"""
Renda recorrente: entradas do mês (pagar/desfazer) e cadastro das fontes.

Parte do módulo Finanças (routers/financas/__init__.py junta as partes
num router só, montado em /api/financas). MAN-02.
"""
import calendar
import datetime
from typing import ClassVar, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.business_days import nth_business_day_of_month, add_business_days
from app.actions import has_action, register_action, revert_actions
from app.achievements import relock_unmet_achievements
from app.finance_utils import create_entrada_transaction, revert_entrada_transaction
from app.limites import Entrada, SAIDA_CONFIG
from app.routers.financas.comum import (
    XP_PAGAMENTO_RECORRENTE,
    _revert_period_xp,
    _validate_month,
)

router = APIRouter()


# ==================== schemas ====================

class IncomeSourceIn(Entrada):
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
    model_config = SAIDA_CONFIG  # resposta: sem os limites de entrada (app/limites.py)
    sem_limites_de_entrada: ClassVar[bool] = True
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


class PayIncomePayload(Entrada):
    valor_recebido: Optional[float] = None   # se omitido, usa o valor esperado da entrada
    paid_date: Optional[str] = None          # se omitido, usa a data de hoje
    atualizar_valor_fonte: bool = False      # se True, propaga valor_recebido pra income_sources.valor


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
        # marcar de novo uma entrada já paga não credita outra vez
        if not has_action(db, "renda_entrada", entry_id):
            register_action(
                db,
                description=f"recebeu renda: {source['nome']}",
                categories=["financas"],
                xp=XP_PAGAMENTO_RECORRENTE,
                impact=2,
                source="financas",
                referencia_tipo="renda_entrada",
                referencia_id=entry_id,
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
    # estorna o xp do recebimento — sem isso marcar/desmarcar rendia xp infinito
    revert_actions(db, "renda_entrada", entry_id)
    db.execute(
        "UPDATE income_entries SET paid_date = NULL, amount = ?, status = 'previsto', transaction_id = NULL WHERE id = ?",
        (source["valor"] if source else row["amount"], entry_id),
    )
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o recebimento ainda pago, o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
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
    if not db.execute("SELECT 1 FROM income_sources WHERE id = ?", (source_id,)).fetchone():
        raise HTTPException(status_code=404, detail="fonte de renda não encontrada")
    dependents = db.execute(
        "SELECT id FROM income_sources WHERE fonte_referencia_id = ?", (source_id,)
    ).fetchall()
    if dependents:
        raise HTTPException(
            status_code=422,
            detail="não é possível remover: existe(m) fonte(s) que dependem desta (encadeamento).",
        )
    # P-14 (CONF-04): apagar a fonte estorna o xp das ocorrências recebidas
    # — sem isso, criar, receber, apagar e recriar rendia xp de novo. As
    # transações reais lançadas ficam (dinheiro que entrou é fato), igual
    # a apagar uma meta (ver metas.py::delete_goal).
    _revert_period_xp(db, "renda_entrada", "income_entries", "income_source_id", source_id)
    db.execute("DELETE FROM income_sources WHERE id = ?", (source_id,))
    # CONF-04 (INV-04): o revert_actions acima rebloqueia conquistas, mas
    # rodou ANTES desta mudança de estado — com o cadastro ainda existindo, o
    # critério ainda valia e nada era rebloqueado. Confere de novo agora.
    relock_unmet_achievements(db)
    db.commit()
    return {"deleted": True}
