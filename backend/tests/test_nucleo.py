"""Testes do router app/routers/nucleo.py e da lógica em app/actions.py / app/xp.py."""
from app.xp import level_from_xp


def test_list_attributes_returns_default_seeded_set(client):
    resp = client.get("/api/nucleo/attributes")
    assert resp.status_code == 200
    names = {a["name"] for a in resp.json()}
    assert names == {"carreira", "financas", "aprendizado", "organizacao", "metas"}
    for attr in resp.json():
        assert attr["current_xp"] == 0
        assert attr["current_level"] == 1
        assert attr["is_active"] is True


def test_register_action_credits_xp_and_updates_level(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={
            "description": "estudei FastAPI",
            "categories": ["aprendizado"],
            "xp": 30,
            "impact": 3,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["xp_gained"] == 30
    assert body["categories"] == ["aprendizado"]

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    aprendizado = attrs["aprendizado"]
    assert aprendizado["current_xp"] == 30
    assert aprendizado["current_level"] == level_from_xp(30)["level"]

    # outros atributos não devem ser afetados
    assert attrs["financas"]["current_xp"] == 0


def test_register_action_accumulates_xp_across_calls(client):
    for _ in range(3):
        client.post(
            "/api/nucleo/actions",
            json={"description": "ação", "categories": ["financas"], "xp": 10},
        )
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["financas"]["current_xp"] == 30


def test_register_action_multiple_categories_credit_all(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={
            "description": "organizei e estudei",
            "categories": ["organizacao", "aprendizado"],
            "xp": 5,
        },
    )
    assert resp.status_code == 200
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 5
    assert attrs["aprendizado"]["current_xp"] == 5


def test_register_action_unknown_category_returns_422(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "x", "categories": ["categoria_inexistente"], "xp": 10},
    )
    assert resp.status_code == 422


def test_register_action_requires_xp_greater_than_zero(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "x", "categories": ["financas"], "xp": 0},
    )
    assert resp.status_code == 422


def test_register_action_requires_at_least_one_category(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "x", "categories": [], "xp": 10},
    )
    assert resp.status_code == 422


def test_log_lists_registered_actions_most_recent_first(client):
    client.post("/api/nucleo/actions", json={"description": "primeira", "categories": ["financas"], "xp": 5})
    client.post("/api/nucleo/actions", json={"description": "segunda", "categories": ["financas"], "xp": 5})

    resp = client.get("/api/nucleo/log")
    assert resp.status_code == 200
    descriptions = [e["description"] for e in resp.json()]
    assert descriptions[0] == "segunda"
    assert descriptions[1] == "primeira"


def test_log_filters_by_attribute(client):
    client.post("/api/nucleo/actions", json={"description": "a", "categories": ["financas"], "xp": 5})
    client.post("/api/nucleo/actions", json={"description": "b", "categories": ["aprendizado"], "xp": 5})

    resp = client.get("/api/nucleo/log", params={"attribute": "aprendizado"})
    body = resp.json()
    assert len(body) == 1
    assert body[0]["description"] == "b"


def test_achievements_gallery_starts_all_locked(client):
    resp = client.get("/api/nucleo/achievements")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) > 0
    assert all(a["unlocked"] is False for a in body)
    assert all(a["unlocked_at"] is None for a in body)


def test_achievement_unlocks_via_count_by_attribute(client):
    for i in range(10):
        client.post(
            "/api/nucleo/actions",
            json={"description": f"ação {i}", "categories": ["aprendizado"], "xp": 1},
        )
    resp = client.get("/api/nucleo/achievements")
    unlocked_titles = {a["title"] for a in resp.json() if a["unlocked"]}
    assert "10 em aprendizado" in unlocked_titles


def test_register_action_response_reports_newly_unlocked_achievements(client):
    for i in range(9):
        client.post(
            "/api/nucleo/actions",
            json={"description": f"ação {i}", "categories": ["aprendizado"], "xp": 1},
        )
    # a 10a ação deve disparar o desbloqueio na própria resposta
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "ação 10", "categories": ["aprendizado"], "xp": 1},
    )
    unlocked = resp.json()["newly_unlocked_achievements"]
    assert any(a["title"] == "10 em aprendizado" for a in unlocked)
