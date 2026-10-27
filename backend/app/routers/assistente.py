"""
Módulo Assistente (Sprint 8 — IA-01: camada de provedores). O chat entra
no IA-02; as ferramentas de leitura e a proteção, no IA-03/SEG-07.

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
  POST   /api/assistente/modelos               lista os modelos do provedor
                                               (/models) — com a chave
                                               digitada, sem salvar, ou com a
                                               salva se o endereço é o mesmo

A chave da API nunca volta pra tela (`tem_chave`). Erro do provedor nunca
é 5xx: não é defeito do Kami e a pessoa resolve no formulário (chave,
modelo, endereço), então sai como 4xx com a chave `erro.assistente.*` e o
texto que o provedor mandou em `vars.detalhe` (ver ERROS_PROVEDOR).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import Field

from app.assistente import catalogo, config, provedores, transporte, uso
from app.assistente.tipos import Provedor
from app.crypto import encrypt_password
from app.database import get_db, new_id, now_iso
from app.limites import Entrada, SEGREDO_MAX, URL_MAX
from app.mensagens import ErroKami

logger = logging.getLogger(__name__)

router = APIRouter()

# Erro do provedor → resposta. Uma ErroKami literal por código (o teste
# tests/test_mensagens.py confere chave e texto contra o pt.json). Em
# `vars`: `detalhe` é o que o provedor disse (cortado, sem a chave da
# API), `http` o status dele, `local` o endereço de um redirecionamento.
def erro_do_provedor(e: transporte.ErroProvedor) -> ErroKami:
    v = {"detalhe": e.detalhe, "http": e.status, "local": e.local_redirecionado}
    c = e.codigo
    if c == "chave_invalida":
        return ErroKami(422, "erro.assistente.provedor.chave_invalida",
                        "o provedor recusou a chave — confira se colou a chave inteira e se ela ainda está ativa", **v)
    if c == "sem_credito":
        return ErroKami(422, "erro.assistente.provedor.sem_credito", "a conta no provedor está sem crédito ou cota", **v)
    if c == "limite":
        return ErroKami(429, "erro.assistente.provedor.limite",
                        "o provedor pediu pra esperar: muitas chamadas em pouco tempo", **v)
    if c == "modelo_indisponivel":
        return ErroKami(422, "erro.assistente.provedor.modelo_indisponivel",
                        "esse modelo não está disponível nesse provedor — escolha outro da lista", **v)
    if c == "sem_ferramentas":
        return ErroKami(422, "erro.assistente.provedor.sem_ferramentas",
                        "esse modelo não aceita ferramentas — escolha outro da lista", **v)
    if c == "url_errada":
        return ErroKami(422, "erro.assistente.provedor.url_errada",
                        "o endereço não respondeu como uma API de IA — confira a URL", **v)
    if c == "redirecionado":
        return ErroKami(422, "erro.assistente.provedor.redirecionado",
                        "o endereço mandou pra outro lugar ({local}) — por segurança o Kami não segue; confira a URL", **v)
    if c == "sem_conexao":
        return ErroKami(424, "erro.assistente.provedor.sem_conexao",
                        "não deu pra conectar ao provedor — confira a internet ou, se for local, se o programa está aberto", **v)
    if c == "tempo_esgotado":
        return ErroKami(424, "erro.assistente.provedor.tempo_esgotado", "o provedor demorou demais pra responder", **v)
    if c == "servidor":
        return ErroKami(424, "erro.assistente.provedor.servidor",
                        "o provedor está com problema agora — tente de novo daqui a pouco", **v)
    if c == "recusado":
        return ErroKami(422, "erro.assistente.provedor.recusado", "o provedor recusou o pedido", **v)
    return ErroKami(424, "erro.assistente.provedor.resposta_invalida", "o provedor respondeu algo que o Kami não entendeu", **v)


def _url(url: str) -> tuple[str, bool]:
    try:
        return provedores.normalizar_url(url)
    except provedores.UrlInvalida as e:
        m = e.motivo
    if m == "vazia":
        raise ErroKami(422, "erro.assistente.url.vazia", "informe o endereço da API")
    if m == "esquema":
        raise ErroKami(422, "erro.assistente.url.esquema", "o endereço precisa começar com https://")
    if m == "credenciais":
        raise ErroKami(422, "erro.assistente.url.credenciais", "o endereço não pode ter usuário ou senha")
    if m == "consulta":
        raise ErroKami(422, "erro.assistente.url.consulta", "o endereço não pode ter ? nem #")
    if m == "http_fora_da_rede":
        raise ErroKami(422, "erro.assistente.url.http_fora_da_rede",
                       "http:// só vale pra este computador ou a rede local — use https://")
    raise ErroKami(422, "erro.assistente.url.host", "endereço inválido")


def _falta(falta: str) -> ErroKami:
    if falta == "modelo":
        return ErroKami(422, "erro.assistente.falta.modelo", "escolha um modelo antes")
    if falta == "chave":
        return ErroKami(422, "erro.assistente.falta.chave", "cole a chave da API antes")
    return ErroKami(422, "erro.assistente.falta.provedor", "configure um provedor antes")


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


def _teto(db, local: bool):
    try:
        uso.conferir(db, config.obter(db), local)
    except uso.TetoAtingido as e:
        if e.qual == "chamadas":
            raise ErroKami(429, "erro.assistente.teto.chamadas",
                           "o assistente chegou ao teto de {teto} chamadas de hoje — dá pra mudar em configurações › assistente",
                           usado=e.usado, teto=e.teto)
        raise ErroKami(429, "erro.assistente.teto.tokens",
                       "o assistente chegou ao teto de {teto} tokens de hoje — dá pra mudar em configurações › assistente",
                       usado=e.usado, teto=e.teto)


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


@router.put("/config")
def put_config(payload: ConfigIn, db=Depends(get_db)):
    campos = payload.model_dump(exclude_none=True)
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
