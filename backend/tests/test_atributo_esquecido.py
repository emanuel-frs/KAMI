"""
GAM-09: atributo esquecido — 14 dias sem ação apaga o vértice do radar.
Só sinal: nenhum xp é perdido. Bônus não contam como atividade.
"""
import datetime

from app.database import new_id
from app.routers.nucleo import _atividade_por_atributo

HOJE = datetime.date(2026, 6, 30)


def _log(conn, day, attribute, referencia_tipo=None):
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at, referencia_tipo) "
        "VALUES (?, 'x', 1, 'form', ?, ?)",
        (log_id, datetime.datetime(day.year, day.month, day.day, 23).astimezone().isoformat(), referencia_tipo),
    )
    attr = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()["id"]
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr))
    conn.commit()


def _by_name(conn, today=HOJE):
    ids = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM attributes").fetchall()}
    return {ids[k]: v for k, v in _atividade_por_atributo(conn, today).items()}


def test_conta_nova_ninguem_esquecido(db_conn):
    info = _by_name(db_conn)
    assert all(v == {"last_activity_at": None, "days_inactive": None, "forgotten": False} for v in info.values())


def test_esquece_com_14_dias_sem_acao(db_conn):
    _log(db_conn, HOJE - datetime.timedelta(days=14), "carreira")
    _log(db_conn, HOJE - datetime.timedelta(days=13), "financas")
    info = _by_name(db_conn)
    assert info["carreira"] == {
        "last_activity_at": (HOJE - datetime.timedelta(days=14)).isoformat(), "days_inactive": 14, "forgotten": True,
    }
    assert info["financas"]["forgotten"] is False
    assert info["financas"]["days_inactive"] == 13


def test_atributo_nunca_usado_conta_desde_a_primeira_acao_do_app(db_conn):
    _log(db_conn, HOJE - datetime.timedelta(days=20), "carreira")
    _log(db_conn, HOJE, "carreira")
    info = _by_name(db_conn)
    assert info["metas"] == {"last_activity_at": None, "days_inactive": 20, "forgotten": True}
    assert info["carreira"]["forgotten"] is False


def test_bonus_nao_conta_como_atividade(db_conn):
    _log(db_conn, HOJE - datetime.timedelta(days=30), "metas")
    _log(db_conn, HOJE, "metas", referencia_tipo="bonus")
    _log(db_conn, HOJE, "metas", referencia_tipo="missao")
    assert _by_name(db_conn)["metas"]["days_inactive"] == 30


def test_api_expoe_e_nao_mexe_no_xp(client, db_conn):
    db_conn.execute("UPDATE attributes SET current_xp = 500 WHERE name = 'carreira'")
    db_conn.commit()
    _log(db_conn, datetime.date.today() - datetime.timedelta(days=40), "carreira")
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["carreira"]["forgotten"] is True
    assert attrs["carreira"]["days_inactive"] == 40
    assert attrs["carreira"]["current_xp"] == 500
