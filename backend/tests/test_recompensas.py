"""GAM-10: recompensas por nível — títulos e temas de terminal, validados pelo nível geral."""
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
    _nivel(db_conn, 10)
    data = client.get("/api/nucleo/recompensas").json()
    assert data["level"] == client.get("/api/nucleo/player").json()["level"]
    unlocked = {t["key"] for t in data["temas"] if t["unlocked"]}
    assert unlocked == {"padrao", "fosforo", "crt"}
    assert [t["key"] for t in data["titulos"] if t["unlocked"]] == ["iniciante", "aprendiz", "operador"]


def test_escolher_titulo_e_tema_liberados(client, db_conn):
    _nivel(db_conn, 10)
    resp = client.put("/api/perfil", json={"titulo": "aprendiz", "tema": "crt"})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["titulo"], resp.json()["tema"]) == ("aprendiz", "crt")
    assert client.get("/api/nucleo/player").json()["player_title"] == "aprendiz"
    # "auto" volta pro mais alto liberado
    client.put("/api/perfil", json={"titulo": "auto"})
    assert client.get("/api/nucleo/player").json()["player_title"] == "operador"


def test_nao_escolhe_acima_do_nivel_nem_desconhecido(client, db_conn):
    _nivel(db_conn, 3)
    resp = client.put("/api/perfil", json={"tema": "ambar"})
    assert resp.status_code == 422
    assert "nível 15" in resp.json()["detail"]
    assert client.put("/api/perfil", json={"titulo": "rei"}).status_code == 422
    assert client.get("/api/perfil").json()["tema"] == "padrao"


def test_escolha_antiga_continua_se_o_nivel_cair(client, db_conn):
    _nivel(db_conn, 10)
    client.put("/api/perfil", json={"tema": "crt"})
    _nivel(db_conn, 1)
    # outro campo salvo não derruba o tema já escolhido
    assert client.put("/api/perfil", json={"display_name": "x"}).json()["tema"] == "crt"
