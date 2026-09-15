"""
Módulo Carteira (v1) — bancos agrupando contas, e assinaturas informativas.

Resumo das regras que este router
aplica:
  - Um banco agrupa 1+ contas; cada conta escolhe individualmente se
    possui_saldo e/ou possui_credito.
  - Não existe mais banco fixo/especial ("dinheiro") — era tratado como
    caso particular (is_dinheiro), removido porque a mesma coisa é
    representável como um banco normal sem crédito (com ou sem saldo).
    Coluna is_dinheiro removida da tabela wallet_banks via migration.
  - Assinaturas afetam saldo/fatura OPCIONALMENTE: se a assinatura tem
    conta_id vinculada e o usuário confirma no momento de marcar como
    paga, gera uma transação 'saida' real (ver app/finance_utils.py) —
    mesmo mecanismo de fixed_bills em financas.py (item 6,
    resolvido junto com a unificação do item 1). Sem conta
    vinculada, continua sendo só lembrete + toggle pago/não-pago por mês
    (mesmo padrão sob-demanda de income_entries).

Endpoints:
  GET    /banks                            lista bancos com contas aninhadas
  POST   /banks                             cria banco
  PUT    /banks/{bank_id}                   edita banco (nome/ícone só — não mexe em
                                             conta nenhuma, então não afeta saldo/fatura)
  DELETE /banks/{bank_id}                   remove banco e as contas dele (ON DELETE
                                             CASCADE em wallet_accounts.bank_id); tudo
                                             que referenciava essas contas (transações,
                                             assinaturas, contas fixas, renda, metas,
                                             compras parceladas) tem ON DELETE SET NULL,
                                             então só perde o vínculo, sem quebrar
                                             (mesmo efeito que já acontecia ao apagar
                                             manualmente a última conta de um banco)
  POST   /banks/{bank_id}/accounts          cria conta dentro de um banco
  PUT    /accounts/{account_id}             edita conta
  DELETE /accounts/{account_id}             remove conta (remove o banco
                                             junto se for a última)
  GET    /summary                           soma de saldos + soma de faturas

  GET    /subscriptions
  POST   /subscriptions
  GET    /subscriptions/periods?month=YYYY-MM
  PUT    /subscriptions/periods/{id}/pay    gerar_transacao opcional (default True se tiver conta_id)
  PUT    /subscriptions/periods/{id}/unpay  reverte a transação se houver

  GET    /compras-parceladas
  POST   /compras-parceladas
  PUT    /compras-parceladas/{id}
  DELETE /compras-parceladas/{id}
  PUT    /compras-parceladas/{id}/ajustar    delta manual (+1 adianta, -1 desfaz)
  GET    /compras-parceladas/mes?mes=YYYY-MM fatura do mês: 1 linha por compra ativa
                                              naquele mês, com o nº da parcela
                                              correspondente àquele mês específico
                                              (não "hoje") — calculado on the fly
"""
import re
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.finance_utils import create_saida_transaction, revert_saida_transaction
from app.business_days import months_between
from app.actions import register_action

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


class DeleteBankOut(BaseModel):
    deleted: bool
    accounts_deleted: int


class SummaryOut(BaseModel):
    total_possui: float
    total_a_pagar: float


class SubscriptionIn(BaseModel):
    nome: str
    valor_esperado: float
    dia_cobranca: int = Field(..., ge=1, le=31)
    conta_id: Optional[str] = None   # vínculo opcional — habilita gerar transação real ao pagar
    active: bool = True
    categoria: Optional[str] = None  # usada na transação gerada; cai pra "assinaturas" se vazia


class SubscriptionOut(SubscriptionIn):
    id: str


class PeriodOut(BaseModel):
    id: str
    subscription_id: str
    mes_ano: str
    paga: bool
    valor_pago: Optional[float] = None
    gerou_transacao: bool = False  # True quando 'paga' veio de uma transação real (não só lembrete)


class PayPeriodPayload(BaseModel):
    valor_pago: Optional[float] = None
    forma_pagamento: Optional[str] = Field(None, pattern="^(saldo|credito)$")  # obrigatório só se a conta tiver os dois
    gerar_transacao: bool = True  # se False, comporta-se como antes: só marca como lembrete


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
        "gerou_transacao": row["transaction_id"] is not None,
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


@router.put("/banks/{bank_id}", response_model=BankOut)
def update_bank(bank_id: str, payload: BankIn, db=Depends(get_db)):
    """
    Edita só nome/icon_ascii do banco — nunca toca em wallet_accounts,
    então saldo_atual/fatura_atual de nenhuma conta é afetado (GET /summary
    soma direto da tabela wallet_accounts a cada chamada, não guarda nada
    cacheado no banco que precisaria ser recalculado aqui).
    """
    row = db.execute("SELECT id FROM wallet_banks WHERE id = ?", (bank_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="banco não encontrado")
    db.execute(
        "UPDATE wallet_banks SET nome=?, icon_ascii=? WHERE id=?",
        (payload.nome, payload.icon_ascii, bank_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_banks WHERE id = ?", (bank_id,)).fetchone()
    return _bank_out(db, updated)


@router.delete("/banks/{bank_id}", response_model=DeleteBankOut)
def delete_bank(bank_id: str, db=Depends(get_db)):
    """
    Remove o banco e todas as contas dele numa vez só (antes só dava pra
    apagar banco indiretamente, deletando conta por conta até sobrar
    nenhuma — ver delete_account). wallet_accounts.bank_id tem ON DELETE
    CASCADE (schema.sql), então o DELETE abaixo já leva as contas junto;
    tudo que referenciava essas contas (transactions.conta_id,
    wallet_subscriptions.conta_id, fixed_bills.conta_id,
    income_sources.conta_id, goals.linked_conta_id,
    compras_parceladas.conta_id) tem ON DELETE SET NULL, então o histórico
    financeiro não some — só perde o vínculo com a conta apagada, mesmo
    efeito que apagar a última conta de um banco já causava antes.
    """
    row = db.execute("SELECT id FROM wallet_banks WHERE id = ?", (bank_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="banco não encontrado")
    accounts_deleted = db.execute(
        "SELECT COUNT(*) AS c FROM wallet_accounts WHERE bank_id = ?", (bank_id,)
    ).fetchone()["c"]
    db.execute("DELETE FROM wallet_banks WHERE id = ?", (bank_id,))
    db.commit()
    return {"deleted": True, "accounts_deleted": accounts_deleted}


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
        "INSERT INTO wallet_subscriptions (id, nome, valor_esperado, dia_cobranca, conta_id, active, categoria) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sub_id, payload.nome, payload.valor_esperado, payload.dia_cobranca, payload.conta_id,
         int(payload.active), payload.categoria),
    )
    db.commit()
    return {"id": sub_id, **payload.model_dump()}


@router.put("/subscriptions/{sub_id}", response_model=SubscriptionOut)
def update_subscription(sub_id: str, payload: SubscriptionIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_subscriptions WHERE id = ?", (sub_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="assinatura não encontrada")
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta não encontrada")
    db.execute(
        "UPDATE wallet_subscriptions SET nome=?, valor_esperado=?, dia_cobranca=?, conta_id=?, active=?, categoria=? WHERE id=?",
        (payload.nome, payload.valor_esperado, payload.dia_cobranca, payload.conta_id,
         int(payload.active), payload.categoria, sub_id),
    )
    db.commit()
    return {"id": sub_id, **payload.model_dump()}


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: str, db=Depends(get_db)):
    # cascade em wallet_subscription_periods via ON DELETE CASCADE (schema.sql),
    # mesmo padrão de delete_fixed_bill em financas.py.
    db.execute("DELETE FROM wallet_subscriptions WHERE id = ?", (sub_id,))
    db.commit()
    return {"deleted": True}


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


DEFAULT_SUBSCRIPTION_CATEGORY = "assinaturas"


@router.put("/subscriptions/periods/{period_id}/pay", response_model=PeriodOut)
def pay_period(period_id: str, payload: PayPeriodPayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="período não encontrado")
    sub = db.execute("SELECT * FROM wallet_subscriptions WHERE id = ?", (row["subscription_id"],)).fetchone()
    if not sub:
        raise HTTPException(status_code=404, detail="assinatura não encontrada")

    amount = payload.valor_pago if payload.valor_pago is not None else sub["valor_esperado"]
    transaction_id = None

    # só gera transação real se a assinatura tem conta_id vinculada E o
    # usuário não recusou explicitamente (payload.gerar_transacao) — sem
    # conta vinculada não tem como saber de onde descontar, então cai
    # pro comportamento de sempre (só lembrete).
    if sub["conta_id"] and payload.gerar_transacao:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (sub["conta_id"],)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta vinculada à assinatura não existe mais")
        transaction_id = create_saida_transaction(
            db, conta, amount,
            category=sub["categoria"] or DEFAULT_SUBSCRIPTION_CATEGORY,
            description=f"assinatura: {sub['nome']}",
            forma_pagamento=payload.forma_pagamento,
        )
        register_action(
            db,
            description=f"pagou assinatura: {sub['nome']}",
            categories=["financas"],
            xp=2,
            impact=2,
            source="financas",
        )

    db.execute(
        "UPDATE wallet_subscription_periods SET paga = 1, valor_pago = ?, transaction_id = ? WHERE id = ?",
        (payload.valor_pago, transaction_id, period_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


@router.put("/subscriptions/periods/{period_id}/unpay", response_model=PeriodOut)
def unpay_period(period_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="período não encontrado")
    # se essa marcação tinha gerado uma transação real, desfaz o efeito no
    # saldo/fatura e remove a transação antes de voltar pra "não paga"
    # (motivo original do item 6: evitar desconto fantasma no saldo).
    revert_saida_transaction(db, row["transaction_id"])
    db.execute(
        "UPDATE wallet_subscription_periods SET paga = 0, valor_pago = NULL, transaction_id = NULL WHERE id = ?",
        (period_id,),
    )
    db.commit()
    updated = db.execute("SELECT * FROM wallet_subscription_periods WHERE id = ?", (period_id,)).fetchone()
    return _period_out(updated)


# ==================== compras parceladas ====================

def _current_month_str() -> str:
    return datetime.date.today().strftime("%Y-%m")


def _parcela_no_mes(row, mes: str) -> Optional[int]:
    """Número da parcela (1-indexed) correspondente a um mês específico
    — mesma fórmula de _compra_parcelada_out, mas parametrizada pelo mês
    consultado em vez de sempre "hoje". Devolve None se a compra não
    está ativa naquele mês (antes da 1ª parcela ou já quitada,
    considerando ajuste_parcelas). Usada tanto por _compra_parcelada_out
    (com mes=hoje) quanto pelo endpoint /compras-parceladas/mes (item 3
    do plano de ajustes — fatura mês a mês, calculada on the fly, sem
    persistir nada em `compra_parcelada_aplicacoes`, que foi removida
    por nunca ter sido usada de verdade)."""
    elapsed = months_between(row["mes_primeira_parcela"], mes)
    raw_parcela = elapsed + 1 + row["ajuste_parcelas"]
    if raw_parcela < 1 or raw_parcela > row["num_parcelas"]:
        return None
    return raw_parcela


def _compra_parcelada_out(row) -> dict:
    """Calcula os campos de EXIBIÇÃO (parcela atual, quitada) a partir
    do calendário + do ajuste manual (ajuste_parcelas) — não escreve
    nada no banco. A reserva do limite é feita inteira na criação (ver
    create_compra_parcelada), não é incremental."""
    today_month = _current_month_str()
    elapsed = months_between(row["mes_primeira_parcela"], today_month)
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


class CompraParceladaMesOut(BaseModel):
    """Uma linha de 'fatura' pra um mês específico — item 3 do plano de
    ajustes. Só as compras ativas naquele mês aparecem (ver
    _parcela_no_mes); o resto (id/nome/conta_id) é o mesmo de sempre,
    só o número da parcela muda conforme o mês consultado."""
    id: str
    nome: str
    parcela_numero: int
    num_parcelas: int
    valor_parcela: float
    conta_id: Optional[str] = None


class AjustarParcelasPayload(BaseModel):
    delta: int  # +1 avança uma parcela, -1 desfaz um adiantamento por engano


@router.get("/compras-parceladas", response_model=List[CompraParceladaOut])
def list_compras_parceladas(db=Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM compras_parceladas ORDER BY mes_primeira_parcela DESC, nome"
    ).fetchall()
    return [_compra_parcelada_out(r) for r in rows]


@router.get("/compras-parceladas/mes", response_model=List[CompraParceladaMesOut])
def list_compras_parceladas_mes(mes: str, db=Depends(get_db)):
    """Fatura mês a mês (item 3 do plano de ajustes): uma linha por
    compra parcelada ativa no `mes` consultado, no formato "nome
    (parcela X/N) — R$ valor_parcela", como um item de fatura de banco
    de verdade — mesmo sem ser uma `transaction` real, já que a reserva
    no limite foi feita inteira na criação (ver create_compra_parcelada)
    e não muda de novo aqui. Calculado on the fly a partir de
    mes_primeira_parcela + ajuste_parcelas (_parcela_no_mes), sem
    persistir nada — não usa/precisa da tabela `compra_parcelada_
    aplicacoes` (removida por nunca ter sido usada de verdade).
    Rota declarada antes de qualquer /compras-parceladas/{compra_id}
    pra "mes" não ser capturado como id — não há conflito hoje (só
    PUT/DELETE usam {compra_id}), mas define a ordem seguindo o mesmo
    cuidado que rotas com path param costumam pedir."""
    _validate_month(mes)
    rows = db.execute(
        "SELECT * FROM compras_parceladas ORDER BY mes_primeira_parcela, nome"
    ).fetchall()
    out = []
    for row in rows:
        parcela_numero = _parcela_no_mes(row, mes)
        if parcela_numero is None:
            continue
        out.append({
            "id": row["id"],
            "nome": row["nome"],
            "parcela_numero": parcela_numero,
            "num_parcelas": row["num_parcelas"],
            "valor_parcela": row["valor_total"] / row["num_parcelas"],
            "conta_id": row["conta_id"],
        })
    return out


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


@router.put("/compras-parceladas/{compra_id}", response_model=CompraParceladaOut)
def update_compra_parcelada(compra_id: str, payload: CompraParceladaIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="compra parcelada não encontrada")
    if not MONTH_RE.match(payload.mes_primeira_parcela):
        raise HTTPException(status_code=422, detail="mes_primeira_parcela deve ser 'YYYY-MM'")

    # Desfaz a reserva antiga antes de validar/aplicar a nova — mesma lógica
    # de "desfaz e refaz" que delete_compra_parcelada já usa, só que aqui
    # tanto desfazendo quanto refazendo dentro do mesmo request.
    if row["conta_id"]:
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) - ? WHERE id = ?",
            (row["valor_total"], row["conta_id"]),
        )

    if payload.conta_id:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            db.rollback()
            raise HTTPException(status_code=422, detail="conta não encontrada")
        if not conta["possui_credito"]:
            db.rollback()
            raise HTTPException(status_code=422, detail="a conta vinculada precisa ter crédito cadastrado")
        if conta["limite_total"] is not None:
            # essa SELECT já reflete o UPDATE de subtração acima (mesma
            # conexão/transação) mesmo se payload.conta_id == row["conta_id"],
            # então fatura_atual aqui já está sem a reserva antiga.
            fatura_atual = conta["fatura_atual"] or 0
            disponivel = conta["limite_total"] - fatura_atual
            if payload.valor_total > disponivel:
                db.rollback()
                raise HTTPException(
                    status_code=422,
                    detail=f"limite insuficiente: disponível R$ {disponivel:.2f}, compra de R$ {payload.valor_total:.2f}",
                )
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) + ? WHERE id = ?",
            (payload.valor_total, payload.conta_id),
        )

    db.execute(
        "UPDATE compras_parceladas SET nome=?, valor_total=?, num_parcelas=?, conta_id=?, mes_primeira_parcela=? "
        "WHERE id=?",
        (payload.nome, payload.valor_total, payload.num_parcelas, payload.conta_id,
         payload.mes_primeira_parcela, compra_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    return _compra_parcelada_out(updated)


@router.put("/compras-parceladas/{compra_id}/ajustar", response_model=CompraParceladaOut)
def ajustar_parcelas_compra(compra_id: str, payload: AjustarParcelasPayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM compras_parceladas WHERE id = ?", (compra_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="compra parcelada não encontrada")

    # Mesma fórmula de _compra_parcelada_out, mas SEM clamping — precisa do
    # raw_parcela "de verdade" pra saber se esse delta levaria o estado pra
    # fora de [0, num_parcelas] antes de aplicar (não confiar só no clamp de
    # exibição, que mascara ajuste_parcelas indo pra além do limite útil).
    today_month = _current_month_str()
    elapsed = months_between(row["mes_primeira_parcela"], today_month)
    novo_ajuste = row["ajuste_parcelas"] + payload.delta
    raw_parcela = elapsed + 1 + novo_ajuste
    if raw_parcela < 0 or raw_parcela > row["num_parcelas"]:
        raise HTTPException(
            status_code=422,
            detail="ajuste inválido: não há adiantamento pra desfazer" if payload.delta < 0
            else "ajuste inválido: a compra já está quitada",
        )

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