"""
2.1.0: aparência personalizável (app/aparencia.py)
— formato, padrão, tema antigo, nível de cada capacidade e backup.
"""
import json

from app import aparencia as ap
from app.xp import xp_for_level


def _nivel(conn, level):
    xp = sum(xp_for_level(n) for n in range(1, level)) if level > 1 else 0
    conn.execute("UPDATE attributes SET current_xp = 0")
    conn.execute("UPDATE attributes SET current_xp = ? WHERE name = 'metas'", (xp,))
    conn.commit()


def test_perfil_novo_vem_com_a_aparencia_padrao(client):
    a = client.get("/api/perfil").json()["aparencia"]
    assert a == ap.padrao()
    assert (a["paleta"], a["textura"], a["texto_tingido"]) == ("padrao", "scanline", False)
    assert a["textura_lugares"] == {"tela": True, "menu": True, "componentes": True}
    assert a["avatar"] == {"contorno": "#000000", "preenchimento": None}


def test_tema_antigo_vira_a_aparencia_equivalente(client, db_conn):
    for tema, esperado in (("fosforo", ("padrao", "scanline", True)), ("crt", ("padrao", "crt", False)),
                           ("ambar", ("ambar", "scanline", False)), ("padrao", ("padrao", "scanline", False))):
        db_conn.execute("UPDATE user_profile SET tema = ?, aparencia = NULL", (tema,))
        db_conn.commit()
        a = client.get("/api/perfil").json()["aparencia"]
        assert (a["paleta"], a["textura"], a["texto_tingido"]) == esperado, tema


def test_nivel_1_usa_o_que_e_livre(client, db_conn):
    _nivel(db_conn, 1)
    r = client.put("/api/perfil", json={"accent_color": "#C9A0DC", "aparencia": {"textura": "nenhuma"}})
    assert r.status_code == 200, r.text
    assert r.json()["accent_color"] == "#c9a0dc"
    assert r.json()["aparencia"]["textura"] == "nenhuma"
    # lugares e ajustes da textura também são livres
    r = client.put("/api/perfil", json={"aparencia": {
        "textura": "scanline", "textura_lugares": {"tela": True, "menu": False, "componentes": False},
        "textura_ajustes": {"scanline": {"esp": 6, "gros": 2, "int": 8}},
    }})
    assert r.status_code == 200, r.text
    assert r.json()["aparencia"]["textura_ajustes"]["scanline"] == {"esp": 6, "gros": 2, "int": 8}


def test_capacidade_acima_do_nivel_e_recusada(client, db_conn):
    _nivel(db_conn, 2)
    casos = [
        ({"aparencia": {"texto_tingido": True}}, "nível 3"),
        ({"accent_color": "#123456"}, "nível 4"),
        ({"aparencia": {"avatar": {"contorno": "#ffffff"}}}, "nível 4"),
        ({"aparencia": {"textura": "crt"}}, "nível 5"),
        ({"aparencia": {"calendario": {"evento": "#ff0000"}}}, "nível 6"),
        ({"aparencia": {"paleta": "ambar"}}, "nível 8"),
        ({"aparencia": {"fixos": {"--red": "#ff0000"}}}, "nível 10"),
        ({"aparencia": {"textura": "grade"}}, "nível 12"),
    ]
    for corpo, msg in casos:
        r = client.put("/api/perfil", json=corpo)
        assert r.status_code == 422, corpo
        assert msg in r.json()["detail"], corpo
    # nada mudou
    perfil = client.get("/api/perfil").json()
    assert perfil["accent_color"] == "#8fbf8f"
    assert perfil["aparencia"] == ap.padrao()
    # subindo pro 3, o texto tingido passa
    _nivel(db_conn, 3)
    assert client.put("/api/perfil", json={"aparencia": {"texto_tingido": True}}).status_code == 200


def test_paleta_personalizada_com_texto_pede_nivel_10(client, db_conn):
    _nivel(db_conn, 8)
    cores = {"bg": "#f2efe6", "superficie": "#e6e1d4", "borda": "#b5ab96", "texto": "#c9c9c9"}
    r = client.put("/api/perfil", json={"aparencia": {"paleta": "personalizada", "cores": cores}})
    assert r.status_code == 200, r.text
    assert r.json()["aparencia"]["cores"] == cores
    r = client.put("/api/perfil", json={"aparencia": {"paleta": "personalizada", "cores": {**cores, "texto": "#383228"}}})
    assert r.status_code == 422 and "nível 10" in r.json()["detail"]


def test_escolha_antiga_continua_se_o_nivel_cair(client, db_conn):
    _nivel(db_conn, 25)
    a = {"textura": "grade", "calendario": {"lembrete": "#AABBCC"}}
    assert client.put("/api/perfil", json={"accent_color": "#ff8800", "aparencia": a}).status_code == 200
    _nivel(db_conn, 1)
    # salvar outra coisa (ou a mesma aparência de novo) não derruba nada
    assert client.put("/api/perfil", json={"display_name": "x"}).status_code == 200
    r = client.put("/api/perfil", json={"aparencia": {**a, "textura_ajustes": {"grade": {"esp": 30, "gros": 3, "int": 5}}}})
    assert r.status_code == 200, r.text
    assert r.json()["aparencia"]["calendario"] == {"lembrete": "#aabbcc"}
    assert r.json()["accent_color"] == "#ff8800"
    # mas algo NOVO acima do nível não
    assert client.put("/api/perfil", json={"aparencia": {**a, "texto_tingido": True}}).status_code == 422


def test_formato_invalido(client, db_conn):
    _nivel(db_conn, 30)
    for corpo in (
        {"accent_color": "verde"},
        {"accent_color": "red; background:url(x)"},
        {"aparencia": {"paleta": "neon"}},
        {"aparencia": {"textura": "xadrez"}},
        {"aparencia": {"avatar": {"contorno": "preto"}}},
        {"aparencia": {"paleta": "personalizada", "cores": {"bg": "#000", "superficie": "#111111", "borda": "#222222", "texto": "#eeeeee"}}},
    ):
        assert client.put("/api/perfil", json=corpo).status_code == 422, corpo


def test_normalizar_descarta_o_desconhecido_e_o_fora_da_faixa():
    a = ap.normalizar({
        "paleta": "neon", "fixos": {"--red": "#FF0000", "--qualquer": "#000000", "--green": "verde"},
        "calendario": {"evento": "#123456", "festa": "#123456"},
        "textura_ajustes": {"grade": {"esp": 999, "gros": 7, "int": 0}, "pontilhado": {"esp": 4, "gros": 10, "int": 2}},
        "chave_do_futuro": 1,
    })
    assert a["paleta"] == "padrao"
    assert a["fixos"] == {"--red": "#ff0000"}
    assert a["calendario"] == {"evento": "#123456"}
    assert a["textura_ajustes"]["grade"] == {"esp": 8, "gros": 7, "int": 3}  # espessura < espaçamento
    assert a["textura_ajustes"]["pontilhado"] == {"esp": 4, "gros": 3, "int": 2}
    assert "chave_do_futuro" not in a


def test_aparencia_vai_e_volta_no_backup(client, db_conn):
    _nivel(db_conn, 30)
    a = {"paleta": "personalizada", "cores": {"bg": "#0b1020", "superficie": "#141a2e", "borda": "#303a5c", "texto": "#b8c0d8"},
         "textura": "pontilhado", "textura_lugares": {"tela": True, "menu": False, "componentes": True},
         "textura_ajustes": {"pontilhado": {"esp": 12, "gros": 3, "int": 6}},
         "avatar": {"contorno": "#2a1640", "preenchimento": "#f2d16b"}, "calendario": {"evento": "#ff8a3d"},
         "fixos": {"--red": "#ff5555"}, "texto_tingido": True}
    salvo = client.put("/api/perfil", json={"accent_color": "#ff8a3d", "aparencia": a}).json()["aparencia"]
    backup = client.get("/api/sistema/export").json()
    linha = backup["tables"]["user_profile"][0]
    assert json.loads(linha["aparencia"]) == salvo

    client.put("/api/perfil", json={"accent_color": "#8fbf8f", "aparencia": {}})
    assert client.get("/api/perfil").json()["aparencia"] == ap.padrao()

    r = client.post("/api/sistema/import", json={"confirmation": "importar", "tables": backup["tables"]})
    assert r.status_code == 200, r.text
    perfil = client.get("/api/perfil").json()
    assert perfil["aparencia"] == salvo
    assert perfil["accent_color"] == "#ff8a3d"


def test_backup_antigo_sem_aparencia_usa_o_tema(client):
    backup = client.get("/api/sistema/export").json()
    linha = backup["tables"]["user_profile"][0]
    linha.pop("aparencia", None)  # backup de antes da 2.1.0
    linha["tema"] = "ambar"
    r = client.post("/api/sistema/import", json={"confirmation": "importar", "tables": backup["tables"]})
    assert r.status_code == 200, r.text
    assert client.get("/api/perfil").json()["aparencia"]["paleta"] == "ambar"


def test_reset_volta_a_aparencia_padrao(client, db_conn):
    _nivel(db_conn, 30)
    client.put("/api/perfil", json={"aparencia": {"textura": "grade"}})
    client.post("/api/sistema/reset", json={"confirmation": "excluir"})
    assert client.get("/api/perfil").json()["aparencia"] == ap.padrao()
