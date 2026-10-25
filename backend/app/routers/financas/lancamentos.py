"""
Lançamentos e resumo do mês: criar, corrigir e apagar lançamento
(CONF-07) e o resumo de entradas/saídas por categoria.

Parte do módulo Finanças (routers/financas/__init__.py junta as partes
num router só, montado em /api/financas). MAN-02.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.actions import register_action, revert_actions
from app.achievements import relock_unmet_achievements
from app.finance_utils import create_saida_transaction, create_entrada_transaction
from app.limites import Entrada
from app.mensagens import Texto, texto_da_linha
from app.routers.financas.comum import (
    CategoryTotal,
    XP_TRANSACAO,
    _prev_month,
    _validate_month,
)

router = APIRouter()


class TransactionIn(Entrada):
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
    # CONF-07: de onde veio (None = lançamento avulso). Lançamento que veio
    # de outro módulo só se desfaz por lá — ver _origem_transacao.
    origem: Optional[str] = None
    # I18N: descrição criada pelo sistema ("conta fixa: aluguel") — o
    # frontend traduz pela chave; None = escrita pela pessoa
    description_key: Optional[str] = None
    description_vars: dict = {}


class SummaryOut(BaseModel):
    month: str
    total_in: float
    total_out: float
    saldo: float
    prev_month_saldo: float
    diff_pct: Optional[float] = None
    top_categories: List[CategoryTotal]


# ==================== transações + resumo ====================

@router.get("/transactions", response_model=List[TransactionOut])
def list_transactions(month: str, db=Depends(get_db)):
    _validate_month(month)
    rows = db.execute(
        "SELECT * FROM transactions WHERE substr(date,1,7) = ? ORDER BY date DESC",
        (month,),
    ).fetchall()
    return [dict(r) | texto_da_linha(r) | {"origem": _origem_transacao(db, r["id"])} for r in rows]


def _apply_transaction(db, payload: TransactionIn) -> dict:
    """
    Valida e aplica um lançamento (grava a transação e mexe em saldo/fatura).
    NÃO comita e NÃO credita xp — create_transaction e update_transaction
    fazem isso; o update usa a falta de commit pra voltar tudo atrás se a
    validação do lançamento novo falhar (CONF-07).
    """
    conta = db.execute("SELECT * FROM wallet_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
    if not conta:
        raise HTTPException(status_code=422, detail=f"conta não encontrada: '{payload.conta_id}'")

    forma_pagamento = payload.forma_pagamento
    conta_destino_id = None
    destino_externo = None
    tx_id = None

    if payload.type == "entrada":
        # reaproveita finance_utils.py (mesma função usada por
        # pay_income_entry) em vez de duplicar a lógica de UPDATE de
        # saldo aqui — validações/erros idênticos aos de antes.
        forma_pagamento = None
        tx_id = create_entrada_transaction(
            db, conta, payload.amount,
            category=payload.category,
            description=payload.description,
            date=payload.date,
        )

    elif payload.type == "saida":
        # idem, reaproveitando create_saida_transaction (mesma função
        # usada por pay_fixed_bill_period/pay_period) em vez de
        # reimplementar a escolha de forma_pagamento e o débito de
        # saldo/fatura na mão.
        tx_id = create_saida_transaction(
            db, conta, payload.amount,
            category=payload.category,
            description=payload.description,
            forma_pagamento=forma_pagamento,
            date=payload.date,
        )
        tx_row = db.execute("SELECT forma_pagamento FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        forma_pagamento = tx_row["forma_pagamento"]

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

# ==================== lançamento: criar, corrigir, apagar (CONF-07) ====================
# Antes não havia como corrigir um lançamento errado (ex.: R$ 500 em vez de
# R$ 50) — o erro ficava no saldo e no xp pra sempre (P-12). Agora:
#   - apagar desfaz o efeito no saldo/fatura e estorna o xp do lançamento;
#   - corrigir (PUT) troca o lançamento de uma vez: desfaz o antigo, aplica
#     o novo e, se o novo não passar na validação (saldo, limite...), volta
#     tudo como estava — sem o risco de "apagar e lançar de novo" falhar
#     no meio e o lançamento sumir;
#   - lançamento gerado por outro módulo (conta fixa, assinatura, renda,
#     meta, dívida) NÃO se apaga nem se corrige por aqui: o vínculo do outro
#     lado ficaria apontando pra nada. Desfaz-se pela origem (desmarcar o
#     pagamento, apagar a contribuição...), que já devolve o dinheiro.

REF_TRANSACAO = "transacao"

# (tabela, coluna) que guardam o id de uma transação gerada por outro módulo
_ORIGENS_TRANSACAO = [
    ("conta fixa", "fixed_bill_periods", "transaction_id"),
    ("assinatura", "wallet_subscription_periods", "transaction_id"),
    ("renda", "income_entries", "transaction_id"),
    ("meta", "goal_contributions", "transaction_id"),
    ("dívida", "debts", "transacao_id"),
]


def _origem_transacao(db, tx_id: str) -> Optional[str]:
    for nome, tabela, coluna in _ORIGENS_TRANSACAO:
        if db.execute(f"SELECT 1 FROM {tabela} WHERE {coluna} = ?", (tx_id,)).fetchone():
            return nome
    return None


def _get_avulsa_or_error(db, tx_id: str):
    tx = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not tx:
        raise HTTPException(status_code=404, detail="lançamento não encontrado")
    origem = _origem_transacao(db, tx_id)
    if origem:
        raise HTTPException(
            status_code=409,
            detail=f"este lançamento veio de {origem} — desfaça por lá (ex.: desmarque o pagamento)",
        )
    return tx


def _undo_transaction(db, tx) -> None:
    """Desfaz o efeito de um lançamento no saldo/fatura e o remove. Não comita."""
    conta_id, amount = tx["conta_id"], tx["amount"]
    if conta_id:  # conta apagada depois: não há saldo pra devolver
        if tx["type"] == "entrada":
            db.execute("UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?", (amount, conta_id))
        elif tx["type"] == "saida" and tx["forma_pagamento"] == "credito":
            db.execute("UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) - ? WHERE id = ?", (amount, conta_id))
        else:  # saída no saldo e transferência (sai da origem nos dois casos)
            db.execute("UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) + ? WHERE id = ?", (amount, conta_id))
    if tx["type"] == "transferencia" and tx["conta_destino_id"]:
        db.execute(
            "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
            (amount, tx["conta_destino_id"]),
        )
    db.execute("DELETE FROM transactions WHERE id = ?", (tx["id"],))


def _texto_lancou(tipo: str, descricao: str) -> Texto:
    # o português segue o de sempre ("lançou saida: …", sem acento): a
    # migração de vínculo (CONF-07) e a revisão de xp casam por esse texto
    if tipo == "entrada":
        return Texto("log.lancamento.entrada", "lançou entrada: {descricao}", descricao=descricao)
    if tipo == "saida":
        return Texto("log.lancamento.saida", "lançou saida: {descricao}", descricao=descricao)
    return Texto("log.lancamento.transferencia", "lançou transferencia: {descricao}", descricao=descricao)


def _credit_transaction_xp(db, out: dict) -> None:
    register_action(
        db,
        description=_texto_lancou(out["type"], out["description"]),
        categories=["financas"],
        xp=XP_TRANSACAO,
        impact=2,
        source="financas",
        referencia_tipo=REF_TRANSACAO,
        referencia_id=out["id"],
    )


@router.post("/transactions", response_model=TransactionOut)
def create_transaction(payload: TransactionIn, db=Depends(get_db)):
    out = _apply_transaction(db, payload)
    db.commit()
    _credit_transaction_xp(db, out)
    return out


@router.put("/transactions/{tx_id}", response_model=TransactionOut)
def update_transaction(tx_id: str, payload: TransactionIn, db=Depends(get_db)):
    old = _get_avulsa_or_error(db, tx_id)
    _undo_transaction(db, old)
    try:
        out = _apply_transaction(db, payload)
    except HTTPException:
        db.rollback()  # o lançamento antigo volta exatamente como estava
        raise
    db.commit()
    # xp: o lançamento corrigido rende o mesmo de um novo, e o antigo é
    # estornado — o total não muda, mas o log aponta pro lançamento certo
    _credit_transaction_xp(db, out)
    revert_actions(db, REF_TRANSACAO, tx_id)
    return out


@router.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: str, db=Depends(get_db)):
    tx = _get_avulsa_or_error(db, tx_id)
    _undo_transaction(db, tx)
    db.commit()
    revert_actions(db, REF_TRANSACAO, tx_id)
    # apagar pode mudar conquistas sem log pra estornar (ex.: "mês no azul"
    # de um lançamento antigo, de antes do vínculo) — confere de novo
    relock_unmet_achievements(db)
    db.commit()


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
