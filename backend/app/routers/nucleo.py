"""
Módulo Núcleo (v1) — motor de gamificação central.

Endpoints:
  GET  /api/nucleo/attributes           lista os 5 atributos com nível/pct calculados
  POST /api/nucleo/actions              registra uma ação (form genérico, decisão 13)
  GET  /api/nucleo/log                  log cronológico, filtrável por atributo/período
  GET  /api/nucleo/achievements         galeria de conquistas (desbloqueadas + bloqueadas), com progresso
  GET  /api/nucleo/player               resumo do jogador: nível geral, sequência de dias, conquistas
  GET  /api/nucleo/xp-review            prévia da revisão de xp (simulação, não grava nada)
  POST /api/nucleo/xp-review            aplica a revisão de xp (guarda uma cópia do banco antes)
"""
import datetime
import json
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.database import backup_database, get_db, local_now
from app.xp import level_from_xp
from app.actions import register_action as register_action_core
from app.achievements import achievement_progress, streak_info
from app.revisao_xp import review_xp

router = APIRouter()

# teto de xp de uma ação manual — sem ele um único "fiz algo" com xp
# arbitrário valia mais que meses de ações reais nos módulos. O valor
# padrão do formulário (10) e o seed demo (até 30) ficam abaixo dele.
MAX_MANUAL_XP = 50


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
    xp: int = Field(..., gt=0, le=MAX_MANUAL_XP)
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
    key: Optional[str] = None
    title: str
    description: Optional[str] = None
    rule_type: str
    unlocked: bool
    unlocked_at: Optional[str] = None
    progress_current: int
    progress_target: int


class PlayerOut(BaseModel):
    level: int
    total_xp: int
    current_level_xp: int
    xp_for_next_level: int
    pct: int
    streak_current: int
    streak_best: int
    active_today: bool
    achievements_unlocked: int
    achievements_total: int


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
        cutoff = (local_now() - datetime.timedelta(days=period_days)).isoformat()
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
    out = []
    for r in rows:
        current, target = achievement_progress(db, json.loads(r["criteria_json"]))
        unlocked = r["unlocked_at"] is not None
        out.append(
            {
                "id": r["id"],
                "key": r["chave"],
                "title": r["title"],
                "description": r["description"],
                "rule_type": r["rule_type"],
                "unlocked": unlocked,
                "unlocked_at": r["unlocked_at"],
                # desbloqueada aparece cheia: o estorno já rebloqueia quem
                # deixou de cumprir o critério (relock_unmet_achievements)
                "progress_current": target if unlocked else current,
                "progress_target": target,
            }
        )
    return out


@router.get("/player", response_model=PlayerOut)
def get_player(db=Depends(get_db)):
    """
    Nível geral do jogador: soma do xp de todos os atributos passada pela
    mesma curva de level_from_xp (xp.py). Antes essa conta vivia só no
    frontend (widgets/profile.js + components/xp.js, uma cópia da fórmula);
    agora a fonte é o backend, igual ao nível de cada atributo.
    """
    total_xp = db.execute("SELECT COALESCE(SUM(current_xp), 0) AS t FROM attributes").fetchone()["t"]
    lv = level_from_xp(total_xp)
    streak = streak_info(db)
    ach = db.execute(
        "SELECT COUNT(*) AS total, COUNT(unlocked_at) AS unlocked FROM achievements"
    ).fetchone()
    return {
        "level": lv["level"],
        "total_xp": total_xp,
        "current_level_xp": lv["current_level_xp"],
        "xp_for_next_level": lv["xp_for_next_level"],
        "pct": lv["pct"],
        "streak_current": streak["current"],
        "streak_best": streak["best"],
        "active_today": streak["active_today"],
        "achievements_unlocked": ach["unlocked"],
        "achievements_total": ach["total"],
    }


@router.get("/xp-review")
def preview_xp_review(db=Depends(get_db)):
    """Simula a revisão de xp (app/revisao_xp.py) e devolve o relatório, sem gravar nada."""
    return review_xp(db, apply=False)


@router.post("/xp-review")
def apply_xp_review(db=Depends(get_db)):
    """
    Aplica a revisão de xp. Antes guarda uma cópia completa do banco na
    pasta de dados (database.backup_database) — a revisão remove logs
    antigos, então quem se arrepender consegue voltar ao estado anterior.
    """
    backup_path = backup_database(db, "antes-revisao-xp")
    report = review_xp(db, apply=True)
    report["backup"] = backup_path
    return report
