"""
Módulo Wallet (v1) — bancos agrupando contas, e assinaturas informativas.

Ver wallet_plano.md pra spec completa. Resumo das regras que este router
aplica:
  - Um banco agrupa 1+ contas; cada conta escolhe individualmente se
    possui_saldo e/ou possui_credito.
  - Não existe mais banco fixo/especial ("dinheiro") — era tratado como
    caso particular (is_dinheiro), removido porque a mesma coisa é
    representável como um banco normal sem crédito (com ou sem saldo).
    Coluna is_dinheiro removida da tabela wallet_banks via migration.
  - Assinaturas NÃO afetam saldo/fatura — são lembrete + toggle
    pago/não-pago por mês (mesmo padrão sob-demanda de income_entries).

Endpoints:
  GET    /banks                            lista bancos com contas aninhadas
  POST   /banks                             cria banco
  POST   /banks/{bank_id}/accounts          cria conta dentro de um banco
  PUT    /accounts/{account_id}             edita conta
  DELETE /accounts/{account_id}             remove conta (remove o banco
                                             junto se for a última)
  GET    /summary                           soma de saldos + soma de faturas

  GET    /subscriptions
  POST   /subscriptions
  GET    /subscriptions/periods?month=YYYY-MM
  PUT    /subscriptions/periods/{id}/pay
  PUT    /subscriptions/periods/{id}/unpay
"""
import re
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso

router = APIRouter()

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_month(month: str) -> None:
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="parâmetro 'month' deve ser 'YYYY-MM'")


# ==================== schemas ====================

class AccountOut(BaseModel):
    id: str
    bank_id: str
    nome: str
    possui_saldo: bool
    saldo_atual: Optional[float] = None
    possui_credito: bool
    fatura_atual: Optional[float] = None
    limite_total: Optional[float] = None
    dia_vencimento: Optional[int] = None


class BankOut(BaseModel):
    id: str
    nome: str
    icon_ascii: Optional[str] = None
    accounts: List[AccountOut]


class BankIn(BaseModel):
    nome: str
    icon_ascii: Optional[str] = None


class AccountIn(BaseModel):
    nome: str
    possui_saldo: bool = False
    saldo_atual: Optional[float] = None
    possui_credito: bool = False
    fatura_atual: Optional[float] = None
    limite_total: Optional[float] = None
    dia_vencimento: Optional[int] = Field(None, ge=1, le=31)


class DeleteAccountOut(BaseModel):
    deleted: bool
    bank_deleted: bool


class SummaryOut(BaseModel):
    total_possui: float
    total_a_pagar: float


class SubscriptionIn(BaseModel):
    nome: str
    valor_esperado: float
    dia_cobranca: int = Field(..., ge=1, le=31)
    conta_id: Optional[str] = None
    active: bool = True


class SubscriptionOut(SubscriptionIn):
    id: str


class PeriodOut(BaseModel):
    id: str
    subscription_id: str
    mes_ano: str
    paga: bool
    valor_pago: Optional[float] = None


class PayPeriodPayload(BaseModel):
    valor_pago: Optional[float] = None


# ==================== helpers de saída ====================

def _account_out(row) -> dict:
    return {
        "id": row["id"],
        "bank_id": row["bank_id"],
        "nome": row["nome"],
        "possui_saldo": bool(row["possui_saldo"]),
        "saldo_atual": row["saldo_atual"],
        "possui_credito": bool(row["possui_credito"]),
        "fatura_atual": row["fatura_atual"],
        "limite_total": row["limite_total"],
        "dia_vencimento": row["dia_vencimento"],
    }


def _bank_out(db, row) -> dict:
    accounts = db.execute(
        "SELECT * FROM wallet_accounts WHERE bank_id = ? ORDER BY nome", (row["id"],)
    ).fetchall()
    return {
        "id": row["id"],
        "nome": row["nome"],
        "icon_ascii": row["icon_ascii"],
        "accounts": [_account_out(a) for a in accounts],
    }


def _period_out(row) -> dict:
    return {
        "id": row["id"],
        "subscription_id": row["subscription_id"],
        "mes_ano": row["mes_ano"],
        "paga": bool(row["paga"]),
        "valor_pago": row["valor_pago"],
    }


# ==================== bancos e contas ====================

@router.get("/banks", response_model=List[BankOut])
def list_banks(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM wallet_banks ORDER BY nome").fetchall()
    return [_bank_out(db, r) for r in rows]


@router.post("/banks", response_model=BankOut)
def create_bank(payload: BankIn, db=Depends(get_db)):
    bank_id = new_id()
    db.execute(
        "INSERT INTO wallet_banks (id, nome, icon_ascii, created_at) "
        "VALUES (?, ?, ?, ?)",
        (bank_id, payload.nome, payload.icon_ascii, now_iso()),
    )
    db.commit()
    row = db.execute("SELECT * FROM wallet_banks WHERE id = ?", (bank_id,)).fetchone()
    return _bank_out(db, row)


@router.post("/banks/{bank_id}/accounts", response_model=AccountOut)
def create_account(bank_id: str, payload: AccountIn, db=Depends(get_db)):
    bank = db.execute("SELECT * FROM wallet_banks WHERE id = ?", (bank_id,)).fetchone()
    if not bank:
        raise HTTPException(status_code=404, detail="banco não encontrado")
    dup = db.execute(
        "SELECT id FROM wallet_accounts WHERE bank_id = ? AND nome = ?", (bank_id, payload.nome)
    ).fetchone()
    if dup:
        raise HTTPException(status_code=422, detail="já existe uma conta com esse nome nesse banco")

    account_id = new_id()
    db.execute(
        "INSERT INTO wallet_accounts "
        "(id, bank_id, nome, possui_saldo, saldo_atual, possui_credito, fatura_atual, limite_total, dia_vencimento) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            account_id, bank_id, payload.nome,
            int(payload.possui_saldo), payload.saldo_atual if payload.possui_saldo else None,
            int(payload.possui_credito),
            payload.fatura_atual if payload.possui_credito else None,
            payload.limite_total if payload.possui_credito else None,
            payload.dia_vencimento if payload.possui_credito else None,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (account_id,)).fetchone()
    return _account_out(row)


@router.put("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: str, payload: AccountIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta não encontrada")
    dup = db.execute(
        "SELECT id FROM wallet_accounts WHERE bank_id = ? AND nome = ? AND id != ?",
        (row["bank_id"], payload.nome, account_id),
    ).fetchone()
    if dup:
        raise HTTPException(status_code=422, detail="já existe uma conta com esse nome nesse banco")

    db.execute(
        "UPDATE wallet_accounts SET nome=?, possui_saldo=?, saldo_atual=?, "
        "possui_credito=?, fatura_atual=?, limite_total=?, dia_vencimento=? WHERE id=?",
        (
            payload.nome, int(payload.possui_saldo),
            payload.saldo_atual if payload.possui_saldo else None,
            int(payload.possui_credito),
            payload.fatura_atual if payload.possui_credito else None,
            payload.limite_total if payload.possui_credito else None,
            payload.dia_vencimento if payload.possui_credito else None,
            account_id,
        ),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (account_id,)).fetchone()
    return _account_out(updated)


@router.delete("/accounts/{account_id}", response_model=DeleteAccountOut)
def delete_account(account_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta não encontrada")

    db.execute("DELETE FROM wallet_accounts WHERE id = ?", (account_id,))
    remaining = db.execute(
        "SELECT COUNT(*) AS c FROM wallet_accounts WHERE bank_id = ?", (row["bank_id"],)
    ).fetchone()
    bank_deleted = False
    if remaining["c"] == 0:
        db.execute("DELETE FROM wallet_banks WHERE id = ?", (row["bank_id"],))
        bank_deleted = True
    db.commit()
    return {"deleted": True, "bank_deleted": bank_deleted}


@router.get("/summary", response_model=SummaryOut)
def get_summary(db=Depends(get_db)):
    row = db.execute(
        "SELECT "
        "COALESCE(SUM(CASE WHEN possui_saldo=1 THEN saldo_atual ELSE 0 END), 0) AS total_possui, "
        "COALESCE(SUM(CASE WHEN possui_credito=1 THEN fatura_atual ELSE 0 END), 0) AS total_a_pagar "
        "FROM wallet_accounts"
    ).fetchone()
    return {"total_possui": row["total_possui"], "total_a_pagar": row["total_a_pagar"]}


# ==================== assinaturas ====================

@router.get("/subscriptions", response_model=List[SubscriptionOut])
def list_subscriptions(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM wallet_subscriptions ORDER BY nome").fetchall()
    return [dict(r) | {"active": bool(r["active"])} for r in rows]


@router.post("/subscriptions", response_model=SubscriptionOut)
def create_subscription(payload: SubscriptionIn, db=Depends(get_db)):
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta não encontrada")
    sub_id = new_id()
    db.execute(
        "INSERT INTO wallet_subscriptions (id, nome, valor_esperado, dia_cobranca, conta_id, active) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (sub_id, payload.nome, payload.valor_esperado, payload.dia_cobranca, payload.conta_id, int(payload.active)),
    )
    db.commit()
    return {"id": sub_id, **payload.model_dump()}


@router.get("/subscriptions/periods", response_model=List[PeriodOut])
def list_subscription_periods(month: str, db=Depends(get_db)):
    _validate_month(month)
    subs = db.execute("SELECT id FROM wallet_subscriptions WHERE active = 1").fetchall()
    for s in subs:
        existing = db.execute(
            "SELECT id FROM wallet_subscription_periods WHERE subscription_id = ? AND mes_ano = ?",
            (s["id"], month),
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO wallet_subscription_periods (id, subscription_id, mes_ano, paga, valor_pago) "
                "VALUES (?, ?, ?, 0, NULL)",
                (new_id(), s["id"], month),
            )
    db.commit()
    rows = db.execute(
        "SELECT p.* FROM wallet_subscription_periods p "
        "JOIN wallet_subscriptions s ON s.id = p.subscription_id "
        "WHERE p.mes_ano = ? AND s.active = 1 ORDER BY s.nome",
        (month,),
    ).fetchall()
    return [_period_out(r) for r in rows]


@router.put("/subscriptions/periods/{period_id}/pay", response_model=PeriodOut)
def pay_period(period_id: str, payload: PayPeriodPayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="período não encontrado")
    db.execute(
        "UPDATE wallet_subscription_periods SET paga = 1, valor_pago = ? WHERE id = ?",
        (payload.valor_pago, period_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


@router.put("/subscriptions/periods/{period_id}/unpay", response_model=PeriodOut)
def unpay_period(period_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="período não encontrado")
    db.execute(
        "UPDATE wallet_subscription_periods SET paga = 0, valor_pago = NULL WHERE id = ?",
        (period_id,),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


# ==================== compras parceladas ====================

def _months_between(mes_inicio: str, mes_atual: str) -> int:
    """Quantidade de meses entre dois 'YYYY-MM' (pode ser negativo se
    mes_inicio for no futuro em relação a mes_atual)."""
    y1, m1 = (int(x) for x in mes_inicio.split("-"))
    y2, m2 = (int(x) for x in mes_atual.split("-"))
    return (y2 - y1) * 12 + (m2 - m1)


def _current_month_str() -> str:
    return datetime.date.today().strftime("%Y-%m")


def _compra_parcelada_out(row) -> dict:
    """Calcula os campos de EXIBIÇÃO (parcela atual, quitada) a partir
    do calendário + do ajuste manual (ajuste_parcelas) — não escreve
    nada no banco. A reserva do limite é feita inteira na criação (ver
    create_compra_parcelada), não é incremental."""
    today_month = _current_month_str()
    elapsed = _months_between(row["mes_primeira_parcela"], today_month)
    raw_parcela = elapsed + 1 + row["ajuste_parcelas"]
    parcela_atual = max(0, min(raw_parcela, row["num_parcelas"]))
    quitada = raw_parcela > row["num_parcelas"]
    return {
        "id": row["id"],
        "nome": row["nome"],
        "valor_total": row["valor_total"],
        "num_parcelas": row["num_parcelas"],
        "conta_id": row["conta_id"],
        "mes_primeira_parcela": row["mes_primeira_parcela"],
        "valor_parcela": row["valor_total"] / row["num_parcelas"],
        "parcela_atual": parcela_atual,
        "ajuste_parcelas": row["ajuste_parcelas"],
        "quitada": quitada,
    }


class CompraParceladaIn(BaseModel):
    nome: str
    valor_total: float = Field(..., gt=0)
    num_parcelas: int = Field(..., ge=1)
    conta_id: Optional[str] = None
    mes_primeira_parcela: str  # 'YYYY-MM'


class CompraParceladaOut(BaseModel):
    id: str
    nome: str
    valor_total: float
    num_parcelas: int
    conta_id: Optional[str] = None
    mes_primeira_parcela: str
    valor_parcela: float
    parcela_atual: int
    ajuste_parcelas: int
    quitada: bool


class AjustarParcelasPayload(BaseModel):
    delta: int  # +1 avança uma parcela, -1 desfaz um adiantamento por engano


@router.get("/compras-parceladas", response_model=List[CompraParceladaOut])
def list_compras_parceladas(db=Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM compras_parceladas ORDER BY mes_primeira_parcela DESC, nome"
    ).fetchall()
    return [_compra_parcelada_out(r) for r in rows]


@router.post("/compras-parceladas", response_model=CompraParceladaOut)
def create_compra_parcelada(payload: CompraParceladaIn, db=Depends(get_db)):
    if not MONTH_RE.match(payload.mes_primeira_parcela):
        raise HTTPException(status_code=422, detail="mes_primeira_parcela deve ser 'YYYY-MM'")

    if payload.conta_id:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta não encontrada")
        if not conta["possui_credito"]:
            raise HTTPException(status_code=422, detail="a conta vinculada precisa ter crédito cadastrado")
        if conta["limite_total"] is not None:
            disponivel = conta["limite_total"] - (conta["fatura_atual"] or 0)
            if payload.valor_total > disponivel:
                raise HTTPException(
                    status_code=422,
                    detail=f"limite insuficiente: disponível R$ {disponivel:.2f}, compra de R$ {payload.valor_total:.2f}",
                )

    compra_id = new_id()
    db.execute(
        "INSERT INTO compras_parceladas "
        "(id, nome, valor_total, num_parcelas, conta_id, mes_primeira_parcela, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            compra_id, payload.nome, payload.valor_total, payload.num_parcelas,
            payload.conta_id, payload.mes_primeira_parcela, now_iso(),
        ),
    )
    if payload.conta_id:
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) + ? WHERE id = ?",
            (payload.valor_total, payload.conta_id),
        )
    db.commit()

    row = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    return _compra_parcelada_out(row)


@router.put("/compras-parceladas/{compra_id}/ajustar", response_model=CompraParceladaOut)
def ajustar_parcelas_compra(compra_id: str, payload: AjustarParcelasPayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="compra parcelada não encontrada")
    db.execute(
        "UPDATE compras_parceladas SET ajuste_parcelas = ajuste_parcelas + ? WHERE id = ?",
        (payload.delta, compra_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    return _compra_parcelada_out(updated)


@router.delete("/compras-parceladas/{compra_id}")
def delete_compra_parcelada(compra_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="compra parcelada não encontrada")
    if row["conta_id"]:
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) - ? WHERE id = ?",
            (row["valor_total"], row["conta_id"]),
        )
    db.execute("DELETE FROM compras_parceladas WHERE id = ?", (compra_id,))
    db.commit()
    return {"deleted": True}