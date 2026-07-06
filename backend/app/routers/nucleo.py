"""
Módulo Núcleo (v1) — motor de gamificação central.

Endpoints:
  GET  /api/nucleo/attributes           lista os 5 atributos com nível/pct calculados
  POST /api/nucleo/actions              registra uma ação (form genérico, decisão 13)
  GET  /api/nucleo/log                  log cronológico, filtrável por atributo/período
  GET  /api/nucleo/achievements         galeria de conquistas (desbloqueadas + bloqueadas)
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.database import get_db
from app.xp import level_from_xp
from app.actions import register_action as register_action_core

router = APIRouter()


# ---------------- schemas ----------------

class AttributeOut(BaseModel):
    id: str
    name: str
    current_xp: int
    current_level: int
    is_active: bool
    pct: int
    xp_for_next_level: int


class ActionCreate(BaseModel):
    description: str
    categories: List[str] = Field(..., min_length=1, description="nomes dos atributos afetados, ex: ['aprendizado']")
    xp: int = Field(..., gt=0)
    impact: Optional[int] = Field(None, ge=1, le=5)


class AchievementUnlockedOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    unlocked_at: str


class ActionOut(BaseModel):
    id: str
    description: str
    xp_gained: int
    impact_note: Optional[int] = None
    categories: List[str]
    created_at: str
    newly_unlocked_achievements: List[AchievementUnlockedOut] = []


class LogEntryOut(BaseModel):
    id: str
    description: str
    xp_gained: int
    impact_note: Optional[int] = None
    categories: List[str]
    source: str
    created_at: str


class AchievementOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    rule_type: str
    unlocked: bool
    unlocked_at: Optional[str] = None


# ---------------- helpers ----------------

def _attribute_row_to_out(row) -> dict:
    lv = level_from_xp(row["current_xp"])
    return {
        "id": row["id"],
        "name": row["name"],
        "current_xp": row["current_xp"],
        "current_level": lv["level"],
        "is_active": bool(row["is_active"]),
        "pct": lv["pct"],
        "xp_for_next_level": lv["xp_for_next_level"],
    }


def _categories_for_log(db, action_log_id: str) -> List[str]:
    rows = db.execute(
        "SELECT a.name FROM action_log_attributes ala "
        "JOIN attributes a ON a.id = ala.attribute_id "
        "WHERE ala.action_log_id = ?",
        (action_log_id,),
    ).fetchall()
    return [r["name"] for r in rows]


# ---------------- endpoints ----------------

@router.get("/attributes", response_model=List[AttributeOut])
def list_attributes(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM attributes ORDER BY name").fetchall()
    return [_attribute_row_to_out(r) for r in rows]


@router.post("/actions", response_model=ActionOut)
def register_action(payload: ActionCreate, db=Depends(get_db)):
    return register_action_core(
        db,
        description=payload.description,
        categories=payload.categories,
        xp=payload.xp,
        impact=payload.impact,
        source="form",
    )


@router.get("/log", response_model=List[LogEntryOut])
def get_log(
    attribute: Optional[str] = None,
    period_days: Optional[int] = None,
    limit: int = 100,
    db=Depends(get_db),
):
    query = "SELECT DISTINCT al.* FROM action_logs al"
    conditions = []
    args = []

    if attribute:
        query += " JOIN action_log_attributes ala ON ala.action_log_id = al.id JOIN attributes a ON a.id = ala.attribute_id"
        conditions.append("a.name = ?")
        args.append(attribute)

    if period_days:
        cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=period_days)).isoformat()
        conditions.append("al.created_at >= ?")
        args.append(cutoff)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY al.created_at DESC LIMIT ?"
    args.append(limit)

    rows = db.execute(query, args).fetchall()
    return [
        {
            "id": r["id"],
            "description": r["description"],
            "xp_gained": r["xp_gained"],
            "impact_note": r["impact_note"],
            "categories": _categories_for_log(db, r["id"]),
            "source": r["source"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/achievements", response_model=List[AchievementOut])
def list_achievements(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM achievements ORDER BY title").fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "description": r["description"],
            "rule_type": r["rule_type"],
            "unlocked": r["unlocked_at"] is not None,
            "unlocked_at": r["unlocked_at"],
        }
        for r in rows
    ]
