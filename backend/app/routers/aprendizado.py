"""
Módulo Aprendizado (v1).

Endpoints:
  Trilhas:
    GET    /api/aprendizado/tracks              lista todas as trilhas em ordem manual (position)
    POST   /api/aprendizado/tracks              cria uma trilha nova (vai pro fim da lista)
    PUT    /api/aprendizado/tracks/{id}         atualiza nome/meta/status de uma trilha
    DELETE /api/aprendizado/tracks/{id}         remove trilha e seus marcos (CASCADE)
    PUT    /api/aprendizado/tracks/reorder      substitui a ordem das trilhas na sidebar (replace
                                                 completo, mesmo padrão do reorder de marcos abaixo)

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
  - ao reabrir um marco (status sai de 'concluido', pra 'pendente' ou
    'esquecido') ESTORNA a ação da conclusão: o action_log referenciado
    ('marco', id) é apagado e o xp dele debitado (app/actions.py::
    revert_actions), e completed_at/xp_awarded são zerados. current_xp
    nunca fica negativo. Remover um marco concluído (ou a trilha inteira)
    estorna do mesmo jeito.
  - apagar o log (em vez de só corrigir o xp) mantém as contagens das
    conquistas honestas: concluir e reabrir o mesmo marco 10 vezes não
    conta como 10 ações. Marcos concluídos antes de action_logs ter
    referência caem no estorno legado (só debita xp_awarded do atributo).
  - marco sem atividade por >30 dias vira 'esquecido' automaticamente, calculado
    na leitura (não há job periódico no v1 — é lazy evaluation)
  - status de trilha: 'ativa' | 'pausada' | 'parada'
  - status de marco:  'pendente' | 'concluido' | 'esquecido'
  - reordenar exige a lista COMPLETA de ids da trilha (mesmo conjunto, nova
    ordem) — rejeita com 422 se faltar ou sobrar algum id
  - mesma regra vale pro reorder de trilhas: lista completa de ids, replace
    total (não é patch incremental por item)
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.database import get_db, local_now, new_id, now_iso
from app.actions import debit_xp, register_action, revert_actions
from app.achievements import relock_unmet_achievements
from app.routers.metas import sync_learning_goals
from app.limites import Entrada
from app.mensagens import ErroKami, Texto

router = APIRouter()

# ── constantes ──────────────────────────────────────────────────────────────

TRACK_STATUSES    = {"ativa", "pausada", "parada"}
MILESTONE_STATUSES = {"pendente", "concluido", "esquecido"}
XP_PER_MILESTONE  = 20          # XP creditado ao concluir um marco
STALE_DAYS        = 30          # dias sem atividade para marcar como 'esquecido'


# ── schemas ──────────────────────────────────────────────────────────────────

class MilestoneIn(Entrada):
    title: str
    description: Optional[str] = None
    started_at: Optional[str] = None   # YYYY-MM-DD, opcional


class MilestoneUpdate(Entrada):
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


class MilestoneReorderIn(Entrada):
    milestone_ids: List[str]  # ordem completa e final dos marcos da trilha


class TrackIn(Entrada):
    name: str
    general_goal: Optional[str] = None
    status: str = "ativa"


class TrackUpdate(Entrada):
    name: Optional[str] = None
    general_goal: Optional[str] = None
    status: Optional[str] = None


class TrackOut(BaseModel):
    id: str
    name: str
    general_goal: Optional[str] = None
    status: str
    position: int
    created_at: str
    total_milestones: int
    completed_milestones: int
    progress_pct: int               # 0-100


class TrackReorderIn(Entrada):
    track_ids: List[str]  # ordem completa e final das trilhas na sidebar


# ── helpers ──────────────────────────────────────────────────────────────────

def _apply_staleness(db, track_id: str) -> None:
    """
    Marca como 'esquecido' qualquer marco 'pendente' cujo last_activity_at
    (ou started_at, se last_activity_at for NULL) seja anterior ao corte de
    STALE_DAYS dias. Lazy: roda na leitura, não precisa de job periódico.
    """
    cutoff = (
        local_now() - datetime.timedelta(days=STALE_DAYS)
    ).isoformat()

    db.execute(
        """
        UPDATE milestones
           SET status = 'esquecido',
               was_ever_stale = 1
         WHERE track_id = ?
           AND status   = 'pendente'
           AND COALESCE(last_activity_at, started_at) IS NOT NULL
           AND COALESCE(last_activity_at, started_at) < ?
        """,
        (track_id, cutoff),
    )
    db.commit()


def _revert_milestone_xp(db, milestone_id: str, xp_awarded) -> None:
    """
    Estorna a conclusão de um marco (ao reabrir ou remover). Marcos
    concluídos antes de action_logs ter referência não têm log
    identificável — pra eles cai no estorno legado de `xp_awarded`.
    """
    if not revert_actions(db, "marco", milestone_id) and xp_awarded:
        debit_xp(db, "aprendizado", xp_awarded)


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
        "position":            row["position"],
        "created_at":          row["created_at"],
        "total_milestones":    prog["total"],
        "completed_milestones": prog["done"],
        "progress_pct":        prog["pct"],
    }


def _get_track_or_404(db, track_id: str):
    row = db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.comum.trilha_nao_encontrada", "trilha não encontrada")
    return row


def _get_milestone_or_404(db, milestone_id: str):
    row = db.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.aprendizado.marco_nao_encontrado", "marco não encontrado")
    return row


# ── trilhas ──────────────────────────────────────────────────────────────────

@router.get("/tracks", response_model=List[TrackOut])
def list_tracks(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM tracks ORDER BY position").fetchall()
    # aplica laziness de staleness para todas as trilhas ativas
    for r in rows:
        if r["status"] == "ativa":
            _apply_staleness(db, r["id"])
    # re-busca depois do UPDATE para refletir possíveis mudanças de status
    rows = db.execute("SELECT * FROM tracks ORDER BY position").fetchall()
    return [_track_row_to_out(db, r) for r in rows]


@router.post("/tracks", response_model=TrackOut, status_code=201)
def create_track(payload: TrackIn, db=Depends(get_db)):
    if payload.status not in TRACK_STATUSES:
        raise ErroKami(
            422,
            "erro.comum.status_invalido_valores_aceitos_valores",
            "status inválido; valores aceitos: {valores}",
            valores=", ".join(map(str, sorted(TRACK_STATUSES))),
        )
    track_id = new_id()
    next_position = db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tracks",
    ).fetchone()["pos"]
    db.execute(
        "INSERT INTO tracks (id, name, general_goal, status, position, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (track_id, payload.name, payload.general_goal, payload.status, next_position, now_iso()),
    )
    db.commit()
    return _track_row_to_out(db, db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone())


@router.put("/tracks/reorder", response_model=List[TrackOut])
def reorder_tracks(payload: TrackReorderIn, db=Depends(get_db)):
    """
    Replace completo da ordem das trilhas na sidebar (mesmo padrão do
    reorder de marcos abaixo, e de PUT /api/dashboard/{screen}): o
    frontend manda a lista inteira de ids na nova ordem depois de um
    drag-and-drop, não patches incrementais por item.

    Registrado ANTES de PUT /tracks/{track_id} de propósito — como
    FastAPI casa rotas na ordem em que são declaradas, se o reorder
    viesse depois, "/tracks/reorder" seria capturado por
    "/tracks/{track_id}" (com track_id="reorder") e nunca chegaria aqui.
    """
    existing_ids = {r["id"] for r in db.execute("SELECT id FROM tracks").fetchall()}
    payload_ids = set(payload.track_ids)
    if payload_ids != existing_ids:
        raise ErroKami(
            422,
            "erro.aprendizado.lista_precisa_conter_exatamente_trilhas",
            "a lista precisa conter exatamente as trilhas atuais, sem faltar nem sobrar nenhuma",
        )

    for position, track_id in enumerate(payload.track_ids):
        db.execute("UPDATE tracks SET position = ? WHERE id = ?", (position, track_id))
    db.commit()

    rows = db.execute("SELECT * FROM tracks ORDER BY position").fetchall()
    return [_track_row_to_out(db, r) for r in rows]


@router.put("/tracks/{track_id}", response_model=TrackOut)
def update_track(track_id: str, payload: TrackUpdate, db=Depends(get_db)):
    row = _get_track_or_404(db, track_id)

    new_status = payload.status if payload.status is not None else row["status"]
    if new_status not in TRACK_STATUSES:
        raise ErroKami(
            422,
            "erro.comum.status_invalido_valores_aceitos_valores",
            "status inválido; valores aceitos: {valores}",
            valores=", ".join(map(str, sorted(TRACK_STATUSES))),
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
    # marcos somem por CASCADE — estorna antes a conclusão de cada um,
    # senão apagar a trilha e recriá-la virava xp infinito
    done = db.execute(
        "SELECT id, xp_awarded FROM milestones WHERE track_id = ? AND status = 'concluido'",
        (track_id,),
    ).fetchall()
    for ms in done:
        _revert_milestone_xp(db, ms["id"], ms["xp_awarded"])
    db.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o marco ainda concluído, o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
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
        raise ErroKami(
            422,
            "erro.comum.status_invalido_valores_aceitos_valores",
            "status inválido; valores aceitos: {valores}",
            valores=", ".join(map(str, sorted(MILESTONE_STATUSES))),
        )

    now = now_iso()

    # lógica de transição de status
    completed_at     = row["completed_at"]
    xp_awarded       = row["xp_awarded"]
    last_activity_at = now   # qualquer edição atualiza last_activity_at

    is_completing = new_status == "concluido" and row["status"] != "concluido"

    if is_completing:
        completed_at = now
        xp_awarded = XP_PER_MILESTONE

    elif row["status"] == "concluido" and new_status != "concluido":
        # reabre o marco (pra 'pendente' ou 'esquecido') — estorna a ação
        # da conclusão. Sem cobrir 'esquecido' aqui, concluido -> esquecido
        # -> concluido creditava xp de novo a cada volta.
        completed_at = None
        _revert_milestone_xp(db, milestone_id, xp_awarded)
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
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o marco ainda concluído, o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
    db.commit()

    if is_completing:
        # credita XP em Aprendizado via núcleo — feito DEPOIS do UPDATE
        # acima (e não antes, como era antigamente) porque register_action
        # dispara check_achievements na mesma chamada: o achievement
        # 'milestone_completed' lê a linha deste marco direto da tabela
        # milestones, então ela precisa já estar com status='concluido'
        # nesse momento, ou o desbloqueio só aconteceria numa checagem
        # futura e por acaso (na próxima ação registrada em qualquer lugar
        # do app), nunca na hora certa.
        register_action(
            db,
            description=Texto("log.marco.concluido", "concluiu marco: {marco}", marco=row["title"]),
            categories=["aprendizado"],
            xp=XP_PER_MILESTONE,
            impact=3,
            source="aprendizado",
            referencia_tipo="marco",
            referencia_id=milestone_id,
        )

    # meta 3.6 (metas v2): metas tipo 'aprendizado' vinculadas a essa trilha
    # progridem sozinhas junto com os marcos — recalcula sempre que o status
    # de um marco muda (concluir OU reabrir), nunca em GET /metas.
    sync_learning_goals(db, row["track_id"])

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
        raise ErroKami(
            422,
            "erro.aprendizado.lista_precisa_conter_exatamente_marcos",
            "a lista precisa conter exatamente os marcos atuais da trilha, sem faltar nem sobrar nenhum",
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
    row = _get_milestone_or_404(db, milestone_id)
    db.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
    db.commit()
    if row["status"] == "concluido":
        _revert_milestone_xp(db, milestone_id, row["xp_awarded"])
    # remover um marco concluído também pode derrubar a contagem que uma
    # meta 'aprendizado' estava usando — recalcula por segurança (não
    # desfaz uma meta já concluída, ver docstring de sync_learning_goals)
    sync_learning_goals(db, row["track_id"])