"""GAM-11: classe do jogador, derivada do atributo com mais xp (polímata se equilibrado)."""
from app.routers.nucleo import _player_class


def _set_xp(conn, **xp):
    conn.execute("UPDATE attributes SET current_xp = 0")
    for name, value in xp.items():
        conn.execute("UPDATE attributes SET current_xp = ? WHERE name = ?", (value, name))
    conn.commit()


def test_sem_xp_sem_classe(db_conn):
    assert _player_class(db_conn) is None


def test_classe_pelo_atributo_dominante(db_conn):
    for attr, cls in [("aprendizado", "erudito"), ("financas", "mercador"), ("carreira", "artífice"),
                      ("metas", "estrategista"), ("organizacao", "arquivista")]:
        _set_xp(db_conn, **{attr: 1000, "metas" if attr != "metas" else "carreira": 100})
        assert _player_class(db_conn) == cls


def test_polimata_quando_os_dois_maiores_estao_a_menos_de_15_por_cento(db_conn):
    _set_xp(db_conn, aprendizado=1000, financas=860)
    assert _player_class(db_conn) == "polímata"
    _set_xp(db_conn, aprendizado=1000, financas=850)  # exatamente 15%: ainda erudito
    assert _player_class(db_conn) == "erudito"


def test_player_expoe_a_classe(client, db_conn):
    _set_xp(db_conn, carreira=500)
    assert client.get("/api/nucleo/player").json()["player_class"] == "artífice"
