"""Testes do router app/routers/perfil.py."""

import re


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


def test_profile_seeds_onboarding_not_completed(client):
    resp = client.get("/api/perfil")
    assert resp.status_code == 200
    assert resp.json()["onboarding_completed"] is False


def test_update_onboarding_marks_completed(client):
    resp = client.put("/api/perfil/onboarding", json={"completed": True})
    assert resp.status_code == 200
    assert resp.json()["onboarding_completed"] is True

    # confirma persistência
    resp2 = client.get("/api/perfil")
    assert resp2.json()["onboarding_completed"] is True


def test_update_onboarding_can_be_unset(client):
    client.put("/api/perfil/onboarding", json={"completed": True})
    resp = client.put("/api/perfil/onboarding", json={"completed": False})
    assert resp.status_code == 200
    assert resp.json()["onboarding_completed"] is False


def test_update_onboarding_requires_field(client):
    resp = client.put("/api/perfil/onboarding", json={})
    assert resp.status_code == 422


def test_screen_tips_seen_starts_empty(client):
    resp = client.get("/api/perfil/tips")
    assert resp.status_code == 200
    assert resp.json()["seen"] == []


def test_mark_screen_tips_seen(client):
    resp = client.put("/api/perfil/tips/nucleo")
    assert resp.status_code == 200
    assert resp.json()["seen"] == ["nucleo"]

    # confirma persistência
    resp2 = client.get("/api/perfil/tips")
    assert resp2.json()["seen"] == ["nucleo"]


def test_mark_screen_tips_seen_is_idempotent(client):
    client.put("/api/perfil/tips/nucleo")
    resp = client.put("/api/perfil/tips/nucleo")
    assert resp.status_code == 200
    assert resp.json()["seen"] == ["nucleo"]


def test_mark_screen_tips_seen_multiple_screens(client):
    client.put("/api/perfil/tips/nucleo")
    resp = client.put("/api/perfil/tips/financas")
    assert sorted(resp.json()["seen"]) == ["financas", "nucleo"]


def test_update_onboarding_bumps_updated_at(client):
    before = client.get("/api/perfil").json()["updated_at"]
    resp = client.put("/api/perfil/onboarding", json={"completed": True})
    after = resp.json()["updated_at"]
    assert after >= before

# ── GAM-04: efeitos visuais ──────────────────────────────────────────────

def test_visual_effects_default_and_update(client):
    assert client.get("/api/perfil").json()["efeitos_visuais"] == "completo"
    resp = client.put("/api/perfil", json={"efeitos_visuais": "sutil"})
    assert resp.status_code == 200
    assert resp.json()["efeitos_visuais"] == "sutil"
    # outros campos não mexem na preferência
    assert client.put("/api/perfil", json={"display_name": "x"}).json()["efeitos_visuais"] == "sutil"


def test_visual_effects_rejects_unknown_value(client):
    assert client.put("/api/perfil", json={"efeitos_visuais": "exagerado"}).status_code == 422


# ==================== GAM-13: sons ====================

def test_som_comeca_ligado_com_todos_os_grupos(client):
    p = client.get("/api/perfil").json()
    assert (p["som_ativo"], p["som_volume"], p["som_progresso"], p["som_interface"], p["som_avisos"]) == (
        True, 60, True, True, True,
    )


def test_reset_liga_o_som_mesmo_com_default_antigo_na_tabela(client, db_conn):
    # banco criado quando o som começava desligado: o DEFAULT 0 fica gravado
    # na tabela (CREATE TABLE IF NOT EXISTS não o atualiza)
    sql = db_conn.execute("SELECT sql FROM sqlite_master WHERE name = 'user_profile'").fetchone()["sql"]
    for col in ("som_ativo", "som_interface"):
        sql = re.sub(rf"({col}\s+INTEGER NOT NULL DEFAULT )1", r"\g<1>0", sql)
    db_conn.executescript(
        "ALTER TABLE user_profile RENAME TO user_profile_old;"
        f"{sql};"
        "INSERT INTO user_profile SELECT * FROM user_profile_old;"
        "DROP TABLE user_profile_old;"
    )
    client.put("/api/perfil", json={"som_ativo": False, "som_interface": False})

    assert client.post("/api/sistema/reset", json={"confirmation": "excluir"}).status_code == 200
    p = client.get("/api/perfil").json()
    assert (p["som_ativo"], p["som_volume"], p["som_progresso"], p["som_interface"], p["som_avisos"]) == (
        True, 60, True, True, True,
    )


def test_salva_preferencias_de_som_sem_mexer_no_resto(client):
    resp = client.put("/api/perfil", json={"som_ativo": False, "som_volume": 35, "som_interface": False})
    assert resp.status_code == 200, resp.text
    p = resp.json()
    assert (p["som_ativo"], p["som_volume"], p["som_interface"], p["som_avisos"]) == (False, 35, False, True)
    assert client.put("/api/perfil", json={"display_name": "x"}).json()["som_volume"] == 35


def test_volume_fora_de_0_a_100_e_recusado(client):
    assert client.put("/api/perfil", json={"som_volume": 101}).status_code == 422
    assert client.put("/api/perfil", json={"som_volume": -1}).status_code == 422


def test_ico_01_theme_icon_is_off_by_default_and_can_be_turned_on(client):
    assert client.get("/api/perfil").json()["icone_tema"] is False  # P-08
    assert client.put("/api/perfil", json={"icone_tema": True}).json()["icone_tema"] is True
    # mexer em outra coisa não desliga
    assert client.put("/api/perfil", json={"accent_color": "#e08fa0"}).json()["icone_tema"] is True


def test_date_format_preference(client):
    """ORG-07 (P-53): formato das datas — segue o sistema por padrão."""
    assert client.get("/api/perfil").json()["formato_data"] == "sistema"
    assert client.put("/api/perfil", json={"formato_data": "mda"}).json()["formato_data"] == "mda"
    assert client.put("/api/perfil", json={"formato_data": "aaaa"}).status_code == 422


# ─── MAN-05: dicas vistas uma a uma ─────────────────────────────────────


def test_dicas_vistas_comecam_vazias(client):
    resp = client.get("/api/perfil/dicas")
    assert resp.status_code == 200
    assert resp.json() == {"vistas": [], "telas_antigas": []}


def test_marcar_dicas_vistas_e_idempotente(client):
    resp = client.put("/api/perfil/dicas", json={"dicas": ["habitos/grade", "habitos/pausar"]})
    assert resp.status_code == 200
    assert resp.json()["vistas"] == ["habitos/grade", "habitos/pausar"]
    primeira = client.get("/api/sistema/export").json()["tables"]["dicas_vistas"]
    client.put("/api/perfil/dicas", json={"dicas": ["habitos/grade"]})
    depois = client.get("/api/sistema/export").json()["tables"]["dicas_vistas"]
    # a data da primeira vez fica
    assert sorted(primeira, key=lambda r: r["dica"]) == sorted(depois, key=lambda r: r["dica"])


def test_dicas_devolvem_as_telas_do_esquema_antigo(client):
    client.put("/api/perfil/tips/nucleo")
    resp = client.get("/api/perfil/dicas")
    assert resp.json()["telas_antigas"] == ["nucleo"]


def test_marcar_dicas_recusa_lista_enorme(client):
    resp = client.put("/api/perfil/dicas", json={"dicas": [f"x/{i}" for i in range(101)]})
    assert resp.status_code == 422
