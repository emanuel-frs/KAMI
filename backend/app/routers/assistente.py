"""
Módulo Assistente (Sprint 8 — IA-01: camada de provedores; IA-02: chat).
As ferramentas de leitura e a proteção entram no IA-03/SEG-07.

Endpoints:
  GET    /api/assistente                       estado: ligado? pronto? o que
                                               falta? provedor em uso, config,
                                               uso de hoje
  GET    /api/assistente/catalogo              provedores conhecidos (só
                                               pré-preenchem — provedores.json)
  PUT    /api/assistente/config                ligar/desligar, esconder o
                                               botão, teto, histórico
  GET    /api/assistente/provedores            provedores salvos (sem chave)
  POST   /api/assistente/provedores            salva um provedor (o primeiro
                                               já fica em uso)
  PUT    /api/assistente/provedores/{id}       edita; trocar o endereço com
                                               chave salva APAGA a chave (P-109)
  DELETE /api/assistente/provedores/{id}
  POST   /api/assistente/provedores/{id}/usar  passa a usar este
  POST   /api/assistente/provedores/{id}/testar
                                               uma chamada de teste (conta no
                                               teto): conexão + ferramentas
  POST   /api/assistente/mensagens             chat (IA-02): resposta em
                                               streaming (SSE); sem
                                               conversa_id começa uma nova
  GET    /api/assistente/conversas             histórico (P-105)
  GET    /api/assistente/conversas/{id}        mensagens de uma conversa
  DELETE /api/assistente/conversas/{id}
  DELETE /api/assistente/conversas             apagar tudo (conversas +
                                               registro do que foi enviado)
  GET    /api/assistente/envios                o que foi enviado pra IA
  DELETE /api/assistente/envios                (princípio 3)
  POST   /api/assistente/modelos               lista os modelos do provedor
                                               (/models) — com a chave
                                               digitada, sem salvar, ou com a
                                               salva se o endereço é o mesmo

A chave da API nunca volta pra tela (`tem_chave`). Erro do provedor nunca
é 5xx: não é defeito do Kami e a pessoa resolve no formulário (chave,
modelo, endereço), então sai como 4xx com a chave `erro.assistente.*` e o
texto que o provedor mandou em `vars.detalhe` (ver ERROS_PROVEDOR).
"""
import asyncio
import json
import logging
import threading
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from app import database
from app.assistente import catalogo, chat, config, conversas, instrucoes, provedores, transporte, uso
from app.assistente.erros import erro_do_provedor, falta as _falta, teto as _teto, url as _url
from app.assistente.tipos import Provedor
from app.crypto import encrypt_password
from app.database import get_db, new_id, now_iso
from app.limites import Entrada, SEGREDO_MAX, URL_MAX
from app.mensagens import ErroKami

logger = logging.getLogger(__name__)

router = APIRouter()

def _provedor_ou_404(db, provedor_id: str):
    row = config.obter_provedor(db, provedor_id)
    if not row:
        raise ErroKami(404, "erro.assistente.provedor_inexistente", "provedor não encontrado")
    return row


def _montar(row) -> Provedor:
    try:
        return config.montar(row)
    except ValueError:
        raise ErroKami(422, "erro.assistente.chave_ilegivel",
                       "a chave salva deste provedor não pôde ser lida — cole a chave de novo")


# ── estado e configuração ───────────────────────────────────────────────

@router.get("")
def get_estado(db=Depends(get_db)):
    return {**config.estado(db), "uso_hoje": uso.hoje(db)}


@router.get("/catalogo")
def get_catalogo():
    return catalogo.listar()


class ConfigIn(Entrada):
    ativo: Optional[bool] = None
    escondido: Optional[bool] = None
    teto_chamadas: Optional[int] = None
    teto_tokens: Optional[int] = None
    max_rodadas: Optional[int] = None
    guardar_conversas: Optional[bool] = None
    dias_historico: Optional[int] = None
    permissoes: Optional[dict[str, bool]] = None  # P-113: {área: pode ler?}


@router.put("/config")
def put_config(payload: ConfigIn, db=Depends(get_db)):
    campos = payload.model_dump(exclude_none=True)
    novas_permissoes = campos.pop("permissoes", None)
    if novas_permissoes is not None:
        if set(novas_permissoes) - set(config.AREAS):
            raise ErroKami(422, "erro.assistente.area_desconhecida", "área desconhecida")
        config.salvar_permissoes(db, novas_permissoes)
    for nome, (minimo, maximo) in config.LIMITES.items():
        if nome in campos and not (minimo <= campos[nome] <= maximo):
            raise ErroKami(422, "erro.assistente.fora_do_limite", "valor fora do limite: use entre {min} e {max}",
                           campo=nome, min=minimo, max=maximo)
    if campos.get("ativo"):
        estado = config.estado(db)
        if estado["falta"] not in (None, "desligado"):
            raise _falta(estado["falta"])
    campos = {k: int(v) if isinstance(v, bool) else v for k, v in campos.items()}
    config.atualizar(db, campos)
    return {**config.estado(db), "uso_hoje": uso.hoje(db)}


# ── provedores ─────────────────────────────────────────────────────────

class ProvedorIn(Entrada):
    catalogo: str = Field(..., max_length=40)
    nome: Optional[str] = Field(None, max_length=60)
    url_base: Optional[str] = Field(None, max_length=URL_MAX)
    modelo: Optional[str] = Field(None, max_length=200)
    api_key: Optional[str] = Field(None, max_length=SEGREDO_MAX)


class ProvedorEditIn(Entrada):
    nome: Optional[str] = Field(None, max_length=60)
    url_base: Optional[str] = Field(None, max_length=URL_MAX)
    modelo: Optional[str] = Field(None, max_length=200)
    api_key: Optional[str] = Field(None, max_length=SEGREDO_MAX)
    apagar_chave: bool = False


def _limpo(texto: Optional[str]) -> Optional[str]:
    texto = (texto or "").strip()
    return texto or None


@router.get("/provedores")
def get_provedores(db=Depends(get_db)):
    return config.listar(db)


@router.post("/provedores", status_code=201)
def criar_provedor(payload: ProvedorIn, db=Depends(get_db)):
    cat = catalogo.obter(payload.catalogo)
    if not cat:
        raise ErroKami(422, "erro.assistente.catalogo_desconhecido", "provedor desconhecido")
    url, _local = _url(payload.url_base if payload.url_base is not None else cat["url_base"])
    chave = _limpo(payload.api_key)
    agora = now_iso()
    pid = new_id()
    db.execute(
        "INSERT INTO assistente_provedores (id, catalogo, nome, tipo, url_base, modelo, chave_enc, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (pid, cat["id"], _limpo(payload.nome) or cat["nome"], cat["tipo"], url, _limpo(payload.modelo),
         encrypt_password(chave) if chave else None, agora, agora),
    )
    if not config.obter(db)["provedor_id"]:
        config.usar_provedor(db, pid)
    db.commit()
    return config.publico(config.obter_provedor(db, pid))


@router.put("/provedores/{provedor_id}")
def editar_provedor(provedor_id: str, payload: ProvedorEditIn, db=Depends(get_db)):
    row = _provedor_ou_404(db, provedor_id)
    sets: dict = {}
    if payload.nome is not None:
        sets["nome"] = _limpo(payload.nome) or row["nome"]
    if payload.modelo is not None:
        sets["modelo"] = _limpo(payload.modelo)
    chave = _limpo(payload.api_key)
    if payload.url_base is not None:
        url, _local = _url(payload.url_base)
        if url != row["url_base"]:
            sets["url_base"] = url
            # P-109: a chave só vai pro endereço em que foi colada
            if not chave:
                sets["chave_enc"] = None
    if chave:
        sets["chave_enc"] = encrypt_password(chave)
    elif payload.apagar_chave:
        sets["chave_enc"] = None
    if sets:
        # mudou o que define a conexão → o último teste não vale mais
        if {"url_base", "modelo", "chave_enc"} & sets.keys():
            sets.update(teste_em=None, teste_ok=None, ferramentas_ok=None)
        colunas = ", ".join(f"{k} = ?" for k in sets)  # nomes fixos deste código
        db.execute(f"UPDATE assistente_provedores SET {colunas}, updated_at = ? WHERE id = ?",
                   (*sets.values(), now_iso(), provedor_id))
        db.commit()
    return config.publico(config.obter_provedor(db, provedor_id))


@router.delete("/provedores/{provedor_id}", status_code=204)
def apagar_provedor(provedor_id: str, db=Depends(get_db)):
    _provedor_ou_404(db, provedor_id)
    era_o_em_uso = config.obter(db)["provedor_id"] == provedor_id
    db.execute("DELETE FROM assistente_provedores WHERE id = ?", (provedor_id,))
    if era_o_em_uso:
        # sem provedor o assistente não funciona — desliga em vez de
        # deixar "ligado" apontando pro nada
        config.usar_provedor(db, None)
        cfg = config.obter(db)
        db.execute("UPDATE assistente_config SET ativo = 0 WHERE id = ?", (cfg["id"],))
    db.commit()


@router.post("/provedores/{provedor_id}/usar")
def usar_provedor(provedor_id: str, db=Depends(get_db)):
    _provedor_ou_404(db, provedor_id)
    config.usar_provedor(db, provedor_id)
    db.commit()
    return {**config.estado(db), "uso_hoje": uso.hoje(db)}


@router.post("/provedores/{provedor_id}/testar")
def testar_provedor(provedor_id: str, db=Depends(get_db)):
    row = _provedor_ou_404(db, provedor_id)
    p = _montar(row)
    if not p.modelo:
        raise _falta("modelo")
    pub = config.publico(row)
    if pub["chave_exigida"] and not p.chave:
        raise _falta("chave")
    _teto(db, p.local)
    try:
        resultado = provedores.testar(p)
    except transporte.ErroProvedor as e:
        # chamada recusada não é cobrada, mas conta pro "testado agora"
        db.execute("UPDATE assistente_provedores SET teste_em = ?, teste_ok = 0, ferramentas_ok = NULL WHERE id = ?",
                   (now_iso(), provedor_id))
        db.commit()
        logger.info("assistente: teste do provedor falhou (%s, http %s)", e.codigo, e.status)
        raise erro_do_provedor(e)
    u = resultado["uso"]
    if u:
        uso.registrar(db, u.entrada, u.saida)
    else:
        uso.registrar(db, uso.estimar(200), uso.estimar(len(resultado["texto"])), estimado=True)
    db.execute("UPDATE assistente_provedores SET teste_em = ?, teste_ok = 1, ferramentas_ok = ? WHERE id = ?",
               (now_iso(), int(resultado["ferramentas"]), provedor_id))
    db.commit()
    return {
        "ok": True,
        "ferramentas": resultado["ferramentas"],
        "ms": resultado["ms"],
        "provedor": config.publico(config.obter_provedor(db, provedor_id)),
        "uso_hoje": uso.hoje(db),
    }


class ModelosIn(Entrada):
    catalogo: str = Field(..., max_length=40)
    url_base: str = Field(..., max_length=URL_MAX)
    api_key: Optional[str] = Field(None, max_length=SEGREDO_MAX)
    provedor_id: Optional[str] = Field(None, max_length=40)


@router.post("/modelos")
def listar_modelos(payload: ModelosIn, db=Depends(get_db)):
    cat = catalogo.obter(payload.catalogo)
    if not cat:
        raise ErroKami(422, "erro.assistente.catalogo_desconhecido", "provedor desconhecido")
    url, local = _url(payload.url_base)
    chave = _limpo(payload.api_key)
    if not chave and payload.provedor_id:
        row = config.obter_provedor(db, payload.provedor_id)
        # P-109: a chave salva só vai pro MESMO endereço em que foi colada
        if row and row["chave_enc"] and row["url_base"] == url:
            chave = _montar(row).chave
    if cat["chave"] == "obrigatoria" and not chave:
        raise _falta("chave")
    try:
        modelos = provedores.listar_modelos(Provedor(cat["tipo"], url, None, chave, local))
    except transporte.ErroProvedor as e:
        logger.info("assistente: listar modelos falhou (%s, http %s)", e.codigo, e.status)
        raise erro_do_provedor(e)
    return {"modelos": modelos}


# ── chat (IA-02) ─────────────────────────────────────────────────────────

class MensagemIn(Entrada):
    texto: str = Field("", max_length=chat.TEXTO_MAX)  # vazio só com `acao`
    acao: Optional[Literal["continuar", "refazer"]] = None  # sobre a última resposta da conversa
    conversa_id: Optional[str] = Field(None, max_length=40)
    tela: Optional[str] = Field(None, max_length=40)
    idioma: Optional[str] = Field(None, max_length=10)


def _checar_antes(conversa_id: Optional[str], acao: Optional[str] = None) -> None:
    """O que dá pra recusar ANTES de abrir o streaming sai como resposta
    comum (4xx): desligado, falta provedor/modelo/chave, teto, conversa
    que não existe, nada pra continuar/refazer. Conexão própria: roda no
    threadpool."""
    conn = database.get_connection()
    try:
        chat.preparar(conn)
        conversa = conversas.obter(conn, conversa_id) if conversa_id else None
        if conversa_id and conversa is None:
            raise ErroKami(404, "erro.assistente.conversa_inexistente", "conversa não encontrada")
        if acao:
            if conversa is None:
                raise ErroKami(409, "erro.assistente.nada_pra_refazer", "não há resposta pra refazer")
            chat.alvo(conversa, acao)
    finally:
        conn.close()


@router.post("/mensagens")
async def enviar_mensagem(payload: MensagemIn):
    """
    Uma mensagem → a resposta em streaming (text/event-stream; eventos em
    app/assistente/chat.py). A conversa nova nasce aqui (sem conversa_id).

    A leitura do provedor roda numa thread própria (o urllib bloqueia) e
    passa os eventos por uma fila; se a tela desconectar (botão parar,
    painel fechado, app fechado), o `finally` cancela — fecha a conexão
    com o provedor na hora, e a resposta parcial fica guardada como
    interrompida.
    """
    texto = payload.texto.strip()
    if not texto and not payload.acao:
        raise ErroKami(422, "erro.assistente.texto_vazio", "escreva uma mensagem")
    idioma = payload.idioma if payload.idioma in instrucoes.IDIOMAS else "pt"
    await run_in_threadpool(_checar_antes, payload.conversa_id, payload.acao)

    cancelamento = transporte.Cancelamento()
    fila: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def entregar(ev):
        loop.call_soon_threadsafe(fila.put_nowait, ev)

    def produzir():
        conn = database.get_connection()
        try:
            for ev in chat.turno(conn, payload.conversa_id, texto, idioma, payload.tela, cancelamento, payload.acao):
                entregar(ev)
        except ErroKami as e:  # condição mudou entre a checagem e aqui (ex.: teto)
            entregar({"tipo": "falha", "status": e.status_code, "chave": e.chave, "detail": e.detail, "vars": e.vars})
        except Exception:  # noqa: BLE001 — a tela precisa saber que acabou
            logger.exception("assistente: erro inesperado no chat")
            entregar({"tipo": "falha", "status": 500, "chave": "erro.erro_interno", "detail": "erro inesperado", "vars": {}})
        finally:
            conn.close()
            entregar(None)

    threading.Thread(target=produzir, name="assistente-chat", daemon=True).start()

    async def corpo():
        try:
            while True:
                ev = await fila.get()
                if ev is None:
                    break
                yield f"event: {ev['tipo']}\ndata: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        finally:
            cancelamento.cancelar()

    return StreamingResponse(corpo(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/conversas")
def get_conversas(db=Depends(get_db)):
    return conversas.listar(db)


@router.get("/conversas/{conversa_id}")
def get_conversa(conversa_id: str, db=Depends(get_db)):
    c = conversas.obter(db, conversa_id)
    if c is None:
        raise ErroKami(404, "erro.assistente.conversa_inexistente", "conversa não encontrada")
    # a tela mostra o que a pessoa e o assistente disseram; os resultados
    # das ferramentas ficam no registro do que foi enviado
    c["mensagens"] = [m for m in c["mensagens"] if m["papel"] != "ferramenta" and (m["texto"] or m["erro_chave"] or m["interrompida"] or m.get("aviso"))]
    return c


@router.delete("/conversas/{conversa_id}", status_code=204)
def apagar_conversa(conversa_id: str, db=Depends(get_db)):
    if not conversas.apagar(db, conversa_id):
        raise ErroKami(404, "erro.assistente.conversa_inexistente", "conversa não encontrada")


@router.delete("/conversas", status_code=204)
def apagar_todas_conversas(db=Depends(get_db)):
    conversas.apagar_tudo(db)


@router.get("/envios")
def get_envios(db=Depends(get_db)):
    return conversas.listar_envios(db)


@router.delete("/envios", status_code=204)
def apagar_envios(db=Depends(get_db)):
    conversas.apagar_envios(db)
