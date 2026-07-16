"""Testes do router app/routers/aprendizado.py."""
import datetime


def _create_track(client, name="Rust"):
    resp = client.post("/api/aprendizado/tracks", json={"name": name})
    assert resp.status_code == 201
    return resp.json()


def _create_milestone(client, track_id, title="ler o livro", description=None):
    payload = {"title": title}
    if description is not None:
        payload["description"] = description
    resp = client.post(f"/api/aprendizado/tracks/{track_id}/milestones", json=payload)
    assert resp.status_code == 201
    return resp.json()


def test_create_track_defaults(client):
    track = _create_track(client)
    assert track["status"] == "ativa"
    assert track["total_milestones"] == 0
    assert track["progress_pct"] == 0


def test_create_track_invalid_status_returns_422(client):
    resp = client.post("/api/aprendizado/tracks", json={"name": "x", "status": "invalido"})
    assert resp.status_code == 422


def test_progress_pct_computed_from_milestones(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], "m1")
    _create_milestone(client, track["id"], "m2")

    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})

    updated = client.get("/api/aprendizado/tracks").json()[0]
    assert updated["total_milestones"] == 2
    assert updated["completed_milestones"] == 1
    assert updated["progress_pct"] == 50


def test_completing_milestone_credits_xp_and_sets_completed_at(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])

    resp = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["completed_at"] is not None

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"]["current_xp"] == 15  # XP_PER_MILESTONE


def test_reopening_milestone_refunds_the_exact_xp_awarded(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    completed = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"}).json()
    assert completed["xp_awarded"] == 15  # XP_PER_MILESTONE

    resp = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "pendente"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["completed_at"] is None
    assert body["xp_awarded"] is None

    # XP_PER_MILESTONE (15) foi estornado do atributo — volta a 0
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"]["current_xp"] == 0


def test_reopening_milestone_never_leaves_negative_xp(client):
    # dois marcos concluídos noutra trilha credita 30xp; desmarcar um só
    # estorna o que aquele marco específico creditou (15), não os 30
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], "m1")
    m2 = _create_milestone(client, track["id"], "m2")
    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})
    client.put(f"/api/aprendizado/milestones/{m2['id']}", json={"status": "concluido"})

    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "pendente"})

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"]["current_xp"] == 15  # 30 - 15 estornado


def test_completing_milestone_twice_does_not_double_credit_xp(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})
    # já está concluído — "concluir" de novo não deve re-creditar (row["status"] já é 'concluido')
    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"]["current_xp"] == 15


def test_milestone_invalid_status_returns_422(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    resp = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "invalido"})
    assert resp.status_code == 422


def test_update_milestone_not_found_returns_404(client):
    resp = client.put("/api/aprendizado/milestones/inexistente", json={"status": "concluido"})
    assert resp.status_code == 404


def test_create_milestone_track_not_found_returns_404(client):
    resp = client.post("/api/aprendizado/tracks/inexistente/milestones", json={"title": "x"})
    assert resp.status_code == 404


def test_delete_track_cascades_milestones(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])

    resp = client.delete(f"/api/aprendizado/tracks/{track['id']}")
    assert resp.status_code == 204

    resp_ms = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "concluido"})
    assert resp_ms.status_code == 404


def test_stale_pending_milestone_becomes_esquecido_on_read(client, db_conn):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])

    # simula 31 dias sem atividade, direto no banco (bypassa a API)
    old_date = (datetime.datetime.utcnow() - datetime.timedelta(days=31)).isoformat()
    db_conn.execute(
        "UPDATE milestones SET last_activity_at = ?, started_at = ? WHERE id = ?",
        (old_date, old_date, m1["id"]),
    )
    db_conn.commit()

    resp = client.get(f"/api/aprendizado/tracks/{track['id']}/milestones")
    body = resp.json()
    assert body[0]["status"] == "esquecido"


def test_recent_pending_milestone_stays_pendente(client):
    track = _create_track(client)
    _create_milestone(client, track["id"])

    resp = client.get(f"/api/aprendizado/tracks/{track['id']}/milestones")
    assert resp.json()[0]["status"] == "pendente"


def test_create_milestone_with_description(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], description="resumo do tema")
    assert m1["description"] == "resumo do tema"
    assert m1["notes"] is None


def test_update_milestone_notes_does_not_affect_status_or_xp(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])

    resp = client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"notes": "anotação livre"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["notes"] == "anotação livre"
    assert body["status"] == "pendente"

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"]["current_xp"] == 0


def test_milestones_are_created_in_order_with_incrementing_position(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], "m1")
    m2 = _create_milestone(client, track["id"], "m2")
    m3 = _create_milestone(client, track["id"], "m3")
    assert [m1["position"], m2["position"], m3["position"]] == [0, 1, 2]

    listed = client.get(f"/api/aprendizado/tracks/{track['id']}/milestones").json()
    assert [m["title"] for m in listed] == ["m1", "m2", "m3"]


def test_reorder_milestones_persists_new_position(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], "m1")
    m2 = _create_milestone(client, track["id"], "m2")
    m3 = _create_milestone(client, track["id"], "m3")

    resp = client.put(
        f"/api/aprendizado/tracks/{track['id']}/milestones/reorder",
        json={"milestone_ids": [m3["id"], m1["id"], m2["id"]]},
    )
    assert resp.status_code == 200
    assert [m["title"] for m in resp.json()] == ["m3", "m1", "m2"]

    listed = client.get(f"/api/aprendizado/tracks/{track['id']}/milestones").json()
    assert [m["title"] for m in listed] == ["m3", "m1", "m2"]


def test_reorder_rejects_mismatched_milestone_set(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"], "m1")
    _create_milestone(client, track["id"], "m2")

    # manda só um dos dois ids — conjunto incompleto
    resp = client.put(
        f"/api/aprendizado/tracks/{track['id']}/milestones/reorder",
        json={"milestone_ids": [m1["id"]]},
    )
    assert resp.status_code == 422


def test_reorder_track_not_found_returns_404(client):
    resp = client.put(
        "/api/aprendizado/tracks/inexistente/milestones/reorder",
        json={"milestone_ids": []},
    )
    assert resp.status_code == 404