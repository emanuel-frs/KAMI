"""Testes do router app/routers/perfil.py."""


def test_get_profile_returns_seeded_defaults(client):
    resp = client.get("/api/perfil")
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "usuário"
    assert body["accent_color"] == "#8fbf8f"
    assert body["avatar_ascii"] is None


def test_update_profile_partial_fields(client):
    resp = client.put("/api/perfil", json={"display_name": "Emanuel"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Emanuel"
    # accent_color não foi enviado — deve manter o valor anterior
    assert body["accent_color"] == "#8fbf8f"


def test_update_profile_both_fields(client):
    resp = client.put(
        "/api/perfil", json={"display_name": "Emanuel", "accent_color": "#ff8800"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Emanuel"
    assert body["accent_color"] == "#ff8800"


def test_update_profile_bumps_updated_at(client):
    before = client.get("/api/perfil").json()["updated_at"]
    resp = client.put("/api/perfil", json={"display_name": "Novo Nome"})
    after = resp.json()["updated_at"]
    assert after >= before


def test_update_avatar(client):
    resp = client.put("/api/perfil/avatar", json={"avatar_ascii": "( ͡° ͜ʖ ͡°)"})
    assert resp.status_code == 200
    assert resp.json()["avatar_ascii"] == "( ͡° ͜ʖ ͡°)"

    # confirma persistência
    resp2 = client.get("/api/perfil")
    assert resp2.json()["avatar_ascii"] == "( ͡° ͜ʖ ͡°)"


def test_update_avatar_requires_field(client):
    resp = client.put("/api/perfil/avatar", json={})
    assert resp.status_code == 422
