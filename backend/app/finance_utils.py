"""
Helpers compartilhados entre app/routers/financas.py (contas fixas) e
app/routers/wallet.py (assinaturas) pra gerar/reverter uma transação real
a partir de um evento recorrente marcado como pago — item 6 do mapa de
problemas, resolvido como OPCIONAL por registro (mesmo espírito de apps
como YNAB/Mobills: marcar uma conta/assinatura como paga pode lançar a
despesa de verdade, mas só se o usuário vinculou uma conta e confirmou):

  - só acontece se o cadastro (fixed_bills/wallet_subscriptions) tem
    conta_id preenchida;
  - e o usuário confirma no momento de marcar como pago (payload
    `gerar_transacao`, default True quando há conta vinculada — ver
    modals/pay-period-modal.js no frontend);
  - se qualquer uma das duas condições faltar, o fluxo continua sendo só
    lembrete (paga=1 na período, sem transação), exatamente como antes.

Vive num módulo próprio (não dentro de financas.py nem de wallet.py) pra
não criar acoplamento entre os dois routers só por causa desse caso de
uso — mesma razão de business_days.py/actions.py serem módulos soltos.

A lógica de validação/atualização de saldo replica o branch 'saida' de
financas.py::create_transaction (mesmas regras: escolhe forma_pagamento
sozinho quando a conta só tem uma opção, exige escolha explícita quando
tem as duas, valida saldo/limite disponível).
"""
import datetime

from fastapi import HTTPException

from app.database import new_id


def create_saida_transaction(db, conta, amount: float, category: str, description: str,
                              forma_pagamento: str = None, date: str = None) -> str:
    """Cria uma transação 'saida' pra `conta`, atualiza saldo_atual/
    fatura_atual de acordo, e devolve o id da transação criada.
    Levanta HTTPException 422 nos mesmos casos que POST /financas/transactions
    (conta sem saldo nem crédito, ambíguo sem forma_pagamento, saldo/limite
    insuficiente)."""
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
        if amount > saldo_atual:
            raise HTTPException(
                status_code=422,
                detail=f"saldo insuficiente: disponível R$ {saldo_atual:.2f}, tentando gastar R$ {amount:.2f}",
            )
        db.execute(
            "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
            (amount, conta["id"]),
        )
    else:
        if conta["limite_total"] is not None:
            disponivel = conta["limite_total"] - (conta["fatura_atual"] or 0)
            if amount > disponivel:
                raise HTTPException(
                    status_code=422,
                    detail=f"limite insuficiente: disponível R$ {disponivel:.2f}, tentando gastar R$ {amount:.2f}",
                )
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) + ? WHERE id = ?",
            (amount, conta["id"]),
        )

    tx_id = new_id()
    db.execute(
        "INSERT INTO transactions "
        "(id, description, amount, type, category, conta_id, forma_pagamento, conta_destino_id, destino_externo, date) "
        "VALUES (?, ?, ?, 'saida', ?, ?, ?, NULL, NULL, ?)",
        (tx_id, description, amount, category, conta["id"], forma_pagamento, date or datetime.date.today().isoformat()),
    )
    return tx_id


def create_entrada_transaction(db, conta, amount: float, category: str, description: str,
                                date: str = None) -> str:
    """Cria uma transação 'entrada' pra `conta`, credita saldo_atual, e
    devolve o id da transação criada. Espelha create_saida_transaction
    (mesmo módulo) e o branch 'entrada' de financas.py::create_transaction
    — usada quando uma fonte de renda com conta_id vinculada é marcada
    como paga (ver financas.py::pay_income_entry). Levanta HTTPException
    422 se a conta não tiver saldo pra receber (mesma regra de
    POST /financas/transactions)."""
    if not conta["possui_saldo"]:
        raise HTTPException(status_code=422, detail="essa conta não possui saldo pra receber uma entrada")
    db.execute(
        "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) + ? WHERE id = ?",
        (amount, conta["id"]),
    )
    tx_id = new_id()
    db.execute(
        "INSERT INTO transactions "
        "(id, description, amount, type, category, conta_id, forma_pagamento, conta_destino_id, destino_externo, date) "
        "VALUES (?, ?, ?, 'entrada', ?, ?, NULL, NULL, NULL, ?)",
        (tx_id, description, amount, category, conta["id"], date or datetime.date.today().isoformat()),
    )
    return tx_id


def revert_entrada_transaction(db, transaction_id: str) -> None:
    """Desfaz o efeito de saldo de uma transação 'entrada' criada por
    create_entrada_transaction e a remove — chamado quando o usuário
    desfaz o pagamento de uma renda (unpay). Mesmo espírito de
    revert_saida_transaction: só deve receber ids vindos de
    income_entries.transaction_id."""
    if not transaction_id:
        return
    tx = db.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if not tx:
        return
    db.execute(
        "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) - ? WHERE id = ?",
        (tx["amount"], tx["conta_id"]),
    )
    db.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))


def revert_saida_transaction(db, transaction_id: str) -> None:
    """Desfaz o efeito de saldo/fatura de uma transação 'saida' criada por
    create_saida_transaction e a remove — chamado quando o usuário desfaz
    o "marcar como pago" de uma conta fixa/assinatura (unpay). Só deve
    receber ids que vieram de period.transaction_id (nunca uma transação
    lançada manualmente pelo usuário em /financas/transactions, essas só
    somem via DELETE explícito, não por aqui)."""
    if not transaction_id:
        return
    tx = db.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if not tx:
        return
    if tx["forma_pagamento"] == "saldo":
        db.execute(
            "UPDATE wallet_accounts SET saldo_atual = COALESCE(saldo_atual, 0) + ? WHERE id = ?",
            (tx["amount"], tx["conta_id"]),
        )
    else:
        db.execute(
            "UPDATE wallet_accounts SET fatura_atual = COALESCE(fatura_atual, 0) - ? WHERE id = ?",
            (tx["amount"], tx["conta_id"]),
        )
    db.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
