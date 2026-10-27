"""
Laço de uma mensagem do chat (IA-02): da mensagem da pessoa até a
resposta completa, como uma sequência de eventos que a rota manda pro
frontend em SSE.

    {"tipo": "inicio", "conversa_id", "provedor", "modelo", "local"}
    {"tipo": "texto", "delta"}                       pedaço da resposta
    {"tipo": "fim", "motivo", "uso_hoje"}            fim | limite | parado | outro
    {"tipo": "falha", "status", "chave", "detail", "vars", "uso_hoje"}

Cada volta do laço é UMA chamada ao provedor, e antes de cada uma:
- confere o teto do dia (P-104) — inclusive no meio de um laço de
  ferramentas, que é onde o gasto dispara;
- confere se o app foi bloqueado pelo PIN no meio (SEG-02);
- registra o que vai sair (princípio 3) — só o que é NOVO naquela chamada.
O número de voltas é limitado por `max_rodadas` (as ferramentas chegam no
IA-03; aqui o laço já existe pra elas).

Histórico: só desta conversa (princípio 1 — conversa antiga nunca vai pro
modelo), cortado pelo fim até HISTORICO_MAX_CARACTERES, pra uma conversa
longa não gastar cada vez mais.
"""
from dataclasses import asdict
from typing import Callable, Iterator
from urllib.parse import urlsplit

from app import pin
from app.assistente import config, conversas, erros, instrucoes, provedores, transporte, uso
from app.assistente.tipos import Chamada, ChamadaFerramenta, Fim, Mensagem, TextoDelta, Uso
from app.database import local_now
from app.mensagens import ErroKami

HISTORICO_MAX_CARACTERES = 16_000
TEXTO_MAX = 4000


def _evento_erro(e: ErroKami, conn) -> dict:
    return {"tipo": "falha", "status": e.status_code, "chave": e.chave, "detail": e.detail,
            "vars": e.vars, "uso_hoje": uso.hoje(conn)}


def _historico(mensagens: list[dict]) -> list[Mensagem]:
    """As mensagens guardadas desta conversa no formato neutro, das mais
    recentes pra trás até o limite — começando sempre numa mensagem da
    pessoa (resultado de ferramenta solto, sem o pedido, não serve)."""
    escolhidas, total = [], 0
    for m in reversed(mensagens):
        tamanho = len(m["texto"]) + sum(len(str(c)) for c in m["chamadas"])
        if escolhidas and total + tamanho > HISTORICO_MAX_CARACTERES:
            break
        escolhidas.append(m)
        total += tamanho
    escolhidas.reverse()
    while escolhidas and escolhidas[0]["papel"] != "usuario":
        escolhidas.pop(0)
    saida = []
    for m in escolhidas:
        if m["papel"] == "assistente" and not m["texto"] and not m["chamadas"]:
            continue  # resposta que falhou antes do 1º pedaço
        saida.append(Mensagem(m["papel"], m["texto"], [ChamadaFerramenta(**c) for c in m["chamadas"]],
                              id_chamada=m.get("id_chamada"), nome_ferramenta=m.get("nome_ferramenta")))
    return saida


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


def turno(conn, conversa_id: str | None, texto: str, idioma: str, tela: str | None,
          cancelamento: transporte.Cancelamento, ferramentas=None,
          executar: Callable | None = None) -> Iterator[dict]:
    cfg, row, p = preparar(conn)
    if conversa_id:
        conversa = conversas.obter(conn, conversa_id)
        if conversa is None:
            raise ErroKami(404, "erro.assistente.conversa_inexistente", "conversa não encontrada")
    else:
        conversa = {**conversas.criar(conn, texto, tela), "mensagens": []}
    cid = conversa["id"]
    historico = _historico(conversa["mensagens"])
    conversas.adicionar_mensagem(conn, cid, "usuario", texto)

    sistema = Mensagem("sistema", instrucoes.montar(idioma, tela, local_now().date()))
    mensagens = [sistema, *historico, Mensagem("usuario", texto)]
    novos = [{"tipo": "instrucoes", "versao": instrucoes.VERSAO, "idioma": idioma, "tela": tela},
             {"tipo": "historico", "mensagens": len(historico)},
             {"tipo": "mensagem", "texto": texto}]
    destino = urlsplit(p.url_base).hostname or p.url_base
    yield {"tipo": "inicio", "conversa_id": cid, "titulo": conversa["titulo"], "provedor": row["nome"],
           "modelo": p.modelo, "local": p.local}

    # `texto_rodada` fica fora do try: parar ou erro no meio de uma volta
    # guarda o que já tinha chegado (a tela já mostrou)
    resposta, texto_rodada, motivo, erro = "", "", "fim", None
    # chamada que começou a responder e foi cortada (parar, erro no meio)
    # também é cobrada pelo provedor: conta com estimativa
    em_andamento = None  # (envio_id, caracteres enviados) enquanto a volta não foi contada
    try:
        for _rodada in range(cfg["max_rodadas"] + 1):
            if pin.bloqueado():
                cancelamento.cancelar()
                raise transporte.Cancelado()
            erros.teto(conn, p.local)
            envio_id = conversas.registrar_envio(conn, cid, row["nome"], p.modelo, destino, p.local, novos)
            caracteres_enviados = sum(len(m.texto) for m in mensagens)
            texto_rodada, chamadas, u, fim = "", [], None, "outro"
            for ev in provedores.adaptador(p.tipo).conversar(p, mensagens, ferramentas, cancelamento):
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
            resposta, texto_rodada = resposta + texto_rodada, ""
            if not (chamadas and executar):
                motivo = fim if fim in ("fim", "limite") else "outro"
                break
            # IA-03: executar as ferramentas e voltar com os resultados
            mensagens.append(Mensagem("assistente", texto_rodada, chamadas))
            conversas.adicionar_mensagem(conn, cid, "assistente", texto_rodada, chamadas=[asdict(c) for c in chamadas],
                                         provedor=row["nome"], modelo=p.modelo)
            novos = []
            for c in chamadas:
                resultado = executar(conn, c)
                mensagens.append(Mensagem("ferramenta", resultado, id_chamada=c.id, nome_ferramenta=c.nome))
                conversas.adicionar_mensagem(conn, cid, "ferramenta", resultado, id_chamada=c.id, nome_ferramenta=c.nome)
                novos.append({"tipo": "ferramenta", "nome": c.nome, "argumentos": c.argumentos, "resultado": resultado})
            resposta = ""
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
    conversas.adicionar_mensagem(conn, cid, "assistente", resposta, provedor=row["nome"], modelo=p.modelo,
                                 interrompida=motivo == "parado" or erro is not None,
                                 erro_chave=erro.chave if erro else None)
    if erro:
        yield _evento_erro(erro, conn)
    else:
        yield {"tipo": "fim", "motivo": motivo, "uso_hoje": uso.hoje(conn)}
