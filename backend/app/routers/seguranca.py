"""
Módulo Segurança (Sprint 3 — SEG-01; o PIN do SEG-02 entra aqui também).

Endpoints:
  GET  /api/seguranca/chave            onde está a chave que protege as
                                       senhas salvas: cofre do sistema,
                                       arquivo, ou indisponível (SEG-01)
  POST /api/seguranca/chave/redefinir  gera uma chave nova e APAGA os
                                       segredos cifrados com a antiga
                                       (senha de app do e-mail, token do
                                       GitHub, chave da busca) — saída de
                                       quando o cofre perdeu a chave

Ver app/crypto.py pro funcionamento do cofre.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import crypto
from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

REDEFINIR_CONFIRMATION_WORD = "redefinir"


class RedefinirChaveIn(BaseModel):
    confirmation: str = Field(..., max_length=20)


def _segredos_salvos(db) -> int:
    return (
        db.execute("SELECT COUNT(*) FROM email_accounts WHERE app_password_enc <> ''").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM github_settings WHERE token_enc IS NOT NULL AND token_enc <> ''").fetchone()[0]
        + db.execute("SELECT COUNT(*) FROM search_settings WHERE api_key_enc IS NOT NULL AND api_key_enc <> ''").fetchone()[0]
    )


@router.get("/chave")
def get_chave(db=Depends(get_db)):
    return {**crypto.estado_da_chave(), "segredos_salvos": _segredos_salvos(db)}


@router.post("/chave/redefinir")
def redefinir_chave(payload: RedefinirChaveIn, db=Depends(get_db)):
    if payload.confirmation != REDEFINIR_CONFIRMATION_WORD:
        raise HTTPException(
            status_code=422,
            detail=f"confirmação inválida; envie confirmation='{REDEFINIR_CONFIRMATION_WORD}' pra prosseguir",
        )
    apagados = _segredos_salvos(db)
    estado = crypto.redefinir_chave()
    # cifrados com a chave antiga = lixo ilegível; a conta de e-mail fica
    # (com a senha vazia) pra pessoa só informar a senha de app de novo
    db.execute("UPDATE email_accounts SET app_password_enc = ''")
    db.execute("UPDATE github_settings SET token_enc = NULL")
    db.execute("UPDATE search_settings SET api_key_enc = NULL")
    db.commit()
    return {**estado, "segredos_salvos": 0, "segredos_apagados": apagados}
