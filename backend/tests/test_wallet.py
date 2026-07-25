"""Testes do router app/routers/wallet.py."""


# ==================== bancos e contas ====================


def test_list_banks_creates_dinheiro_vivo_automatically(client):
    resp = client.get("/api/wallet/banks")
    assert resp.status_code == 200
    banks = resp.json()
    dinheiro = next(b for b in banks if b["is_dinheiro"] is True)
    assert dinheiro["nome"] == "dinheiro"
    assert len(dinheiro["accounts"]) == 1
    conta = dinheiro["accounts"][0]
    assert conta["possui_saldo"] is True
    assert conta["possui_credito"] is False


def test_list_banks_is_idempotent_for_dinheiro_vivo(client):
    first = client.get("/api/wallet/banks").json()
    second = client.get("/api/wallet/banks").json()
    first_dinheiro = next(b for b in first if b["is_dinheiro"])
    second_dinheiro = next(b for b in second if b["is_dinheiro"])
    assert first_dinheiro["id"] == second_dinheiro["id"]
    assert len([b for b in second if b["is_dinheiro"]]) == 1


def test_create_bank(client):
    resp = client.post("/api/wallet/banks", json={"nome": "Nubank", "icon_ascii": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["nome"] == "Nubank"
    assert body["is_dinheiro"] is False
    assert body["accounts"] == []


def test_create_account_in_bank(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Inter"}).json()
    resp = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={
            "nome": "conta corrente",
            "possui_saldo": True,
            "saldo_atual": 250.0,
            "possui_credito": True,
            "fatura_atual": 100.0,
            "limite_total": 2000.0,
            "dia_vencimento": 15,
        },
    )
    assert resp.status_code == 200
    conta = resp.json()
    assert conta["bank_id"] == bank["id"]
    assert conta["saldo_atual"] == 250.0
    assert conta["fatura_atual"] == 100.0
    assert conta["limite_total"] == 2000.0
    assert conta["dia_vencimento"] == 15


def test_create_account_ignores_saldo_credito_fields_when_flags_off(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Itau"}).json()
    resp = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={
            "nome": "conta simples",
            "possui_saldo": False,
            "saldo_atual": 999,
            "possui_credito": False,
            "fatura_atual": 999,
            "limite_total": 999,
            "dia_vencimento": 20,
        },
    )
    assert resp.status_code == 200
    conta = resp.json()
    assert conta["saldo_atual"] is None
    assert conta["fatura_atual"] is None
    assert conta["limite_total"] is None
    assert conta["dia_vencimento"] is None


def test_create_account_duplicate_name_in_same_bank_returns_422(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Bradesco"}).json()
    client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta A", "possui_saldo": True, "saldo_atual": 0},
    )
    resp = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta A", "possui_saldo": True, "saldo_atual": 0},
    )
    assert resp.status_code == 422


def test_create_account_in_dinheiro_vivo_bank_returns_422(client):
    banks = client.get("/api/wallet/banks").json()
    dinheiro = next(b for b in banks if b["is_dinheiro"])
    resp = client.post(
        f"/api/wallet/banks/{dinheiro['id']}/accounts",
        json={"nome": "segunda carteira", "possui_saldo": True, "saldo_atual": 0},
    )
    assert resp.status_code == 422


def test_create_account_in_nonexistent_bank_returns_404(client):
    resp = client.post(
        "/api/wallet/banks/banco-inexistente/accounts",
        json={"nome": "conta", "possui_saldo": True, "saldo_atual": 0},
    )
    assert resp.status_code == 404


def test_update_account(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Santander"}).json()
    conta = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "antiga", "possui_saldo": True, "saldo_atual": 100},
    ).json()

    resp = client.put(
        f"/api/wallet/accounts/{conta['id']}",
        json={"nome": "nova", "possui_saldo": True, "saldo_atual": 500},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["nome"] == "nova"
    assert body["saldo_atual"] == 500


def test_update_account_duplicate_name_returns_422(client):
    bank = client.post("/api/wallet/banks", json={"nome": "C6"}).json()
    conta_a = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta A", "possui_saldo": True, "saldo_atual": 0},
    ).json()
    client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta B", "possui_saldo": True, "saldo_atual": 0},
    )
    resp = client.put(
        f"/api/wallet/accounts/{conta_a['id']}",
        json={"nome": "conta B", "possui_saldo": True, "saldo_atual": 0},
    )
    assert resp.status_code == 422


def test_update_account_not_found_returns_404(client):
    resp = client.put(
        "/api/wallet/accounts/conta-inexistente",
        json={"nome": "x", "possui_saldo": True, "saldo_atual": 0},
    )
    assert resp.status_code == 404


def test_delete_last_account_of_bank_deletes_bank_too(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Banco Solo"}).json()
    conta = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "unica", "possui_saldo": True, "saldo_atual": 0},
    ).json()

    resp = client.delete(f"/api/wallet/accounts/{conta['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is True
    assert body["bank_deleted"] is True

    banks = client.get("/api/wallet/banks").json()
    assert not any(b["id"] == bank["id"] for b in banks)


def test_delete_account_keeps_bank_when_others_remain(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Banco Duplo"}).json()
    conta_a = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta A", "possui_saldo": True, "saldo_atual": 0},
    ).json()
    client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta B", "possui_saldo": True, "saldo_atual": 0},
    )

    resp = client.delete(f"/api/wallet/accounts/{conta_a['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is True
    assert body["bank_deleted"] is False

    banks = client.get("/api/wallet/banks").json()
    assert any(b["id"] == bank["id"] for b in banks)


def test_delete_dinheiro_vivo_account_returns_422(client):
    banks = client.get("/api/wallet/banks").json()
    dinheiro = next(b for b in banks if b["is_dinheiro"])
    conta = dinheiro["accounts"][0]

    resp = client.delete(f"/api/wallet/accounts/{conta['id']}")
    assert resp.status_code == 422

    banks_after = client.get("/api/wallet/banks").json()
    assert any(b["is_dinheiro"] for b in banks_after)


def test_delete_account_not_found_returns_404(client):
    resp = client.delete("/api/wallet/accounts/conta-inexistente")
    assert resp.status_code == 404


# ==================== summary ====================


def test_summary_sums_saldo_and_fatura_across_accounts(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Banco Resumo"}).json()
    client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={
            "nome": "conta 1", "possui_saldo": True, "saldo_atual": 300,
            "possui_credito": True, "fatura_atual": 150, "limite_total": 1000, "dia_vencimento": 10,
        },
    )
    client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta 2", "possui_saldo": True, "saldo_atual": 200},
    )

    resp = client.get("/api/wallet/summary")
    assert resp.status_code == 200
    body = resp.json()
    # inclui também a conta "dinheiro" (saldo 0, criada sob demanda)
    assert body["total_possui"] == 300 + 200
    assert body["total_a_pagar"] == 150


# ==================== assinaturas ====================


def test_create_subscription_without_conta(client):
    resp = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["nome"] == "Streaming"
    assert body["active"] is True
    assert body["conta_id"] is None


def test_create_subscription_with_invalid_conta_returns_422(client):
    resp = client.post(
        "/api/wallet/subscriptions",
        json={
            "nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12,
            "conta_id": "conta-inexistente",
        },
    )
    assert resp.status_code == 422


def test_list_subscriptions(client):
    client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming A", "valor_esperado": 20.0, "dia_cobranca": 5},
    )
    client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming B", "valor_esperado": 40.0, "dia_cobranca": 15},
    )
    resp = client.get("/api/wallet/subscriptions")
    assert resp.status_code == 200
    nomes = {s["nome"] for s in resp.json()}
    assert nomes == {"Streaming A", "Streaming B"}


def test_subscription_periods_generated_on_demand_and_idempotent(client):
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Academia", "valor_esperado": 100.0, "dia_cobranca": 5},
    ).json()

    first = client.get("/api/wallet/subscriptions/periods", params={"month": "2026-03"}).json()
    assert len(first) == 1
    assert first[0]["subscription_id"] == sub["id"]
    assert first[0]["mes_ano"] == "2026-03"
    assert first[0]["paga"] is False

    second = client.get("/api/wallet/subscriptions/periods", params={"month": "2026-03"}).json()
    assert first[0]["id"] == second[0]["id"]


def test_subscription_periods_invalid_month_returns_422(client):
    resp = client.get("/api/wallet/subscriptions/periods", params={"month": "2026/03"})
    assert resp.status_code == 422


def test_subscription_periods_excludes_inactive_subscriptions(client):
    client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Cancelada", "valor_esperado": 10.0, "dia_cobranca": 1, "active": False},
    )
    periods = client.get("/api/wallet/subscriptions/periods", params={"month": "2026-03"}).json()
    assert periods == []


def test_pay_and_unpay_subscription_period(client):
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Revista", "valor_esperado": 25.0, "dia_cobranca": 10},
    ).json()
    period = client.get(
        "/api/wallet/subscriptions/periods", params={"month": "2026-03"}
    ).json()[0]
    assert period["subscription_id"] == sub["id"]

    resp_pay = client.put(
        f"/api/wallet/subscriptions/periods/{period['id']}/pay",
        json={"valor_pago": 27.5},
    )
    assert resp_pay.status_code == 200
    paid = resp_pay.json()
    assert paid["paga"] is True
    assert paid["valor_pago"] == 27.5

    resp_unpay = client.put(f"/api/wallet/subscriptions/periods/{period['id']}/unpay")
    assert resp_unpay.status_code == 200
    unpaid = resp_unpay.json()
    assert unpaid["paga"] is False
    assert unpaid["valor_pago"] is None


def test_pay_period_without_valor_pago_uses_default(client):
    client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Jornal", "valor_esperado": 15.0, "dia_cobranca": 8},
    )
    period = client.get(
        "/api/wallet/subscriptions/periods", params={"month": "2026-03"}
    ).json()[0]

    resp_pay = client.put(f"/api/wallet/subscriptions/periods/{period['id']}/pay", json={})
    assert resp_pay.status_code == 200
    body = resp_pay.json()
    assert body["paga"] is True
    assert body["valor_pago"] is None


def test_pay_period_not_found_returns_404(client):
    resp = client.put(
        "/api/wallet/subscriptions/periods/id-inexistente/pay", json={"valor_pago": 10}
    )
    assert resp.status_code == 404


def test_unpay_period_not_found_returns_404(client):
    resp = client.put("/api/wallet/subscriptions/periods/id-inexistente/unpay")
    assert resp.status_code == 404