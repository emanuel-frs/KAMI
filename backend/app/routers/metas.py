"""
Módulo Metas Pessoais (v1).

Tipos disponíveis no v1:
  'financeira' — target_value em dinheiro (unit='money'), progresso via contribuições
  'livre'      — qualquer contagem ou valor (unit='count' ou 'money')
  ('academica' entra junto com o módulo Carreira, pós-mvp)

Endpoints:
  GET    /api/metas/goals                     lista metas (filtro opcional por tipo/status)
  POST   /api/metas/goals                     cria uma meta
  PUT    /api/metas/goals/{id}                atualiza campos da meta
  DELETE /api/metas/goals/{id}                remove meta e contribuições (CASCADE)

  GET    /api/metas/goals/{id}/contributions  lista contribuições de uma meta
  POST   /api/metas/goals/{id}/contributions  adiciona contribuição (atualiza current_value)
  DELETE /api/metas/contributions/{id}        remove contribuição (recalcula current_value)

Regras de negócio:
  - current_value é sempre recalculado como SUM(contributions.amount) para a meta;
    o campo na tabela goals é mantido em sincronia a cada insert/delete de contribuição.
  - ao atingir target_value, o status muda automaticamente para 'concluida' e credita
    XP em 'metas' via register_action.
  - ao remover uma contribuição, se current_value voltar abaixo de target_value e a
    meta estava 'concluida', ela volta para 'ativa' (sem estorno de XP — v1).
  - tipo 'academica' é rejeitado no v1 com 422 explicativo.
  - deadline é opcional; sem validação de data passada no v1 (registro livre).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.actions import register_action

router = APIRouter()

# ── constantes ───────────────────────────────────────────────────────────────

VALID_TYPES    = {"financeira", "livre"}
VALID_UNITS    = {"money", "count"}
VALID_STATUSES = {"ativa", "concluida"}
XP_GOAL_DONE   = 50   # XP creditado ao concluir uma meta


# ── schemas ───────────────────────────────────────────────────────────────────

class GoalIn(BaseModel):
    title: str
    type: str                           # 'financeira' | 'livre'
    target_value: float = Field(..., gt=0)
    unit: str = "count"                 # 'money' | 'count'
    deadline: Optional[str] = None      # YYYY-MM-DD, opcional


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    target_value: Optional[float] = Field(None, gt=0)
    unit: Optional[str] = None
    deadline: Optional[str] = None
    status: Optional[str] = None        # permite marcar manualmente como 'concluida'


class GoalOut(BaseModel):
    id: str
    title: str
    type: str
    current_value: float
    target_value: float
    unit: str
    deadline: Optional[str] = None
    status: str
    progress_pct: int                   # 0-100, calculado


class ContributionIn(BaseModel):
    amount: float = Field(..., gt=0)
    note: Optional[str] = None
    date: str                           # YYYY-MM-DD


class ContributionOut(BaseModel):
    id: str
    goal_id: str
    amount: float
    note: Optional[str] = None
    date: str


# ── helpers ───────────────────────────────────────────────────────────────────

def _get_goal_or_404(db, goal_id: str):
    row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="meta não encontrada")
    return row


def _recalc_current_value(db, goal_id: str) -> float:
    """Recalcula current_value como soma das contribuições e atualiza a tabela."""
    row = db.execute(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM goal_contributions WHERE goal_id = ?",
        (goal_id,),
    ).fetchone()
    total = row["total"]
    db.execute("UPDATE goals SET current_value = ? WHERE id = ?", (total, goal_id))
    db.commit()
    return total


def _maybe_complete(db, goal_row) -> None:
    """
    Se current_value >= target_value e a meta ainda está 'ativa',
    marca como 'concluida' e credita XP.
    """
    if goal_row["status"] == "ativa" and goal_row["current_value"] >= goal_row["target_value"]:
        db.execute("UPDATE goals SET status = 'concluida' WHERE id = ?", (goal_row["id"],))
        db.commit()
        register_action(
            db,
            description=f"concluiu meta: {goal_row['title']}",
            categories=["metas"],
            xp=XP_GOAL_DONE,
            impact=5,
            source="metas",
        )


def _maybe_reopen(db, goal_row) -> None:
    """
    Se current_value ficou abaixo de target_value após remoção de contribuição
    e a meta estava 'concluida', reabre para 'ativa' (sem estorno de XP — v1).
    """
    if goal_row["status"] == "concluida" and goal_row["current_value"] < goal_row["target_value"]:
        db.execute("UPDATE goals SET status = 'ativa' WHERE id = ?", (goal_row["id"],))
        db.commit()


def _goal_row_to_out(row) -> dict:
    pct = 0
    if row["target_value"] and row["target_value"] > 0:
        pct = min(100, round((row["current_value"] / row["target_value"]) * 100))
    return {
        "id":            row["id"],
        "title":         row["title"],
        "type":          row["type"],
        "current_value": row["current_value"],
        "target_value":  row["target_value"],
        "unit":          row["unit"],
        "deadline":      row["deadline"],
        "status":        row["status"],
        "progress_pct":  pct,
    }


# ── metas ─────────────────────────────────────────────────────────────────────

@router.get("/goals", response_model=List[GoalOut])
def list_goals(
    type: Optional[str] = None,
    status: Optional[str] = None,
    db=Depends(get_db),
):
    query = "SELECT * FROM goals"
    conditions, args = [], []

    if type:
        conditions.append("type = ?")
        args.append(type)
    if status:
        conditions.append("status = ?")
        args.append(status)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY deadline ASC, title ASC"

    rows = db.execute(query, args).fetchall()
    return [_goal_row_to_out(r) for r in rows]


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(payload: GoalIn, db=Depends(get_db)):
    if payload.type == "academica":
        raise HTTPException(
            status_code=422,
            detail="tipo 'academica' não está disponível no v1; entra junto com o módulo Carreira (pós-mvp)",
        )
    if payload.type not in VALID_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"tipo inválido; valores aceitos no v1: {sorted(VALID_TYPES)}",
        )
    if payload.unit not in VALID_UNITS:
        raise HTTPException(
            status_code=422,
            detail=f"unit inválido; valores aceitos: {sorted(VALID_UNITS)}",
        )

    goal_id = new_id()
    db.execute(
        "INSERT INTO goals (id, title, type, current_value, target_value, unit, deadline, status) "
        "VALUES (?, ?, ?, 0, ?, ?, ?, 'ativa')",
        (goal_id, payload.title, payload.type, payload.target_value, payload.unit, payload.deadline),
    )
    db.commit()
    return _goal_row_to_out(db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone())


@router.put("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: str, payload: GoalUpdate, db=Depends(get_db)):
    row = _get_goal_or_404(db, goal_id)

    new_status = payload.status if payload.status is not None else row["status"]
    if new_status not in VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status inválido; valores aceitos: {sorted(VALID_STATUSES)}",
        )

    new_unit = payload.unit if payload.unit is not None else row["unit"]
    if new_unit not in VALID_UNITS:
        raise HTTPException(
            status_code=422,
            detail=f"unit inválido; valores aceitos: {sorted(VALID_UNITS)}",
        )

    db.execute(
        """
        UPDATE goals
           SET title        = ?,
               target_value = ?,
               unit         = ?,
               deadline     = ?,
               status       = ?
         WHERE id = ?
        """,
        (
            payload.title        if payload.title        is not None else row["title"],
            payload.target_value if payload.target_value is not None else row["target_value"],
            new_unit,
            payload.deadline     if payload.deadline     is not None else row["deadline"],
            new_status,
            goal_id,
        ),
    )
    db.commit()

    # re-avalia conclusão caso target_value tenha sido reduzido
    updated = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    _maybe_complete(db, updated)

    return _goal_row_to_out(db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone())


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db=Depends(get_db)):
    _get_goal_or_404(db, goal_id)
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()


# ── contribuições ─────────────────────────────────────────────────────────────

@router.get("/goals/{goal_id}/contributions", response_model=List[ContributionOut])
def list_contributions(goal_id: str, db=Depends(get_db)):
    _get_goal_or_404(db, goal_id)
    rows = db.execute(
        "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC",
        (goal_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/goals/{goal_id}/contributions", response_model=ContributionOut, status_code=201)
def add_contribution(goal_id: str, payload: ContributionIn, db=Depends(get_db)):
    goal = _get_goal_or_404(db, goal_id)

    if goal["status"] == "concluida":
        raise HTTPException(
            status_code=422,
            detail="meta já concluída; reabra-a antes de adicionar contribuições",
        )

    contrib_id = new_id()
    db.execute(
        "INSERT INTO goal_contributions (id, goal_id, amount, note, date) VALUES (?, ?, ?, ?, ?)",
        (contrib_id, goal_id, payload.amount, payload.note, payload.date),
    )
    db.commit()

    new_value = _recalc_current_value(db, goal_id)
    updated_goal = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    _maybe_complete(db, updated_goal)

    return {
        "id":      contrib_id,
        "goal_id": goal_id,
        "amount":  payload.amount,
        "note":    payload.note,
        "date":    payload.date,
    }


@router.delete("/contributions/{contribution_id}", status_code=204)
def delete_contribution(contribution_id: str, db=Depends(get_db)):
    row = db.execute(
        "SELECT * FROM goal_contributions WHERE id = ?", (contribution_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="contribuição não encontrada")

    goal_id = row["goal_id"]
    db.execute("DELETE FROM goal_contributions WHERE id = ?", (contribution_id,))
    db.commit()

    _recalc_current_value(db, goal_id)
    updated_goal = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    _maybe_reopen(db, updated_goal)