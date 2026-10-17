"""
Testes do router app/routers/calendario.py.

Endpoint único (GET /api/calendario/events?month=YYYY-MM), agregador
read-only sobre tabelas de outros módulos. Cada teste cria a fonte via
API do módulo dono (fixed-bills, debts, subscriptions,
compras-parceladas, metas, actions) e confere que o evento
correspondente aparece formatado corretamente na lista do calendário.

Renda/salário foi deliberadamente removida do calendário (ideia melhor
pra isso ainda não implementada) — income_entries/income_sources
continuam existindo e funcionando normalmente em Finanças.
"""
import datetime


def _current_month():
    return datetime.datetime.now().astimezone().strftime("%Y-%m")


def test_invalid_month_returns_422(client):
    resp = client.get("/api/calendario/events", params={"month": "2026/03"})
    assert resp.status_code == 422


def test_empty_month_returns_no_events(client):
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_fixed_bill_appears_on_due_day(client):
    client.post(
        "/api/financas/fixed-bills",
        json={"name": "Aluguel", "amount": 1500, "due_day": 5},
    )
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    events = [e for e in resp.json() if e["type"] == "conta_fixa"]
    assert len(events) == 1
    assert events[0]["date"] == "2026-03-05"
    assert events[0]["title"] == "Aluguel"
    assert events[0]["amount"] == 1500


def test_fixed_bill_due_day_clamped_to_last_day_of_month(client):
    client.post(
        "/api/financas/fixed-bills",
        json={"name": "Assinatura", "amount": 50, "due_day": 31},
    )
    # fevereiro/2026 (não bissexto) tem só 28 dias
    resp = client.get("/api/calendario/events", params={"month": "2026-02"})
    events = [e for e in resp.json() if e["type"] == "conta_fixa"]
    assert events[0]["date"] == "2026-02-28"


def test_inactive_fixed_bill_is_excluded(client):
    bill = client.post(
        "/api/financas/fixed-bills",
        json={"name": "Cancelada", "amount": 10, "due_day": 10, "active": False},
    ).json()
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    ids = [e["id"] for e in resp.json()]
    assert f"conta_fixa:{bill['id']}:2026-03" not in ids


def test_debt_appears_only_in_its_due_month(client):
    client.post(
        "/api/financas/debts",
        json={"description": "empréstimo", "amount": 500, "due_date": "2026-03-20"},
    )
    resp_in = client.get("/api/calendario/events", params={"month": "2026-03"})
    resp_out = client.get("/api/calendario/events", params={"month": "2026-04"})

    in_events = [e for e in resp_in.json() if e["type"] == "divida"]
    out_events = [e for e in resp_out.json() if e["type"] == "divida"]
    assert len(in_events) == 1
    assert in_events[0]["date"] == "2026-03-20"
    assert in_events[0]["status"] == "aberta"
    assert out_events == []


def test_subscription_appears_and_reflects_payment_status(client):
    sub = client.post(
        "/api/carteira/subscriptions",
        json={"nome": "Streaming", "valor_esperado": 30.0, "dia_cobranca": 12},
    ).json()

    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    events = [e for e in resp.json() if e["type"] == "assinatura"]
    assert len(events) == 1
    assert events[0]["date"] == "2026-03-12"
    assert events[0]["status"] == "pendente"
    assert events[0]["amount"] == 30.0

    periods = client.get("/api/carteira/subscriptions/periods", params={"month": "2026-03"}).json()
    period = next(p for p in periods if p["subscription_id"] == sub["id"])
    client.put(f"/api/carteira/subscriptions/periods/{period['id']}/pay", json={"valor_pago": 32.0})

    resp2 = client.get("/api/calendario/events", params={"month": "2026-03"})
    events2 = [e for e in resp2.json() if e["type"] == "assinatura"]
    assert events2[0]["status"] == "paga"
    assert events2[0]["amount"] == 32.0


def test_inactive_subscription_is_excluded(client):
    client.post(
        "/api/carteira/subscriptions",
        json={"nome": "Cancelada", "valor_esperado": 20.0, "dia_cobranca": 8, "active": False},
    )
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    assert [e for e in resp.json() if e["type"] == "assinatura"] == []


def test_compra_parcelada_appears_only_during_installment_window(client):
    client.post(
        "/api/carteira/compras-parceladas",
        json={
            "nome": "presente", "valor_total": 300, "num_parcelas": 3,
            "mes_primeira_parcela": "2026-03",
        },
    )
    before = client.get("/api/calendario/events", params={"month": "2026-02"}).json()
    first = client.get("/api/calendario/events", params={"month": "2026-03"}).json()
    last = client.get("/api/calendario/events", params={"month": "2026-05"}).json()
    after = client.get("/api/calendario/events", params={"month": "2026-06"}).json()

    assert [e for e in before if e["type"] == "parcela"] == []
    assert [e for e in after if e["type"] == "parcela"] == []

    first_parcela = [e for e in first if e["type"] == "parcela"][0]
    assert first_parcela["title"] == "presente (1/3)"
    assert first_parcela["amount"] == 100
    assert first_parcela["date"] == "2026-03-01"

    last_parcela = [e for e in last if e["type"] == "parcela"][0]
    assert last_parcela["title"] == "presente (3/3)"


def test_goal_with_deadline_appears_in_its_month(client):
    goal = client.post(
        "/api/metas", json={"title": "viagem", "type": "livre", "target_value": 100, "deadline": "2026-03-15"}
    ).json()
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    events = [e for e in resp.json() if e["type"] == "meta"]
    assert len(events) == 1
    assert events[0]["id"] == f"meta:{goal['id']}"
    assert events[0]["title"] == "viagem"
    assert events[0]["module"] == "metas"
    assert events[0]["status"] == "ativa"


def test_goal_without_deadline_is_excluded(client):
    client.post("/api/metas", json={"title": "sem prazo", "type": "livre", "target_value": 100})
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    assert [e for e in resp.json() if e["type"] == "meta"] == []


def test_events_are_sorted_by_date(client):
    client.post(
        "/api/financas/debts",
        json={"description": "tardia", "amount": 10, "due_date": "2026-03-28"},
    )
    client.post(
        "/api/financas/fixed-bills",
        json={"name": "cedo", "amount": 20, "due_day": 2},
    )
    resp = client.get("/api/calendario/events", params={"month": "2026-03"})
    dates = [e["date"] for e in resp.json()]
    assert dates == sorted(dates)

def test_action_log_appears_as_acao_event(client):
    created = client.post(
        "/api/nucleo/actions",
        json={"description": "revisei PR do projeto", "categories": ["organizacao"], "xp": 15},
    ).json()

    month = _current_month()
    resp = client.get("/api/calendario/events", params={"month": month})
    events = [e for e in resp.json() if e["type"] == "acao"]
    assert len(events) == 1
    assert events[0]["id"] == f"acao:{created['id']}"
    assert events[0]["title"] == "revisei PR do projeto"
    assert events[0]["module"] == "nucleo"
    assert events[0]["xp"] == 15
    assert events[0]["categories"] == ["organizacao"]
    assert events[0]["date"] == created["created_at"][:10]


def test_multiple_action_logs_same_day_all_appear(client):
    client.post("/api/nucleo/actions", json={"description": "a", "categories": ["aprendizado"], "xp": 5})
    client.post("/api/nucleo/actions", json={"description": "b", "categories": ["financas"], "xp": 10})

    resp = client.get("/api/calendario/events", params={"month": _current_month()})
    events = [e for e in resp.json() if e["type"] == "acao"]
    assert len(events) == 2
    assert {e["title"] for e in events} == {"a", "b"}


def test_no_income_events_in_calendar(client):
    # renda recorrente ainda é seedada/gerada normalmente em Finanças,
    # mas não deve aparecer no calendário
    client.get("/api/financas/income-entries", params={"month": _current_month()})
    resp = client.get("/api/calendario/events", params={"month": _current_month()})
    assert "renda" not in {e["type"] for e in resp.json()}

# ---------------- eventos próprios (CONF-04: CAL-05..CAL-08) ----------------

def _evento(client, **extra):
    body = {"title": "dentista", "date": "2026-03-10", **extra}
    resp = client.post("/api/calendario/events/evento", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _eventos(client, month):
    return [e for e in client.get("/api/calendario/events", params={"month": month}).json() if e["type"] == "evento"]


def test_cal_05_evento_proprio_aparece_so_no_seu_mes(client):
    _evento(client)
    assert [e["date"] for e in _eventos(client, "2026-03")] == ["2026-03-10"]
    assert _eventos(client, "2026-04") == []


def test_cal_06_recorrencia_semanal_respeita_o_fim(client):
    _evento(client, date="2026-03-02", recurrence="weekly", recurrence_end="2026-03-20")
    assert [e["date"] for e in _eventos(client, "2026-03")] == ["2026-03-02", "2026-03-09", "2026-03-16"]
    assert _eventos(client, "2026-04") == []


def test_cal_06_recorrencia_mensal_no_dia_31_cai_no_ultimo_dia_do_mes_curto(client):
    _evento(client, date="2026-01-31", recurrence="monthly")
    assert [e["date"] for e in _eventos(client, "2026-02")] == ["2026-02-28"]
    assert [e["date"] for e in _eventos(client, "2026-04")] == ["2026-04-30"]


def test_cal_07_editar_e_mover_data_do_evento(client):
    ev = _evento(client)
    resp = client.put(f"/api/calendario/events/evento/{ev['id']}", json={"title": "consulta", "date": "2026-03-12"})
    assert resp.status_code == 200
    assert [(e["title"], e["date"]) for e in _eventos(client, "2026-03")] == [("consulta", "2026-03-12")]

    resp = client.patch(f"/api/calendario/events/evento/{ev['id']}/date", json={"date": "2026-04-01"})
    assert resp.status_code == 200
    assert _eventos(client, "2026-03") == []
    assert [(e["title"], e["date"]) for e in _eventos(client, "2026-04")] == [("consulta", "2026-04-01")]


def test_cal_08_apagar_evento_e_validacoes(client):
    ev = _evento(client)
    assert client.delete(f"/api/calendario/events/evento/{ev['id']}").status_code == 204
    assert _eventos(client, "2026-03") == []
    for bad in ({"title": " ", "date": "2026-03-10"}, {"title": "x", "date": "10/03/2026"},
                {"title": "x", "date": "2026-03-10", "time": "9h"}, {"title": "x", "date": "2026-03-10", "recurrence": "hourly"}):
        assert client.post("/api/calendario/events/evento", json=bad).status_code == 422, bad
