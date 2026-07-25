"""Testes do router app/routers/financas.py."""
import datetime

from app.business_days import add_business_days, nth_business_day_of_month


# ==================== helper ====================

def _create_account(
    client,
    nome="conta teste",
    possui_saldo=True,
    saldo_atual=0,
    possui_credito=False,
    fatura_atual=0,
    limite_total=1000,
    dia_vencimento=10,
):
    """Cria um banco novo + uma conta dentro dele, retorna o dict da conta."""
    bank = client.post("/api/wallet/banks", json={"nome": f"banco {nome}"}).json()
    payload = {
        "nome": nome,
        "possui_saldo": possui_saldo,
        "possui_credito": possui_credito,
    }
    if possui_saldo:
        payload["saldo_atual"] = saldo_atual
    if possui_credito:
        payload["fatura_atual"] = fatura_atual
        payload["limite_total"] = limite_total
        payload["dia_vencimento"] = dia_vencimento
    resp = client.post(f"/api/wallet/banks/{bank['id']}/accounts", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ==================== renda recorrente ====================


def test_get_income_entries_generates_part1_and_part2(client):
    resp = client.get("/api/financas/income-entries", params={"month": "2026-03"})
    assert resp.status_code == 200
    body = resp.json()
    labels = {e["label"] for e in body}
    assert labels == {"parte 1", "parte 2"}
    for entry in body:
        assert entry["status"] == "previsto"
        assert entry["paid_date"] is None

    p1 = next(e for e in body if e["label"] == "parte 1")
    expected_p1 = nth_business_day_of_month(2026, 3, 5).isoformat()
    assert p1["expected_date"] == expected_p1


def test_get_income_entries_is_idempotent(client):
    first = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    second = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    assert {e["id"] for e in first} == {e["id"] for e in second}


def test_get_income_entries_invalid_month_format_returns_422(client):
    resp = client.get("/api/financas/income-entries", params={"month": "03-2026"})
    assert resp.status_code == 422


def test_confirm_income_entry_marks_as_paid(client):
    entries = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    p1 = next(e for e in entries if e["label"] == "parte 1")

    resp = client.put(
        f"/api/financas/income-entries/{p1['id']}/confirm",
        json={"paid_date": p1["expected_date"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pago"
    assert body["paid_date"] == p1["expected_date"]


def test_confirm_part1_with_different_date_recalculates_part2(client):
    entries = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    p1 = next(e for e in entries if e["label"] == "parte 1")
    p2_before = next(e for e in entries if e["label"] == "parte 2")

    real_paid_date = (
        datetime.date.fromisoformat(p1["expected_date"]) + datetime.timedelta(days=3)
    )
    client.put(
        f"/api/financas/income-entries/{p1['id']}/confirm",
        json={"paid_date": real_paid_date.isoformat()},
    )

    entries_after = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    p2_after = next(e for e in entries_after if e["label"] == "parte 2")

    expected_p2 = add_business_days(real_paid_date, 15).isoformat()
    assert p2_after["expected_date"] == expected_p2
    assert p2_after["expected_date"] != p2_before["expected_date"]
    assert p2_after["status"] == "previsto"


def test_revert_income_entry_undoes_confirmation(client):
    entries = client.get("/api/financas/income-entries", params={"month": "2026-03"}).json()
    p1 = next(e for e in entries if e["label"] == "parte 1")
    client.put(
        f"/api/financas/income-entries/{p1['id']}/confirm",
        json={"paid_date": p1["expected_date"]},
    )

    resp = client.put(f"/api/financas/income-entries/{p1['id']}/revert")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "previsto"
    assert body["paid_date"] is None


def test_confirm_income_entry_not_found_returns_404(client):
    resp = client.put(
        "/api/financas/income-entries/id-inexistente/confirm",
        json={"paid_date": "2026-03-10"},
    )
    assert resp.status_code == 404


# ==================== cadastros simples (fixed_bills / debts) ====================
# credit_cards e subscriptions antigas saíram daqui — substituídas pelo
# módulo wallet (ver test_wallet.py). fixed_bills/debts continuam fora de
# escopo da wallet, então os testes deles não mudam.


def test_fixed_bill_crud(client):
    resp = client.post(
        "/api/financas/fixed-bills",
        json={"name": "Aluguel", "amount": 1500, "due_day": 5},
    )
    assert resp.status_code == 200
    bill = resp.json()
    assert bill["active"] is True

    resp_del = client.delete(f"/api/financas/fixed-bills/{bill['id']}")
    assert resp_del.status_code == 200


def test_debt_crud_including_update_and_404(client):
    resp = client.post(
        "/api/financas/debts",
        json={"description": "empréstimo", "amount": 500, "counterparty": "amigo"},
    )
    debt = resp.json()
    assert debt["status"] == "aberta"

    resp_upd = client.put(
        f"/api/financas/debts/{debt['id']}",
        json={"description": "empréstimo pago", "amount": 0, "status": "paga"},
    )
    assert resp_upd.status_code == 200
    assert resp_upd.json()["status"] == "paga"

    resp_404 = client.put(
        "/api/financas/debts/inexistente",
        json={"description": "x", "amount": 1},
    )
    assert resp_404.status_code == 404


# ==================== transações + resumo ====================


def test_create_transaction_credits_xp_in_financas(client):
    conta = _create_account(client, nome="conta xp", possui_saldo=True, saldo_atual=500)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "mercado",
            "amount": 120.5,
            "type": "saida",
            "category": "alimentacao",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 200, resp.text

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["financas"]["current_xp"] == 2


def test_create_transaction_debits_saldo_on_saida(client):
    conta = _create_account(client, nome="conta saldo", possui_saldo=True, saldo_atual=500)
    client.post(
        "/api/financas/transactions",
        json={
            "description": "mercado",
            "amount": 120.5,
            "type": "saida",
            "category": "alimentacao",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    bank_id = conta["bank_id"]
    banks = client.get("/api/wallet/banks").json()
    bank = next(b for b in banks if b["id"] == bank_id)
    updated_conta = next(a for a in bank["accounts"] if a["id"] == conta["id"])
    assert updated_conta["saldo_atual"] == 500 - 120.5


def test_create_transaction_saida_requires_forma_pagamento_when_conta_has_both(client):
    conta = _create_account(
        client, nome="conta dupla", possui_saldo=True, saldo_atual=500,
        possui_credito=True, fatura_atual=0, limite_total=1000, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra",
            "amount": 50,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 422

    resp_ok = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra",
            "amount": 50,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
            "forma_pagamento": "credito",
        },
    )
    assert resp_ok.status_code == 200
    assert resp_ok.json()["forma_pagamento"] == "credito"


def test_create_transaction_entrada_requires_conta_with_saldo(client):
    conta = _create_account(
        client, nome="conta so credito", possui_saldo=False, possui_credito=True,
        fatura_atual=0, limite_total=1000, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "salário",
            "amount": 1000,
            "type": "entrada",
            "category": "renda",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 422


def test_create_transaction_transferencia_interna_moves_saldo_between_contas(client):
    origem = _create_account(client, nome="conta origem", possui_saldo=True, saldo_atual=1000)
    destino = _create_account(client, nome="conta destino", possui_saldo=True, saldo_atual=0)

    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia interna",
            "amount": 300,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "conta_destino_id": destino["id"],
        },
    )
    assert resp.status_code == 200, resp.text

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    origem_after = next(a for a in all_accounts if a["id"] == origem["id"])
    destino_after = next(a for a in all_accounts if a["id"] == destino["id"])
    assert origem_after["saldo_atual"] == 700
    assert destino_after["saldo_atual"] == 300


def test_create_transaction_transferencia_externa_only_debits_origem(client):
    origem = _create_account(client, nome="conta origem externa", possui_saldo=True, saldo_atual=1000)

    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "pix pra alguém",
            "amount": 200,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "destino_externo": "fulano",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["destino_externo"] == "fulano"

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    origem_after = next(a for a in all_accounts if a["id"] == origem["id"])
    assert origem_after["saldo_atual"] == 800


def test_create_transaction_transferencia_requires_exactly_one_destino(client):
    origem = _create_account(client, nome="conta origem unico destino", possui_saldo=True, saldo_atual=1000)
    destino = _create_account(client, nome="conta destino unico", possui_saldo=True, saldo_atual=0)

    # nenhum destino
    resp_nenhum = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia",
            "amount": 100,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
        },
    )
    assert resp_nenhum.status_code == 422

    # os dois ao mesmo tempo
    resp_ambos = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia",
            "amount": 100,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "conta_destino_id": destino["id"],
            "destino_externo": "fulano",
        },
    )
    assert resp_ambos.status_code == 422


def test_create_transaction_saida_saldo_insuficiente_returns_422(client):
    conta = _create_account(client, nome="conta saldo pouco", possui_saldo=True, saldo_atual=100)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra cara",
            "amount": 150,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 422
    assert "saldo insuficiente" in resp.json()["detail"]

    # saldo não pode ter sido descontado
    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["saldo_atual"] == 100


def test_create_transaction_saida_saldo_exato_e_valido(client):
    """Caso-limite: gastar exatamente o saldo disponível deve ser aceito (não é '>' estrito)."""
    conta = _create_account(client, nome="conta saldo exato", possui_saldo=True, saldo_atual=100)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "gastou tudo",
            "amount": 100,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 200, resp.text

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["saldo_atual"] == 0


def test_create_transaction_saida_limite_insuficiente_returns_422(client):
    conta = _create_account(
        client, nome="conta limite pouco", possui_saldo=False,
        possui_credito=True, fatura_atual=900, limite_total=1000, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra no crédito",
            "amount": 150,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
            "forma_pagamento": "credito",
        },
    )
    assert resp.status_code == 422
    assert "limite insuficiente" in resp.json()["detail"]

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["fatura_atual"] == 900


def test_create_transaction_saida_dentro_do_limite_e_valido(client):
    conta = _create_account(
        client, nome="conta limite ok", possui_saldo=False,
        possui_credito=True, fatura_atual=900, limite_total=1000, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra no crédito",
            "amount": 100,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
            "forma_pagamento": "credito",
        },
    )
    assert resp.status_code == 200, resp.text

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["fatura_atual"] == 1000


def test_create_transaction_saida_conta_sem_limite_cadastrado_nao_bloqueia(client):
    """limite_total é opcional — sem limite, a fatura só acumula sem checagem."""
    conta = _create_account(
        client, nome="conta sem limite", possui_saldo=False,
        possui_credito=True, fatura_atual=0, limite_total=None, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra grande",
            "amount": 999999,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
            "forma_pagamento": "credito",
        },
    )
    assert resp.status_code == 200, resp.text


def test_create_transaction_saida_conta_sem_saldo_nem_credito_returns_422(client):
    conta = _create_account(client, nome="conta vazia", possui_saldo=False, possui_credito=False)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra impossível",
            "amount": 10,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 422
    assert "não possui saldo nem crédito" in resp.json()["detail"]


def test_create_transaction_transferencia_saldo_insuficiente_returns_422(client):
    origem = _create_account(client, nome="conta origem pouco", possui_saldo=True, saldo_atual=100)
    destino = _create_account(client, nome="conta destino pouco", possui_saldo=True, saldo_atual=0)

    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia grande demais",
            "amount": 300,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "conta_destino_id": destino["id"],
        },
    )
    assert resp.status_code == 422
    assert "saldo insuficiente" in resp.json()["detail"]

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    origem_after = next(a for a in all_accounts if a["id"] == origem["id"])
    destino_after = next(a for a in all_accounts if a["id"] == destino["id"])
    assert origem_after["saldo_atual"] == 100
    assert destino_after["saldo_atual"] == 0


def test_create_transaction_transferencia_conta_destino_inexistente_returns_422(client):
    origem = _create_account(client, nome="conta origem destino invalido", possui_saldo=True, saldo_atual=500)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia",
            "amount": 100,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "conta_destino_id": "conta-inexistente",
        },
    )
    assert resp.status_code == 422
    assert "destino não encontrada" in resp.json()["detail"]


def test_create_transaction_transferencia_conta_destino_sem_saldo_returns_422(client):
    origem = _create_account(client, nome="conta origem destino sem saldo", possui_saldo=True, saldo_atual=500)
    destino_credito = _create_account(
        client, nome="conta destino so credito", possui_saldo=False,
        possui_credito=True, fatura_atual=0, limite_total=1000, dia_vencimento=10,
    )
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia",
            "amount": 100,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem["id"],
            "conta_destino_id": destino_credito["id"],
        },
    )
    assert resp.status_code == 422
    assert "destino precisa ter saldo" in resp.json()["detail"]


def test_create_transaction_transferencia_origem_sem_saldo_returns_422(client):
    origem_credito = _create_account(
        client, nome="conta origem so credito", possui_saldo=False,
        possui_credito=True, fatura_atual=0, limite_total=1000, dia_vencimento=10,
    )
    destino = _create_account(client, nome="conta destino de origem credito", possui_saldo=True, saldo_atual=0)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia",
            "amount": 100,
            "type": "transferencia",
            "category": "transferencia",
            "date": "2026-03-10",
            "conta_id": origem_credito["id"],
            "conta_destino_id": destino["id"],
        },
    )
    assert resp.status_code == 422
    assert "origem" in resp.json()["detail"]


def test_create_transaction_with_invalid_conta_returns_422(client):
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra",
            "amount": 50,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "conta_id": "conta-inexistente",
        },
    )
    assert resp.status_code == 422


def test_create_transaction_invalid_type_returns_422(client):
    conta = _create_account(client, nome="conta tipo invalido", possui_saldo=True, saldo_atual=100)
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "x",
            "amount": 10,
            "type": "invalido",
            "category": "y",
            "date": "2026-03-10",
            "conta_id": conta["id"],
        },
    )
    assert resp.status_code == 422


def test_list_transactions_filters_by_month(client):
    conta = _create_account(client, nome="conta filtro mes", possui_saldo=True, saldo_atual=0)
    client.post(
        "/api/financas/transactions",
        json={
            "description": "março", "amount": 10, "type": "entrada",
            "category": "x", "date": "2026-03-05", "conta_id": conta["id"],
        },
    )
    client.post(
        "/api/financas/transactions",
        json={
            "description": "abril", "amount": 10, "type": "entrada",
            "category": "x", "date": "2026-04-05", "conta_id": conta["id"],
        },
    )
    resp = client.get("/api/financas/transactions", params={"month": "2026-03"})
    body = resp.json()
    assert len(body) == 1
    assert body[0]["description"] == "março"


def test_summary_calculates_totals_saldo_and_categories(client):
    conta = _create_account(client, nome="conta resumo", possui_saldo=True, saldo_atual=0)
    client.post(
        "/api/financas/transactions",
        json={
            "description": "salário", "amount": 1000, "type": "entrada",
            "category": "renda", "date": "2026-03-05", "conta_id": conta["id"],
        },
    )
    client.post(
        "/api/financas/transactions",
        json={
            "description": "mercado", "amount": 300, "type": "saida",
            "category": "alimentacao", "date": "2026-03-06", "conta_id": conta["id"],
        },
    )
    client.post(
        "/api/financas/transactions",
        json={
            "description": "uber", "amount": 50, "type": "saida",
            "category": "transporte", "date": "2026-03-07", "conta_id": conta["id"],
        },
    )

    resp = client.get("/api/financas/summary", params={"month": "2026-03"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_in"] == 1000
    assert body["total_out"] == 350
    assert body["saldo"] == 650
    assert body["top_categories"][0]["category"] == "alimentacao"
    assert body["top_categories"][0]["total"] == 300


def test_summary_ignores_transferencias(client):
    origem = _create_account(client, nome="conta resumo origem", possui_saldo=True, saldo_atual=1000)
    destino = _create_account(client, nome="conta resumo destino", possui_saldo=True, saldo_atual=0)
    client.post(
        "/api/financas/transactions",
        json={
            "description": "transferencia interna", "amount": 400, "type": "transferencia",
            "category": "transferencia", "date": "2026-03-06",
            "conta_id": origem["id"], "conta_destino_id": destino["id"],
        },
    )
    resp = client.get("/api/financas/summary", params={"month": "2026-03"})
    body = resp.json()
    assert body["total_in"] == 0
    assert body["total_out"] == 0


def test_summary_compares_with_previous_month(client):
    conta = _create_account(client, nome="conta comparacao mes", possui_saldo=True, saldo_atual=0)
    client.post(
        "/api/financas/transactions",
        json={
            "description": "fev entrada", "amount": 500, "type": "entrada",
            "category": "x", "date": "2026-02-10", "conta_id": conta["id"],
        },
    )
    client.post(
        "/api/financas/transactions",
        json={
            "description": "mar entrada", "amount": 1000, "type": "entrada",
            "category": "x", "date": "2026-03-10", "conta_id": conta["id"],
        },
    )

    resp = client.get("/api/financas/summary", params={"month": "2026-03"})
    body = resp.json()
    assert body["prev_month_saldo"] == 500
    assert body["diff_pct"] == 100.0


def test_summary_handles_january_wrapping_to_previous_december(client):
    resp = client.get("/api/financas/summary", params={"month": "2026-01"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["prev_month_saldo"] == 0