"""
Módulo Segurança (Sprint 3 — SEG-01; o PIN do SEG-02 entra aqui também).

Endpoints:
  GET  /api/seguranca/chave            onde está a chave que protege as
                                       senhas salvas: cofre do sistema,
                                       arquivo, ou indisponível (SEG-01)
  POST /api/seguranca/chave/redefinir  gera uma chave nova e APAGA os
                                       segredos cifrados com a antiga
                                       (senha de app do e-mail, token do
                                       GitHub, chave da busca, chave da IA) — saída de
                                       quando o cofre perdeu a chave

  GET  /api/seguranca/pin              PIN ligado? bloqueado? espera?
  POST /api/seguranca/pin              liga o PIN; devolve o código de
                                       recuperação (mostrado uma vez)
  PUT  /api/seguranca/pin              troca o PIN (pede o atual)
  POST /api/seguranca/pin/desativar    tira o PIN (pede o atual)
  POST /api/seguranca/pin/desbloquear  PIN certo → libera a API
  POST /api/seguranca/pin/recuperar    código de recuperação + PIN novo
  POST /api/seguranca/pin/bloquear     bloqueia agora (inatividade)
  PUT  /api/seguranca/pin/inatividade  5/15/30 min ou desligado

  GET  /api/seguranca/cifra            banco cifrado? dá pra ligar aqui?
                                       quantas cópias sem cifra (SEG-08)
  POST /api/seguranca/cifra/ligar      converte o banco; devolve o código
                                       de recuperação (mostrado uma vez)
  POST /api/seguranca/cifra/desligar   volta pro SQLite comum
  POST /api/seguranca/cifra/codigo     mostra o código de novo (com o PIN,
                                       se ligado)
  POST /api/seguranca/cifra/recuperar  banco cifrado sem a chave no cofre:
                                       o código abre (rota livre)

Ver app/crypto.py pro funcionamento do cofre, app/pin.py pro PIN e
app/cifra.py + app/cifra_troca.py pro banco cifrado.
"""
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from typing import Optional

from app import backup_auto, cifra, cifra_troca, crypto, database, pin
from app.database import get_db, now_iso
from app.limites import Entrada
from app.mensagens import ErroKami, erro_de

logger = logging.getLogger(__name__)

router = APIRouter()

REDEFINIR_CONFIRMATION_WORD = "redefinir"


class RedefinirChaveIn(Entrada):
    confirmation: str = Field(..., max_length=20)


def _segredos_salvos(db) -> int:
    return (
        db.execute("SELECT COUNT(*) FROM email_accounts WHERE app_password_enc <> ''").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM github_settings WHERE token_enc IS NOT NULL AND token_enc <> ''").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM search_settings WHERE api_key_enc IS NOT NULL AND api_key_enc <> ''").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM notas WHERE conteudo_cifrado IS NOT NULL").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM assistente_provedores WHERE chave_enc IS NOT NULL").fetchone()[0]
    )


@router.get("/chave")
def get_chave(db=Depends(get_db)):
    return {**crypto.estado_da_chave(), "segredos_salvos": _segredos_salvos(db)}


@router.post("/chave/redefinir")
def redefinir_chave(payload: RedefinirChaveIn, db=Depends(get_db)):
    if payload.confirmation != REDEFINIR_CONFIRMATION_WORD:
        raise ErroKami(
            422,
            "erro.seguranca.confirmacao_invalida_envie_confirmation_redefinir",
            "confirmação inválida; envie confirmation='{redefinir_confirmation_word}' pra prosseguir",
            redefinir_confirmation_word=REDEFINIR_CONFIRMATION_WORD,
        )
    apagados = _segredos_salvos(db)
    backup_auto.copia_antes_de(db, "redefinir-chave")  # CONF-08
    estado = crypto.redefinir_chave()
    # cifrados com a chave antiga = lixo ilegível; a conta de e-mail fica
    # (com a senha vazia) pra pessoa só informar a senha de app de novo
    # ORG-06: a conta já fica marcada — a aba de e-mail avisa na hora que a
    # senha precisa ser informada de novo (antes a sincronização automática
    # só falhava em silêncio)
    db.execute(
        "UPDATE email_accounts SET app_password_enc = '', sync_erro = 'senha', "
        "sync_erro_desde = COALESCE(sync_erro_desde, ?)",
        (now_iso(),),
    )
    db.execute("UPDATE github_settings SET token_enc = NULL")
    db.execute("UPDATE search_settings SET api_key_enc = NULL")
    # IA-01: chave da API de IA — o provedor fica (endereço, modelo), só a
    # chave precisa ser colada de novo; sem ela o assistente não está pronto
    db.execute("UPDATE assistente_provedores SET chave_enc = NULL, teste_ok = NULL, teste_em = NULL, ferramentas_ok = NULL")
    # ORG-01: o texto das notas trancadas também era cifrado com a chave
    # antiga — perdido (a tela de trancar avisa disso). Título e o resto ficam.
    db.execute("UPDATE notas SET conteudo_cifrado = NULL WHERE trancada = 1")
    db.commit()
    return {**estado, "segredos_salvos": 0, "segredos_apagados": apagados}


# ── PIN pra abrir o app (SEG-02) ─────────────────────────────────────────

class PinIn(Entrada):
    pin: str = Field(..., max_length=8)


class TrocarPinIn(Entrada):
    pin_atual: str = Field(..., max_length=8)
    pin_novo: str = Field(..., max_length=8)


class DesativarPinIn(Entrada):
    pin_atual: str = Field(..., max_length=8)


class RecuperarPinIn(Entrada):
    codigo: str = Field(..., max_length=40)
    pin_novo: str = Field(..., max_length=8)


class InatividadeIn(Entrada):
    minutos: Optional[int] = None


def _erro_de_pin(exc: Exception):
    if isinstance(exc, pin.Esperando):
        return erro_de(exc, 429, headers={"Retry-After": str(exc.segundos)})
    return erro_de(exc, 422)


@router.get("/pin")
def get_pin():
    return pin.estado()


@router.post("/pin", status_code=201)
def ativar_pin(payload: PinIn, db=Depends(get_db)):
    try:
        codigo = pin.ativar(payload.pin)
    except ValueError as exc:
        raise _erro_de_pin(exc) from exc
    logger.info("PIN de abertura ligado")
    # ORG-05 (P-70): com PIN, a notificação do sistema esconde o texto por
    # padrão (aparece na tela de bloqueio) — dá pra desligar em notificações
    db.execute("UPDATE user_profile SET notif_ocultar_texto = 1")
    db.commit()
    return {**pin.estado(), "codigo_recuperacao": codigo}


@router.put("/pin")
def trocar_pin(payload: TrocarPinIn):
    try:
        pin.trocar(payload.pin_atual, payload.pin_novo)
    except (ValueError, pin.Esperando) as exc:
        raise _erro_de_pin(exc) from exc
    logger.info("PIN de abertura trocado")
    return pin.estado()


@router.post("/pin/desativar")
def desativar_pin(payload: DesativarPinIn):
    try:
        pin.desativar(payload.pin_atual)
    except (ValueError, pin.Esperando) as exc:
        raise _erro_de_pin(exc) from exc
    logger.info("PIN de abertura desligado")
    return pin.estado()


@router.post("/pin/desbloquear")
def desbloquear(payload: PinIn):
    try:
        pin.desbloquear(payload.pin)
    except (ValueError, pin.Esperando) as exc:
        raise _erro_de_pin(exc) from exc
    return pin.estado()


@router.post("/pin/recuperar")
def recuperar_pin(payload: RecuperarPinIn):
    try:
        codigo = pin.recuperar(payload.codigo, payload.pin_novo)
    except pin.PinErrado as exc:
        raise ErroKami(422, "erro.seguranca.codigo_recuperacao_errado", "código de recuperação errado") from exc
    except (ValueError, pin.Esperando) as exc:
        raise _erro_de_pin(exc) from exc
    logger.warning("PIN redefinido pelo código de recuperação")
    return {**pin.estado(), "codigo_recuperacao": codigo}


@router.post("/pin/bloquear")
def bloquear():
    pin.bloquear()
    return pin.estado()


@router.put("/pin/inatividade")
def definir_inatividade(payload: InatividadeIn):
    try:
        pin.definir_inatividade(payload.minutos)
    except ValueError as exc:
        raise _erro_de_pin(exc) from exc
    return pin.estado()



# ── banco cifrado (SEG-08) ───────────────────────────────────────────────
# ligar/desligar NÃO usam get_db: a troca do arquivo espera todas as
# conexões fecharem (database.exclusivo), inclusive a da própria rota

class LigarCifraIn(Entrada):
    apagar_copias_sem_cifra: bool = True


class CodigoCifraIn(Entrada):
    pin: Optional[str] = Field(None, max_length=8)


class RecuperarCifraIn(Entrada):
    codigo: str = Field(..., max_length=80)


def _erro_de_cifra(exc: Exception):
    if isinstance(exc, database.Ocupado):
        return ErroKami(409, "erro.cifra.ocupado", "o banco está em uso — tente de novo em instantes")
    return erro_de(exc, 422)


@router.get("/cifra")
def get_cifra():
    # rota livre (tela de abertura): bloqueado, sem contar as cópias
    if cifra_troca.trancado() or pin.bloqueado():
        return cifra_troca.estado()
    conn = database.get_connection()
    try:
        return cifra_troca.estado(conn)
    finally:
        conn.close()


@router.post("/cifra/ligar")
def ligar_cifra(payload: LigarCifraIn):
    try:
        resultado = cifra_troca.ligar(payload.apagar_copias_sem_cifra)
    except (cifra.Indisponivel, database.Ocupado) as exc:
        raise _erro_de_cifra(exc) from exc
    return {**get_cifra(), **resultado}


@router.post("/cifra/desligar")
def desligar_cifra():
    try:
        cifra_troca.desligar()
    except (cifra.Indisponivel, database.Ocupado) as exc:
        raise _erro_de_cifra(exc) from exc
    return get_cifra()


@router.post("/cifra/codigo")
def codigo_cifra(payload: CodigoCifraIn):
    # mostrar a chave de novo é tão sensível quanto o PIN: com PIN ligado, pede
    if pin.ativo():
        try:
            pin.conferir(payload.pin or "")
        except (ValueError, pin.Esperando) as exc:
            raise _erro_de_pin(exc) from exc
    try:
        return {"codigo": cifra_troca.mostrar_codigo()}
    except cifra.Indisponivel as exc:
        raise _erro_de_cifra(exc) from exc


@router.post("/cifra/recuperar")
def recuperar_cifra(payload: RecuperarCifraIn):
    if not cifra_troca.trancado():
        raise ErroKami(409, "erro.cifra.nao_trancado", "o banco já está aberto")
    try:
        return cifra_troca.recuperar(payload.codigo)
    except cifra.CodigoErrado as exc:
        raise erro_de(exc, 422) from exc
