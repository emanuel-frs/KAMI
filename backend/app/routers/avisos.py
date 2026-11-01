"""
Avisos proativos (IA-06) — regras em app/avisos.py.

Rotas (prefixo /api/avisos):
  GET    /                         roda as regras e devolve os avisos ativos
                                   (o agendador do frontend chama ao abrir e a
                                   cada 6 h; o sino, ao abrir — P-133)
  POST   /{id}/dispensar           sai do sino até o ciclo da regra mudar (P-145)
  POST   /{id}/notificado          já virou notificação do sistema (P-146)
  POST   /{id}/silenciar           "não me avise disso" pra este item (P-145)
  GET    /config                   ligados, regras ligadas e itens silenciados
  PUT    /regras/{regra}           {ligada} — liga/desliga uma regra; regra "*"
                                   = todos os avisos (P-140)
  DELETE /silenciados/{regra}/{alvo_id}
                                   "voltar a avisar" (P-147)

Sem IA aqui: o texto é o padrão dos dicionários. "Perguntar ao assistente"
só abre o painel com a pergunta pronta — nada sai sem a pessoa enviar (P-134).
"""
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import avisos
from app.database import get_db, now_iso
from app.limites import Entrada
from app.mensagens import ErroKami

router = APIRouter()


class AvisoOut(BaseModel):
    id: str
    regra: str
    alvo_id: str
    nome: str
    vars: dict
    criado_em: str
    notificado: bool


class SilenciadoOut(BaseModel):
    regra: str
    alvo_id: str
    nome: Optional[str] = None
    criado_em: str


class ConfigOut(BaseModel):
    ligados: bool
    regras: Dict[str, bool]
    silenciados: List[SilenciadoOut]


class RegraIn(Entrada):
    ligada: bool


def _linha(db, aviso_id: str):
    row = db.execute("SELECT * FROM avisos WHERE id = ?", (aviso_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.avisos.aviso_nao_encontrado", "aviso não encontrado")
    return row


def _config(db) -> dict:
    sil = avisos.silenciados(db)
    itens = db.execute(
        "SELECT * FROM avisos_silenciados WHERE alvo_id != '' ORDER BY criado_em DESC"
    ).fetchall()
    return {
        "ligados": avisos.ligados(sil),
        "regras": {r: (r, "") not in sil for r in avisos.REGRAS},
        "silenciados": [dict(r) for r in itens],
    }


@router.get("", response_model=List[AvisoOut])
def listar(db=Depends(get_db)):
    return avisos.checar(db)


@router.post("/{aviso_id}/dispensar", status_code=204)
def dispensar(aviso_id: str, db=Depends(get_db)):
    _linha(db, aviso_id)
    db.execute("UPDATE avisos SET dispensado_em = ? WHERE id = ?", (now_iso(), aviso_id))
    db.commit()


@router.post("/{aviso_id}/notificado", status_code=204)
def notificado(aviso_id: str, db=Depends(get_db)):
    _linha(db, aviso_id)
    db.execute("UPDATE avisos SET notificado_em = ? WHERE id = ?", (now_iso(), aviso_id))
    db.commit()


@router.post("/{aviso_id}/silenciar", status_code=204)
def silenciar(aviso_id: str, db=Depends(get_db)):
    row = _linha(db, aviso_id)
    # o nome atual do item, pra lista de silenciados
    nome = next((a["nome"] for a in avisos.checar(db) if a["id"] == aviso_id), None)
    db.execute(
        "INSERT OR REPLACE INTO avisos_silenciados (regra, alvo_id, nome, criado_em) VALUES (?, ?, ?, ?)",
        (row["regra"], row["alvo_id"], nome, now_iso()),
    )
    db.commit()


@router.get("/config", response_model=ConfigOut)
def config(db=Depends(get_db)):
    return _config(db)


@router.put("/regras/{regra}", response_model=ConfigOut)
def definir_regra(regra: str, payload: RegraIn, db=Depends(get_db)):
    if regra != "*" and regra not in avisos.REGRAS:
        raise ErroKami(422, "erro.avisos.regra_desconhecida", "regra desconhecida")
    if payload.ligada:
        db.execute("DELETE FROM avisos_silenciados WHERE regra = ? AND alvo_id = ''", (regra,))
    else:
        db.execute(
            "INSERT OR IGNORE INTO avisos_silenciados (regra, alvo_id, criado_em) VALUES (?, '', ?)",
            (regra, now_iso()),
        )
    db.commit()
    return _config(db)


@router.delete("/silenciados/{regra}/{alvo_id}", response_model=ConfigOut)
def voltar_a_avisar(regra: str, alvo_id: str, db=Depends(get_db)):
    apagou = db.execute("DELETE FROM avisos_silenciados WHERE regra = ? AND alvo_id = ?", (regra, alvo_id)).rowcount
    if not apagou:
        raise ErroKami(404, "erro.avisos.silenciado_nao_encontrado", "esse aviso não está silenciado")
    db.commit()
    return _config(db)
