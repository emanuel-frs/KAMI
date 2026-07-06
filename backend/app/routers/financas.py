"""
Módulo Finanças (v1).

Endpoints:
  Renda recorrente (decisão 06 — dia útil real via workalendar):
    GET /income-entries?month=YYYY-MM        garante e devolve as entradas do mês
    PUT /income-entries/{id}/confirm         marca como paga (recalcula parte 2)
    PUT /income-entries/{id}/revert          desfaz a confirmação

  Cadastros simples (CRUD básico):
    /credit-cards, /fixed-bills, /debts, /subscriptions

  Transações + visão agregada:
    GET/POST /transactions?month=YYYY-MM
    GET /summary?month=YYYY-MM               entradas/saídas/saldo, comparação
                                              com mês anterior, categorias
"""
import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.business_days import nth_business_day_of_month, add_business_days
from app.actions import register_action

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


class CreditCardIn(BaseModel):
    name: str
    closing_day: int = Field(..., ge=1, le=31)
    due_day: int = Field(..., ge=1, le=31)
    card_limit: Optional[float] = None


class CreditCardOut(CreditCardIn):
    id: str


class FixedBillIn(BaseModel):
    name: str
    amount: float
    due_day: int = Field(..., ge=1, le=31)
    active: bool = True


class FixedBillOut(FixedBillIn):
    id: str


class DebtIn(BaseModel):
    description: str
    counterparty: Optional[str] = None
    amount: float
    due_date: Optional[str] = None
    status: str = "aberta"


class DebtOut(DebtIn):
    id: str


class SubscriptionIn(BaseModel):
    name: str
    amount: float
    billing_day: int = Field(..., ge=1, le=31)
    installment_current: Optional[int] = None
    installment_total: Optional[int] = None
    active: bool = True


class SubscriptionOut(SubscriptionIn):
    id: str


class TransactionIn(BaseModel):
    description: str
    amount: float = Field(..., gt=0)
    type: str = Field(..., pattern="^(entrada|saida)$")
    category: str
    date: str  # YYYY-MM-DD
    card_id: Optional[str] = None


class TransactionOut(TransactionIn):
    id: str


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

@router.get("/credit-cards", response_model=List[CreditCardOut])
def list_credit_cards(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM credit_cards ORDER BY name").fetchall()
    return [dict(r) for r in rows]


@router.post("/credit-cards", response_model=CreditCardOut)
def create_credit_card(payload: CreditCardIn, db=Depends(get_db)):
    card_id = new_id()
    db.execute(
        "INSERT INTO credit_cards (id, name, closing_day, due_day, card_limit) VALUES (?, ?, ?, ?, ?)",
        (card_id, payload.name, payload.closing_day, payload.due_day, payload.card_limit),
    )
    db.commit()
    return {"id": card_id, **payload.model_dump()}


@router.delete("/credit-cards/{card_id}")
def delete_credit_card(card_id: str, db=Depends(get_db)):
    db.execute("DELETE FROM credit_cards WHERE id = ?", (card_id,))
    db.commit()
    return {"deleted": True}


@router.get("/fixed-bills", response_model=List[FixedBillOut])
def list_fixed_bills(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM fixed_bills ORDER BY name").fetchall()
    return [dict(r) | {"active": bool(r["active"])} for r in rows]


@router.post("/fixed-bills", response_model=FixedBillOut)
def create_fixed_bill(payload: FixedBillIn, db=Depends(get_db)):
    bill_id = new_id()
    db.execute(
        "INSERT INTO fixed_bills (id, name, amount, due_day, active) VALUES (?, ?, ?, ?, ?)",
        (bill_id, payload.name, payload.amount, payload.due_day, int(payload.active)),
    )
    db.commit()
    return {"id": bill_id, **payload.model_dump()}


@router.delete("/fixed-bills/{bill_id}")
def delete_fixed_bill(bill_id: str, db=Depends(get_db)):
    db.execute("DELETE FROM fixed_bills WHERE id = ?", (bill_id,))
    db.commit()
    return {"deleted": True}


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


@router.get("/subscriptions", response_model=List[SubscriptionOut])
def list_subscriptions(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM subscriptions ORDER BY name").fetchall()
    return [dict(r) | {"active": bool(r["active"])} for r in rows]


@router.post("/subscriptions", response_model=SubscriptionOut)
def create_subscription(payload: SubscriptionIn, db=Depends(get_db)):
    sub_id = new_id()
    db.execute(
        "INSERT INTO subscriptions (id, name, amount, billing_day, installment_current, installment_total, active) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            sub_id, payload.name, payload.amount, payload.billing_day,
            payload.installment_current, payload.installment_total, int(payload.active),
        ),
    )
    db.commit()
    return {"id": sub_id, **payload.model_dump()}


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: str, db=Depends(get_db)):
    db.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
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
    card_id = payload.card_id or None
    if card_id:
        card = db.execute("SELECT id FROM credit_cards WHERE id = ?", (card_id,)).fetchone()
        if not card:
            raise HTTPException(status_code=422, detail=f"cartão não encontrado: '{card_id}'")

    tx_id = new_id()
    db.execute(
        "INSERT INTO transactions (id, description, amount, type, category, card_id, date) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (tx_id, payload.description, payload.amount, payload.type, payload.category, card_id, payload.date),
    )
    db.commit()

    # credita XP em finanças automaticamente (mesmo comportamento do protótipo:
    # todo lançamento manual conta como uma ação pequena registrada no núcleo)
    register_action(
        db,
        description=f"lançou {'entrada' if payload.type == 'entrada' else 'gasto'}: {payload.description}",
        categories=["financas"],
        xp=2,
        impact=2,
        source="financas",
    )

    return {"id": tx_id, **{**payload.model_dump(), "card_id": card_id}}


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
