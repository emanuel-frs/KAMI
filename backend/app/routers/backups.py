"""
Cópias automáticas do banco (CONF-08) — regra em app/backup_auto.py.

Endpoints:
  GET  /api/backups              cópias da pasta de backups + estado da
                                 pasta extra (inclui "atrasada": 30 dias
                                 sem conseguir copiar pra lá)
  POST /api/backups/verificar    faz a cópia semanal se a última tem mais
                                 de 7 dias (o frontend chama ao abrir e a
                                 cada poucas horas — o app pode ficar dias
                                 aberto na bandeja)
  POST /api/backups/agora        cópia semanal agora, mesmo sem vencer
  POST /api/backups/antes-de-atualizar  cópia antes de instalar uma versão
                                 nova (DIST-01)
  PUT  /api/backups/pasta-extra  liga (valida e já copia) ou desliga
  POST /api/backups/restaurar    volta o banco pra uma cópia (guarda o
                                 estado atual antes); exige a palavra
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import backup_auto
from app.database import get_connection, get_db
from app.limites import Entrada

router = APIRouter()

RESTAURAR_CONFIRMATION_WORD = "restaurar"


class CopiaOut(BaseModel):
    nome: str
    tipo: str  # semanal | antes | atualizacao
    acao: Optional[str] = None  # o que veio depois (importar...) ou a versão, na de atualização
    quando: str
    tamanho: int


class BackupsOut(BaseModel):
    copias: list[CopiaOut]
    semanal_manter: int
    semanal_dias: int
    pasta_extra: Optional[str] = None
    extra_ok_em: Optional[str] = None
    extra_erro: Optional[str] = None
    extra_atrasada: bool


class PastaExtraIn(Entrada):
    # vazio/None desliga a pasta extra
    pasta: Optional[str] = Field(None, max_length=1000)


class RestaurarIn(Entrada):
    nome: str = Field(..., max_length=200)
    confirmation: str = Field(..., max_length=20)


@router.get("", response_model=BackupsOut)
def get_backups(db=Depends(get_db)):
    return backup_auto.status(db)


@router.post("/verificar", response_model=BackupsOut)
def verificar(db=Depends(get_db)):
    backup_auto.copia_semanal_se_precisar(db)
    return backup_auto.status(db)


@router.post("/agora", response_model=BackupsOut)
def copiar_agora(db=Depends(get_db)):
    backup_auto.copia_semanal_se_precisar(db, forcar=True)
    return backup_auto.status(db)


@router.post("/antes-de-atualizar", response_model=BackupsOut)
def copiar_antes_de_atualizar(db=Depends(get_db)):
    """DIST-01 (P-90): o app chama logo antes de instalar uma versão nova."""
    backup_auto.copia_antes_de(db, "atualizar")
    return backup_auto.status(db)


@router.put("/pasta-extra", response_model=BackupsOut)
def definir_pasta_extra(payload: PastaExtraIn, db=Depends(get_db)):
    try:
        backup_auto.definir_pasta_extra(db, payload.pasta)
    except backup_auto.PastaInvalida as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return backup_auto.status(db)


@router.post("/restaurar", response_model=BackupsOut)
def restaurar(payload: RestaurarIn, db=Depends(get_db)):
    if payload.confirmation != RESTAURAR_CONFIRMATION_WORD:
        raise HTTPException(
            status_code=422,
            detail=f"confirmação inválida; envie confirmation='{RESTAURAR_CONFIRMATION_WORD}' pra prosseguir",
        )
    db.close()  # a restauração abre as próprias conexões
    try:
        backup_auto.restaurar(payload.nome)
    except backup_auto.CopiaDesconhecida as exc:
        raise HTTPException(status_code=404, detail="essa cópia não existe na pasta de backups") from exc
    conn = get_connection()
    try:
        return backup_auto.status(conn)
    finally:
        conn.close()
