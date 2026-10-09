"""
GAM-08: bônus de xp — primeira ação do dia (+5), multiplicador de
sequência em degraus (1,1/1,2/1,3/1,5×), atributo atrasado (2×), teto de
+20 por bônus, ação manual sem bônus, bônus separado no log, estornado
junto com a ação e fora das contagens de conquista.

Desligado por padrão na suíte (conftest.py) — aqui `bonus_ligado` religa.
"""
import datetime

import pytest

from app.achievements import achievement_progress
from app.actions import register_action, revert_actions
from app.bonus import atributo_atrasado, multiplicador
from app.database import new_id

pytestmark = pytest.mark.usefixtures("bonus_ligado")


def _logs(conn):
    return [(r["description"], r["xp_gained"]) for r in conn.execute(
        "SELECT description, xp_gained FROM action_logs ORDER BY created_at, rowid"
    ).fetchall()]


def _bonus(conn):
    return [(d, x) for d, x in _logs(conn) if d.startswith("bônus")]


def _xp(conn, name):
    return conn.execute("SELECT current_xp FROM attributes WHERE name = ?", (name,)).fetchone()["current_xp"]


def _set_xp(conn, **xp):
    for name, value in xp.items():
        conn.execute("UPDATE attributes SET current_xp = ? WHERE name = ?", (value, name))
    conn.commit()


def _past_streak(conn, days):
    """Ações (sem bônus: source 'form') nos `days` dias antes de hoje."""
    attr = conn.execute("SELECT id FROM attributes WHERE name = 'metas'").fetchone()["id"]
    for n in range(1, days + 1):
        d = datetime.date.today() - datetime.timedelta(days=n)
        log_id = new_id()
        conn.execute(
            "INSERT INTO action_logs (id, description, xp_gained, source, created_at) VALUES (?, 'x', 1, 'form', ?)",
            (log_id, datetime.datetime(d.year, d.month, d.day, 12).astimezone().isoformat()),
        )
        conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr))
    conn.commit()


def _all_equal_but(conn, lowest=None):
    """Todos os atributos com 100 xp, menos `lowest` (0 xp) — define quem está atrasado."""
    _set_xp(conn, aprendizado=100, carreira=100, financas=100, metas=100, organizacao=100)
    if lowest:
        _set_xp(conn, **{lowest: 0})


# ==================== regras ====================

def test_degraus_do_multiplicador():
    assert [multiplicador(d) for d in (0, 2, 3, 6, 7, 13, 14, 29, 30, 365)] == [
        1.0, 1.0, 1.1, 1.1, 1.2, 1.2, 1.3, 1.3, 1.5, 1.5,
    ]


def test_atributo_atrasado_e_empate(db_conn):
    assert atributo_atrasado(db_conn) is None  # conta nova: todos empatados
    _all_equal_but(db_conn, "carreira")
    assert atributo_atrasado(db_conn) == "carreira"


def test_primeira_acao_do_dia_ganha_5_so_uma_vez(db_conn):
    _all_equal_but(db_conn)
    register_action(db_conn, "marco", ["aprendizado"], 20, source="aprendizado")
    register_action(db_conn, "marco 2", ["aprendizado"], 20, source="aprendizado")
    assert _bonus(db_conn) == [("bônus · primeira ação do dia", 5)]
    assert _xp(db_conn, "aprendizado") == 100 + 20 + 5 + 20


def test_multiplicador_de_sequencia(db_conn):
    _all_equal_but(db_conn)
    _past_streak(db_conn, 13)  # hoje é o 14º dia → 1,3×
    register_action(db_conn, "marco", ["aprendizado"], 20, source="aprendizado")
    assert ("bônus · sequência de 14 dias 1,3×", 6) in _bonus(db_conn)


def test_atributo_atrasado_rende_2x(db_conn):
    _all_equal_but(db_conn, "financas")
    register_action(db_conn, "lançou", ["financas"], 3, source="financas")
    assert ("bônus · atributo atrasado 2×", 3) in _bonus(db_conn)
    register_action(db_conn, "link", ["organizacao"], 2, source="organizacao")
    assert sum(1 for d, _ in _bonus(db_conn) if "atrasado" in d) == 1


def test_bonus_somam_e_cada_um_tem_teto_de_20(db_conn):
    _all_equal_but(db_conn, "carreira")
    _past_streak(db_conn, 29)  # 30 dias → 1,5×
    register_action(db_conn, "nova posição", ["carreira"], 150, source="carreira")
    assert sorted(_bonus(db_conn)) == sorted([
        ("bônus · primeira ação do dia", 5),
        ("bônus · sequência de 30 dias 1,5×", 20),
        ("bônus · atributo atrasado 2×", 20),
    ])
    assert _xp(db_conn, "carreira") == 0 + 150 + 45


def test_acao_manual_do_nucleo_nao_ganha_bonus(client, db_conn):
    _all_equal_but(db_conn, "metas")
    resp = client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 50})
    assert resp.status_code == 200
    assert _bonus(db_conn) == []


def test_bonus_aparece_separado_no_log(client, db_conn):
    _all_equal_but(db_conn)
    client.post("/api/organizacao/links", json={"title": "a", "url": "https://a.com", "category": "c"})
    log = client.get("/api/nucleo/log").json()
    descs = [(l["description"], l["xp_gained"], l["source"]) for l in log]
    assert ("bônus · primeira ação do dia", 5, "bonus") in descs
    assert any(d.startswith("salvou") or "link" in d for d, _, s in descs if s == "organizacao")


# ==================== estorno e conquistas ====================

def test_desfazer_a_acao_estorna_os_bonus(client, db_conn):
    _all_equal_but(db_conn, "organizacao")
    link = client.post("/api/organizacao/links", json={"title": "a", "url": "https://a.com", "category": "c"}).json()
    assert _xp(db_conn, "organizacao") == 0 + 2 + 5 + 2
    client.delete(f"/api/organizacao/links/{link['id']}")
    assert _xp(db_conn, "organizacao") == 0
    assert _bonus(db_conn) == []


def test_primeira_acao_desfeita_passa_o_bonus_pra_proxima(db_conn):
    _all_equal_but(db_conn)
    register_action(db_conn, "a", ["aprendizado"], 20, source="aprendizado",
                    referencia_tipo="marco", referencia_id="m1")
    revert_actions(db_conn, "marco", "m1")
    register_action(db_conn, "b", ["aprendizado"], 20, source="aprendizado")
    assert _bonus(db_conn) == [("bônus · primeira ação do dia", 5)]


def test_bonus_nao_conta_nas_conquistas_de_contagem(db_conn):
    _all_equal_but(db_conn, "financas")
    register_action(db_conn, "lançou", ["financas"], 3, source="financas")
    assert len(_bonus(db_conn)) == 2
    assert achievement_progress(db_conn, {"type": "count_total", "count": 50})[0] == 1
    assert achievement_progress(db_conn, {"type": "count_by_attribute", "attribute": "financas", "count": 10})[0] == 1


def test_bonus_de_missao_nao_ganha_bonus(db_conn, missoes_ligadas):
    _all_equal_but(db_conn)
    today = datetime.date.today().isoformat()
    db_conn.execute(
        "INSERT INTO missoes (id, periodo, referencia, posicao, tipo, titulo, atributo, quantidade, xp_bonus, created_at) "
        "VALUES ('m', 'dia', ?, 0, 'link', 'salve um link', 'organizacao', 1, 10, ?)",
        (today, today),
    )
    db_conn.execute(
        "INSERT INTO missoes (id, periodo, referencia, posicao, tipo, titulo, atributo, quantidade, xp_bonus, created_at) "
        "VALUES ('s', 'semana', ?, 0, 'marcos', 'x', 'aprendizado', 99, 40, ?)",
        ((datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday())).isoformat(), today),
    )
    db_conn.commit()
    register_action(db_conn, "salvou link", ["organizacao"], 2, source="organizacao", referencia_tipo="link", referencia_id="l1")
    # ação (2) + primeira do dia (5) + missão (10) — a missão não gera outro bônus
    assert _xp(db_conn, "organizacao") == 100 + 2 + 5 + 10


def test_attributes_diz_qual_rende_2x(client, db_conn):
    assert not any(a["bonus_atrasado"] for a in client.get("/api/nucleo/attributes").json())
    _all_equal_but(db_conn, "metas")
    flags = {a["name"]: a["bonus_atrasado"] for a in client.get("/api/nucleo/attributes").json()}
    assert flags == {"aprendizado": False, "carreira": False, "financas": False, "metas": True, "organizacao": False}
