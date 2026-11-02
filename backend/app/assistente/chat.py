"""
Laço de uma mensagem do chat (IA-02): da mensagem da pessoa até a
resposta completa, como uma sequência de eventos que a rota manda pro
frontend em SSE.

    {"tipo": "inicio", "conversa_id", "provedor", "modelo", "local"}
    {"tipo": "texto", "delta"}                       pedaço da resposta
    {"tipo": "ferramenta", "nome"}                   o modelo pediu dados (IA-03)
    {"tipo": "quadro", "nome", "dados"}              IA-07a: os números dessa consulta, pra tela
                                                     mostrar do jeito que o Kami leu
    {"tipo": "proposta", "mensagem_id", "proposta"}  IA-05: cartão de prévia de ações
    {"tipo": "mascarado", "n", "texto"}              P-139: números de conta/documento
                                                     trocados na mensagem da pessoa
    {"tipo": "cuidado", "servico"}                   P-111: o Kami respondeu sozinho
    {"tipo": "conferido", "texto", "valores"}        IA-07a: resposta com a moeda arrumada e os
                                                     valores/datas que não estão nos dados (conferir.py)
    {"tipo": "fim", "motivo", "uso_hoje"}            fim | limite | parado | rodadas | cuidado | outro
    {"tipo": "falha", "status", "chave", "detail", "vars", "uso_hoje"}

Cada volta do laço é UMA chamada ao provedor, e antes de cada uma:
- confere o teto do dia (P-104) — inclusive no meio de um laço de
  ferramentas, que é onde o gasto dispara;
- confere se o app foi bloqueado pelo PIN no meio (SEG-02);
- registra o que vai sair (princípio 3) — só o que é NOVO naquela chamada.
O número de voltas é limitado por `max_rodadas` (as ferramentas chegam no
IA-03; aqui o laço já existe pra elas).

Continuar / refazer (retorno do teste da F3): `acao="refazer"` apaga a
última resposta e roda de novo a última pergunta; `acao="continuar"`
manda a resposta cortada no histórico + um pedido escondido pra seguir
de onde parou, e o texto novo é emendado nela. Nenhum dos dois cria
mensagem da pessoa.

Ações (IA-05): `propose_actions` não grava nada — vira uma proposta
guardada no resultado da ferramenta e um cartão na tela (acoes.py). No
máximo uma por resposta; no histórico, o resultado leva junto o que a
pessoa fez com ela depois (aplicou, descartou, desfez).

Histórico: só desta conversa (princípio 1 — conversa antiga nunca vai pro
modelo), cortado pelo fim até HISTORICO_MAX_CARACTERES, pra uma conversa
longa não gastar cada vez mais.
"""
import json
import re
from dataclasses import asdict, replace
from typing import Iterator
from urllib.parse import urlsplit

from app import pin
from app.assistente import acoes, conferir, config, conversas, cuidado, erros, filtro, instrucoes, provedores, transporte, uso
from app.assistente import ferramentas as ferramentas_mod
from app.assistente.tipos import Chamada, ChamadaFerramenta, Fim, Mensagem, TextoDelta, Uso
from app.database import local_now
from app.mensagens import ErroKami

HISTORICO_MAX_CARACTERES = 16_000
# IA-07a: o Ollama roda com 4.096 tokens e só instruções + ferramentas já
# levam ~2.700 — na 3ª pergunta a resposta cortava (teste do Emanuel:
# 3.978 enviados, sobraram 118). No local, o histórico leva só o texto das
# perguntas e respostas (sem os dados já consultados) e cabe neste limite.
HISTORICO_LOCAL_CARACTERES = 1_500
TEXTO_MAX = 4000
ACOES = ("continuar", "refazer")
CONTINUAR = ("Your previous answer was cut off. Continue it exactly where it stopped: "
             "no preamble, and do not repeat anything already written.")


def _evento_erro(e: ErroKami, conn) -> dict:
    return {"tipo": "falha", "status": e.status_code, "chave": e.chave, "detail": e.detail,
            "vars": e.vars, "uso_hoje": uso.hoje(conn)}


def _so_texto(m: dict) -> dict:
    """Mensagem do histórico local sem pedido de ferramenta; a proposta
    (IA-05) vira uma linha do assistente dizendo o que a pessoa fez com ela."""
    if m["papel"] == "ferramenta":
        return {**m, "papel": "assistente", "texto": acoes.estado_pro_modelo(m["proposta"]).strip(),
                "chamadas": [], "proposta": None, "id_chamada": None, "nome_ferramenta": None}
    return {**m, "chamadas": []}


def _historico(mensagens: list[dict], local: bool = False) -> list[Mensagem]:
    """As mensagens guardadas desta conversa no formato neutro, das mais
    recentes pra trás até o limite — começando sempre numa mensagem da
    pessoa (resultado de ferramenta solto, sem o pedido, não serve)."""
    limite = HISTORICO_LOCAL_CARACTERES if local else HISTORICO_MAX_CARACTERES
    if local:
        mensagens = [_so_texto(m) for m in mensagens
                     if (m["papel"] != "ferramenta" or m.get("proposta"))
                     and not (m["papel"] == "assistente" and m["chamadas"] and not m["texto"])]
    escolhidas, total = [], 0
    for m in reversed(mensagens):
        tamanho = len(m["texto"]) + sum(len(str(c)) for c in m["chamadas"])
        if escolhidas and total + tamanho > limite:
            break
        escolhidas.append(m)
        total += tamanho
    escolhidas.reverse()
    while escolhidas and escolhidas[0]["papel"] != "usuario":
        escolhidas.pop(0)
    saida = []
    for m in escolhidas:
        if _cuidado_de(m):
            continue  # P-111: o que passou pelo fluxo de cuidado nunca vai pro provedor
        if m["papel"] == "assistente" and not m["texto"] and not m["chamadas"]:
            continue  # resposta que falhou antes do 1º pedaço
        texto = m["texto"] + (acoes.estado_pro_modelo(m["proposta"]) if m.get("proposta") else "")
        saida.append(Mensagem(m["papel"], texto, [ChamadaFerramenta(**c) for c in m["chamadas"]],
                              id_chamada=m.get("id_chamada"), nome_ferramenta=m.get("nome_ferramenta")))
    return saida


def _cuidado_de(m: dict) -> bool:
    return (m.get("aviso") or {}).get("tipo") == "cuidado"


def alvo(conversa: dict, acao: str) -> tuple[int, dict | None]:
    """Índice da última pergunta e, no continuar, a resposta cortada.
    Pergunta que passou pelo fluxo de cuidado não se refaz (nunca vai
    pro provedor)."""
    msgs = conversa["mensagens"]
    i = next((k for k in range(len(msgs) - 1, -1, -1) if msgs[k]["papel"] == "usuario"), None)
    if i is None or _cuidado_de(msgs[i]):
        raise ErroKami(409, "erro.assistente.nada_pra_refazer", "não há resposta pra refazer")
    if acao == "refazer":
        return i, None
    ultima = msgs[-1]
    if ultima["papel"] != "assistente" or not ultima["interrompida"] or not ultima["texto"]:
        raise ErroKami(409, "erro.assistente.nada_pra_continuar", "não há resposta cortada pra continuar")
    return i, ultima


def preparar(conn) -> tuple:
    """(cfg, row, Provedor) do provedor em uso — ou ErroKami dizendo o que
    falta. Roda ANTES de abrir o streaming, pra esses erros saírem como
    resposta comum (4xx), não no meio do SSE."""
    estado = config.estado(conn)
    if not estado["pronto"]:
        if estado["falta"] == "desligado":
            raise ErroKami(409, "erro.assistente.desligado", "o assistente está desligado — ligue em configurações › assistente")
        raise erros.falta(estado["falta"])
    row, p = config.provedor_em_uso(conn)
    erros.teto(conn, p.local)
    return config.obter(conn), row, p


def _perfil(conn) -> dict:
    row = conn.execute("SELECT pais, moeda FROM user_profile LIMIT 1").fetchone()
    return dict(row) if row else {"pais": None, "moeda": None}


def _comeco(conn, cfg: dict, p, idioma: str, tela: str | None) -> tuple[Mensagem, list]:
    """Instruções + ferramentas: o começo igual de toda chamada (e o que
    `aquecer` deixa lido)."""
    permitidas = ferramentas_mod.disponiveis(cfg, local=p.local)
    desligadas = [a for a, ligada in config.permissoes(cfg).items() if not ligada]
    sistema = Mensagem("sistema", instrucoes.montar(idioma, tela, local_now().date(), _perfil(conn)["moeda"],
                                                    desligadas, local=p.local))
    return sistema, [l.ferramenta() for l in permitidas] + [acoes.ferramenta(acoes.atributos(conn))]


def aquecer(conn, idioma: str, tela: str | None, recente: tuple | None = None) -> tuple | None:
    """IA-07a (teste do Emanuel): sem placa de vídeo, o qwen3.5:4b leva
    ~45 s só pra ler instruções + ferramentas (2,5 mil tokens) — a primeira
    pergunta passava de 1 min. O Ollama guarda o que leu por último; lendo
    quando o painel abre, a pergunta só lê o que é novo (2,3 s até pedir
    os dados, medido). Só modelo local: na nuvem custaria uma chamada.
    Nada da pessoa vai junto — só as instruções e as ferramentas.
    Devolve o que ficou lido (None se não é local); `recente` igual a ele
    = já está lido, não chama de novo."""
    cfg, _row, p = preparar(conn)
    if not p.local or p.tipo != "openai":
        return None
    chave = (p.url_base, p.modelo, idioma, tela, local_now().date().isoformat())
    if chave != recente:
        sistema, ferramentas = _comeco(conn, cfg, p, idioma, tela)
        provedores.adaptador(p.tipo).aquecer(p, [sistema, Mensagem("usuario", "ok")], ferramentas)
    return chave


def _cuidado(conn, cid: str, texto: str) -> dict:
    """P-111: o próprio Kami responde (cuidado.py) — nada vai pro provedor.
    As duas mensagens ficam marcadas e saem do histórico das próximas
    chamadas desta conversa."""
    servico = cuidado.servico(_perfil(conn)["pais"])
    aviso = {"tipo": "cuidado", "servico": servico}
    conversas.adicionar_mensagem(conn, cid, "usuario", texto, aviso={"tipo": "cuidado"})
    conversas.adicionar_mensagem(conn, cid, "assistente", "", aviso=aviso)
    return {"tipo": "cuidado", "servico": servico}


def _normalizar_nome(nome: str) -> str:
    return re.sub(r"[\s-]+", "_", (nome or "").strip()).lower()


def _nome_certo(c: ChamadaFerramenta) -> ChamadaFerramenta:
    """IA-07a: modelo pequeno erra a grafia ("Goals", "accounts_and Categories").
    Só caixa, espaço e hífen — nome que não bate continua não existindo."""
    if c.nome in ferramentas_mod._POR_NOME or c.nome == acoes.NOME:
        return c
    conhecidos = {_normalizar_nome(n): n for n in [*ferramentas_mod._POR_NOME, acoes.NOME]}
    certo = conhecidos.get(_normalizar_nome(c.nome))
    return replace(c, nome=certo) if certo else c


def _propor(conn, chamada: ChamadaFerramenta, ja_feitas: int) -> tuple[str, dict | None]:
    """(resultado pro modelo, proposta | None). Erro volta como texto pro
    modelo se corrigir — a conversa não quebra."""
    if ja_feitas:
        return json.dumps({"error": "only one proposal per answer: it is already in the card"}), None
    if "_invalido" in chamada.argumentos:
        return json.dumps({"error": "arguments were not valid JSON"}), None
    try:
        proposta = acoes.propor(conn, chamada.argumentos)
    except ValueError as e:
        return json.dumps({"error": str(e)}), None
    return acoes.resultado_pro_modelo(proposta), {**proposta, "estado": "pendente"}


def turno(conn, conversa_id: str | None, texto: str, idioma: str, tela: str | None,
          cancelamento: transporte.Cancelamento, acao: str | None = None) -> Iterator[dict]:
    cfg, row, p = preparar(conn)
    # P-139: cartão, CPF/CNPJ, IBAN e agência+conta saem do que a pessoa
    # escreveu ANTES de tudo — nem a conversa guardada nem o provedor veem
    mascarados = 0
    if not acao:
        texto, mascarados = filtro.mascarar_numeros(texto)
    if conversa_id:
        conversa = conversas.obter(conn, conversa_id)
        if conversa is None:
            raise ErroKami(404, "erro.assistente.conversa_inexistente", "conversa não encontrada")
    elif acao:
        raise ErroKami(409, "erro.assistente.nada_pra_refazer", "não há resposta pra refazer")
    else:
        conversa = {**conversas.criar(conn, texto, tela), "mensagens": []}
    cid = conversa["id"]
    parcial = None
    if acao:
        i, parcial = alvo(conversa, acao)
        texto = conversa["mensagens"][i]["texto"]
    yield {"tipo": "inicio", "conversa_id": cid, "titulo": conversa["titulo"], "provedor": row["nome"],
           "modelo": p.modelo, "local": p.local}
    if mascarados:
        yield {"tipo": "mascarado", "n": mascarados, "texto": texto}

    if not acao and cuidado.ha_risco(texto):
        yield _cuidado(conn, cid, texto)
        yield {"tipo": "fim", "motivo": "cuidado", "uso_hoje": uso.hoje(conn)}
        return

    if acao == "refazer":
        conversas.remover_mensagens(conn, cid, [m["id"] for m in conversa["mensagens"][i + 1:]])
        historico = _historico(conversa["mensagens"][:i], p.local)
        pergunta, item = Mensagem("usuario", texto), {"tipo": "mensagem", "texto": texto, "refeita": True}
    elif acao == "continuar":
        historico = _historico(conversa["mensagens"], p.local)
        pergunta, item = Mensagem("usuario", CONTINUAR), {"tipo": "continuar"}
    else:
        historico = _historico(conversa["mensagens"], p.local)
        conversas.adicionar_mensagem(conn, cid, "usuario", texto)
        pergunta, item = Mensagem("usuario", texto), {"tipo": "mensagem", "texto": texto}
    sistema, ferramentas = _comeco(conn, cfg, p, idioma, tela)
    mensagens = [sistema, *historico, pergunta]
    novos = [{"tipo": "instrucoes", "versao": instrucoes.VERSAO, "idioma": idioma, "tela": tela},
             {"tipo": "historico", "mensagens": len(historico)}, item]
    destino = urlsplit(p.url_base).hostname or p.url_base

    # `texto_rodada` fica fora do try: parar ou erro no meio de uma volta
    # guarda o que já tinha chegado (a tela já mostrou)
    # no continuar, o texto novo é emendado no que já tinha chegado
    resposta, texto_rodada, motivo, erro = parcial["texto"] if parcial else "", "", "fim", None
    # chamada que começou a responder e foi cortada (parar, erro no meio)
    # também é cobrada pelo provedor: conta com estimativa
    em_andamento = None  # (envio_id, caracteres enviados) enquanto a volta não foi contada
    propostas = 0
    try:
        for _rodada in range(cfg["max_rodadas"] + 1):
            if pin.bloqueado():
                cancelamento.cancelar()
                raise transporte.Cancelado()
            erros.teto(conn, p.local)
            envio_id = conversas.registrar_envio(conn, cid, row["nome"], p.modelo, destino, p.local, novos)
            caracteres_enviados = sum(len(m.texto) for m in mensagens)
            texto_rodada, chamadas, u, fim = "", [], None, "outro"
            for ev in provedores.adaptador(p.tipo).conversar(p, mensagens, ferramentas or None, cancelamento):
                em_andamento = em_andamento or (envio_id, caracteres_enviados)
                if isinstance(ev, TextoDelta):
                    texto_rodada += ev.delta
                    yield {"tipo": "texto", "delta": ev.delta}
                elif isinstance(ev, Chamada):
                    chamadas.append(ev.chamada)
                elif isinstance(ev, Uso):
                    u = ev
                elif isinstance(ev, Fim):
                    fim = ev.motivo
            if u:
                uso.registrar(conn, u.entrada, u.saida)
            else:
                u = Uso(uso.estimar(caracteres_enviados), uso.estimar(len(texto_rodada)))
                uso.registrar(conn, u.entrada, u.saida, estimado=True)
            conn.commit()  # chamada feita = chamada contada, aconteça o que acontecer depois
            em_andamento = None
            conversas.anotar_tokens(conn, envio_id, u.entrada, u.saida)
            if not chamadas:
                resposta, texto_rodada = resposta + texto_rodada, ""
                motivo = fim if fim in ("fim", "limite") else "outro"
                break
            # IA-03: o modelo pediu dados — roda as ferramentas de leitura e
            # volta com os resultados (filtrados e embrulhados em <dados>)
            chamadas = [_nome_certo(c) for c in chamadas]
            mensagens.append(Mensagem("assistente", texto_rodada, chamadas))
            conversas.adicionar_mensagem(conn, cid, "assistente", texto_rodada, chamadas=[asdict(c) for c in chamadas],
                                         provedor=row["nome"], modelo=p.modelo)
            texto_rodada = ""
            novos = []
            for c in chamadas:
                if c.nome == acoes.NOME:
                    resultado, proposta = _propor(conn, c, propostas)
                    msg = conversas.adicionar_mensagem(conn, cid, "ferramenta", resultado, id_chamada=c.id,
                                                       nome_ferramenta=c.nome, proposta=proposta)
                    mensagens.append(Mensagem("ferramenta", resultado, id_chamada=c.id, nome_ferramenta=c.nome))
                    if proposta:
                        propostas += 1
                        yield {"tipo": "proposta", "mensagem_id": msg["id"], "proposta": proposta}
                    novos.append({"tipo": "ferramenta", "nome": c.nome, "argumentos": filtro.limpar_dado(c.argumentos),
                                  "resultado": resultado})
                    continue
                yield {"tipo": "ferramenta", "nome": c.nome}
                resultado = ferramentas_mod.executar(conn, c, cfg)
                if q := ferramentas_mod.quadro(c.nome, resultado):
                    yield {"tipo": "quadro", **q}
                mensagens.append(Mensagem("ferramenta", resultado, id_chamada=c.id, nome_ferramenta=c.nome))
                conversas.adicionar_mensagem(conn, cid, "ferramenta", resultado, id_chamada=c.id, nome_ferramenta=c.nome)
                novos.append({"tipo": "ferramenta", "nome": c.nome, "argumentos": filtro.limpar_dado(c.argumentos),
                              "resultado": resultado})
        else:
            motivo = "rodadas"
    except transporte.Cancelado:
        motivo = "parado"
    except transporte.ErroProvedor as e:
        erro = erros.erro_do_provedor(e)
    except ErroKami as e:
        erro = e
    if em_andamento:
        envio_id, caracteres = em_andamento
        entrada, saida = uso.estimar(caracteres), uso.estimar(len(texto_rodada))
        uso.registrar(conn, entrada, saida, estimado=True)
        conn.commit()
        conversas.anotar_tokens(conn, envio_id, entrada, saida)
    resposta += texto_rodada
    conferido = None
    if resposta and not erro:
        arrumada = conferir.arrumar_moeda(resposta)
        # tudo o que foi consultado NA CONVERSA: no local, o histórico não leva
        # os dados antigos, mas o modelo repete números de respostas anteriores
        consultados = [m["texto"] for m in conversa["mensagens"] if m["papel"] == "ferramenta"]
        valores = conferir.soltos(arrumada, consultados + [m.texto for m in mensagens if m.papel == "ferramenta"],
                                  texto, local_now().date())
        if valores or arrumada != resposta:
            resposta, conferido = arrumada, {"tipo": "conferido", "texto": arrumada, "valores": valores}
    if parcial:
        conversas.remover_mensagens(conn, cid, [parcial["id"]])  # volta emendada, no fim da conversa
    # "limite" = o provedor cortou pelo máximo de tokens: também dá pra continuar
    conversas.adicionar_mensagem(conn, cid, "assistente", resposta, provedor=row["nome"], modelo=p.modelo,
                                 interrompida=motivo in ("parado", "limite") or erro is not None,
                                 erro_chave=erro.chave if erro else None,
                                 aviso={"tipo": "conferir", "valores": conferido["valores"]}
                                 if conferido and conferido["valores"] else None)
    if conferido:
        yield conferido
    if erro:
        yield _evento_erro(erro, conn)
    else:
        yield {"tipo": "fim", "motivo": motivo, "uso_hoje": uso.hoje(conn)}
