"""
Cadastros simples (categorias, contas fixas, dívidas), contas fixas por
mês e quitação de dívidas (P-13).

Parte do módulo Finanças (routers/financas/__init__.py junta as partes
num router só, montado em /api/financas). MAN-02.
"""
from typing import ClassVar, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.actions import has_action, register_action, revert_actions
from app.achievements import relock_unmet_achievements
from app.finance_utils import create_saida_transaction, revert_saida_transaction
from app.limites import Entrada, SAIDA_CONFIG
from app.mensagens import ErroKami, Texto
from app.routers.financas.comum import (
    XP_PAGAMENTO_RECORRENTE,
    _revert_period_xp,
    _validate_month,
)

router = APIRouter()


class FixedBillIn(Entrada):
    name: str
    amount: float
    due_day: int = Field(..., ge=1, le=31)
    active: bool = True
    conta_id: Optional[str] = None   # vínculo opcional — habilita gerar transação real ao pagar
    categoria: Optional[str] = None  # usada na transação gerada; cai pra "contas fixas" se vazia


class FixedBillOut(FixedBillIn):
    model_config = SAIDA_CONFIG  # resposta: sem os limites de entrada (app/limites.py)
    sem_limites_de_entrada: ClassVar[bool] = True
    id: str


class FixedBillPeriodOut(BaseModel):
    id: str
    fixed_bill_id: str
    mes_ano: str
    paga: bool
    valor_pago: Optional[float] = None
    gerou_transacao: bool = False  # True quando 'paga' veio de uma transação real (não só lembrete)


class PayFixedBillPeriodPayload(Entrada):
    valor_pago: Optional[float] = None
    forma_pagamento: Optional[str] = Field(None, pattern="^(saldo|credito)$")  # obrigatório só se a conta tiver os dois
    gerar_transacao: bool = True  # se False, comporta-se como antes: só marca como lembrete


class DebtIn(Entrada):
    description: str
    counterparty: Optional[str] = None
    amount: float
    due_date: Optional[str] = None
    status: str = "aberta"


class DebtOut(DebtIn):
    model_config = SAIDA_CONFIG  # resposta: sem os limites de entrada (app/limites.py)
    sem_limites_de_entrada: ClassVar[bool] = True
    id: str
    transacao_id: Optional[str] = None


class PayDebtPayload(Entrada):
    # sem conta_id: só marca como quitada (sem mexer em saldo nenhum)
    conta_id: Optional[str] = None
    forma_pagamento: Optional[str] = Field(None, pattern="^(saldo|credito)$")  # só se a conta tiver os dois

# ==================== cadastros simples (CRUD básico) ====================

@router.get("/fixed-bills", response_model=List[FixedBillOut])
def list_fixed_bills(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM fixed_bills ORDER BY name").fetchall()
    return [dict(r) | {"active": bool(r["active"])} for r in rows]


@router.post("/fixed-bills", response_model=FixedBillOut)
def create_fixed_bill(payload: FixedBillIn, db=Depends(get_db)):
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise ErroKami(422, "erro.comum.conta_nao_encontrada", "conta não encontrada")
    bill_id = new_id()
    db.execute(
        "INSERT INTO fixed_bills (id, name, amount, due_day, active, conta_id, categoria) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (bill_id, payload.name, payload.amount, payload.due_day, int(payload.active),
         payload.conta_id, payload.categoria),
    )
    db.commit()
    return {"id": bill_id, **payload.model_dump()}


@router.put("/fixed-bills/{bill_id}", response_model=FixedBillOut)
def update_fixed_bill(bill_id: str, payload: FixedBillIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM fixed_bills WHERE id = ?", (bill_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.contas.conta_fixa_nao_encontrada", "conta fixa não encontrada")
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise ErroKami(422, "erro.comum.conta_nao_encontrada", "conta não encontrada")
    db.execute(
        "UPDATE fixed_bills SET name=?, amount=?, due_day=?, active=?, conta_id=?, categoria=? WHERE id=?",
        (payload.name, payload.amount, payload.due_day, int(payload.active),
         payload.conta_id, payload.categoria, bill_id),
    )
    db.commit()
    return {"id": bill_id, **payload.model_dump()}


@router.delete("/fixed-bills/{bill_id}")
def delete_fixed_bill(bill_id: str, db=Depends(get_db)):
    if not db.execute("SELECT 1 FROM fixed_bills WHERE id = ?", (bill_id,)).fetchone():
        raise ErroKami(404, "erro.contas.conta_fixa_nao_encontrada", "conta fixa não encontrada")
    # P-14 (CONF-04): estorna o xp dos meses pagos (transações reais ficam)
    _revert_period_xp(db, "conta_fixa_periodo", "fixed_bill_periods", "fixed_bill_id", bill_id)
    db.execute("DELETE FROM fixed_bills WHERE id = ?", (bill_id,))
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o cadastro ainda existindo, o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
    db.commit()
    return {"deleted": True}


# ==================== contas fixas — instância mensal ====================
# Mesmo padrão sob-demanda de app/routers/wallet.py::list_subscription_periods
# (unificação do item 1 do mapa de problemas). Marcar como paga gera uma
# transação real OPCIONALMENTE — ver docstring de app/finance_utils.py.

DEFAULT_FIXED_BILL_CATEGORY = "contas fixas"


def _period_out(row) -> dict:
    return {
        "id": row["id"],
        "fixed_bill_id": row["fixed_bill_id"],
        "mes_ano": row["mes_ano"],
        "paga": bool(row["paga"]),
        "valor_pago": row["valor_pago"],
        "gerou_transacao": row["transaction_id"] is not None,
    }


@router.get("/fixed-bills/periods", response_model=List[FixedBillPeriodOut])
def list_fixed_bill_periods(month: str, db=Depends(get_db)):
    _validate_month(month)
    bills = db.execute("SELECT id FROM fixed_bills WHERE active = 1").fetchall()
    for b in bills:
        existing = db.execute(
            "SELECT id FROM fixed_bill_periods WHERE fixed_bill_id = ? AND mes_ano = ?",
            (b["id"], month),
        ).fetchone()
        if not existing:
            # OR IGNORE: a tela pede o mês em várias requisições ao mesmo tempo e
            # duas podem criar o mesmo período juntas (UNIQUE) — quem chega depois só usa o que já existe
            db.execute(
                "INSERT OR IGNORE INTO fixed_bill_periods (id, fixed_bill_id, mes_ano, paga, valor_pago) "
                "VALUES (?, ?, ?, 0, NULL)",
                (new_id(), b["id"], month),
            )
    db.commit()
    rows = db.execute(
        "SELECT p.* FROM fixed_bill_periods p "
        "JOIN fixed_bills b ON b.id = p.fixed_bill_id "
        "WHERE p.mes_ano = ? AND b.active = 1 ORDER BY b.name",
        (month,),
    ).fetchall()
    return [_period_out(r) for r in rows]


@router.put("/fixed-bills/periods/{period_id}/pay", response_model=FixedBillPeriodOut)
def pay_fixed_bill_period(period_id: str, payload: PayFixedBillPeriodPayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.contas.instancia_conta_fixa_nao_encontrada", "instância de conta fixa não encontrada")
    bill = db.execute("SELECT * FROM fixed_bills WHERE id = ?", (row["fixed_bill_id"],)).fetchone()
    if not bill:
        raise ErroKami(404, "erro.contas.conta_fixa_nao_encontrada", "conta fixa não encontrada")

    amount = payload.valor_pago if payload.valor_pago is not None else bill["amount"]
    transaction_id = None

    # só gera transação real se a conta fixa tem conta_id vinculada E o
    # usuário não recusou explicitamente (payload.gerar_transacao) — sem
    # conta vinculada não tem como saber de onde descontar, então cai
    # pro comportamento de sempre (só lembrete).
    if bill["conta_id"] and payload.gerar_transacao:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (bill["conta_id"],)).fetchone()
        if not conta:
            raise ErroKami(
                422,
                "erro.contas.conta_vinculada_conta_fixa_nao",
                "conta vinculada à conta fixa não existe mais",
            )
        transaction_id = create_saida_transaction(
            db, conta, amount,
            category=bill["categoria"] or DEFAULT_FIXED_BILL_CATEGORY,
            description=Texto("lancamento.conta_fixa", "conta fixa: {nome}", nome=bill["name"]),
            forma_pagamento=payload.forma_pagamento,
        )

    # o período vira "paga" ANTES de registrar a ação: register_action roda
    # a checagem de conquistas, e "contas em dia" (todas as contas do mês
    # pagas) só vale com este período já pago — na ordem antiga, pagar a
    # última conta do mês não desbloqueava nada na hora (achado do CONF-04)
    db.execute(
        "UPDATE fixed_bill_periods SET paga = 1, valor_pago = ?, transaction_id = ? WHERE id = ?",
        (payload.valor_pago, transaction_id, period_id),
    )
    if transaction_id and not has_action(db, "conta_fixa_periodo", period_id):
        register_action(
            db,
            description=Texto("log.conta_fixa.paga", "pagou conta fixa: {nome}", nome=bill["name"]),
            categories=["financas"],
            xp=XP_PAGAMENTO_RECORRENTE,
            impact=2,
            source="financas",
            referencia_tipo="conta_fixa_periodo",
            referencia_id=period_id,
        )
    db.commit()
    updated = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


@router.put("/fixed-bills/periods/{period_id}/unpay", response_model=FixedBillPeriodOut)
def unpay_fixed_bill_period(period_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.contas.instancia_conta_fixa_nao_encontrada", "instância de conta fixa não encontrada")
    # se essa marcação tinha gerado uma transação real, desfaz o efeito no
    # saldo/fatura e remove a transação antes de voltar pra "não paga" —
    # sem isso o saldo ficaria com um desconto fantasma que o usuário não
    # consegue mais explicar (motivo original do item 6).
    revert_saida_transaction(db, row["transaction_id"])
    revert_actions(db, "conta_fixa_periodo", period_id)
    db.execute(
        "UPDATE fixed_bill_periods SET paga = 0, valor_pago = NULL, transaction_id = NULL WHERE id = ?",
        (period_id,),
    )
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o período ainda pago (ex.: "contas em dia"), o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
    db.commit()
    updated = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


# ==================== dívidas — quitação (P-13, CONF-04) ====================
# Quitar uma dívida funciona como pagar uma conta fixa: credita o xp de
# pagamento e, se a pessoa escolher a conta de onde o dinheiro saiu, lança
# a saída real (categoria "dívidas"). Desmarcar a quitação desfaz tudo:
# devolve o dinheiro, estorna o xp e rebloqueia a conquista "dívida
# quitada" se ela não valer mais. Diferente da conta fixa, o xp vem com
# ou sem conta: quitar é um evento único por dívida, e desmarcar estorna,
# então não há como repetir.

DEFAULT_DEBT_CATEGORY = "dívidas"
REF_DIVIDA = "divida"


def _pay_debt(db, debt, conta_id: Optional[str], forma_pagamento: Optional[str]) -> None:
    if debt["status"] == "paga":
        return  # já quitada: pagar de novo não credita nem lança de novo
    transacao_id = None
    if conta_id:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (conta_id,)).fetchone()
        if not conta:
            raise ErroKami(
                422,
                "erro.comum.conta_nao_encontrada_conta_id",
                "conta não encontrada: '{conta_id}'",
                conta_id=conta_id,
            )
        transacao_id = create_saida_transaction(
            db, conta, debt["amount"],
            category=DEFAULT_DEBT_CATEGORY,
            description=Texto("lancamento.divida", "quitação de dívida: {descricao}", descricao=debt["description"]),
            forma_pagamento=forma_pagamento,
        )
    db.execute("UPDATE debts SET status = 'paga', transacao_id = ? WHERE id = ?", (transacao_id, debt["id"]))
    if not has_action(db, REF_DIVIDA, debt["id"]):
        register_action(
            db,
            description=Texto("log.divida.quitada", "quitou a dívida: {descricao}", descricao=debt["description"]),
            categories=["financas"],
            xp=XP_PAGAMENTO_RECORRENTE,
            impact=3,
            source="financas",
            referencia_tipo=REF_DIVIDA,
            referencia_id=debt["id"],
        )


def _unpay_debt(db, debt) -> None:
    if debt["status"] != "paga":
        return
    revert_saida_transaction(db, debt["transacao_id"])
    db.execute("UPDATE debts SET status = 'aberta', transacao_id = NULL WHERE id = ?", (debt["id"],))
    revert_actions(db, REF_DIVIDA, debt["id"])
    # dívida quitada antes desta mudança não tem log pra estornar — o
    # revert_actions não rebloqueia nada nesse caso, então rebloqueia aqui
    relock_unmet_achievements(db)


def _get_debt_or_404(db, debt_id: str):
    row = db.execute("SELECT * FROM debts WHERE id = ?", (debt_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.contas.divida_nao_encontrada", "dívida não encontrada")
    return row


@router.put("/debts/{debt_id}/pay", response_model=DebtOut)
def pay_debt(debt_id: str, payload: PayDebtPayload, db=Depends(get_db)):
    _pay_debt(db, _get_debt_or_404(db, debt_id), payload.conta_id, payload.forma_pagamento)
    db.commit()
    return dict(_get_debt_or_404(db, debt_id))


@router.put("/debts/{debt_id}/unpay", response_model=DebtOut)
def unpay_debt(debt_id: str, db=Depends(get_db)):
    _unpay_debt(db, _get_debt_or_404(db, debt_id))
    db.commit()
    return dict(_get_debt_or_404(db, debt_id))


@router.get("/debts", response_model=List[DebtOut])
def list_debts(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM debts ORDER BY due_date").fetchall()
    return [dict(r) for r in rows]


@router.post("/debts", response_model=DebtOut)
def create_debt(payload: DebtIn, db=Depends(get_db)):
    debt_id = new_id()
    db.execute(
        "INSERT INTO debts (id, description, counterparty, amount, due_date, status) "
        "VALUES (?, ?, ?, ?, ?, 'aberta')",
        (debt_id, payload.description, payload.counterparty, payload.amount, payload.due_date),
    )
    # criada já quitada: passa pela quitação (xp + conquista), sem conta (P-13)
    if payload.status == "paga":
        _pay_debt(db, _get_debt_or_404(db, debt_id), None, None)
    db.commit()
    return dict(_get_debt_or_404(db, debt_id))


@router.put("/debts/{debt_id}", response_model=DebtOut)
def update_debt(debt_id: str, payload: DebtIn, db=Depends(get_db)):
    row = _get_debt_or_404(db, debt_id)
    db.execute(
        "UPDATE debts SET description=?, counterparty=?, amount=?, due_date=? WHERE id=?",
        (payload.description, payload.counterparty, payload.amount, payload.due_date, debt_id),
    )
    # trocar o status pela edição passa pelo mesmo caminho da quitação
    # (P-13), pra xp e conquista não saírem de sincronia — sem conta,
    # porque a edição não diz de onde saiu o dinheiro
    if payload.status != row["status"]:
        fresh = _get_debt_or_404(db, debt_id)
        if payload.status == "paga":
            _pay_debt(db, fresh, None, None)
        else:
            _unpay_debt(db, fresh)
    db.commit()
    return dict(_get_debt_or_404(db, debt_id))


@router.delete("/debts/{debt_id}")
def delete_debt(debt_id: str, db=Depends(get_db)):
    _get_debt_or_404(db, debt_id)
    # estorna o xp da quitação; a saída real, se houve, fica em Finanças
    # (mesma regra de apagar conta fixa/assinatura — P-14)
    revert_actions(db, REF_DIVIDA, debt_id)
    db.execute("DELETE FROM debts WHERE id = ?", (debt_id,))
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o dívida ainda quitada ("quitado"), o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
    db.commit()
    return {"deleted": True}
