"""
Etapa 2 da gamificação: horário local (com offset), sequência de dias,
progresso das conquistas, chave estável do seed e resumo do jogador.
"""
import datetime
import json

from app import database
from app.achievements import ACHIEVEMENT_SEED, seed_achievements, streak_info
from app.database import migrate_timestamps_to_local, new_id


# ==================== helpers ====================

def _insert_log(conn, created_at, attribute="metas", xp=1):
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at) VALUES (?, 'x', ?, 'form', ?)",
        (log_id, xp, created_at),
    )
    attr_id = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()["id"]
    conn.execute(
        "INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr_id)
    )
    conn.commit()


def _local_day(days_ago, hour=12):
    d = datetime.date.today() - datetime.timedelta(days=days_ago)
    return datetime.datetime(d.year, d.month, d.day, hour).astimezone().isoformat()


def _achievements(client):
    return {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}


# ==================== horário local ====================

def test_now_iso_is_local_time_with_offset():
    value = database.now_iso()
    parsed = datetime.datetime.fromisoformat(value)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == datetime.datetime.now().astimezone().utcoffset()
    assert value[:10] == datetime.date.today().isoformat()


def test_registered_action_uses_local_date(client):
    resp = client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 5})
    created_at = resp.json()["created_at"]
    assert datetime.datetime.fromisoformat(created_at).tzinfo is not None
    assert created_at[:10] == datetime.date.today().isoformat()


def test_migration_converts_legacy_utc_timestamps(db_conn):
    legacy_utc = "2026-03-10T02:30:00.123456"  # gravado pelo antigo utcnow()
    _insert_log(db_conn, legacy_utc)
    db_conn.execute("INSERT INTO transactions (id, description, amount, type, category, date) "
                    "VALUES ('t1', 'x', 1, 'saida', 'c', '2026-03-10')")
    db_conn.commit()

    assert migrate_timestamps_to_local(db_conn) >= 1
    db_conn.commit()

    stored = db_conn.execute("SELECT created_at FROM action_logs").fetchone()["created_at"]
    parsed = datetime.datetime.fromisoformat(stored)
    expected = datetime.datetime.fromisoformat(legacy_utc).replace(tzinfo=datetime.timezone.utc)
    assert parsed.tzinfo is not None
    assert parsed == expected  # mesmo instante, agora com o offset local
    # data pura digitada pelo usuário não é tocada
    assert db_conn.execute("SELECT date FROM transactions").fetchone()["date"] == "2026-03-10"

    # idempotente: rodar de novo não converte nada
    assert migrate_timestamps_to_local(db_conn) == 0


def test_import_of_old_backup_converts_timestamps_and_restores_keys(client):
    backup = client.get("/api/sistema/export").json()["tables"]
    backup["action_logs"] = [{
        "id": "antigo", "description": "ação antiga", "xp_gained": 5, "impact_note": None,
        "source": "form", "created_at": "2026-01-01T10:00:00",
    }]
    for row in backup["achievements"]:
        row.pop("chave", None)

    resp = client.post("/api/sistema/import", json={"confirmation": "importar", "tables": backup})
    assert resp.status_code == 200, resp.text

    log = client.get("/api/nucleo/log").json()[0]
    assert datetime.datetime.fromisoformat(log["created_at"]).tzinfo is not None
    keys = {a["key"] for a in client.get("/api/nucleo/achievements").json()}
    assert keys == {item["key"] for item in ACHIEVEMENT_SEED}


# ==================== sequência ====================

def test_streak_counts_current_run_ending_today(db_conn):
    for days_ago in (0, 1, 2, 5, 6, 7, 8):
        _insert_log(db_conn, _local_day(days_ago))
    info = streak_info(db_conn)
    assert (info["current"], info["best"], info["active_today"]) == (3, 4, True)


def test_streak_still_alive_if_last_action_was_yesterday(db_conn):
    for days_ago in (1, 2):
        _insert_log(db_conn, _local_day(days_ago))
    info = streak_info(db_conn)
    assert info["current"] == 2
    assert info["active_today"] is False


def test_streak_broken_after_a_missed_day(db_conn):
    for days_ago in (2, 3):
        _insert_log(db_conn, _local_day(days_ago))
    assert streak_info(db_conn)["current"] == 0


def test_late_night_action_counts_for_the_local_day(db_conn):
    # 23h locais: em UTC (Brasil) isso já seria o dia seguinte
    _insert_log(db_conn, _local_day(1, hour=23))
    _insert_log(db_conn, _local_day(0, hour=9))
    assert streak_info(db_conn)["current"] == 2


# ==================== conquistas ====================

def test_locked_achievement_reports_progress(client):
    for _ in range(3):
        client.post("/api/nucleo/actions", json={"description": "x", "categories": ["aprendizado"], "xp": 5})
    a = _achievements(client)["aprendizado_10"]
    assert a["unlocked"] is False
    assert (a["progress_current"], a["progress_target"]) == (3, 10)


def test_unlocked_achievement_reports_full_progress(client):
    client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 5})
    goal = client.post("/api/metas", json={"title": "x", "type": "livre", "target_value": 1}).json()
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    a = _achievements(client)["meta_1"]
    assert a["unlocked"] is True
    assert a["progress_current"] == a["progress_target"] == 1


def test_seed_matches_legacy_rows_by_title_once_and_follows_renames(db_conn):
    # linha antiga, sem chave, já desbloqueada
    db_conn.execute("DELETE FROM achievements")
    db_conn.execute(
        "INSERT INTO achievements (id, title, description, rule_type, criteria_json, unlocked_at) "
        "VALUES ('velha', 'primeira semana', 'd', 'fixed', ?, '2026-01-01T10:00:00-03:00')",
        (json.dumps({"type": "streak_days", "days": 7}),),
    )
    db_conn.commit()
    seed_achievements(db_conn)
    row = db_conn.execute("SELECT * FROM achievements WHERE chave = 'streak_7'").fetchone()
    assert row["id"] == "velha"
    assert row["unlocked_at"] is not None

    # renomear no seed atualiza a mesma linha em vez de duplicar
    original = ACHIEVEMENT_SEED[0]["title"]
    try:
        ACHIEVEMENT_SEED[0]["title"] = "sete dias seguidos"
        seed_achievements(db_conn)
    finally:
        ACHIEVEMENT_SEED[0]["title"] = original
    rows = db_conn.execute("SELECT * FROM achievements WHERE chave = 'streak_7'").fetchall()
    assert len(rows) == 1 and rows[0]["title"] == "sete dias seguidos"
    assert db_conn.execute("SELECT COUNT(*) AS c FROM achievements").fetchone()["c"] == len(ACHIEVEMENT_SEED)


# ==================== jogador ====================

def test_player_summary(client):
    client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 50})
    client.post("/api/nucleo/actions", json={"description": "y", "categories": ["aprendizado"], "xp": 50})
    resp = client.get("/api/nucleo/player")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_xp"] == 100
    assert body["level"] == 2  # 100 xp fecham o nível 1 (xp_for_level(1) = 100)
    assert body["current_level_xp"] == 0
    assert body["streak_current"] == 1
    assert body["active_today"] is True
    assert body["achievements_total"] == len(ACHIEVEMENT_SEED)
