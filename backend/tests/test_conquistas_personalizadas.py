"""GAM-14: conquistas personalizadas — área + contagem + palavra-chave opcional."""
import json

from app import database
from app.achievements import ACHIEVEMENT_SEED, seed_achievements
from app.actions import register_action


def _create(client, **kw):
    payload = {"title": "poliglota", "attribute": "aprendizado", "count": 2, "keyword": "inglês", **kw}
    return client.post("/api/nucleo/achievements/custom", json=payload)


def test_cria_e_aparece_na_galeria(client):
    resp = _create(client)
    assert resp.status_code == 201, resp.text
    a = resp.json()
    assert (a["title"], a["category"], a["rule_type"], a["unlocked"]) == ("poliglota", "aprendizado", "custom", False)
    assert a["description"] == '2 ações em aprendizado com "inglês"'
    assert (a["progress_current"], a["progress_target"]) == (0, 2)
    assert any(x["id"] == a["id"] for x in client.get("/api/nucleo/achievements").json())


def test_conta_so_acoes_de_verdade_com_a_palavra(client, db_conn):
    a = _create(client).json()
    register_action(db_conn, "estudou INGLÊS no app", ["aprendizado"], 5, source="aprendizado")
    register_action(db_conn, "estudou espanhol", ["aprendizado"], 5, source="aprendizado")  # sem a palavra
    register_action(db_conn, "inglês no carro", ["carreira"], 5, source="carreira")  # outra área
    register_action(db_conn, "inglês", ["aprendizado"], 5, source="form")  # manual do núcleo não conta
    register_action(db_conn, "bônus inglês", ["aprendizado"], 5, source="bonus", referencia_tipo="bonus", referencia_id="x")
    got = {x["id"]: x for x in client.get("/api/nucleo/achievements").json()}[a["id"]]
    assert (got["progress_current"], got["unlocked"]) == (1, False)

    register_action(db_conn, "aula de inglês", ["aprendizado"], 5, source="aprendizado")
    got = {x["id"]: x for x in client.get("/api/nucleo/achievements").json()}[a["id"]]
    assert got["unlocked"] is True


def test_qualquer_area_sem_palavra_e_desbloqueio_na_criacao(client, db_conn):
    for i in range(3):
        register_action(db_conn, f"x{i}", ["metas"], 5, source="metas")
    a = _create(client, title="três passos", attribute=None, count=3, keyword=None).json()
    assert (a["category"], a["unlocked"], a["description"]) == ("nucleo", True, "3 ações")


def test_validacao(client):
    assert _create(client, title="  ").status_code == 422
    assert _create(client, attribute="xadrez").status_code == 422
    assert _create(client, count=0).status_code == 422


def test_apaga_so_personalizada(client, db_conn):
    a = _create(client).json()
    assert client.delete(f"/api/nucleo/achievements/custom/{a['id']}").status_code == 204
    assert all(x["id"] != a["id"] for x in client.get("/api/nucleo/achievements").json())
    seed_id = db_conn.execute("SELECT id FROM achievements WHERE rule_type != 'custom' LIMIT 1").fetchone()["id"]
    assert client.delete(f"/api/nucleo/achievements/custom/{seed_id}").status_code == 404


def test_seed_nao_mexe_em_personalizada_com_titulo_igual(client, db_conn):
    a = _create(client, title=ACHIEVEMENT_SEED[0]["title"]).json()
    seed_achievements(db_conn)
    row = db_conn.execute("SELECT chave, criteria_json FROM achievements WHERE id = ?", (a["id"],)).fetchone()
    assert row["chave"] == f"custom:{a['id']}"
    assert json.loads(row["criteria_json"])["type"] == "custom_count"
    assert db_conn.execute("SELECT COUNT(*) AS c FROM achievements WHERE rule_type != 'custom'").fetchone()["c"] == len(ACHIEVEMENT_SEED)
