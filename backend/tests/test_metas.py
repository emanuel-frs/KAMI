"""Testes do router app/routers/metas.py."""


def _create_goal(client, target_value=100, type_="financeira", unit="money"):
    resp = client.post(
        "/api/metas/goals",
        json={"title": "viagem", "type": type_, "target_value": target_value, "unit": unit},
    )
    assert resp.status_code == 201
    return resp.json()


def test_create_goal_starts_ativa_with_zero_progress(client):
    goal = _create_goal(client)
    assert goal["status"] == "ativa"
    assert goal["current_value"] == 0
    assert goal["progress_pct"] == 0


def test_create_goal_rejects_academica_type(client):
    resp = client.post(
        "/api/metas/goals",
        json={"title": "certificado", "type": "academica", "target_value": 1},
    )
    assert resp.status_code == 422
    assert "academica" in resp.json()["detail"]


def test_create_goal_rejects_invalid_type(client):
    resp = client.post(
        "/api/metas/goals",
        json={"title": "x", "type": "invalido", "target_value": 1},
    )
    assert resp.status_code == 422


def test_create_goal_rejects_invalid_unit(client):
    resp = client.post(
        "/api/metas/goals",
        json={"title": "x", "type": "livre", "target_value": 1, "unit": "invalido"},
    )
    assert resp.status_code == 422


def test_add_contribution_updates_current_value_as_sum(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 30, "date": "2026-03-01"})
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 20, "date": "2026-03-02"})

    updated = client.get("/api/metas/goals").json()[0]
    assert updated["current_value"] == 50
    assert updated["progress_pct"] == 50
    assert updated["status"] == "ativa"


def test_reaching_target_marks_goal_as_concluida_and_credits_xp(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 100, "date": "2026-03-01"})

    updated = client.get("/api/metas/goals").json()[0]
    assert updated["status"] == "concluida"
    assert updated["progress_pct"] == 100

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["metas"]["current_xp"] == 50  # XP_GOAL_DONE


def test_exceeding_target_still_marks_concluida_with_capped_pct(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 150, "date": "2026-03-01"})

    updated = client.get("/api/metas/goals").json()[0]
    assert updated["status"] == "concluida"
    assert updated["progress_pct"] == 100
    assert updated["current_value"] == 150


def test_cannot_contribute_to_completed_goal(client):
    goal = _create_goal(client, target_value=50)
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 50, "date": "2026-03-01"})

    resp = client.post(
        f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 10, "date": "2026-03-02"}
    )
    assert resp.status_code == 422


def test_deleting_contribution_that_drops_below_target_reopens_goal(client):
    goal = _create_goal(client, target_value=100)
    c1 = client.post(
        f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 60, "date": "2026-03-01"}
    ).json()
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 40, "date": "2026-03-02"})

    goal_completed = client.get("/api/metas/goals").json()[0]
    assert goal_completed["status"] == "concluida"

    # remove uma contribuição, derrubando o total abaixo do alvo
    resp = client.delete(f"/api/metas/contributions/{c1['id']}")
    assert resp.status_code == 204

    goal_after = client.get("/api/metas/goals").json()[0]
    assert goal_after["current_value"] == 40
    assert goal_after["status"] == "ativa"

    # XP não é estornado (regra explícita do v1)
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["metas"]["current_xp"] == 50


def test_deleting_contribution_that_keeps_target_met_stays_concluida(client):
    goal = _create_goal(client, target_value=50)
    c1 = client.post(
        f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 10, "date": "2026-03-01"}
    ).json()
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 60, "date": "2026-03-02"})

    resp = client.delete(f"/api/metas/contributions/{c1['id']}")
    assert resp.status_code == 204

    goal_after = client.get("/api/metas/goals").json()[0]
    assert goal_after["current_value"] == 60
    assert goal_after["status"] == "concluida"


def test_delete_nonexistent_contribution_returns_404(client):
    resp = client.delete("/api/metas/contributions/inexistente")
    assert resp.status_code == 404


def test_list_goals_filters_by_type_and_status(client):
    _create_goal(client, type_="financeira", target_value=10)
    resp_livre = client.post(
        "/api/metas/goals", json={"title": "leitura", "type": "livre", "target_value": 5, "unit": "count"}
    )
    assert resp_livre.status_code == 201

    only_livre = client.get("/api/metas/goals", params={"type": "livre"}).json()
    assert len(only_livre) == 1
    assert only_livre[0]["type"] == "livre"

    only_ativa = client.get("/api/metas/goals", params={"status": "ativa"}).json()
    assert len(only_ativa) == 2


def test_update_goal_lowering_target_can_trigger_completion(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/goals/{goal['id']}/contributions", json={"amount": 40, "date": "2026-03-01"})

    resp = client.put(f"/api/metas/goals/{goal['id']}", json={"target_value": 40})
    assert resp.status_code == 200
    assert resp.json()["status"] == "concluida"


def test_delete_goal_not_found_returns_404(client):
    resp = client.delete("/api/metas/goals/inexistente")
    assert resp.status_code == 404


def test_update_goal_invalid_status_returns_422(client):
    goal = _create_goal(client)
    resp = client.put(f"/api/metas/goals/{goal['id']}", json={"status": "invalido"})
    assert resp.status_code == 422
