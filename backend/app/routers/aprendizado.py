"""
Módulo Aprendizado (v1).

Endpoints:
  Trilhas:
    GET    /api/aprendizado/tracks              lista todas as trilhas com progresso calculado
    POST   /api/aprendizado/tracks              cria uma trilha nova
    PUT    /api/aprendizado/tracks/{id}         atualiza nome/meta/status de uma trilha
    DELETE /api/aprendizado/tracks/{id}         remove trilha e seus marcos (CASCADE)

  Marcos:
    GET    /api/aprendizado/tracks/{id}/milestones          lista marcos de uma trilha
    POST   /api/aprendizado/tracks/{id}/milestones          adiciona um marco
    PUT    /api/aprendizado/milestones/{id}                 atualiza título ou muda status
    DELETE /api/aprendizado/milestones/{id}                 remove um marco

Regras de negócio:
  - progresso (%) = concluídos / total de marcos (0 se não há marcos)
  - ao concluir um marco (status -> 'concluido') credita XP em Aprendizado via
    register_action (mesmo mecanismo do Núcleo) e preenche completed_at
  - ao reabrir um marco (status -> 'pendente') zera completed_at, não estorna XP
    (decisão simples para v1: XP é acumulativo, sem punição)
  - marco sem atividade por >30 dias vira 'esquecido' automaticamente, calculado
    na leitura (não há job periódico no v1 — é lazy evaluation)
  - status de trilha: 'ativa' | 'pausada' | 'parada'
  - status de marco:  'pendente' | 'concluido' | 'esquecido'
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.actions import register_action

router = APIRouter()

# ── constantes ──────────────────────────────────────────────────────────────

TRACK_STATUSES    = {"ativa", "pausada", "parada"}
MILESTONE_STATUSES = {"pendente", "concluido", "esquecido"}
XP_PER_MILESTONE  = 15          # XP creditado ao concluir um marco
STALE_DAYS        = 30          # dias sem atividade para marcar como 'esquecido'


# ── schemas ──────────────────────────────────────────────────────────────────

class MilestoneIn(BaseModel):
    title: str
    started_at: Optional[str] = None   # YYYY-MM-DD, opcional


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None       # 'pendente' | 'concluido' | 'esquecido'
    started_at: Optional[str] = None


class MilestoneOut(BaseModel):
    id: str
    track_id: str
    title: str
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_activity_at: Optional[str] = None


class TrackIn(BaseModel):
    name: str
    general_goal: Optional[str] = None
    status: str = "ativa"


class TrackUpdate(BaseModel):
    name: Optional[str] = None
    general_goal: Optional[str] = None
    status: Optional[str] = None


class TrackOut(BaseModel):
    id: str
    name: str
    general_goal: Optional[str] = None
    status: str
    created_at: str
    total_milestones: int
    completed_milestones: int
    progress_pct: int               # 0-100


# ── helpers ──────────────────────────────────────────────────────────────────

def _apply_staleness(db, track_id: str) -> None:
    """
    Marca como 'esquecido' qualquer marco 'pendente' cujo last_activity_at
    (ou started_at, se last_activity_at for NULL) seja anterior ao corte de
    STALE_DAYS dias. Lazy: roda na leitura, não precisa de job periódico.
    """
    cutoff = (
        datetime.datetime.utcnow() - datetime.timedelta(days=STALE_DAYS)
    ).isoformat()

    db.execute(
        """
        UPDATE milestones
           SET status = 'esquecido'
         WHERE track_id = ?
           AND status   = 'pendente'
           AND COALESCE(last_activity_at, started_at) IS NOT NULL
           AND COALESCE(last_activity_at, started_at) < ?
        """,
        (track_id, cutoff),
    )
    db.commit()


def _milestone_row_to_out(row) -> dict:
    return {
        "id":               row["id"],
        "track_id":         row["track_id"],
        "title":            row["title"],
        "status":           row["status"],
        "started_at":       row["started_at"],
        "completed_at":     row["completed_at"],
        "last_activity_at": row["last_activity_at"],
    }


def _track_progress(db, track_id: str) -> dict:
    """Retorna total, concluídos e percentual de progresso de uma trilha."""
    row = db.execute(
        """
        SELECT
            COUNT(*)                                          AS total,
            SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) AS done
          FROM milestones
         WHERE track_id = ?
        """,
        (track_id,),
    ).fetchone()
    total = row["total"] or 0
    done  = row["done"]  or 0
    pct   = round((done / total) * 100) if total > 0 else 0
    return {"total": total, "done": done, "pct": pct}


def _track_row_to_out(db, row) -> dict:
    prog = _track_progress(db, row["id"])
    return {
        "id":                  row["id"],
        "name":                row["name"],
        "general_goal":        row["general_goal"],
        "status":              row["status"],
        "created_at":          row["created_at"],
        "total_milestones":    prog["total"],
        "completed_milestones": prog["done"],
        "progress_pct":        prog["pct"],
    }


def _get_track_or_404(db, track_id: str):
    row = db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="trilha não encontrada")
    return row


def _get_milestone_or_404(db, milestone_id: str):
    row = db.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="marco não encontrado")
    return row


# ── trilhas ──────────────────────────────────────────────────────────────────

@router.get("/tracks", response_model=List[TrackOut])
def list_tracks(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM tracks ORDER BY name").fetchall()
    # aplica laziness de staleness para todas as trilhas ativas
    for r in rows:
        if r["status"] == "ativa":
            _apply_staleness(db, r["id"])
    # re-busca depois do UPDATE para refletir possíveis mudanças de status
    rows = db.execute("SELECT * FROM tracks ORDER BY name").fetchall()
    return [_track_row_to_out(db, r) for r in rows]


@router.post("/tracks", response_model=TrackOut, status_code=201)
def create_track(payload: TrackIn, db=Depends(get_db)):
    if payload.status not in TRACK_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status inválido; valores aceitos: {sorted(TRACK_STATUSES)}",
        )
    track_id = new_id()
    db.execute(
        "INSERT INTO tracks (id, name, general_goal, status, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (track_id, payload.name, payload.general_goal, payload.status, now_iso()),
    )
    db.commit()
    return _track_row_to_out(db, db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone())


@router.put("/tracks/{track_id}", response_model=TrackOut)
def update_track(track_id: str, payload: TrackUpdate, db=Depends(get_db)):
    row = _get_track_or_404(db, track_id)

    new_status = payload.status if payload.status is not None else row["status"]
    if new_status not in TRACK_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status inválido; valores aceitos: {sorted(TRACK_STATUSES)}",
        )

    db.execute(
        "UPDATE tracks SET name = ?, general_goal = ?, status = ? WHERE id = ?",
        (
            payload.name         if payload.name         is not None else row["name"],
            payload.general_goal if payload.general_goal is not None else row["general_goal"],
            new_status,
            track_id,
        ),
    )
    db.commit()
    return _track_row_to_out(db, db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone())


@router.delete("/tracks/{track_id}", status_code=204)
def delete_track(track_id: str, db=Depends(get_db)):
    _get_track_or_404(db, track_id)
    db.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    db.commit()


# ── marcos ───────────────────────────────────────────────────────────────────

@router.get("/tracks/{track_id}/milestones", response_model=List[MilestoneOut])
def list_milestones(track_id: str, db=Depends(get_db)):
    _get_track_or_404(db, track_id)
    _apply_staleness(db, track_id)
    rows = db.execute(
        "SELECT * FROM milestones WHERE track_id = ? ORDER BY rowid",
        (track_id,),
    ).fetchall()
    return [_milestone_row_to_out(r) for r in rows]


@router.post("/tracks/{track_id}/milestones", response_model=MilestoneOut, status_code=201)
def create_milestone(track_id: str, payload: MilestoneIn, db=Depends(get_db)):
    _get_track_or_404(db, track_id)
    ms_id = new_id()
    now   = now_iso()
    db.execute(
        "INSERT INTO milestones (id, track_id, title, status, started_at, completed_at, last_activity_at) "
        "VALUES (?, ?, ?, 'pendente', ?, NULL, ?)",
        (ms_id, track_id, payload.title, payload.started_at, now),
    )
    db.commit()
    return _milestone_row_to_out(db.execute("SELECT * FROM milestones WHERE id = ?", (ms_id,)).fetchone())


@router.put("/milestones/{milestone_id}", response_model=MilestoneOut)
def update_milestone(milestone_id: str, payload: MilestoneUpdate, db=Depends(get_db)):
    row = _get_milestone_or_404(db, milestone_id)

    new_status = payload.status if payload.status is not None else row["status"]
    if new_status not in MILESTONE_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status inválido; valores aceitos: {sorted(MILESTONE_STATUSES)}",
        )

    now = now_iso()

    # lógica de transição de status
    completed_at     = row["completed_at"]
    last_activity_at = now   # qualquer edição atualiza last_activity_at

    if new_status == "concluido" and row["status"] != "concluido":
        completed_at = now
        # credita XP em Aprendizado via núcleo
        register_action(
            db,
            description=f"concluiu marco: {row['title']}",
            categories=["aprendizado"],
            xp=XP_PER_MILESTONE,
            impact=3,
            source="aprendizado",
        )

    elif new_status == "pendente" and row["status"] == "concluido":
        # reabre o marco — zera completed_at, não estorna XP (v1)
        completed_at = None

    db.execute(
        """
        UPDATE milestones
           SET title            = ?,
               status           = ?,
               started_at       = ?,
               completed_at     = ?,
               last_activity_at = ?
         WHERE id = ?
        """,
        (
            payload.title      if payload.title      is not None else row["title"],
            new_status,
            payload.started_at if payload.started_at is not None else row["started_at"],
            completed_at,
            last_activity_at,
            milestone_id,
        ),
    )
    db.commit()
    return _milestone_row_to_out(db.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone())


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: str, db=Depends(get_db)):
    _get_milestone_or_404(db, milestone_id)
    db.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
    db.commit()