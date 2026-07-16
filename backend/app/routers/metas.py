"""
Módulo Metas Pessoais (v1 — tipo 'academica' fica pós-mvp, depende de Carreira).

Endpoints:
  GET    /api/metas                        lista todas as metas (ativas + concluídas)
  POST   /api/metas                        cria uma meta nova
  PUT    /api/metas/{id}                   atualiza título/tipo/alvo/prazo
  DELETE /api/metas/{id}                   remove a meta (contribuições somem via CASCADE)
  POST   /api/metas/{id}/contribute        registra uma contribuição livre (valor + nota opcional)
  GET    /api/metas/{id}/contributions     histórico de contribuições de uma meta

Regras de negócio:
  - tipo define a unidade automaticamente (decisão do protótipo kami_telas_final.html,
    mantida aqui): 'financeira' -> unit='money', 'livre' -> unit='count'. O usuário
    não escolhe a unidade solta — evita meta "financeira" contada em unidades ou
    vice-versa.
  - progresso (%) = current_value / target_value, arredondado, sem passar de 100
  - contribuição: valor livre por chamada (não é mais passo fixo como no protótipo —
    decisão explícita do usuário: contribuição real de uma meta financeira não é
    sempre a mesma quantia). Cada contribuição:
      * grava uma linha em goal_contributions (histórico completo)
      * soma no current_value da meta, sem passar do target_value
      * credita XP em 'metas' via register_action (mesmo mecanismo do Núcleo/Aprendizado)
      * se essa contribuição faz current_value alcançar target_value pela primeira vez,
        a meta vira 'concluida' e credita um XP BÔNUS de conclusão em vez do XP normal
        de contribuição (mesmo comportamento do protótipo: um crédito ou outro, nunca
        os dois na mesma chamada) — isso também alimenta o achievement dormente
        'goal_completed' (ver app/achievements.py)
  - meta 'concluida' não aceita mais contribuições (422)
  - sem coluna própria de "completed_at" na tabela goals (decisão de escopo do
    projeto: "sem tabela nova, já cabe no campo status que a tabela já tinha") — a
    data de conclusão exibida na tela é derivada da data da última contribuição
    registrada pra aquela meta, reaproveitando goal_contributions em vez de somar
    coluna nova
  - exclusão e edição de meta (título/tipo/alvo/prazo) fazem parte do escopo desta
    implementação (decisão explícita do usuário, além do que o protótipo mostrava)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.actions import register_action

router = APIRouter()

# ── constantes ──────────────────────────────────────────────────────────────

GOAL_TYPES = {"financeira", "livre"}  # 'academica' só entra com o módulo Carreira
GOAL_STATUSES = {"ativa", "concluida"}

XP_PER_CONTRIBUTION = 3      # XP creditado em 'metas' a cada contribuição normal
XP_GOAL_COMPLETED_BONUS = 30  # XP bônus ao concluir a meta (funciona quase como uma "quest")


def _unit_for_type(goal_type: str) -> str:
    return "money" if goal_type == "financeira" else "count"


# ── schemas ──────────────────────────────────────────────────────────────────

class GoalIn(BaseModel):
    title: str
    type: str = "livre"
    target_value: float
    deadline: Optional[str] = None  # YYYY-MM-DD, opcional


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    target_value: Optional[float] = None
    # "" limpa o prazo; None = não mexe no prazo atual
    deadline: Optional[str] = None
    clear_deadline: bool = False


class GoalOut(BaseModel):
    id: str
    title: str
    type: str
    current_value: float
    target_value: float
    unit: str
    deadline: Optional[str] = None
    status: str
    progress_pct: int
    completed_at: Optional[str] = None  # derivado de goal_contributions, ver docstring


class ContributeIn(BaseModel):
    amount: float
    note: Optional[str] = None


class ContributionOut(BaseModel):
    id: str
    goal_id: str
    amount: float
    note: Optional[str] = None
    date: str


# ── helpers ──────────────────────────────────────────────────────────────────

def _get_goal_or_404(db, goal_id: str):
    row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="meta não encontrada")
    return row


def _goal_row_to_out(db, row) -> dict:
    target = row["target_value"] or 0
    pct = min(100, round((row["current_value"] / target) * 100)) if target > 0 else 0

    completed_at = None
    if row["status"] == "concluida":
        last = db.execute(
            "SELECT MAX(date) AS d FROM goal_contributions WHERE goal_id = ?",
            (row["id"],),
        ).fetchone()
        completed_at = last["d"] if last else None

    return {
        "id": row["id"],
        "title": row["title"],
        "type": row["type"],
        "current_value": row["current_value"],
        "target_value": row["target_value"],
        "unit": row["unit"],
        "deadline": row["deadline"],
        "status": row["status"],
        "progress_pct": pct,
        "completed_at": completed_at,
    }


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[GoalOut])
def list_goals(db=Depends(get_db)):
    # ativas primeiro (por prazo mais próximo, sem prazo por último), depois
    # concluídas — o frontend também separa visualmente em duas seções, mas
    # devolver já ordenado evita reordenar dos dois lados
    rows = db.execute(
        """
        SELECT * FROM goals
        ORDER BY
            CASE WHEN status = 'concluida' THEN 1 ELSE 0 END,
            CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
            deadline,
            title
        """
    ).fetchall()
    return [_goal_row_to_out(db, r) for r in rows]


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(payload: GoalIn, db=Depends(get_db)):
    if payload.type not in GOAL_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"tipo inválido; valores aceitos: {sorted(GOAL_TYPES)}",
        )
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="título é obrigatório")
    if payload.target_value <= 0:
        raise HTTPException(status_code=422, detail="alvo precisa ser maior que zero")

    goal_id = new_id()
    db.execute(
        "INSERT INTO goals (id, title, type, current_value, target_value, unit, deadline, status) "
        "VALUES (?, ?, ?, 0, ?, ?, ?, 'ativa')",
        (
            goal_id,
            payload.title.strip(),
            payload.type,
            payload.target_value,
            _unit_for_type(payload.type),
            payload.deadline,
        ),
    )
    db.commit()
    return _goal_row_to_out(db, _get_goal_or_404(db, goal_id))


@router.put("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: str, payload: GoalUpdate, db=Depends(get_db)):
    row = _get_goal_or_404(db, goal_id)

    new_title = payload.title.strip() if payload.title is not None else row["title"]
    if not new_title:
        raise HTTPException(status_code=422, detail="título é obrigatório")

    new_type = payload.type if payload.type is not None else row["type"]
    if new_type not in GOAL_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"tipo inválido; valores aceitos: {sorted(GOAL_TYPES)}",
        )

    new_target = payload.target_value if payload.target_value is not None else row["target_value"]
    if new_target <= 0:
        raise HTTPException(status_code=422, detail="alvo precisa ser maior que zero")

    if payload.clear_deadline:
        new_deadline = None
    elif payload.deadline is not None:
        new_deadline = payload.deadline
    else:
        new_deadline = row["deadline"]

    db.execute(
        "UPDATE goals SET title = ?, type = ?, target_value = ?, unit = ?, deadline = ? WHERE id = ?",
        (new_title, new_type, new_target, _unit_for_type(new_type), new_deadline, goal_id),
    )
    db.commit()
    return _goal_row_to_out(db, _get_goal_or_404(db, goal_id))


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db=Depends(get_db)):
    _get_goal_or_404(db, goal_id)
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()


@router.post("/{goal_id}/contribute", response_model=GoalOut)
def contribute_goal(goal_id: str, payload: ContributeIn, db=Depends(get_db)):
    row = _get_goal_or_404(db, goal_id)

    if row["status"] == "concluida":
        raise HTTPException(status_code=422, detail="meta já concluída — não aceita novas contribuições")
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="valor da contribuição precisa ser maior que zero")

    db.execute(
        "INSERT INTO goal_contributions (id, goal_id, amount, note, date) VALUES (?, ?, ?, ?, ?)",
        (new_id(), goal_id, payload.amount, payload.note, now_iso()),
    )

    new_current = min(row["target_value"], row["current_value"] + payload.amount)
    completes_now = new_current >= row["target_value"]

    db.execute("UPDATE goals SET current_value = ? WHERE id = ?", (new_current, goal_id))
    if completes_now:
        db.execute("UPDATE goals SET status = 'concluida' WHERE id = ?", (goal_id,))
    db.commit()

    # um crédito OU outro, nunca os dois na mesma contribuição (mesmo
    # comportamento do protótipo) — o bônus de conclusão também dispara
    # check_achievements (via register_action) pro achievement 'quest concluída'
    if completes_now:
        register_action(
            db,
            description=f'concluiu a meta "{row["title"]}" (xp bônus)',
            categories=["metas"],
            xp=XP_GOAL_COMPLETED_BONUS,
            impact=5,
            source="metas",
        )
    else:
        register_action(
            db,
            description=f'contribuiu para "{row["title"]}"',
            categories=["metas"],
            xp=XP_PER_CONTRIBUTION,
            impact=2,
            source="metas",
        )

    return _goal_row_to_out(db, _get_goal_or_404(db, goal_id))


@router.get("/{goal_id}/contributions", response_model=List[ContributionOut])
def list_contributions(goal_id: str, db=Depends(get_db)):
    _get_goal_or_404(db, goal_id)
    rows = db.execute(
        "SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC",
        (goal_id,),
    ).fetchall()
    return [dict(r) for r in rows]