"""
Módulo Finanças (v1).

Endpoints:
  Renda recorrente (decisão 06 — dia útil real via workalendar):
    GET /income-entries?month=YYYY-MM        garante e devolve as entradas do mês
    PUT /income-entries/{id}/confirm         marca como paga (recalcula parte 2)
    PUT /income-entries/{id}/revert          desfaz a confirmação

  Cadastros simples (CRUD básico):
    /fixed-bills, /debts

  Contas fixas — instância mensal (mesmo padrão de wallet_subscriptions,
  ver app/routers/wallet.py — unifica os dois conceitos, item 1 do mapa
  de problemas). Marcar como paga é OPCIONALMENTE real (item 6): se a
  conta fixa tem conta_id vinculada E o usuário confirma no momento de
  marcar como paga, gera uma transação 'saida' de verdade e desconta
  saldo/fatura — igual um app de finanças de verdade faria. Sem conta
  vinculada, ou se o usuário recusar, continua só lembrete:
    GET /fixed-bills/periods?month=YYYY-MM   garante e devolve as instâncias do mês
    PUT /fixed-bills/periods/{id}/pay        marca como paga (gerar_transacao opcional)
    PUT /fixed-bills/periods/{id}/unpay      desfaz (reverte a transação se houver)

  Transações + visão agregada:
    GET/POST /transactions?month=YYYY-MM     toda transação é vinculada a uma
                                              wallet_account (conta_id obrigatório).
                                              'entrada' soma em saldo_atual;
                                              'saida' desconta de saldo_atual OU
                                              lança em fatura_atual (depende de
                                              forma_pagamento, exigido só quando a
                                              conta tem os dois); 'transferencia'
                                              move saldo entre 2 contas (interna)
                                              ou só debita a origem (externa).
    GET /summary?month=YYYY-MM               entradas/saídas/saldo, comparação
                                              com mês anterior, categorias
                                              (transferências não entram nessa soma)

  Bancos/contas/assinaturas da wallet ficam em app/routers/wallet.py.
"""
import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.business_days import nth_business_day_of_month, add_business_days
from app.actions import register_action
from app.finance_utils import create_saida_transaction, revert_saida_transaction

router = APIRouter()

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_month(month: str) -> tuple:
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="parâmetro 'month' deve ser 'YYYY-MM'")
    year, mo = month.split("-")
    return int(year), int(mo)


def _prev_month(year: int, month: int) -> tuple:
    if month == 1:
        return year - 1, 12
    return year, month - 1


# ==================== schemas ====================

class IncomeEntryOut(BaseModel):
    id: str
    income_source_id: str
    label: str
    amount: float
    expected_date: str
    paid_date: Optional[str] = None
    status: str


class ConfirmIncomePayload(BaseModel):
    paid_date: str


class FixedBillIn(BaseModel):
    name: str
    amount: float
    due_day: int = Field(..., ge=1, le=31)
    active: bool = True
    conta_id: Optional[str] = None   # vínculo opcional — habilita gerar transação real ao pagar
    categoria: Optional[str] = None  # usada na transação gerada; cai pra "contas fixas" se vazia


class FixedBillOut(FixedBillIn):
    id: str


class FixedBillPeriodOut(BaseModel):
    id: str
    fixed_bill_id: str
    mes_ano: str
    paga: bool
    valor_pago: Optional[float] = None
    gerou_transacao: bool = False  # True quando 'paga' veio de uma transação real (não só lembrete)


class PayFixedBillPeriodPayload(BaseModel):
    valor_pago: Optional[float] = None
    forma_pagamento: Optional[str] = Field(None, pattern="^(saldo|credito)$")  # obrigatório só se a conta tiver os dois
    gerar_transacao: bool = True  # se False, comporta-se como antes: só marca como lembrete


class DebtIn(BaseModel):
    description: str
    counterparty: Optional[str] = None
    amount: float
    due_date: Optional[str] = None
    status: str = "aberta"


class DebtOut(DebtIn):
    id: str


class TransactionIn(BaseModel):
    description: str
    amount: float = Field(..., gt=0)
    type: str = Field(..., pattern="^(entrada|saida|transferencia)$")
    category: str
    date: str  # YYYY-MM-DD
    conta_id: str
    forma_pagamento: Optional[str] = Field(
        None, pattern="^(saldo|credito)$"
    )  # só usado/obrigatório em 'saida' quando a conta tem saldo E crédito
    conta_destino_id: Optional[str] = None  # só 'transferencia' interna
    destino_externo: Optional[str] = None   # só 'transferencia' externa


class TransactionOut(BaseModel):
    id: str
    description: str
    amount: float
    type: str
    category: str
    date: str
    conta_id: Optional[str] = None
    forma_pagamento: Optional[str] = None
    conta_destino_id: Optional[str] = None
    destino_externo: Optional[str] = None


class CategoryTotal(BaseModel):
    category: str
    total: float


class SummaryOut(BaseModel):
    month: str
    total_in: float
    total_out: float
    saldo: float
    prev_month_saldo: float
    diff_pct: Optional[float] = None
    top_categories: List[CategoryTotal]


# ==================== renda recorrente ====================

def _ensure_income_entries_for_month(db, year: int, month: int) -> None:
    sources = {r["label"]: r for r in db.execute("SELECT * FROM income_sources").fetchall()}
    p1 = sources.get("parte 1")
    p2 = sources.get("parte 2")
    if not p1 or not p2:
        return  # schema sem os defaults esperados — nada a gerar

    month_prefix = f"{year:04d}-{month:02d}"

    p1_entry = db.execute(
        "SELECT * FROM income_entries WHERE income_source_id = ? AND substr(expected_date,1,7) = ?",
        (p1["id"], month_prefix),
    ).fetchone()
    if not p1_entry:
        expected = nth_business_day_of_month(year, month, 5)
        db.execute(
            "INSERT INTO income_entries (id, income_source_id, expected_date, paid_date, amount, status) "
            "VALUES (?, ?, ?, NULL, ?, 'previsto')",
            (new_id(), p1["id"], expected.isoformat(), p1["amount"]),
        )
        db.commit()
        p1_entry = db.execute(
            "SELECT * FROM income_entries WHERE income_source_id = ? AND substr(expected_date,1,7) = ?",
            (p1["id"], month_prefix),
        ).fetchone()

    # parte 2 é sempre derivada da parte 1 (paga, se já confirmada; senão prevista)
    p2_entry = db.execute(
        "SELECT * FROM income_entries WHERE income_source_id = ? AND substr(expected_date,1,7) = ?",
        (p2["id"], month_prefix),
    ).fetchone()
    base_date_str = p1_entry["paid_date"] or p1_entry["expected_date"]
    base_date = datetime.date.fromisoformat(base_date_str)
    p2_expected = add_business_days(base_date, 15)

    if not p2_entry:
        db.execute(
            "INSERT INTO income_entries (id, income_source_id, expected_date, paid_date, amount, status) "
            "VALUES (?, ?, ?, NULL, ?, 'previsto')",
            (new_id(), p2["id"], p2_expected.isoformat(), p2["amount"]),
        )
        db.commit()
    elif p2_entry["status"] != "pago" and p2_entry["expected_date"] != p2_expected.isoformat():
        # parte 1 mudou de data depois que a parte 2 já tinha sido gerada — recalcula
        db.execute(
            "UPDATE income_entries SET expected_date = ? WHERE id = ?",
            (p2_expected.isoformat(), p2_entry["id"]),
        )
        db.commit()


def _income_entry_out(db, row) -> dict:
    source = db.execute("SELECT label FROM income_sources WHERE id = ?", (row["income_source_id"],)).fetchone()
    return {
        "id": row["id"],
        "income_source_id": row["income_source_id"],
        "label": source["label"] if source else "—",
        "amount": row["amount"],
        "expected_date": row["expected_date"],
        "paid_date": row["paid_date"],
        "status": row["status"],
    }


@router.get("/income-entries", response_model=List[IncomeEntryOut])
def get_income_entries(month: str, db=Depends(get_db)):
    year, mo = _validate_month(month)
    _ensure_income_entries_for_month(db, year, mo)
    rows = db.execute(
        "SELECT ie.* FROM income_entries ie JOIN income_sources s ON s.id = ie.income_source_id "
        "WHERE substr(ie.expected_date,1,7) = ? ORDER BY s.label",
        (month,),
    ).fetchall()
    return [_income_entry_out(db, r) for r in rows]


@router.put("/income-entries/{entry_id}/confirm", response_model=IncomeEntryOut)
def confirm_income_entry(entry_id: str, payload: ConfirmIncomePayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="entrada de renda não encontrada")
    db.execute(
        "UPDATE income_entries SET paid_date = ?, status = 'pago' WHERE id = ?",
        (payload.paid_date, entry_id),
    )
    db.commit()

    # se essa era a parte 1, recalcula a data prevista da parte 2 do mesmo mês
    year, mo = (int(x) for x in row["expected_date"][:7].split("-"))
    _ensure_income_entries_for_month(db, year, mo)

    updated = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    return _income_entry_out(db, updated)


@router.put("/income-entries/{entry_id}/revert", response_model=IncomeEntryOut)
def revert_income_entry(entry_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="entrada de renda não encontrada")
    db.execute(
        "UPDATE income_entries SET paid_date = NULL, status = 'previsto' WHERE id = ?",
        (entry_id,),
    )
    db.commit()

    year, mo = (int(x) for x in row["expected_date"][:7].split("-"))
    _ensure_income_entries_for_month(db, year, mo)

    updated = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    return _income_entry_out(db, updated)


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
            raise HTTPException(status_code=422, detail="conta não encontrada")
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
        raise HTTPException(status_code=404, detail="conta fixa não encontrada")
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta não encontrada")
    db.execute(
        "UPDATE fixed_bills SET name=?, amount=?, due_day=?, active=?, conta_id=?, categoria=? WHERE id=?",
        (payload.name, payload.amount, payload.due_day, int(payload.active),
         payload.conta_id, payload.categoria, bill_id),
    )
    db.commit()
    return {"id": bill_id, **payload.model_dump()}


@router.delete("/fixed-bills/{bill_id}")
def delete_fixed_bill(bill_id: str, db=Depends(get_db)):
    db.execute("DELETE FROM fixed_bills WHERE id = ?", (bill_id,))
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
            db.execute(
                "INSERT INTO fixed_bill_periods (id, fixed_bill_id, mes_ano, paga, valor_pago) "
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
        raise HTTPException(status_code=404, detail="instância de conta fixa não encontrada")
    bill = db.execute("SELECT * FROM fixed_bills WHERE id = ?", (row["fixed_bill_id"],)).fetchone()
    if not bill:
        raise HTTPException(status_code=404, detail="conta fixa não encontrada")

    amount = payload.valor_pago if payload.valor_pago is not None else bill["amount"]
    transaction_id = None

    # só gera transação real se a conta fixa tem conta_id vinculada E o
    # usuário não recusou explicitamente (payload.gerar_transacao) — sem
    # conta vinculada não tem como saber de onde descontar, então cai
    # pro comportamento de sempre (só lembrete).
    if bill["conta_id"] and payload.gerar_transacao:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (bill["conta_id"],)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta vinculada à conta fixa não existe mais")
        transaction_id = create_saida_transaction(
            db, conta, amount,
            category=bill["categoria"] or DEFAULT_FIXED_BILL_CATEGORY,
            description=f"conta fixa: {bill['name']}",
            forma_pagamento=payload.forma_pagamento,
        )

    db.execute(
        "UPDATE fixed_bill_periods SET paga = 1, valor_pago = ?, transaction_id = ? WHERE id = ?",
        (payload.valor_pago, transaction_id, period_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


@router.put("/fixed-bills/periods/{period_id}/unpay", response_model=FixedBillPeriodOut)
def unpay_fixed_bill_period(period_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="instância de conta fixa não encontrada")
    # se essa marcação tinha gerado uma transação real, desfaz o efeito no
    # saldo/fatura e remove a transação antes de voltar pra "não paga" —
    # sem isso o saldo ficaria com um desconto fantasma que o usuário não
    # consegue mais explicar (motivo original do item 6).
    revert_saida_transaction(db, row["transaction_id"])
    db.execute(
        "UPDATE fixed_bill_periods SET paga = 0, valor_pago = NULL, transaction_id = NULL WHERE id = ?",
        (period_id,),
    )
    db.commit()
    updated = db.execute("SELECT * FROM fixed_bill_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


@router.get("/debts", response_model=List[DebtOut])
def list_debts(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM debts ORDER BY due_date").fetchall()
    return [dict(r) for r in rows]


@router.post("/debts", response_model=DebtOut)
def create_debt(payload: DebtIn, db=Depends(get_db)):
    debt_id = new_id()
    db.execute(
        "INSERT INTO debts (id, description, counterparty, amount, due_date, status) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (debt_id, payload.description, payload.counterparty, payload.amount, payload.due_date, payload.status),
    )
    db.commit()
    return {"id": debt_id, **payload.model_dump()}


@router.put("/debts/{debt_id}", response_model=DebtOut)
def update_debt(debt_id: str, payload: DebtIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM debts WHERE id = ?", (debt_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="dívida não encontrada")
    db.execute(
        "UPDATE debts SET description=?, counterparty=?, amount=?, due_date=?, status=? WHERE id=?",
        (payload.description, payload.counterparty, payload.amount, payload.due_date, payload.status, debt_id),
    )
    db.commit()
    return {"id": debt_id, **payload.model_dump()}


@router.delete("/debts/{debt_id}")
def delete_debt(debt_id: str, db=Depends(get_db)):
    db.execute("DELETE FROM debts WHERE id = ?", (debt_id,))
    db.commit()
    return {"deleted": True}


# ==================== transações + resumo ====================

@router.get("/transactions", response_model=List[TransactionOut])
def list_transactions(month: str, db=Depends(get_db)):
    _validate_month(month)
    rows = db.execute(
        "SELECT * FROM transactions WHERE substr(date,1,7) = ? ORDER BY date DESC",
        (month,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/transactions", response_model=TransactionOut)
def create_transaction(payload: TransactionIn, db=Depends(get_db)):
    conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
    if not conta:
        raise HTTPException(status_code=422, detail=f"conta não encontrada: '{payload.conta_id}'")

    forma_pagamento = payload.forma_pagamento
    conta_destino_id = None
    destino_externo = None

    if payload.type == "entrada":
        if not conta["possui_saldo"]:
            raise HTTPException(status_code=422, detail="essa conta não possui saldo pra receber uma entrada")
        forma_pagamento = None
        db.execute(
            "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) + ? WHERE id = ?",
            (payload.amount, conta["id"]),
        )

    elif payload.type == "saida":
        if conta["possui_saldo"] and conta["possui_credito"]:
            if forma_pagamento not in ("saldo", "credito"):
                raise HTTPException(
                    status_code=422,
                    detail="essa conta tem saldo e crédito — informe 'forma_pagamento' ('saldo' ou 'credito')",
                )
        elif conta["possui_credito"]:
            forma_pagamento = "credito"
        elif conta["possui_saldo"]:
            forma_pagamento = "saldo"
        else:
            raise HTTPException(status_code=422, detail="essa conta não possui saldo nem crédito cadastrado")

        if forma_pagamento == "saldo":
            saldo_atual = conta["saldo_atual"] or 0
            if payload.amount > saldo_atual:
                raise HTTPException(
                    status_code=422,
                    detail=f"saldo insuficiente: disponível R$ {saldo_atual:.2f}, tentando gastar R$ {payload.amount:.2f}",
                )
            db.execute(
                "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
                (payload.amount, conta["id"]),
            )
        else:
            if conta["limite_total"] is not None:
                disponivel = conta["limite_total"] - (conta["fatura_atual"] or 0)
                if payload.amount > disponivel:
                    raise HTTPException(
                        status_code=422,
                        detail=f"limite insuficiente: disponível R$ {disponivel:.2f}, tentando gastar R$ {payload.amount:.2f}",
                    )
            db.execute(
                "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) + ? WHERE id = ?",
                (payload.amount, conta["id"]),
            )

    else:  # transferencia
        if not conta["possui_saldo"]:
            raise HTTPException(status_code=422, detail="a conta de origem de uma transferência precisa ter saldo")
        saldo_atual = conta["saldo_atual"] or 0
        if payload.amount > saldo_atual:
            raise HTTPException(
                status_code=422,
                detail=f"saldo insuficiente pra essa transferência: disponível R$ {saldo_atual:.2f}, tentando transferir R$ {payload.amount:.2f}",
            )
        if bool(payload.conta_destino_id) == bool(payload.destino_externo):
            raise HTTPException(
                status_code=422,
                detail="informe exatamente um destino: 'conta_destino_id' (interna) ou 'destino_externo' (texto livre)",
            )
        forma_pagamento = None
        db.execute(
            "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
            (payload.amount, conta["id"]),
        )
        if payload.conta_destino_id:
            destino = db.execute(
                "SELECT * FROM wallet_accounts WHERE id = ?", (payload.conta_destino_id,)
            ).fetchone()
            if not destino:
                raise HTTPException(status_code=422, detail="conta de destino não encontrada")
            if not destino["possui_saldo"]:
                raise HTTPException(status_code=422, detail="a conta de destino precisa ter saldo")
            db.execute(
                "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) + ? WHERE id = ?",
                (payload.amount, destino["id"]),
            )
            conta_destino_id = payload.conta_destino_id
        else:
            destino_externo = payload.destino_externo

    tx_id = new_id()
    db.execute(
        "INSERT INTO transactions "
        "(id, description, amount, type, category, conta_id, forma_pagamento, conta_destino_id, destino_externo, date) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            tx_id, payload.description, payload.amount, payload.type, payload.category,
            conta["id"], forma_pagamento, conta_destino_id, destino_externo, payload.date,
        ),
    )
    db.commit()

    register_action(
        db,
        description=f"lançou {payload.type}: {payload.description}",
        categories=["financas"],
        xp=2,
        impact=2,
        source="financas",
    )

    return {
        "id": tx_id,
        "description": payload.description,
        "amount": payload.amount,
        "type": payload.type,
        "category": payload.category,
        "date": payload.date,
        "conta_id": conta["id"],
        "forma_pagamento": forma_pagamento,
        "conta_destino_id": conta_destino_id,
        "destino_externo": destino_externo,
    }

@router.get("/summary", response_model=SummaryOut)
def get_summary(month: str, db=Depends(get_db)):
    year, mo = _validate_month(month)

    def totals_for(m: str):
        row = db.execute(
            "SELECT "
            "COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE 0 END), 0) AS total_in, "
            "COALESCE(SUM(CASE WHEN type='saida' THEN amount ELSE 0 END), 0) AS total_out "
            "FROM transactions WHERE substr(date,1,7) = ?",
            (m,),
        ).fetchone()
        return row["total_in"], row["total_out"]

    total_in, total_out = totals_for(month)
    saldo = total_in - total_out

    prev_year, prev_mo = _prev_month(year, mo)
    prev_month_str = f"{prev_year:04d}-{prev_mo:02d}"
    prev_in, prev_out = totals_for(prev_month_str)
    prev_saldo = prev_in - prev_out

    diff_pct = None
    if prev_saldo != 0:
        diff_pct = round(((saldo - prev_saldo) / abs(prev_saldo)) * 100, 1)

    cat_rows = db.execute(
        "SELECT category, SUM(amount) AS total FROM transactions "
        "WHERE substr(date,1,7) = ? AND type = 'saida' "
        "GROUP BY category ORDER BY total DESC",
        (month,),
    ).fetchall()

    return {
        "month": month,
        "total_in": total_in,
        "total_out": total_out,
        "saldo": saldo,
        "prev_month_saldo": prev_saldo,
        "diff_pct": diff_pct,
        "top_categories": [{"category": r["category"], "total": r["total"]} for r in cat_rows],
    }