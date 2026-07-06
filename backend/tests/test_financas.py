"""Testes do router app/routers/financas.py."""
import datetime

from app.business_days import add_business_days, nth_business_day_of_month


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

    # confirma parte 1 com uma data diferente da prevista
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
    # parte 2 continua não confirmada
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


# ==================== cadastros simples ====================


def test_credit_card_crud(client):
    resp = client.post(
        "/api/financas/credit-cards",
        json={"name": "Nubank", "closing_day": 10, "due_day": 17, "card_limit": 3000},
    )
    assert resp.status_code == 200
    card = resp.json()
    assert card["name"] == "Nubank"

    listed = client.get("/api/financas/credit-cards").json()
    assert any(c["id"] == card["id"] for c in listed)

    resp_del = client.delete(f"/api/financas/credit-cards/{card['id']}")
    assert resp_del.status_code == 200
    listed_after = client.get("/api/financas/credit-cards").json()
    assert not any(c["id"] == card["id"] for c in listed_after)


def test_credit_card_invalid_day_returns_422(client):
    resp = client.post(
        "/api/financas/credit-cards",
        json={"name": "X", "closing_day": 40, "due_day": 10},
    )
    assert resp.status_code == 422


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


def test_subscription_crud(client):
    resp = client.post(
        "/api/financas/subscriptions",
        json={"name": "Streaming", "amount": 30, "billing_day": 12},
    )
    assert resp.status_code == 200
    sub = resp.json()
    assert sub["active"] is True

    resp_del = client.delete(f"/api/financas/subscriptions/{sub['id']}")
    assert resp_del.status_code == 200


# ==================== transações + resumo ====================


def test_create_transaction_credits_xp_in_financas(client):
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "mercado",
            "amount": 120.5,
            "type": "saida",
            "category": "alimentacao",
            "date": "2026-03-10",
        },
    )
    assert resp.status_code == 200

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["financas"]["current_xp"] == 2


def test_create_transaction_with_invalid_card_returns_422(client):
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "compra",
            "amount": 50,
            "type": "saida",
            "category": "lazer",
            "date": "2026-03-10",
            "card_id": "cartao-inexistente",
        },
    )
    assert resp.status_code == 422


def test_create_transaction_invalid_type_returns_422(client):
    resp = client.post(
        "/api/financas/transactions",
        json={
            "description": "x",
            "amount": 10,
            "type": "invalido",
            "category": "y",
            "date": "2026-03-10",
        },
    )
    assert resp.status_code == 422


def test_list_transactions_filters_by_month(client):
    client.post(
        "/api/financas/transactions",
        json={"description": "março", "amount": 10, "type": "entrada", "category": "x", "date": "2026-03-05"},
    )
    client.post(
        "/api/financas/transactions",
        json={"description": "abril", "amount": 10, "type": "entrada", "category": "x", "date": "2026-04-05"},
    )
    resp = client.get("/api/financas/transactions", params={"month": "2026-03"})
    body = resp.json()
    assert len(body) == 1
    assert body[0]["description"] == "março"


def test_summary_calculates_totals_saldo_and_categories(client):
    client.post(
        "/api/financas/transactions",
        json={"description": "salário", "amount": 1000, "type": "entrada", "category": "renda", "date": "2026-03-05"},
    )
    client.post(
        "/api/financas/transactions",
        json={"description": "mercado", "amount": 300, "type": "saida", "category": "alimentacao", "date": "2026-03-06"},
    )
    client.post(
        "/api/financas/transactions",
        json={"description": "uber", "amount": 50, "type": "saida", "category": "transporte", "date": "2026-03-07"},
    )

    resp = client.get("/api/financas/summary", params={"month": "2026-03"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_in"] == 1000
    assert body["total_out"] == 350
    assert body["saldo"] == 650
    assert body["top_categories"][0]["category"] == "alimentacao"
    assert body["top_categories"][0]["total"] == 300


def test_summary_compares_with_previous_month(client):
    client.post(
        "/api/financas/transactions",
        json={"description": "fev entrada", "amount": 500, "type": "entrada", "category": "x", "date": "2026-02-10"},
    )
    client.post(
        "/api/financas/transactions",
        json={"description": "mar entrada", "amount": 1000, "type": "entrada", "category": "x", "date": "2026-03-10"},
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
