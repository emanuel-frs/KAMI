"""GAM-10 + 2.1.0: recompensas por nível — títulos e capacidades da aparência, validados pelo nível geral."""
from app.recompensas import titulo_atual
from app.xp import xp_for_level


def _nivel(conn, level):
    """Põe xp suficiente pro nível geral `level` (num atributo só)."""
    xp = sum(xp_for_level(n) for n in range(1, level)) if level > 1 else 0
    conn.execute("UPDATE attributes SET current_xp = 0")
    conn.execute("UPDATE attributes SET current_xp = ? WHERE name = 'metas'", (xp,))
    conn.commit()


def test_titulo_automatico_e_o_mais_alto_liberado():
    assert titulo_atual(None, 1) == "iniciante"
    assert titulo_atual(None, 12) == "operador"
    assert titulo_atual(None, 40) == "lenda"
    assert titulo_atual("aprendiz", 40) == "aprendiz"


def test_catalogo_marca_o_que_esta_liberado(client, db_conn):
    _nivel(db_conn, 5)
    data = client.get("/api/nucleo/recompensas").json()
    assert data["level"] == client.get("/api/nucleo/player").json()["level"]
    unlocked = {c["key"] for c in data["capacidades"] if c["unlocked"]}
    assert unlocked == {"texto_tingido", "cor_livre", "textura_crt"}
    assert "temas" not in data
    assert [t["key"] for t in data["titulos"] if t["unlocked"]] == ["iniciante", "aprendiz"]


def test_escolher_titulo_liberado(client, db_conn):
    _nivel(db_conn, 10)
    resp = client.put("/api/perfil", json={"titulo": "aprendiz"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["titulo"] == "aprendiz"
    assert client.get("/api/nucleo/player").json()["player_title"] == "aprendiz"
    # "auto" volta pro mais alto liberado
    client.put("/api/perfil", json={"titulo": "auto"})
    assert client.get("/api/nucleo/player").json()["player_title"] == "operador"


def test_nao_escolhe_titulo_acima_do_nivel_nem_desconhecido(client, db_conn):
    _nivel(db_conn, 3)
    assert client.put("/api/perfil", json={"titulo": "mestre"}).status_code == 422
    assert client.put("/api/perfil", json={"titulo": "rei"}).status_code == 422
