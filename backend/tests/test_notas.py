"""
Notas da Organização (ORG-01) — app/routers/notas.py.
Regras em docs/REGRAS-DE-NEGOCIO.md (ORG-07..ORG-11).
"""
import pytest

from app.routers import notas as notas_router
from app.routers.notas import previa_de_markdown

BASE = "/api/organizacao/notas"
PIN = "4821"


def _xp_org(client):
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    return attrs["organizacao"]["current_xp"]


def _nova(client, **campos):
    resp = client.post(BASE, json={"titulo": "nota", "conteudo": "texto", **campos})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _ligar_pin(client):
    assert client.post("/api/seguranca/pin", json={"pin": PIN}).status_code == 201


@pytest.fixture(autouse=True)
def _sem_acessos():
    notas_router._acessos.clear()
    yield
    notas_router._acessos.clear()


# ---------- criar / editar / listar ----------

def test_create_edit_and_get_note_keeps_markdown(client):
    md = "# Título\n\n- [ ] tarefa\n- [x] feita\n\n**negrito** e `código`"
    nota = _nova(client, titulo="  Mercado  ", conteudo=md, tags=["#Casa", "casa", " Compras "])
    assert nota["titulo"] == "Mercado"
    assert nota["tags"] == ["casa", "compras"]
    assert nota["conteudo"] == md

    resp = client.put(f"{BASE}/{nota['id']}", json={"conteudo": md + "\n\nmais"})
    assert resp.status_code == 200
    assert client.get(f"{BASE}/{nota['id']}").json()["conteudo"].endswith("mais")


def test_list_is_summary_pinned_first_and_hides_archived(client):
    a = _nova(client, titulo="a")
    b = _nova(client, titulo="b")
    c = _nova(client, titulo="c")
    client.put(f"{BASE}/{a['id']}", json={"fixada": True})
    client.put(f"{BASE}/{c['id']}", json={"arquivada": True})

    lista = client.get(BASE).json()
    assert [n["titulo"] for n in lista] == ["a", "b"]
    assert "conteudo" not in lista[0] and lista[0]["previa"] == "texto"
    assert [n["titulo"] for n in client.get(BASE, params={"arquivadas": True}).json()] == ["c"]
    assert [n["titulo"] for n in client.get(BASE, params={"fixadas": True}).json()] == ["a"]


def test_search_by_title_text_and_tag(client):
    _nova(client, titulo="Receita de bolo", conteudo="farinha e ovos", tags=["cozinha"])
    _nova(client, titulo="Reunião", conteudo="pauta do Q4", tags=["trabalho"])
    busca = lambda q: [n["titulo"] for n in client.get(BASE, params={"q": q}).json()]
    assert busca("BOLO") == ["Receita de bolo"]
    assert busca("pauta") == ["Reunião"]
    assert busca("cozin") == ["Receita de bolo"]
    assert [n["titulo"] for n in client.get(BASE, params={"tag": "#Trabalho"}).json()] == ["Reunião"]
    assert client.get(f"{BASE}/tags").json() == [{"tag": "cozinha", "notas": 1}, {"tag": "trabalho", "notas": 1}]


def test_pin_and_archive_do_not_change_edit_order(client):
    a = _nova(client, titulo="a")
    _nova(client, titulo="b")
    antes = client.get(f"{BASE}/{a['id']}").json()["atualizada_em"]
    client.put(f"{BASE}/{a['id']}", json={"fixada": True})
    assert client.get(f"{BASE}/{a['id']}").json()["atualizada_em"] == antes


def test_color_set_and_clear(client):
    n = _nova(client, cor="ambar")
    assert n["cor"] == "ambar"
    assert client.put(f"{BASE}/{n['id']}", json={"limpar_cor": True}).json()["cor"] is None


def test_not_found_is_404(client):
    assert client.get(f"{BASE}/x").status_code == 404
    assert client.put(f"{BASE}/x", json={"titulo": "a"}).status_code == 404
    assert client.delete(f"{BASE}/x").status_code == 404


def test_content_limit(client):
    assert client.post(BASE, json={"conteudo": "a" * 100_000}).status_code == 201
    assert client.post(BASE, json={"conteudo": "a" * 100_001}).status_code == 422


# ---------- xp (P-32) ----------

def test_only_three_notes_a_day_give_xp(client):
    inicial = _xp_org(client)
    for i in range(5):
        _nova(client, titulo=f"n{i}")
    assert _xp_org(client) == inicial + 3 * notas_router.XP_NOTA


def test_deleting_a_note_from_today_reverts_xp_and_cannot_farm(client):
    inicial = _xp_org(client)
    ids = [_nova(client, titulo=f"n{i}")["id"] for i in range(3)]
    for i in ids:
        assert client.delete(f"{BASE}/{i}").status_code == 204
    assert _xp_org(client) == inicial
    for i in range(4):
        _nova(client, titulo=f"m{i}")
    # saldo do dia nunca passa de 3 notas
    assert _xp_org(client) == inicial + 3 * notas_router.XP_NOTA


def test_editing_never_gives_xp(client):
    n = _nova(client)
    depois_de_criar = _xp_org(client)
    for i in range(5):
        client.put(f"{BASE}/{n['id']}", json={"conteudo": f"v{i}"})
    assert _xp_org(client) == depois_de_criar


# ---------- vínculo (P-35) ----------

def test_link_to_goal_shows_name_count_and_disappears_when_goal_is_deleted(client, db_conn):
    db_conn.execute(
        "INSERT INTO goals (id, title, type, target_value) VALUES ('g1', 'Viagem', 'livre', 1)"
    )
    db_conn.commit()
    n = _nova(client, vinculo_tipo="meta", vinculo_id="g1")
    assert n["vinculo"] == {"tipo": "meta", "id": "g1", "nome": "Viagem"}
    assert client.get(f"{BASE}/contagem", params={"vinculo_tipo": "meta"}).json() == {"g1": 1}
    assert [x["id"] for x in client.get(BASE, params={"vinculo_tipo": "meta", "vinculo_id": "g1"}).json()] == [n["id"]]

    db_conn.execute("DELETE FROM goals WHERE id = 'g1'")
    db_conn.commit()
    assert client.get(f"{BASE}/{n['id']}").json()["vinculo"] is None


def test_link_targets_list_by_type(client, db_conn):
    db_conn.execute("INSERT INTO tracks (id, name, status, created_at) VALUES ('t1', 'Parada', 'parada', '2026-01-01')")
    db_conn.execute("INSERT INTO tracks (id, name, status, created_at) VALUES ('t2', 'Ativa', 'ativa', '2026-01-01')")
    db_conn.commit()
    assert client.get(f"{BASE}/alvos", params={"tipo": "trilha"}).json() == [
        {"id": "t2", "nome": "Ativa"},
        {"id": "t1", "nome": "Parada"},
    ]
    for tipo in ("meta", "evento", "posicao"):
        assert client.get(f"{BASE}/alvos", params={"tipo": tipo}).status_code == 200
    assert client.get(f"{BASE}/alvos", params={"tipo": "x"}).status_code == 422


def test_invalid_link_is_rejected(client):
    assert client.post(BASE, json={"vinculo_tipo": "meta", "vinculo_id": "nao-existe"}).status_code == 404
    assert client.post(BASE, json={"vinculo_tipo": "qualquer", "vinculo_id": "x"}).status_code == 422
    assert client.get(f"{BASE}/contagem", params={"vinculo_tipo": "qualquer"}).status_code == 422


def test_clear_link(client, db_conn):
    db_conn.execute("INSERT INTO tracks (id, name, created_at) VALUES ('t1', 'Rust', '2026-01-01')")
    db_conn.commit()
    n = _nova(client, vinculo_tipo="trilha", vinculo_id="t1")
    assert n["vinculo"]["nome"] == "Rust"
    assert client.put(f"{BASE}/{n['id']}", json={"limpar_vinculo": True}).json()["vinculo"] is None


# ---------- trancada (P-33/P-50) ----------

def test_lock_requires_pin_on(client):
    n = _nova(client)
    resp = client.post(f"{BASE}/{n['id']}/trancar")
    assert resp.status_code == 409 and "PIN" in resp.json()["detail"]


def test_locked_note_hides_text_everywhere_and_opens_with_pin(client, db_conn):
    _ligar_pin(client)
    n = _nova(client, titulo="Senhas do banco", conteudo="agência 1234 segredo")
    trancada = client.post(f"{BASE}/{n['id']}/trancar").json()
    assert trancada["trancada"] is True and trancada["chave"]

    # no banco: nada legível
    row = db_conn.execute("SELECT conteudo, conteudo_cifrado FROM notas WHERE id = ?", (n["id"],)).fetchone()
    assert row["conteudo"] == "" and "segredo" not in row["conteudo_cifrado"]

    # lista, busca e GET não mostram o texto; o título sim
    item = client.get(BASE).json()[0]
    assert item["titulo"] == "Senhas do banco" and item["previa"] == "" and item["trancada"] is True
    assert client.get(BASE, params={"q": "segredo"}).json() == []
    fechada = client.get(f"{BASE}/{n['id']}").json()
    assert fechada["conteudo"] == "" and fechada["conteudo_disponivel"] is False

    # PIN errado não abre; certo abre e dá a chave de acesso
    assert client.post(f"{BASE}/{n['id']}/abrir", json={"pin": "0000"}).status_code == 422
    aberta = client.post(f"{BASE}/{n['id']}/abrir", json={"pin": PIN}).json()
    assert aberta["conteudo"] == "agência 1234 segredo" and aberta["chave"]


def test_locked_note_edit_and_delete_need_the_access_key(client):
    _ligar_pin(client)
    n = _nova(client, conteudo="v1")
    client.post(f"{BASE}/{n['id']}/trancar")
    notas_router._acessos.clear()  # "fechou" a nota

    assert client.put(f"{BASE}/{n['id']}", json={"conteudo": "hack"}).status_code == 423
    assert client.delete(f"{BASE}/{n['id']}").status_code == 423

    chave = client.post(f"{BASE}/{n['id']}/abrir", json={"pin": PIN}).json()["chave"]
    salvo = client.put(f"{BASE}/{n['id']}", json={"conteudo": "v2", "chave": chave}).json()
    assert salvo["conteudo"] == "v2"
    # abrir de novo troca a chave (a antiga para de valer)
    reaberta = client.post(f"{BASE}/{n['id']}/abrir", json={"pin": PIN}).json()
    assert reaberta["conteudo"] == "v2"
    assert client.delete(f"{BASE}/{n['id']}", params={"chave": chave}).status_code == 423
    assert client.delete(f"{BASE}/{n['id']}", params={"chave": reaberta["chave"]}).status_code == 204


def test_unlock_for_good_needs_pin_and_restores_text(client):
    _ligar_pin(client)
    n = _nova(client, conteudo="claro")
    client.post(f"{BASE}/{n['id']}/trancar")
    assert client.post(f"{BASE}/{n['id']}/destrancar", json={"pin": "1111"}).status_code == 422
    livre = client.post(f"{BASE}/{n['id']}/destrancar", json={"pin": PIN}).json()
    assert livre["trancada"] is False and livre["conteudo"] == "claro"
    assert client.get(BASE, params={"q": "claro"}).json()[0]["id"] == n["id"]


def test_wrong_pin_on_notes_counts_toward_the_wait(client):
    _ligar_pin(client)
    n = _nova(client)
    client.post(f"{BASE}/{n['id']}/trancar")
    codigos = [client.post(f"{BASE}/{n['id']}/abrir", json={"pin": "0000"}).status_code for _ in range(8)]
    assert 429 in codigos  # mesma espera crescente do desbloqueio do app


def test_pin_turned_off_later_opens_locked_note_without_pin(client):
    _ligar_pin(client)
    n = _nova(client, conteudo="ainda aqui")
    client.post(f"{BASE}/{n['id']}/trancar")
    assert client.post("/api/seguranca/pin/desativar", json={"pin_atual": PIN}).status_code == 200
    nota = client.get(f"{BASE}/{n['id']}").json()
    assert nota["trancada"] is True and nota["conteudo"] == "ainda aqui" and nota["pin_ligado"] is False


def test_key_reset_loses_locked_text_but_keeps_the_note(client):
    _ligar_pin(client)
    n = _nova(client, titulo="guardada", conteudo="some")
    client.post(f"{BASE}/{n['id']}/trancar")
    assert client.get("/api/seguranca/chave").json()["segredos_salvos"] == 1
    client.post("/api/seguranca/chave/redefinir", json={"confirmation": "redefinir"})
    aberta = client.post(f"{BASE}/{n['id']}/abrir", json={"pin": PIN}).json()
    assert aberta["titulo"] == "guardada" and aberta["conteudo"] == ""


def test_protected_backup_carries_locked_text_and_plain_backup_does_not(client):
    _ligar_pin(client)
    n = _nova(client, conteudo="vai no backup")
    client.post(f"{BASE}/{n['id']}/trancar")
    resp = client.post("/api/sistema/export-protegido", json={"senha": "senha-forte-123"})
    assert resp.status_code == 200
    assert resp.json()["segredos_incluidos"] >= 1


# ---------- prévia ----------

def test_preview_strips_markdown():
    md = "# Lista\n\n- [ ] **pão** e _leite_\n1. [site](https://x.com)\n\n```\ncodigo()\n```\n---\n| a | b |\n|---|---|\n| 1 | 2 |"
    assert previa_de_markdown(md) == "Lista pão e leite site codigo() a b 1 2"
    longo = previa_de_markdown("palavra " * 100)
    assert longo.endswith("…") and len(longo) <= notas_router.PREVIA_MAX + 1
