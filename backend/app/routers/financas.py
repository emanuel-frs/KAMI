"""
Módulo Finanças (v1).

Endpoints:
  Renda recorrente (v2 — CRUD completo de fontes + encadeamento, ver
  redesenho no topo de app/database.py::_migrate_income_v2 e schema.sql):
    GET/POST/PUT/DELETE /income-sources      cadastro das fontes de renda
    GET /income-entries?month=YYYY-MM        garante e devolve as ocorrências do mês
    PUT /income-entries/{id}/pay             marca como paga (gera transação real
                                              se a fonte tem conta_id, ver
                                              app/finance_utils.py)
    PUT /income-entries/{id}/unpay           desfaz o pagamento (reverte a
                                              transação se houver)

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
import calendar
import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.business_days import nth_business_day_of_month, add_business_days
from app.actions import register_action
from app.finance_utils import (
    create_saida_transaction,
    revert_saida_transaction,
    create_entrada_transaction,
    revert_entrada_transaction,
)

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

class IncomeSourceIn(BaseModel):
    nome: str
    valor: float
    conta_id: Optional[str] = None    # vínculo opcional — habilita gerar transação real ao pagar
    categoria: Optional[str] = None   # usada na transação gerada; cai pra "renda" se vazia
    frequencia: str = Field(..., pattern="^(mensal|quinzenal|semanal|avulsa)$")
    tipo_data: Optional[str] = Field(None, pattern="^(dia_fixo|dia_util|intervalo_dias|offset_fonte)$")
    dia_mes: Optional[int] = Field(None, ge=1, le=31)          # tipo_data='dia_fixo'
    nth_dia_util: Optional[int] = Field(None, ge=1)            # tipo_data='dia_util'
    intervalo_dias: Optional[int] = Field(None, ge=1)          # tipo_data='intervalo_dias'
    data_base: Optional[str] = None                            # tipo_data='intervalo_dias'
    fonte_referencia_id: Optional[str] = None                  # tipo_data='offset_fonte'
    offset_dias_uteis: Optional[int] = None                    # tipo_data='offset_fonte'
    data_avulsa: Optional[str] = None                           # frequencia='avulsa'
    active: bool = True


class IncomeSourceOut(IncomeSourceIn):
    id: str
    unica: bool = False  # True quando frequencia='avulsa' — não gera novas ocorrências


class IncomeEntryOut(BaseModel):
    id: str
    income_source_id: str
    label: str
    amount: float
    expected_date: str
    paid_date: Optional[str] = None
    status: str
    gerou_transacao: bool = False  # True quando 'pago' veio de uma transação real (não só lembrete)


class PayIncomePayload(BaseModel):
    valor_recebido: Optional[float] = None   # se omitido, usa o valor esperado da entrada
    paid_date: Optional[str] = None          # se omitido, usa a data de hoje
    atualizar_valor_fonte: bool = False      # se True, propaga valor_recebido pra income_sources.valor


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


# ==================== renda recorrente (v2) ====================
# Cadastro genérico de fontes (income_sources) com CRUD completo +
# geração sob-demanda de ocorrências (income_entries), mesmo padrão
# sob-demanda de fixed_bill_periods/wallet_subscription_periods. Marcar
# como paga gera uma transação 'entrada' real OPCIONALMENTE — mesma
# lógica de fixed_bills/wallet_subscriptions (item 6 do mapa de
# problemas antigo), agora replicada aqui via app/finance_utils.py.

DEFAULT_INCOME_CATEGORY = "renda"


def _last_day_of_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _month_bounds(year: int, month: int):
    first = datetime.date(year, month, 1)
    last = datetime.date(year, month, _last_day_of_month(year, month))
    return first, last


def _upsert_single_month_entry(db, source, month_prefix: str, expected_date: datetime.date):
    """Garante a única ocorrência de `source` no mês `month_prefix`,
    recalculando a data se ela mudou (e a ocorrência ainda não foi paga)
    — mesmo comportamento que a parte 2 sempre teve em relação à parte 1
    antes desta v2, só que genérico pra qualquer fonte com uma ocorrência
    por mês (dia_fixo/dia_util/offset_fonte)."""
    existing = db.execute(
        "SELECT * FROM income_entries WHERE income_source_id = ? AND substr(expected_date,1,7) = ? "
        "ORDER BY expected_date LIMIT 1",
        (source["id"], month_prefix),
    ).fetchone()
    if existing:
        if existing["status"] != "pago" and existing["expected_date"] != expected_date.isoformat():
            db.execute(
                "UPDATE income_entries SET expected_date = ? WHERE id = ?",
                (expected_date.isoformat(), existing["id"]),
            )
            db.commit()
            existing = db.execute("SELECT * FROM income_entries WHERE id = ?", (existing["id"],)).fetchone()
        return existing

    # já pode existir uma entrada pra essa data exata gerada quando outro
    # mês foi consultado (ex: offset que cai no mês seguinte) — evita duplicar
    existing_exact = db.execute(
        "SELECT * FROM income_entries WHERE income_source_id = ? AND expected_date = ?",
        (source["id"], expected_date.isoformat()),
    ).fetchone()
    if existing_exact:
        return existing_exact

    db.execute(
        "INSERT INTO income_entries (id, income_source_id, expected_date, paid_date, amount, status) "
        "VALUES (?, ?, ?, NULL, ?, 'previsto')",
        (new_id(), source["id"], expected_date.isoformat(), source["valor"]),
    )
    db.commit()
    return db.execute(
        "SELECT * FROM income_entries WHERE income_source_id = ? AND expected_date = ?",
        (source["id"], expected_date.isoformat()),
    ).fetchone()


def _upsert_interval_entries(db, source, year: int, month: int) -> list:
    """tipo_data='intervalo_dias' pode gerar mais de uma ocorrência por
    mês (ex: semanal). Enumera todas as datas de data_base + k*intervalo
    que caem dentro do mês pedido e garante uma income_entry pra cada."""
    first, last = _month_bounds(year, month)
    base = datetime.date.fromisoformat(source["data_base"])
    step = source["intervalo_dias"]
    if base > last:
        return []

    if base >= first:
        current = base
    else:
        steps = (first - base).days // step
        current = base + datetime.timedelta(days=steps * step)
        while current < first:
            current += datetime.timedelta(days=step)

    entries = []
    while current <= last:
        existing = db.execute(
            "SELECT * FROM income_entries WHERE income_source_id = ? AND expected_date = ?",
            (source["id"], current.isoformat()),
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO income_entries (id, income_source_id, expected_date, paid_date, amount, status) "
                "VALUES (?, ?, ?, NULL, ?, 'previsto')",
                (new_id(), source["id"], current.isoformat(), source["valor"]),
            )
            db.commit()
            existing = db.execute(
                "SELECT * FROM income_entries WHERE income_source_id = ? AND expected_date = ?",
                (source["id"], current.isoformat()),
            ).fetchone()
        entries.append(existing)
        current += datetime.timedelta(days=step)
    return entries


def _resolve_source_entries_for_month(db, source, year: int, month: int, sources_by_id: dict, cache: dict) -> list:
    """Garante e devolve as income_entries de `source` pro (year, month)
    dado, resolvendo a cadeia de offset_fonte recursivamente. `cache`
    evita reprocessar a mesma fonte mais de uma vez dentro da mesma
    chamada de _ensure_income_entries_for_month (encadeamento pode
    ramificar em mais de uma fonte dependente)."""
    if source["id"] in cache:
        return cache[source["id"]]

    month_prefix = f"{year:04d}-{month:02d}"

    if source["unica"]:
        # avulsa: a única entrada já foi criada na criação da fonte (ver
        # create_income_source) — nada a gerar aqui, só devolve o que existe.
        entries = db.execute(
            "SELECT * FROM income_entries WHERE income_source_id = ?", (source["id"],)
        ).fetchall()

    elif source["tipo_data"] == "dia_util":
        expected = nth_business_day_of_month(year, month, source["nth_dia_util"])
        entries = [_upsert_single_month_entry(db, source, month_prefix, expected)]

    elif source["tipo_data"] == "dia_fixo":
        dia = min(source["dia_mes"], _last_day_of_month(year, month))
        expected = datetime.date(year, month, dia)
        entries = [_upsert_single_month_entry(db, source, month_prefix, expected)]

    elif source["tipo_data"] == "intervalo_dias":
        entries = _upsert_interval_entries(db, source, year, month)

    elif source["tipo_data"] == "offset_fonte":
        ref = sources_by_id.get(source["fonte_referencia_id"])
        if not ref:
            entries = []  # fonte de referência inativa/removida — nada a gerar
        else:
            ref_entries = _resolve_source_entries_for_month(db, ref, year, month, sources_by_id, cache)
            entries = []
            for ref_entry in ref_entries:
                base_str = ref_entry["paid_date"] or ref_entry["expected_date"]
                base_date = datetime.date.fromisoformat(base_str)
                expected = add_business_days(base_date, source["offset_dias_uteis"])
                entries.append(_upsert_single_month_entry(db, source, month_prefix, expected))
    else:
        entries = []

    cache[source["id"]] = entries
    return entries


def _ensure_income_entries_for_month(db, year: int, month: int) -> None:
    rows = db.execute("SELECT * FROM income_sources WHERE active = 1").fetchall()
    sources_by_id = {r["id"]: r for r in rows}
    cache: dict = {}
    for source in rows:
        _resolve_source_entries_for_month(db, source, year, month, sources_by_id, cache)


def _income_entry_out(db, row) -> dict:
    source = db.execute("SELECT nome FROM income_sources WHERE id = ?", (row["income_source_id"],)).fetchone()
    return {
        "id": row["id"],
        "income_source_id": row["income_source_id"],
        "label": source["nome"] if source else "—",
        "amount": row["amount"],
        "expected_date": row["expected_date"],
        "paid_date": row["paid_date"],
        "status": row["status"],
        "gerou_transacao": row["transaction_id"] is not None,
    }


@router.get("/income-entries", response_model=List[IncomeEntryOut])
def get_income_entries(month: str, db=Depends(get_db)):
    year, mo = _validate_month(month)
    _ensure_income_entries_for_month(db, year, mo)
    rows = db.execute(
        "SELECT ie.* FROM income_entries ie JOIN income_sources s ON s.id = ie.income_source_id "
        "WHERE substr(ie.expected_date,1,7) = ? AND s.active = 1 ORDER BY ie.expected_date",
        (month,),
    ).fetchall()
    return [_income_entry_out(db, r) for r in rows]


@router.put("/income-entries/{entry_id}/pay", response_model=IncomeEntryOut)
def pay_income_entry(entry_id: str, payload: PayIncomePayload, db=Depends(get_db)):
    row = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="entrada de renda não encontrada")
    source = db.execute("SELECT * FROM income_sources WHERE id = ?", (row["income_source_id"],)).fetchone()
    if not source:
        raise HTTPException(status_code=404, detail="fonte de renda não encontrada")

    amount = payload.valor_recebido if payload.valor_recebido is not None else row["amount"]
    paid_date = payload.paid_date or datetime.date.today().isoformat()
    transaction_id = None

    # só gera transação real se a fonte tem conta_id vinculada — sem
    # conta vinculada não tem como saber onde creditar, então cai pro
    # comportamento de sempre (só lembrete), igual contas fixas/assinaturas.
    if source["conta_id"]:
        conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (source["conta_id"],)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta vinculada à fonte de renda não existe mais")
        transaction_id = create_entrada_transaction(
            db, conta, amount,
            category=source["categoria"] or DEFAULT_INCOME_CATEGORY,
            description=f"renda: {source['nome']}",
            date=paid_date,
        )

    # se o valor recebido for diferente do cadastrado, o usuário pode ter
    # pedido pra atualizar o valor da fonte pra frente (ver
    # pay-income-modal.js no frontend) — a entrada em si sempre reflete o
    # que foi de fato recebido.
    if payload.atualizar_valor_fonte and payload.valor_recebido is not None:
        db.execute("UPDATE income_sources SET valor = ? WHERE id = ?", (payload.valor_recebido, source["id"]))

    db.execute(
        "UPDATE income_entries SET paid_date = ?, amount = ?, status = 'pago', transaction_id = ? WHERE id = ?",
        (paid_date, amount, transaction_id, entry_id),
    )
    db.commit()

    # se essa entrada alimenta outra por encadeamento (offset_fonte),
    # recalcula a(s) dependente(s) do mesmo mês
    year, mo = (int(x) for x in row["expected_date"][:7].split("-"))
    _ensure_income_entries_for_month(db, year, mo)

    updated = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    return _income_entry_out(db, updated)


@router.put("/income-entries/{entry_id}/unpay", response_model=IncomeEntryOut)
def unpay_income_entry(entry_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="entrada de renda não encontrada")
    source = db.execute("SELECT * FROM income_sources WHERE id = ?", (row["income_source_id"],)).fetchone()

    # desfaz o efeito de saldo se essa marcação tinha gerado uma
    # transação real, antes de voltar pra "previsto" — mesmo motivo de
    # unpay_fixed_bill_period (sem isso o saldo fica com um crédito
    # fantasma que o usuário não consegue mais explicar).
    revert_entrada_transaction(db, row["transaction_id"])
    db.execute(
        "UPDATE income_entries SET paid_date = NULL, amount = ?, status = 'previsto', transaction_id = NULL WHERE id = ?",
        (source["valor"] if source else row["amount"], entry_id),
    )
    db.commit()

    year, mo = (int(x) for x in row["expected_date"][:7].split("-"))
    _ensure_income_entries_for_month(db, year, mo)

    updated = db.execute("SELECT * FROM income_entries WHERE id = ?", (entry_id,)).fetchone()
    return _income_entry_out(db, updated)


# ==================== renda recorrente — cadastro das fontes ====================

def _income_source_out(row) -> dict:
    return {
        "id": row["id"],
        "nome": row["nome"],
        "valor": row["valor"],
        "conta_id": row["conta_id"],
        "categoria": row["categoria"],
        "frequencia": row["frequencia"],
        "tipo_data": row["tipo_data"],
        "dia_mes": row["dia_mes"],
        "nth_dia_util": row["nth_dia_util"],
        "intervalo_dias": row["intervalo_dias"],
        "data_base": row["data_base"],
        "fonte_referencia_id": row["fonte_referencia_id"],
        "offset_dias_uteis": row["offset_dias_uteis"],
        "data_avulsa": row["data_avulsa"],
        "active": bool(row["active"]),
        "unica": bool(row["unica"]),
    }


def _would_create_cycle(db, source_id: str, referencia_id: str) -> bool:
    """Percorre a cadeia de fonte_referencia_id a partir de `referencia_id`
    e rejeita se ela volta pro próprio `source_id` — mesma checagem simples
    que qualquer cadeia linear pede."""
    current = referencia_id
    seen = set()
    while current:
        if current == source_id:
            return True
        if current in seen:
            break  # ciclo pré-existente alheio a essa edição — não trava aqui
        seen.add(current)
        row = db.execute("SELECT fonte_referencia_id FROM income_sources WHERE id = ?", (current,)).fetchone()
        current = row["fonte_referencia_id"] if row else None
    return False


def _validate_income_source_payload(db, payload: IncomeSourceIn, source_id: Optional[str] = None) -> None:
    if payload.conta_id:
        conta = db.execute("SELECT id FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
        if not conta:
            raise HTTPException(status_code=422, detail="conta não encontrada")

    if payload.frequencia == "avulsa":
        if not payload.data_avulsa:
            raise HTTPException(status_code=422, detail="fonte avulsa precisa de 'data_avulsa'")
        return

    if not payload.tipo_data:
        raise HTTPException(status_code=422, detail="informe 'tipo_data' pra uma fonte não avulsa")

    if payload.tipo_data in ("dia_fixo", "dia_util") and payload.frequencia != "mensal":
        raise HTTPException(status_code=422, detail=f"'{payload.tipo_data}' só faz sentido com frequencia='mensal'")

    if payload.tipo_data == "dia_fixo" and not payload.dia_mes:
        raise HTTPException(status_code=422, detail="informe 'dia_mes' pra tipo_data='dia_fixo'")

    if payload.tipo_data == "dia_util" and not payload.nth_dia_util:
        raise HTTPException(status_code=422, detail="informe 'nth_dia_util' pra tipo_data='dia_util'")

    if payload.tipo_data == "intervalo_dias" and (not payload.intervalo_dias or not payload.data_base):
        raise HTTPException(
            status_code=422,
            detail="informe 'intervalo_dias' e 'data_base' pra tipo_data='intervalo_dias'",
        )

    if payload.tipo_data == "offset_fonte":
        if not payload.fonte_referencia_id or payload.offset_dias_uteis is None:
            raise HTTPException(
                status_code=422,
                detail="informe 'fonte_referencia_id' e 'offset_dias_uteis' pra tipo_data='offset_fonte'",
            )
        if source_id and payload.fonte_referencia_id == source_id:
            raise HTTPException(status_code=422, detail="uma fonte não pode depender de si mesma")
        ref = db.execute("SELECT id FROM income_sources WHERE id = ?", (payload.fonte_referencia_id,)).fetchone()
        if not ref:
            raise HTTPException(status_code=422, detail="fonte de referência não encontrada")
        if source_id and _would_create_cycle(db, source_id, payload.fonte_referencia_id):
            raise HTTPException(status_code=422, detail="esse encadeamento formaria um ciclo")


@router.get("/income-sources", response_model=List[IncomeSourceOut])
def list_income_sources(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM income_sources ORDER BY nome").fetchall()
    return [_income_source_out(r) for r in rows]


@router.post("/income-sources", response_model=IncomeSourceOut)
def create_income_source(payload: IncomeSourceIn, db=Depends(get_db)):
    _validate_income_source_payload(db, payload)
    source_id = new_id()
    unica = 1 if payload.frequencia == "avulsa" else 0
    db.execute(
        "INSERT INTO income_sources "
        "(id, nome, valor, conta_id, categoria, frequencia, tipo_data, dia_mes, nth_dia_util, "
        "intervalo_dias, data_base, fonte_referencia_id, offset_dias_uteis, data_avulsa, active, unica) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            source_id, payload.nome, payload.valor, payload.conta_id, payload.categoria, payload.frequencia,
            payload.tipo_data, payload.dia_mes, payload.nth_dia_util, payload.intervalo_dias, payload.data_base,
            payload.fonte_referencia_id, payload.offset_dias_uteis, payload.data_avulsa, int(payload.active), unica,
        ),
    )
    db.commit()

    if payload.frequencia == "avulsa":
        # entrada única, criada de uma vez só — unica=1 impede
        # _ensure_income_entries_for_month de gerar qualquer outra.
        db.execute(
            "INSERT INTO income_entries (id, income_source_id, expected_date, paid_date, amount, status) "
            "VALUES (?, ?, ?, NULL, ?, 'previsto')",
            (new_id(), source_id, payload.data_avulsa, payload.valor),
        )
        db.commit()

    row = db.execute("SELECT * FROM income_sources WHERE id = ?", (source_id,)).fetchone()
    return _income_source_out(row)


@router.put("/income-sources/{source_id}", response_model=IncomeSourceOut)
def update_income_source(source_id: str, payload: IncomeSourceIn, db=Depends(get_db)):
    row = db.execute("SELECT * FROM income_sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="fonte de renda não encontrada")
    _validate_income_source_payload(db, payload, source_id=source_id)
    unica = 1 if payload.frequencia == "avulsa" else 0
    db.execute(
        "UPDATE income_sources SET nome=?, valor=?, conta_id=?, categoria=?, frequencia=?, tipo_data=?, "
        "dia_mes=?, nth_dia_util=?, intervalo_dias=?, data_base=?, fonte_referencia_id=?, offset_dias_uteis=?, "
        "data_avulsa=?, active=?, unica=? WHERE id=?",
        (
            payload.nome, payload.valor, payload.conta_id, payload.categoria, payload.frequencia, payload.tipo_data,
            payload.dia_mes, payload.nth_dia_util, payload.intervalo_dias, payload.data_base,
            payload.fonte_referencia_id, payload.offset_dias_uteis, payload.data_avulsa, int(payload.active), unica,
            source_id,
        ),
    )
    db.commit()
    updated = db.execute("SELECT * FROM income_sources WHERE id = ?", (source_id,)).fetchone()
    return _income_source_out(updated)


@router.delete("/income-sources/{source_id}")
def delete_income_source(source_id: str, db=Depends(get_db)):
    dependents = db.execute(
        "SELECT id FROM income_sources WHERE fonte_referencia_id = ?", (source_id,)
    ).fetchall()
    if dependents:
        raise HTTPException(
            status_code=422,
            detail="não é possível remover: existe(m) fonte(s) que dependem desta (encadeamento).",
        )
    db.execute("DELETE FROM income_sources WHERE id = ?", (source_id,))
    db.commit()
    return {"deleted": True}

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