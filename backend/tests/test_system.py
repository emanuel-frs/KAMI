"""Testes do router app/routers/system.py (ALINHAMENTO.md 4.3/4.4)."""


def test_export_sets_last_backup_at_on_profile(client):
    """Exportar um backup de verdade deve registrar quando foi (usado pelo
    lembrete discreto do frontend), tanto no dump devolvido quanto no
    perfil persistido."""
    assert client.get("/api/perfil").json()["last_backup_at"] is None

    body = client.get("/api/system/export").json()
    assert body["tables"]["user_profile"][0]["last_backup_at"] == body["exported_at"]
    assert client.get("/api/perfil").json()["last_backup_at"] == body["exported_at"]


def test_export_includes_known_tables_and_metadata(client):
    resp = client.get("/api/system/export")
    assert resp.status_code == 200
    body = resp.json()
    assert "kami_version" in body
    assert "exported_at" in body
    assert "attributes" in body["tables"]
    assert "user_profile" in body["tables"]
    assert "action_logs" in body["tables"]


def test_export_reflects_current_data(client):
    client.post(
        "/api/nucleo/actions",
        json={"description": "estudei FastAPI", "categories": ["aprendizado"], "xp": 30},
    )
    body = client.get("/api/system/export").json()
    assert len(body["tables"]["action_logs"]) == 1
    assert body["tables"]["action_logs"][0]["description"] == "estudei FastAPI"
    assert len(body["tables"]["action_log_attributes"]) == 1

    # perfil default seedado já deve aparecer, mesmo sem edição do usuário
    assert len(body["tables"]["user_profile"]) == 1
    assert body["tables"]["user_profile"][0]["display_name"] == "usuário"


def test_import_requires_confirmation_field(client):
    resp = client.post("/api/system/import", json={"tables": {"user_profile": []}})
    assert resp.status_code == 422


def test_import_rejects_wrong_confirmation_word(client):
    backup = client.get("/api/system/export").json()
    resp = client.post(
        "/api/system/import",
        json={"confirmation": "sim, quero", "tables": backup["tables"]},
    )
    assert resp.status_code == 422


def test_import_rejects_file_without_user_profile_table(client):
    resp = client.post(
        "/api/system/import",
        json={"confirmation": "importar", "tables": {"attributes": []}},
    )
    assert resp.status_code == 422


def test_import_restores_a_previous_backup(client):
    client.put("/api/perfil", json={"display_name": "nome original", "accent_color": "#8fbf8f"})
    client.post(
        "/api/nucleo/actions",
        json={"description": "estudei FastAPI", "categories": ["aprendizado"], "xp": 30},
    )
    backup = client.get("/api/system/export").json()

    # muda tudo depois do backup ter sido tirado
    client.put("/api/perfil", json={"display_name": "nome mudou", "accent_color": "#ff0000"})
    client.post(
        "/api/nucleo/actions",
        json={"description": "outra coisa", "categories": ["financas"], "xp": 10},
    )

    resp = client.post(
        "/api/system/import",
        json={"confirmation": "importar", "tables": backup["tables"]},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    restored = client.get("/api/system/export").json()["tables"]
    assert restored["user_profile"][0]["display_name"] == "nome original"
    assert len(restored["action_logs"]) == 1
    assert restored["action_logs"][0]["description"] == "estudei FastAPI"


def test_import_leaves_data_untouched_on_bad_confirmation(client):
    client.post(
        "/api/nucleo/actions",
        json={"description": "estudei FastAPI", "categories": ["aprendizado"], "xp": 30},
    )
    resp = client.post(
        "/api/system/import",
        json={"confirmation": "errado", "tables": {"user_profile": []}},
    )
    assert resp.status_code == 422

    logs = client.get("/api/system/export").json()["tables"]["action_logs"]
    assert len(logs) == 1


def test_reset_requires_confirmation_field(client):
    resp = client.post("/api/system/reset", json={})
    assert resp.status_code == 422


def test_reset_rejects_wrong_confirmation_word(client):
    resp = client.post("/api/system/reset", json={"confirmation": "sim, quero"})
    assert resp.status_code == 422
    # nada deve ter sido apagado por uma tentativa rejeitada
    attrs = client.get("/api/nucleo/attributes").json()
    assert len(attrs) == 5


def test_reset_wipes_user_data(client):
    client.post(
        "/api/nucleo/actions",
        json={"description": "estudei FastAPI", "categories": ["aprendizado"], "xp": 30},
    )

    resp = client.post("/api/system/reset", json={"confirmation": "excluir"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    body = client.get("/api/system/export").json()["tables"]
    assert body["action_logs"] == []
    assert body["action_log_attributes"] == []


def test_reset_reseeds_fresh_install_defaults(client):
    client.post("/api/system/reset", json={"confirmation": "excluir"})

    attrs = client.get("/api/nucleo/attributes").json()
    assert {a["name"] for a in attrs} == {
        "carreira", "financas", "aprendizado", "organizacao", "metas",
    }
    assert all(a["current_xp"] == 0 and a["current_level"] == 1 for a in attrs)

    profile_rows = client.get("/api/system/export").json()["tables"]["user_profile"]
    assert len(profile_rows) == 1
    assert profile_rows[0]["display_name"] == "usuário"

    income = client.get("/api/system/export").json()["tables"]["income_sources"]
    assert len(income) == 2

    dashboard_nucleo = client.get("/api/dashboard/nucleo").json()
    assert [w["widget_type"] for w in dashboard_nucleo] == [
        "attributes", "priorities", "log", "registrar", "achievements",
    ]

    achievements = client.get("/api/nucleo/achievements").json()
    assert len(achievements) > 0
    assert all(a["unlocked_at"] is None for a in achievements)


def test_reset_after_profile_edit_restores_default_name(client):
    """Um perfil editado pelo usuário também deve voltar ao default no reset."""
    client.put("/api/perfil", json={"display_name": "outro nome", "accent_color": "#ff0000"})
    client.post("/api/system/reset", json={"confirmation": "excluir"})

    profile_rows = client.get("/api/system/export").json()["tables"]["user_profile"]
    assert profile_rows[0]["display_name"] == "usuário"
    assert profile_rows[0]["accent_color"] == "#8fbf8f"


def test_reset_clears_screen_tips_seen(client):
    """screen_tips_seen precisa fazer parte do 'estado de instalação nova' —
    senão o reset devolve o tour geral do zero mas deixa as dicas por tela
    marcadas como já vistas, o que é inconsistente."""
    client.put("/api/perfil/tips/nucleo")
    assert client.get("/api/perfil/tips").json()["seen"] == ["nucleo"]

    client.post("/api/system/reset", json={"confirmation": "excluir"})

    assert client.get("/api/perfil/tips").json()["seen"] == []


def test_export_import_roundtrip_preserves_screen_tips_seen(client):
    """Um backup restaurado deve trazer de volta quais dicas por tela já
    tinham sido vistas, não só os dados 'principais'."""
    client.put("/api/perfil/tips/nucleo")
    client.put("/api/perfil/tips/financas")
    backup = client.get("/api/system/export").json()

    client.post("/api/system/reset", json={"confirmation": "excluir"})
    assert client.get("/api/perfil/tips").json()["seen"] == []

    resp = client.post(
        "/api/system/import",
        json={"confirmation": "importar", "tables": backup["tables"]},
    )
    assert resp.status_code == 200

    assert set(client.get("/api/perfil/tips").json()["seen"]) == {"nucleo", "financas"}