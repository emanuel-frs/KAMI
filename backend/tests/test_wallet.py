"""Testes do router app/routers/wallet.py."""


# ==================== bancos e contas ====================


def test_list_banks_returns_empty_when_none_created(client):
    """Não existe mais banco fixo/especial ('dinheiro') criado sob demanda
    (ver docstring de app/routers/wallet.py — coluna is_dinheiro removida
    via migration). DB novo começa sem nenhum banco."""
    resp = client.get("/api/wallet/banks")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_bank(client):
    resp = client.post("/api/wallet/banks", json={"nome": "Nubank", "icon_ascii": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["nome"] == "Nubank"
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


def test_update_subscription(client):
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    ).json()
    resp = client.put(
        f"/api/wallet/subscriptions/{sub['id']}",
        json={"nome": "Streaming Premium", "valor_esperado": 45.0, "dia_cobranca": 20, "active": False},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nome"] == "Streaming Premium"
    assert body["valor_esperado"] == 45.0
    assert body["dia_cobranca"] == 20
    assert body["active"] is False

    body = client.get("/api/wallet/subscriptions").json()[0]
    assert body["nome"] == "Streaming Premium"


def test_update_subscription_not_found_returns_404(client):
    resp = client.put(
        "/api/wallet/subscriptions/inexistente",
        json={"nome": "x", "valor_esperado": 10.0, "dia_cobranca": 5},
    )
    assert resp.status_code == 404


def test_update_subscription_with_invalid_conta_returns_422(client):
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    ).json()
    resp = client.put(
        f"/api/wallet/subscriptions/{sub['id']}",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12, "conta_id": "inexistente"},
    )
    assert resp.status_code == 422


def test_delete_subscription(client):
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    ).json()
    resp = client.delete(f"/api/wallet/subscriptions/{sub['id']}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert client.get("/api/wallet/subscriptions").json() == []


def test_delete_subscription_cascades_periods(client):
    """Ao remover a assinatura, os wallet_subscription_periods dela também
    somem (ON DELETE CASCADE) — não deixa período órfão pra reaparecer."""
    sub = client.post(
        "/api/wallet/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    ).json()
    client.get("/api/wallet/subscriptions/periods?month=2026-01")  # gera o period sob demanda

    client.delete(f"/api/wallet/subscriptions/{sub['id']}")

    resp = client.get("/api/wallet/subscriptions/periods?month=2026-01")
    assert resp.json() == []


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


# ==================== compras parceladas ====================
# Sem cobertura até agora — endpoints em app/routers/wallet.py
# (create/list/delete + ajustar_parcelas).


def _create_credito_account(client, nome="conta credito parcelas", fatura_atual=0, limite_total=1000):
    bank = client.post("/api/wallet/banks", json={"nome": f"banco {nome}"}).json()
    resp = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={
            "nome": nome, "possui_saldo": False, "possui_credito": True,
            "fatura_atual": fatura_atual, "limite_total": limite_total, "dia_vencimento": 10,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_create_compra_parcelada_without_conta(client):
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "presente", "valor_total": 300, "num_parcelas": 3,
            "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["conta_id"] is None
    assert body["valor_parcela"] == 100
    assert body["ajuste_parcelas"] == 0


def test_create_compra_parcelada_updates_fatura_atual_da_conta(client):
    conta = _create_credito_account(client, fatura_atual=200, limite_total=1000)
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "notebook", "valor_total": 600, "num_parcelas": 6,
            "conta_id": conta["id"], "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 200, resp.text

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["fatura_atual"] == 800


def test_create_compra_parcelada_limite_insuficiente_returns_422(client):
    conta = _create_credito_account(client, fatura_atual=900, limite_total=1000)
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "tv", "valor_total": 200, "num_parcelas": 2,
            "conta_id": conta["id"], "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 422
    assert "limite insuficiente" in resp.json()["detail"]

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    updated = next(a for a in all_accounts if a["id"] == conta["id"])
    assert updated["fatura_atual"] == 900


def test_create_compra_parcelada_valor_exato_do_limite_e_valido(client):
    conta = _create_credito_account(client, fatura_atual=800, limite_total=1000)
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "tv no limite", "valor_total": 200, "num_parcelas": 2,
            "conta_id": conta["id"], "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 200, resp.text


def test_create_compra_parcelada_conta_sem_credito_returns_422(client):
    bank = client.post("/api/wallet/banks", json={"nome": "banco so saldo"}).json()
    conta = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "conta so saldo", "possui_saldo": True, "saldo_atual": 1000},
    ).json()
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "compra", "valor_total": 100, "num_parcelas": 1,
            "conta_id": conta["id"], "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 422
    assert "precisa ter crédito" in resp.json()["detail"]


def test_create_compra_parcelada_conta_inexistente_returns_422(client):
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "compra", "valor_total": 100, "num_parcelas": 1,
            "conta_id": "conta-inexistente", "mes_primeira_parcela": "2026-03",
        },
    )
    assert resp.status_code == 422
    assert "conta não encontrada" in resp.json()["detail"]


def test_create_compra_parcelada_mes_invalido_returns_422(client):
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "compra", "valor_total": 100, "num_parcelas": 1, "mes_primeira_parcela": "03-2026"},
    )
    assert resp.status_code == 422
    assert "mes_primeira_parcela" in resp.json()["detail"]


def test_create_compra_parcelada_valor_zero_returns_422(client):
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "compra", "valor_total": 0, "num_parcelas": 1, "mes_primeira_parcela": "2026-03"},
    )
    assert resp.status_code == 422


def test_create_compra_parcelada_num_parcelas_zero_returns_422(client):
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "compra", "valor_total": 100, "num_parcelas": 0, "mes_primeira_parcela": "2026-03"},
    )
    assert resp.status_code == 422


def test_compra_parcelada_parcela_atual_and_quitada_computed_from_calendar(client, monkeypatch):
    """parcela_atual/quitada são derivados de mes_primeira_parcela + mês
    'atual' (_current_month_str), não persistidos — mockado pra ser
    determinístico independente da data real de execução do teste."""
    resp = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "fone", "valor_total": 300, "num_parcelas": 3,
            "mes_primeira_parcela": "2026-01",
        },
    )
    compra = resp.json()

    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-01")
    body = client.get("/api/wallet/compras-parceladas").json()[0]
    assert body["parcela_atual"] == 1
    assert body["quitada"] is False

    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-03")
    body = client.get("/api/wallet/compras-parceladas").json()[0]
    assert body["parcela_atual"] == 3
    assert body["quitada"] is False

    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-04")
    body = client.get("/api/wallet/compras-parceladas").json()[0]
    assert body["parcela_atual"] == 3  # clampado no máximo de parcelas
    assert body["quitada"] is True


def test_update_compra_parcelada_sem_conta(client):
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "fone", "valor_total": 300, "num_parcelas": 3, "mes_primeira_parcela": "2026-01"},
    ).json()
    resp = client.put(
        f"/api/wallet/compras-parceladas/{compra['id']}",
        json={"nome": "fone bluetooth", "valor_total": 300, "num_parcelas": 3, "mes_primeira_parcela": "2026-01"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["nome"] == "fone bluetooth"


def test_update_compra_parcelada_not_found_returns_404(client):
    resp = client.put(
        "/api/wallet/compras-parceladas/inexistente",
        json={"nome": "x", "valor_total": 100, "num_parcelas": 2, "mes_primeira_parcela": "2026-01"},
    )
    assert resp.status_code == 404


def test_update_compra_parcelada_reconcilia_fatura_da_mesma_conta(client):
    """Editar valor_total de uma compra que já tinha conta_id precisa
    desfazer a reserva antiga e refazer com o novo valor, não simplesmente
    somar por cima."""
    bank = client.post("/api/wallet/banks", json={"nome": "Nubank"}).json()
    conta = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "cartão", "possui_saldo": False, "possui_credito": True,
              "fatura_atual": 0, "limite_total": 1000},
    ).json()
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "fone", "valor_total": 300, "num_parcelas": 3,
              "mes_primeira_parcela": "2026-01", "conta_id": conta["id"]},
    ).json()

    resp = client.put(
        f"/api/wallet/compras-parceladas/{compra['id']}",
        json={"nome": "fone", "valor_total": 500, "num_parcelas": 5,
              "mes_primeira_parcela": "2026-01", "conta_id": conta["id"]},
    )
    assert resp.status_code == 200, resp.text

    contas = client.get("/api/wallet/banks").json()[0]["accounts"]
    assert contas[0]["fatura_atual"] == 500  # não 300 (antigo) + 500 (novo) = 800


def test_update_compra_parcelada_move_conta_reconcilia_ambas(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Nubank"}).json()
    conta_a = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "cartão A", "possui_saldo": False, "possui_credito": True,
              "fatura_atual": 0, "limite_total": 1000},
    ).json()
    conta_b = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "cartão B", "possui_saldo": False, "possui_credito": True,
              "fatura_atual": 0, "limite_total": 1000},
    ).json()
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "fone", "valor_total": 300, "num_parcelas": 3,
              "mes_primeira_parcela": "2026-01", "conta_id": conta_a["id"]},
    ).json()

    resp = client.put(
        f"/api/wallet/compras-parceladas/{compra['id']}",
        json={"nome": "fone", "valor_total": 300, "num_parcelas": 3,
              "mes_primeira_parcela": "2026-01", "conta_id": conta_b["id"]},
    )
    assert resp.status_code == 200, resp.text

    contas = {a["nome"]: a for a in client.get("/api/wallet/banks").json()[0]["accounts"]}
    assert contas["cartão A"]["fatura_atual"] == 0
    assert contas["cartão B"]["fatura_atual"] == 300


def test_update_compra_parcelada_limite_insuficiente_returns_422_e_nao_altera_fatura(client):
    bank = client.post("/api/wallet/banks", json={"nome": "Nubank"}).json()
    conta = client.post(
        f"/api/wallet/banks/{bank['id']}/accounts",
        json={"nome": "cartão", "possui_saldo": False, "possui_credito": True,
              "fatura_atual": 0, "limite_total": 400},
    ).json()
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "fone", "valor_total": 300, "num_parcelas": 3,
              "mes_primeira_parcela": "2026-01", "conta_id": conta["id"]},
    ).json()

    resp = client.put(
        f"/api/wallet/compras-parceladas/{compra['id']}",
        json={"nome": "fone", "valor_total": 500, "num_parcelas": 5,
              "mes_primeira_parcela": "2026-01", "conta_id": conta["id"]},
    )
    assert resp.status_code == 422, resp.text

    contas = client.get("/api/wallet/banks").json()[0]["accounts"]
    assert contas[0]["fatura_atual"] == 300  # reserva antiga preservada, não perdida no rollback


def test_ajustar_parcelas_delta_positivo_avanca_parcela(client, monkeypatch):
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "geladeira", "valor_total": 400, "num_parcelas": 4, "mes_primeira_parcela": "2026-01"},
    ).json()
    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-01")

    resp = client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ajuste_parcelas"] == 1
    assert body["parcela_atual"] == 2  # 1 (calendário) + 1 (ajuste)


def test_ajustar_parcelas_delta_negativo_desfaz_ajuste(client, monkeypatch):
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "sofa", "valor_total": 400, "num_parcelas": 4, "mes_primeira_parcela": "2026-01"},
    ).json()
    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-01")
    client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": 1})

    resp = client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": -1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ajuste_parcelas"] == 0
    assert body["parcela_atual"] == 1


def test_ajustar_parcelas_not_found_returns_404(client):
    resp = client.put("/api/wallet/compras-parceladas/inexistente/ajustar", json={"delta": 1})
    assert resp.status_code == 404


def test_ajustar_parcelas_delta_negativo_sem_adiantamento_returns_422(client, monkeypatch):
    """0/N (ainda não começou) é um estado válido — um '‹' até ali é
    permitido (desfaz o avanço natural do calendário). O que reproduz o
    bug relatado é o PRÓXIMO '‹' a partir daí, que empurraria
    ajuste_parcelas pra produzir parcela_atual < 0."""
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "cadeira", "valor_total": 300, "num_parcelas": 3, "mes_primeira_parcela": "2026-01"},
    ).json()
    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-01")

    resp = client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": -1})
    assert resp.status_code == 200, resp.text
    assert resp.json()["parcela_atual"] == 0

    resp = client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": -1})
    assert resp.status_code == 422, resp.text

    # e o estado no banco não deve ter mudado além do primeiro ajuste válido
    body = client.get("/api/wallet/compras-parceladas").json()[0]
    assert body["ajuste_parcelas"] == -1
    assert body["parcela_atual"] == 0


def test_ajustar_parcelas_delta_positivo_quando_ja_quitada_returns_422(client, monkeypatch):
    """'›' não pode avançar além do total de parcelas."""
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "notebook", "valor_total": 300, "num_parcelas": 3, "mes_primeira_parcela": "2026-01"},
    ).json()
    monkeypatch.setattr("app.routers.wallet._current_month_str", lambda: "2026-03")  # parcela_atual == 3 (último mês)

    resp = client.put(f"/api/wallet/compras-parceladas/{compra['id']}/ajustar", json={"delta": 1})
    assert resp.status_code == 422, resp.text

    body = client.get("/api/wallet/compras-parceladas").json()[0]
    assert body["ajuste_parcelas"] == 0
    assert body["parcela_atual"] == 3


def test_delete_compra_parcelada_reverts_fatura_atual(client):
    conta = _create_credito_account(client, fatura_atual=100, limite_total=1000)
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={
            "nome": "bike", "valor_total": 500, "num_parcelas": 5,
            "conta_id": conta["id"], "mes_primeira_parcela": "2026-03",
        },
    ).json()

    banks = client.get("/api/wallet/banks").json()
    all_accounts = [a for b in banks for a in b["accounts"]]
    assert next(a for a in all_accounts if a["id"] == conta["id"])["fatura_atual"] == 600

    resp = client.delete(f"/api/wallet/compras-parceladas/{compra['id']}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    banks_after = client.get("/api/wallet/banks").json()
    all_accounts_after = [a for b in banks_after for a in b["accounts"]]
    updated = next(a for a in all_accounts_after if a["id"] == conta["id"])
    assert updated["fatura_atual"] == 100


def test_delete_compra_parcelada_without_conta_does_not_error(client):
    compra = client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "sem conta", "valor_total": 100, "num_parcelas": 1, "mes_primeira_parcela": "2026-03"},
    ).json()
    resp = client.delete(f"/api/wallet/compras-parceladas/{compra['id']}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


def test_delete_compra_parcelada_not_found_returns_404(client):
    resp = client.delete("/api/wallet/compras-parceladas/inexistente")
    assert resp.status_code == 404


def test_list_compras_parceladas_ordered_by_mes_primeira_parcela_desc(client):
    client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "mais antiga", "valor_total": 100, "num_parcelas": 1, "mes_primeira_parcela": "2026-01"},
    )
    client.post(
        "/api/wallet/compras-parceladas",
        json={"nome": "mais recente", "valor_total": 100, "num_parcelas": 1, "mes_primeira_parcela": "2026-05"},
    )
    body = client.get("/api/wallet/compras-parceladas").json()
    assert [c["nome"] for c in body] == ["mais recente", "mais antiga"]