"""GAM-01: registro de critérios, metadados (categoria/nível/secreta) e máscara de secreta."""
import json
import sqlite3

from app import database
from app.achievements import (
    ACHIEVEMENT_SEED, CATEGORIES, CRITERIA, TIERS, achievement_progress, criterion, seed_achievements,
)


def _achievements(client):
    return {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}


def test_every_seed_item_has_valid_metadata():
    keys = [item["key"] for item in ACHIEVEMENT_SEED]
    assert len(keys) == len(set(keys))
    for item in ACHIEVEMENT_SEED:
        assert item["category"] in CATEGORIES, item["key"]
        assert item.get("tier") in (*TIERS, None), item["key"]
        assert item["criteria"]["type"] in CRITERIA, item["key"]


def test_api_exposes_category_tier_and_secret(client):
    a = _achievements(client)["aprendizado_10"]
    assert (a["category"], a["tier"], a["secret"]) == ("aprendizado", "bronze", False)


def test_new_criterion_type_only_needs_a_function(db_conn):
    @criterion("teste_sempre_metade")
    def _half(conn, c):
        return c["alvo"] // 2, c["alvo"]

    try:
        assert achievement_progress(db_conn, {"type": "teste_sempre_metade", "alvo": 10}) == (5, 10)
    finally:
        CRITERIA.pop("teste_sempre_metade")


def test_unknown_criterion_never_unlocks(db_conn):
    assert achievement_progress(db_conn, {"type": "nao_existe"}) == (0, 1)


def test_locked_secret_achievement_is_masked(client, db_conn):
    db_conn.execute("UPDATE achievements SET secreta = 1 WHERE chave = 'meta_1'")
    db_conn.commit()
    a = _achievements(client)["meta_1"]
    assert (a["title"], a["description"], a["secret"]) == ("???", "conquista secreta", True)
    assert (a["progress_current"], a["progress_target"]) == (0, 1)

    goal = client.post("/api/metas", json={"title": "x", "type": "livre", "target_value": 1}).json()
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    a = _achievements(client)["meta_1"]
    assert a["unlocked"] is True
    assert a["title"] == "quest concluída"


def test_migration_adds_metadata_columns_and_seed_fills_them(temp_db_path):
    conn = sqlite3.connect(temp_db_path)
    conn.execute(
        "CREATE TABLE achievements (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, "
        "rule_type TEXT NOT NULL DEFAULT 'fixed', criteria_json TEXT NOT NULL, unlocked_at TEXT)"
    )
    conn.execute(
        "INSERT INTO achievements (id, title, criteria_json, unlocked_at) VALUES (?, ?, ?, ?)",
        ("velha", "primeira semana", json.dumps({"type": "streak_days", "days": 7}), "2026-01-01T10:00:00"),
    )
    conn.commit()
    conn.close()

    database.init_db()

    conn = database.get_connection()
    row = conn.execute("SELECT * FROM achievements WHERE id = 'velha'").fetchone()
    assert (row["chave"], row["categoria"], row["nivel"], row["secreta"]) == ("streak_7", "nucleo", "bronze", 0)
    assert row["unlocked_at"] is not None
    conn.close()


def test_seed_updates_metadata_of_existing_rows(db_conn):
    db_conn.execute("UPDATE achievements SET categoria = NULL, nivel = NULL WHERE chave = 'streak_30'")
    db_conn.commit()
    seed_achievements(db_conn)
    row = db_conn.execute("SELECT categoria, nivel FROM achievements WHERE chave = 'streak_30'").fetchone()
    assert (row["categoria"], row["nivel"]) == ("nucleo", "prata")
