"""
Módulo Aprendizado (v1).

Endpoints:
  Trilhas:
    GET    /api/aprendizado/tracks              lista todas as trilhas com progresso calculado
    POST   /api/aprendizado/tracks              cria uma trilha nova
    PUT    /api/aprendizado/tracks/{id}         atualiza nome/meta/status de uma trilha
    DELETE /api/aprendizado/tracks/{id}         remove trilha e seus marcos (CASCADE)

  Marcos:
    GET    /api/aprendizado/tracks/{id}/milestones          lista marcos de uma trilha, em ordem (position)
    POST   /api/aprendizado/tracks/{id}/milestones          adiciona um marco (vai pro fim da lista)
    PUT    /api/aprendizado/milestones/{id}                 atualiza título/descrição/notas ou muda status
    DELETE /api/aprendizado/milestones/{id}                 remove um marco
    PUT    /api/aprendizado/tracks/{id}/milestones/reorder  substitui a ordem (replace completo, mesmo
                                                             padrão de PUT /api/dashboard/{screen})

Regras de negócio:
  - progresso (%) = concluídos / total de marcos (0 se não há marcos)
  - ao concluir um marco (status -> 'concluido') credita XP_PER_MILESTONE em
    Aprendizado via register_action (mesmo mecanismo do Núcleo), preenche
    completed_at, e guarda o valor creditado em xp_awarded
  - ao reabrir um marco (status -> 'pendente') ESTORNA exatamente o
    xp_awarded daquele marco (não um valor fixo recalculado — importa se
    XP_PER_MILESTONE mudar no futuro, marcos antigos continuam revertendo
    certo) e zera completed_at/xp_awarded. current_xp nunca fica negativo.
    [MUDANÇA DE REGRA] Antes o v1 não estornava nada ao reabrir; muda porque
    o desmarcar agora é uma ação de usuário de primeira classe na UI (roadmap
    arrastável), não só uma correção administrativa.
  - o estorno NÃO cria um novo action_log (a conclusão original continua no
    histórico — só o XP/nível atual do atributo é corrigido)
  - marco sem atividade por >30 dias vira 'esquecido' automaticamente, calculado
    na leitura (não há job periódico no v1 — é lazy evaluation)
  - status de trilha: 'ativa' | 'pausada' | 'parada'
  - status de marco:  'pendente' | 'concluido' | 'esquecido'
  - reordenar exige a lista COMPLETA de ids da trilha (mesmo conjunto, nova
    ordem) — rejeita com 422 se faltar ou sobrar algum id
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.actions import register_action
from app.xp import level_from_xp

router = APIRouter()

# ── constantes ──────────────────────────────────────────────────────────────

TRACK_STATUSES    = {"ativa", "pausada", "parada"}
MILESTONE_STATUSES = {"pendente", "concluido", "esquecido"}
XP_PER_MILESTONE  = 15          # XP creditado ao concluir um marco
STALE_DAYS        = 30          # dias sem atividade para marcar como 'esquecido'


# ── schemas ──────────────────────────────────────────────────────────────────

class MilestoneIn(BaseModel):
    title: str
    description: Optional[str] = None
    started_at: Optional[str] = None   # YYYY-MM-DD, opcional


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None       # 'pendente' | 'concluido' | 'esquecido'
    started_at: Optional[str] = None


class MilestoneOut(BaseModel):
    id: str
    track_id: str
    title: str
    description: Optional[str] = None
    notes: Optional[str] = None
    status: str
    position: int
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_activity_at: Optional[str] = None
    xp_awarded: Optional[int] = None


class MilestoneReorderIn(BaseModel):
    milestone_ids: List[str]  # ordem completa e final dos marcos da trilha


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


def _debit_xp(db, attribute_name: str, amount: int) -> None:
    """
    Estorna XP de um atributo ao desmarcar um marco — contrapartida de
    register_action, mas sem criar um novo action_log (a conclusão
    original continua no histórico; isso só corrige o XP/nível atuais
    do atributo). Nunca deixa current_xp negativo.
    """
    row = db.execute("SELECT * FROM attributes WHERE name = ?", (attribute_name,)).fetchone()
    if not row:
        return
    new_xp = max(0, row["current_xp"] - amount)
    new_level = level_from_xp(new_xp)["level"]
    db.execute(
        "UPDATE attributes SET current_xp = ?, current_level = ? WHERE id = ?",
        (new_xp, new_level, row["id"]),
    )
    db.commit()


def _milestone_row_to_out(row) -> dict:
    return {
        "id":               row["id"],
        "track_id":         row["track_id"],
        "title":            row["title"],
        "description":      row["description"],
        "notes":            row["notes"],
        "status":           row["status"],
        "position":         row["position"],
        "started_at":       row["started_at"],
        "completed_at":     row["completed_at"],
        "last_activity_at": row["last_activity_at"],
        "xp_awarded":       row["xp_awarded"],
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
        "SELECT * FROM milestones WHERE track_id = ? ORDER BY position",
        (track_id,),
    ).fetchall()
    return [_milestone_row_to_out(r) for r in rows]


@router.post("/tracks/{track_id}/milestones", response_model=MilestoneOut, status_code=201)
def create_milestone(track_id: str, payload: MilestoneIn, db=Depends(get_db)):
    _get_track_or_404(db, track_id)
    ms_id = new_id()
    now   = now_iso()
    next_position = db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM milestones WHERE track_id = ?",
        (track_id,),
    ).fetchone()["pos"]
    db.execute(
        "INSERT INTO milestones "
        "(id, track_id, title, description, notes, status, position, started_at, completed_at, last_activity_at, xp_awarded) "
        "VALUES (?, ?, ?, ?, NULL, 'pendente', ?, ?, NULL, ?, NULL)",
        (ms_id, track_id, payload.title, payload.description, next_position, payload.started_at, now),
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
    xp_awarded       = row["xp_awarded"]
    last_activity_at = now   # qualquer edição atualiza last_activity_at

    if new_status == "concluido" and row["status"] != "concluido":
        completed_at = now
        xp_awarded = XP_PER_MILESTONE
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
        # reabre o marco — estorna exatamente o xp que foi creditado
        # nessa conclusão (não um valor fixo recalculado agora), sem
        # criar um novo action_log (a conclusão original continua no
        # histórico, só o xp/nível atual do atributo é corrigido)
        completed_at = None
        if xp_awarded:
            _debit_xp(db, "aprendizado", xp_awarded)
        xp_awarded = None

    db.execute(
        """
        UPDATE milestones
           SET title            = ?,
               description      = ?,
               notes            = ?,
               status           = ?,
               started_at       = ?,
               completed_at     = ?,
               last_activity_at = ?,
               xp_awarded       = ?
         WHERE id = ?
        """,
        (
            payload.title       if payload.title       is not None else row["title"],
            payload.description if payload.description is not None else row["description"],
            payload.notes       if payload.notes        is not None else row["notes"],
            new_status,
            payload.started_at  if payload.started_at   is not None else row["started_at"],
            completed_at,
            last_activity_at,
            xp_awarded,
            milestone_id,
        ),
    )
    db.commit()
    return _milestone_row_to_out(db.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone())


@router.put("/tracks/{track_id}/milestones/reorder", response_model=List[MilestoneOut])
def reorder_milestones(track_id: str, payload: MilestoneReorderIn, db=Depends(get_db)):
    """
    Replace completo da ordem (mesmo padrão de PUT /api/dashboard/{screen}):
    o frontend manda a lista inteira de ids na nova ordem depois de um
    drag-and-drop, não patches incrementais por item.
    """
    _get_track_or_404(db, track_id)

    existing_ids = {
        r["id"]
        for r in db.execute(
            "SELECT id FROM milestones WHERE track_id = ?", (track_id,)
        ).fetchall()
    }
    payload_ids = set(payload.milestone_ids)
    if payload_ids != existing_ids:
        raise HTTPException(
            status_code=422,
            detail="a lista precisa conter exatamente os marcos atuais da trilha, sem faltar nem sobrar nenhum",
        )

    for position, milestone_id in enumerate(payload.milestone_ids):
        db.execute(
            "UPDATE milestones SET position = ? WHERE id = ?",
            (position, milestone_id),
        )
    db.commit()

    rows = db.execute(
        "SELECT * FROM milestones WHERE track_id = ? ORDER BY position", (track_id,)
    ).fetchall()
    return [_milestone_row_to_out(r) for r in rows]


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: str, db=Depends(get_db)):
    _get_milestone_or_404(db, milestone_id)
    db.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
    db.commit()