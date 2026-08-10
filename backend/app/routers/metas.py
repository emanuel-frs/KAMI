"""
Módulo Metas Pessoais (v2 — tipo 'academica' fica pós-mvp, depende de Carreira).

Endpoints:
  GET    /api/metas                        lista todas as metas (ativas + concluídas)
  POST   /api/metas                        cria uma meta nova
  PUT    /api/metas/{id}                   atualiza título/tipo/alvo/prazo/peso/vínculos
  DELETE /api/metas/{id}                   remove a meta (contribuições somem via CASCADE;
                                              transações reais já lançadas em Finanças NÃO somem)
  POST   /api/metas/{id}/contribute        registra uma contribuição (valor + nota opcional)
  GET    /api/metas/{id}/contributions     histórico de contribuições de uma meta

Regras de negócio (v1, mantidas):
  - progresso (%) = current_value / target_value, arredondado, sem passar de 100
  - contribuição: valor livre por chamada (não é passo fixo)
  - meta 'concluida' não aceita mais contribuições nem edição de progresso (422)
  - sem coluna própria de "completed_at" — derivado da data da última
    goal_contributions daquela meta

Regras de negócio (v2 — NOVO nesta versão):
  - tipo define a unidade automaticamente: 'financeira' -> unit='money', todo
    o resto -> unit='count'. Pra tipos 'count' o usuário pode dar um rótulo
    livre (`unit_label`, ex: "kg", "páginas", "vezes") só de exibição — não
    muda nenhuma lógica de cálculo, é puramente cosmético.
  - tipos 'saude', 'leitura' e 'habito' reaproveitam 100% o mecanismo de
    contribuição livre que já existia só pra 'livre' — decisão explícita de
    manter escopo leve (nada de streak/heatmap dedicado pra hábito).
  - tipo 'aprendizado' é especial: current_value é 100% automático, calculado
    a partir dos marcos concluídos da trilha vinculada (`linked_track_id`).
    Não aceita POST /contribute (422). Quem atualiza o progresso é o módulo
    Aprendizado, chamando `sync_learning_goals(db, track_id)` sempre que um
    marco muda de status ou é removido — nunca em GET, pra não recreditar xp
    em toda leitura. Uma vez concluída, a meta não desfaz (mesma filosofia
    dos outros tipos) mesmo que um marco seja reaberto depois.
  - peso (`weight`, tiers fixos: baixo/medio/alto/epico) multiplica o xp de
    contribuição e o xp bônus de conclusão (ver GOAL_WEIGHTS) — meta "épica"
    vale bem mais xp que uma "baixa", sem reinventar a fórmula de xp em si.
  - conexão com Finanças: contribuição numa meta 'financeira' agora exige
    escolher a origem do dinheiro:
      * origem='externo'  -> comportamento do v1 (só soma valor, sem tocar
        em conta nenhuma) — cobre presente/ajuda de terceiro.
      * origem='conta'    -> cria uma transação REAL de saída (categoria
        'metas') na conta escolhida (ou na `linked_conta_id` da própria
        meta, se não vier `conta_id` na contribuição), debita saldo, e
        guarda o id da transação em goal_contributions.transaction_id. Se a
        meta for apagada depois, a transação FICA em Finanças (só a linha
        de contribuição some) — dinheiro que já saiu da conta é fato
        financeiro real.
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.actions import register_action

router = APIRouter()

# ── constantes ──────────────────────────────────────────────────────────────

GOAL_TYPES = {"financeira", "livre", "saude", "leitura", "habito", "aprendizado"}
# 'academica' só entra com o módulo Carreira
GOAL_STATUSES = {"ativa", "concluida"}
CONTRIBUTION_ORIGINS = {"conta", "externo"}

XP_PER_CONTRIBUTION = 3      # XP base creditado em 'metas' a cada contribuição normal
XP_GOAL_COMPLETED_BONUS = 30  # XP base bônus ao concluir a meta

GOAL_WEIGHTS = {
    "baixo": 0.5,
    "medio": 1.0,
    "alto": 1.75,
    "epico": 3.0,
}


def _unit_for_type(goal_type: str) -> str:
    return "money" if goal_type == "financeira" else "count"


def _xp_for(base: int, weight: str) -> int:
    return round(base * GOAL_WEIGHTS.get(weight, 1.0))


# ── schemas ──────────────────────────────────────────────────────────────────

class GoalIn(BaseModel):
    title: str
    type: str = "livre"
    target_value: float
    deadline: Optional[str] = None  # YYYY-MM-DD, opcional
    weight: str = "medio"
    unit_label: Optional[str] = None
    linked_conta_id: Optional[str] = None   # só 'financeira' (conta padrão pra contribuir)
    linked_track_id: Optional[str] = None   # obrigatório em 'aprendizado'


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    target_value: Optional[float] = None
    # "" limpa o prazo; None = não mexe no prazo atual
    deadline: Optional[str] = None
    clear_deadline: bool = False
    weight: Optional[str] = None
    unit_label: Optional[str] = None
    clear_unit_label: bool = False
    linked_conta_id: Optional[str] = None
    clear_linked_conta_id: bool = False
    linked_track_id: Optional[str] = None


class GoalOut(BaseModel):
    id: str
    title: str
    type: str
    current_value: float
    target_value: float
    unit: str
    unit_label: Optional[str] = None
    deadline: Optional[str] = None
    status: str
    progress_pct: int
    completed_at: Optional[str] = None  # derivado de goal_contributions, ver docstring
    weight: str
    linked_conta_id: Optional[str] = None
    linked_conta_nome: Optional[str] = None       # computado (join), só exibição
    linked_track_id: Optional[str] = None
    linked_track_name: Optional[str] = None       # computado (join), só exibição


class ContributeIn(BaseModel):
    amount: float
    note: Optional[str] = None
    origem: Optional[str] = None    # 'conta' | 'externo' — obrigatório só quando type == 'financeira'
    conta_id: Optional[str] = None  # só quando origem == 'conta'; se ausente usa linked_conta_id da meta


class ContributionOut(BaseModel):
    id: str
    goal_id: str
    amount: float
    note: Optional[str] = None
    date: str
    origem: Optional[str] = None
    transaction_id: Optional[str] = None


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

    linked_conta_nome = None
    if row["linked_conta_id"]:
        conta = db.execute(
            "SELECT wa.nome AS nome, wb.nome AS bank_nome "
            "FROM wallet_accounts wa JOIN wallet_banks wb ON wb.id = wa.bank_id "
            "WHERE wa.id = ?",
            (row["linked_conta_id"],),
        ).fetchone()
        if conta:
            linked_conta_nome = f'{conta["bank_nome"]} — {conta["nome"]}'

    linked_track_name = None
    if row["linked_track_id"]:
        track = db.execute(
            "SELECT name FROM tracks WHERE id = ?", (row["linked_track_id"],)
        ).fetchone()
        if track:
            linked_track_name = track["name"]

    return {
        "id": row["id"],
        "title": row["title"],
        "type": row["type"],
        "current_value": row["current_value"],
        "target_value": row["target_value"],
        "unit": row["unit"],
        "unit_label": row["unit_label"],
        "deadline": row["deadline"],
        "status": row["status"],
        "progress_pct": pct,
        "completed_at": completed_at,
        "weight": row["weight"],
        "linked_conta_id": row["linked_conta_id"],
        "linked_conta_nome": linked_conta_nome,
        "linked_track_id": row["linked_track_id"],
        "linked_track_name": linked_track_name,
    }


def _create_goal_transaction(db, conta_row, amount: float, description: str) -> str:
    """
    Cria a transação real de saída (categoria 'metas') que representa uma
    contribuição financeira paga de uma conta de verdade — debita saldo e
    devolve o id da transação criada, pra ficar referenciada em
    goal_contributions.transaction_id. Sempre 'saldo' (nunca crédito — pagar
    uma meta no cartão não faz sentido conceitual aqui) e sempre na data de
    hoje (a contribuição é um evento "agora", não retroativo).
    """
    tx_id = new_id()
    hoje = datetime.date.today().isoformat()
    db.execute(
        "INSERT INTO transactions "
        "(id, description, amount, type, category, conta_id, forma_pagamento, conta_destino_id, destino_externo, date) "
        "VALUES (?, ?, ?, 'saida', 'metas', ?, 'saldo', NULL, NULL, ?)",
        (tx_id, description, amount, conta_row["id"], hoje),
    )
    db.execute(
        "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
        (amount, conta_row["id"]),
    )
    return tx_id


def sync_learning_goals(db, track_id: str) -> None:
    """
    Recalcula o progresso das metas tipo 'aprendizado' vinculadas a uma
    trilha, a partir do número atual de marcos concluídos. Chamado pelo
    módulo Aprendizado (não pelas rotas de Metas) sempre que um marco muda
    de status ou é removido — nunca em GET /metas, pra não recreditar xp em
    toda leitura. Só anda pra frente: uma meta que já concluiu não volta a
    'ativa' se um marco for reaberto depois (mesma filosofia das outras
    metas — meta concluída não desfaz).
    """
    active_goals = db.execute(
        "SELECT * FROM goals WHERE type = 'aprendizado' AND linked_track_id = ? AND status = 'ativa'",
        (track_id,),
    ).fetchall()
    if not active_goals:
        return

    done = db.execute(
        "SELECT COUNT(*) AS c FROM milestones WHERE track_id = ? AND status = 'concluido'",
        (track_id,),
    ).fetchone()["c"]

    newly_completed = []
    for goal in active_goals:
        target = goal["target_value"] or 0
        new_current = min(target, done) if target > 0 else done
        db.execute("UPDATE goals SET current_value = ? WHERE id = ?", (new_current, goal["id"]))
        if target > 0 and new_current >= target:
            db.execute("UPDATE goals SET status = 'concluida' WHERE id = ?", (goal["id"],))
            newly_completed.append(goal)
    db.commit()

    for goal in newly_completed:
        register_action(
            db,
            description=f'concluiu a meta "{goal["title"]}" (trilha, xp bônus)',
            categories=["metas"],
            xp=_xp_for(XP_GOAL_COMPLETED_BONUS, goal["weight"]),
            impact=5,
            source="metas",
        )


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
    if payload.weight not in GOAL_WEIGHTS:
        raise HTTPException(
            status_code=422,
            detail=f"peso inválido; valores aceitos: {sorted(GOAL_WEIGHTS)}",
        )

    linked_conta_id = None
    if payload.type == "financeira" and payload.linked_conta_id:
        conta = db.execute(
            "SELECT id FROM wallet_accounts WHERE id = ?", (payload.linked_conta_id,)
        ).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta padrão não encontrada")
        linked_conta_id = payload.linked_conta_id

    linked_track_id = None
    if payload.type == "aprendizado":
        if not payload.linked_track_id:
            raise HTTPException(
                status_code=422, detail="meta do tipo 'aprendizado' precisa de uma trilha vinculada"
            )
        track = db.execute("SELECT id FROM tracks WHERE id = ?", (payload.linked_track_id,)).fetchone()
        if not track:
            raise HTTPException(status_code=422, detail="trilha não encontrada")
        linked_track_id = payload.linked_track_id

    unit_label = (payload.unit_label or "").strip() or None
    if payload.type == "financeira":
        unit_label = None  # unidade já é 'money', rótulo livre não se aplica

    goal_id = new_id()
    db.execute(
        "INSERT INTO goals "
        "(id, title, type, current_value, target_value, unit, unit_label, deadline, status, weight, linked_conta_id, linked_track_id) "
        "VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'ativa', ?, ?, ?)",
        (
            goal_id,
            payload.title.strip(),
            payload.type,
            payload.target_value,
            _unit_for_type(payload.type),
            unit_label,
            payload.deadline,
            payload.weight,
            linked_conta_id,
            linked_track_id,
        ),
    )
    db.commit()

    if payload.type == "aprendizado":
        # backfilla o progresso já existente da trilha (ex: usuário cria a
        # meta depois de já ter concluído alguns módulos)
        sync_learning_goals(db, linked_track_id)

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

    new_weight = payload.weight if payload.weight is not None else row["weight"]
    if new_weight not in GOAL_WEIGHTS:
        raise HTTPException(
            status_code=422,
            detail=f"peso inválido; valores aceitos: {sorted(GOAL_WEIGHTS)}",
        )

    if payload.clear_deadline:
        new_deadline = None
    elif payload.deadline is not None:
        new_deadline = payload.deadline
    else:
        new_deadline = row["deadline"]

    if payload.clear_unit_label:
        new_unit_label = None
    elif payload.unit_label is not None:
        new_unit_label = payload.unit_label.strip() or None
    else:
        new_unit_label = row["unit_label"]
    if new_type == "financeira":
        new_unit_label = None

    if payload.clear_linked_conta_id:
        new_linked_conta_id = None
    elif payload.linked_conta_id is not None:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.linked_conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta padrão não encontrada")
        new_linked_conta_id = payload.linked_conta_id
    else:
        new_linked_conta_id = row["linked_conta_id"]

    new_linked_track_id = row["linked_track_id"]
    if new_type == "aprendizado":
        candidate = payload.linked_track_id if payload.linked_track_id is not None else row["linked_track_id"]
        if not candidate:
            raise HTTPException(
                status_code=422, detail="meta do tipo 'aprendizado' precisa de uma trilha vinculada"
            )
        track = db.execute("SELECT id FROM tracks WHERE id = ?", (candidate,)).fetchone()
        if not track:
            raise HTTPException(status_code=422, detail="trilha não encontrada")
        new_linked_track_id = candidate
    elif payload.type is not None:
        # mudou pra um tipo que não é mais 'aprendizado' — solta o vínculo
        new_linked_track_id = None

    db.execute(
        "UPDATE goals SET title = ?, type = ?, target_value = ?, unit = ?, unit_label = ?, "
        "deadline = ?, weight = ?, linked_conta_id = ?, linked_track_id = ? WHERE id = ?",
        (
            new_title, new_type, new_target, _unit_for_type(new_type), new_unit_label,
            new_deadline, new_weight, new_linked_conta_id, new_linked_track_id, goal_id,
        ),
    )
    db.commit()

    if new_type == "aprendizado" and row["status"] == "ativa":
        sync_learning_goals(db, new_linked_track_id)

    return _goal_row_to_out(db, _get_goal_or_404(db, goal_id))


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db=Depends(get_db)):
    _get_goal_or_404(db, goal_id)
    # goal_contributions some via CASCADE; transações reais criadas por
    # contribuições origem='conta' NÃO somem (ver docstring do módulo) —
    # ficam com goal_contributions.transaction_id apagado junto, mas a
    # linha em transactions continua existindo normalmente em Finanças.
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()


@router.post("/{goal_id}/contribute", response_model=GoalOut)
def contribute_goal(goal_id: str, payload: ContributeIn, db=Depends(get_db)):
    row = _get_goal_or_404(db, goal_id)

    if row["type"] == "aprendizado":
        raise HTTPException(
            status_code=422,
            detail="meta do tipo 'aprendizado' progride sozinha junto com a trilha — não aceita contribuição manual",
        )
    if row["status"] == "concluida":
        raise HTTPException(status_code=422, detail="meta já concluída — não aceita novas contribuições")
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="valor da contribuição precisa ser maior que zero")

    origem = None
    transaction_id = None

    if row["type"] == "financeira":
        if payload.origem not in CONTRIBUTION_ORIGINS:
            raise HTTPException(
                status_code=422,
                detail=f"informe a origem da contribuição: {sorted(CONTRIBUTION_ORIGINS)}",
            )
        origem = payload.origem

        if origem == "conta":
            conta_id = payload.conta_id or row["linked_conta_id"]
            if not conta_id:
                raise HTTPException(
                    status_code=422,
                    detail="informe 'conta_id' (ou cadastre uma conta padrão na meta) pra contribuir a partir de uma conta",
                )
            conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (conta_id,)).fetchone()
            if not conta:
                raise HTTPException(status_code=422, detail="conta não encontrada")
            if not conta["possui_saldo"]:
                raise HTTPException(status_code=422, detail="essa conta não possui saldo")
            saldo_atual = conta["saldo_atual"] or 0
            if payload.amount > saldo_atual:
                raise HTTPException(
                    status_code=422,
                    detail=f"saldo insuficiente: disponível R$ {saldo_atual:.2f}, tentando contribuir R$ {payload.amount:.2f}",
                )
            transaction_id = _create_goal_transaction(
                db, conta, payload.amount, f'meta: {row["title"]}'
            )

    db.execute(
        "INSERT INTO goal_contributions (id, goal_id, amount, note, date, origem, transaction_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (new_id(), goal_id, payload.amount, payload.note, now_iso(), origem, transaction_id),
    )

    new_current = min(row["target_value"], row["current_value"] + payload.amount)
    completes_now = new_current >= row["target_value"]

    db.execute("UPDATE goals SET current_value = ? WHERE id = ?", (new_current, goal_id))
    if completes_now:
        db.execute("UPDATE goals SET status = 'concluida' WHERE id = ?", (goal_id,))
    db.commit()

    # um crédito OU outro, nunca os dois na mesma contribuição (mesmo
    # comportamento do v1) — o bônus de conclusão também dispara
    # check_achievements (via register_action) pro achievement 'goal_completed'.
    # Ambos passam pelo multiplicador de peso da meta (GOAL_WEIGHTS).
    if completes_now:
        register_action(
            db,
            description=f'concluiu a meta "{row["title"]}" (xp bônus)',
            categories=["metas"],
            xp=_xp_for(XP_GOAL_COMPLETED_BONUS, row["weight"]),
            impact=5,
            source="metas",
        )
    else:
        register_action(
            db,
            description=f'contribuiu para "{row["title"]}"',
            categories=["metas"],
            xp=_xp_for(XP_PER_CONTRIBUTION, row["weight"]),
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
