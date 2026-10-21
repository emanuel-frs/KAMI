"""
Busca global (ORG-03) — a paleta Ctrl+K do frontend (components/paleta.js).

  GET /api/busca?q=texto[&tipos=nota,meta]   itens do banco que batem com o
                                              texto, melhores primeiro

Critério e fontes em app/busca.py. As AÇÕES da paleta ("ir para
finanças", "nova nota"…) não passam por aqui: são do frontend.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app import busca
from app.database import get_db

router = APIRouter()


class ResultadoOut(BaseModel):
    tipo: str
    id: str
    titulo: str
    detalhe: str = ""
    data: Optional[str] = None
    valor: Optional[float] = None
    ref: Optional[str] = None
    pontos: int


@router.get("", response_model=List[ResultadoOut])
def buscar(
    q: str = Query("", max_length=200),
    tipos: Optional[str] = Query(None, max_length=300),
    db=Depends(get_db),
):
    filtro = {t.strip() for t in tipos.split(",") if t.strip()} if tipos else None
    return busca.buscar(db, q, filtro)
