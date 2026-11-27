"""
Assistente edita, apaga, conclui/reabre e reordena (2026-11) — sempre pelo
cartão de prévia (princípio 4) e desfazível pelo lote:

- o modelo aponta a coisa pelo `ref` das leituras; ref que não existe
  volta pro modelo, nunca vira item;
- alterar mostra o antes; desfazer grava o antes de volta (o que a pessoa
  mexeu depois fica, a não ser que ela peça);
- apagar estorna o xp como a tela; desfazer devolve as linhas com os
  mesmos ids e o mesmo xp (trilha com marcos e meta ligada, hábito com
  marcas); lançamento volta pela rota de lançar (refaz o saldo);
- concluir marco/tarefa/hábito com o xp das rotas, e desfazer estorna;
- link: criar (o bug do retorno de 2026-11), alterar e apagar.
"""
import pytest

from app.assistente import edicao
from test_assistente_acoes import _aplicar, _eventos, _ligar, _pede, _propor, _xp, falso  # noqa: F401
from provedor_falso import openai_texto


def _trilha(client, nome="Java", marcos=("básico", "OO", "streams"), concluidos=1):
    t = client.post("/api/aprendizado/tracks", json={"name": nome, "general_goal": "API"}).json()
    ms = [client.post(f"/api/aprendizado/tracks/{t['id']}/milestones", json={"title": m}).json() for m in marcos]
    for m in ms[:concluidos]:
        client.put(f"/api/aprendizado/milestones/{m['id']}", json={"status": "concluido"})
    return t, ms


def _ref(id_):
    return edicao.ref(id_)


def _desfazer(client, lote, **extra):
    return client.post(f"/api/assistente/lotes/{lote['id']}/desfazer", json=extra).json()


# ── links: o bug ─────────────────────────────────────────────────────────

def test_cria_link_e_desfaz(client, db_conn, falso):
    _ligar(client, falso)
    xp = _xp(db_conn)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "link", "title": "docs do Python", "url": "https://docs.python.org", "category": "estudo"}])
    assert prop["itens"][0]["problema"] is None
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    row = db_conn.execute("SELECT * FROM links").fetchone()
    assert (row["title"], row["url"], row["category"], row["criado_por"]) == (
        "docs do Python", "https://docs.python.org", "estudo", "assistente")
    assert _xp(db_conn) > xp  # o mesmo xp de salvar à mão
    assert _desfazer(client, lote)["desfeitos"] == 1
    assert db_conn.execute("SELECT COUNT(*) FROM links").fetchone()[0] == 0 and _xp(db_conn) == xp


def test_link_sem_categoria_vem_com_problema(client, falso):
    _ligar(client, falso)
    _, _, prop, _ = _propor(client, falso, [{"type": "link", "title": "x", "url": "https://x.dev"}])
    assert prop["itens"][0]["problema"] == "erro.assistente.sem_categoria"


def test_altera_e_apaga_link(client, db_conn, falso):
    _ligar(client, falso)
    a = client.post("/api/organizacao/links", json={"title": "a", "url": "https://a.dev", "category": "x"}).json()
    b = client.post("/api/organizacao/links", json={"title": "b", "url": "https://b.dev", "category": "x"}).json()
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "link", "action": "update", "ref": _ref(a["id"]), "url": "https://a.com"},
        {"type": "link", "action": "delete", "ref": _ref(b["id"])}])
    assert prop["itens"][0]["antes"]["url"] == "https://a.dev" and prop["itens"][0]["dados"]["url"] == "https://a.com"
    lote = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert [r["url"] for r in db_conn.execute("SELECT url FROM links")] == ["https://a.com"]
    _desfazer(client, lote)
    assert sorted((r["id"], r["url"]) for r in db_conn.execute("SELECT id, url FROM links")) == sorted(
        [(a["id"], "https://a.dev"), (b["id"], "https://b.dev")])


# ── ref ──────────────────────────────────────────────────────────────────

def test_ref_que_nao_existe_volta_pro_modelo(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=_pede(("propose_actions", {"items": [
        {"type": "track", "action": "update", "ref": "abcdef12", "title": "novo"}]})))
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    ev = _eventos(client, "renomeia a trilha")
    assert not [e for e in ev if e["tipo"] == "proposta"]
    assert "no track with ref" in falso.recebidas[1]["json"]["messages"][-1]["content"]


def test_acha_pelo_nome_quando_o_modelo_nao_manda_o_ref(client, db_conn):
    """qwen3.5:4b: "renomeia a trilha 'Java'" vinha com o nome no lugar do ref."""
    t, ms = _trilha(client, nome="Java e Spring Boot", marcos=("Orientação a objetos", "Coleções", "Coleções e streams"))
    assert edicao.achar(db_conn, "trilha", "'java e spring boot'") == t["id"]
    assert edicao.achar(db_conn, "marco", "orientacao a OBJETOS") == ms[0]["id"]  # sem acento nem caixa
    assert edicao.achar(db_conn, "marco", "Coleções") == ms[1]["id"]  # exato ganha do parecido
    assert edicao.achar(db_conn, "marco", "streams") == ms[2]["id"]  # parecido, mas um só
    with pytest.raises(ValueError, match="more than one"):
        edicao.achar(db_conn, "marco", "ções")
    with pytest.raises(ValueError, match="no milestone"):
        edicao.achar(db_conn, "marco", "Docker")


def test_leituras_mandam_o_ref(client, db_conn):
    from app.assistente import ferramentas

    t, ms = _trilha(client)
    r = ferramentas._aprendizado(db_conn, {})["tracks"][0]
    assert r["ref"] == _ref(t["id"]) and [m["ref"] for m in r["milestones"]] == [_ref(m["id"]) for m in ms]
    assert edicao.achar(db_conn, "marco", r["milestones"][1]["ref"]) == ms[1]["id"]


# ── alterar ──────────────────────────────────────────────────────────────

def test_altera_trilha_e_marco_e_desfaz(client, db_conn, falso):
    _ligar(client, falso)
    t, ms = _trilha(client)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "track", "action": "update", "ref": _ref(t["id"]), "title": "Java 21", "status": "paused"},
        {"type": "milestone", "action": "update", "ref": _ref(ms[1]["id"]), "title": "Orientação a objetos"}])
    assert [i["problema"] for i in prop["itens"]] == [None, None]
    assert prop["itens"][0]["antes"]["nome"] == "Java" and prop["itens"][0]["dados"]["status"] == "pausada"
    # a pessoa corrige o depois no cartão
    lote = _aplicar(client, cid, mid, [{"indice": 0, "dados": {"nome": "Java 21 LTS"}}, {"indice": 1}]).json()["lote"]
    trilha = db_conn.execute("SELECT name, status FROM tracks").fetchone()
    assert tuple(trilha) == ("Java 21 LTS", "pausada")
    assert db_conn.execute("SELECT title FROM milestones WHERE id = ?", (ms[1]["id"],)).fetchone()[0] == "Orientação a objetos"
    assert _desfazer(client, lote)["desfeitos"] == 2
    assert tuple(db_conn.execute("SELECT name, status FROM tracks").fetchone()) == ("Java", "ativa")
    assert db_conn.execute("SELECT title FROM milestones WHERE id = ?", (ms[1]["id"],)).fetchone()[0] == "OO"


def test_alterar_sem_mudar_nada_vem_com_problema(client, falso):
    _ligar(client, falso)
    t, _ = _trilha(client)
    _, _, prop, _ = _propor(client, falso, [{"type": "track", "action": "update", "ref": _ref(t["id"]), "title": "Java"}])
    assert prop["itens"][0]["problema"] == "erro.assistente.nada_muda"


def test_altera_meta_com_prazo_vencido_sem_mexer_no_prazo(client, db_conn, falso):
    _ligar(client, falso)
    g = client.post("/api/metas", json={"title": "ler", "type": "leitura", "target_value": 10, "unit_label": "livros"}).json()
    db_conn.execute("UPDATE goals SET deadline = '2020-01-01' WHERE id = ?", (g["id"],))
    db_conn.commit()
    cid, mid, prop, _ = _propor(client, falso, [{"type": "goal", "action": "update", "ref": _ref(g["id"]), "target": 12}])
    assert prop["itens"][0]["problema"] is None  # o prazo antigo não é problema desta edição
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT target_value, deadline FROM goals").fetchone()[:] == (12.0, "2020-01-01")
    _desfazer(client, lote)
    assert db_conn.execute("SELECT target_value FROM goals").fetchone()[0] == 10.0


def test_o_que_a_pessoa_mexeu_depois_da_edicao_fica(client, db_conn, falso):
    _ligar(client, falso)
    t, _ = _trilha(client)
    cid, mid, _, _ = _propor(client, falso, [{"type": "track", "action": "update", "ref": _ref(t["id"]), "title": "B"}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    client.put(f"/api/aprendizado/tracks/{t['id']}", json={"name": "C"})
    assert client.get(f"/api/assistente/lotes/{lote['id']}").json()["itens"][0]["situacao"] == "editado"
    r = _desfazer(client, lote)
    assert (r["desfeitos"], r["mantidos"]) == (0, 1)
    assert db_conn.execute("SELECT name FROM tracks").fetchone()[0] == "C"


def test_nota_trancada_nao_se_altera(client, db_conn, falso):
    _ligar(client, falso)
    n = client.post("/api/organizacao/notas", json={"titulo": "segredo", "conteudo": "x"}).json()
    db_conn.execute("UPDATE notas SET trancada = 1 WHERE id = ?", (n["id"],))
    db_conn.commit()
    _, _, prop, _ = _propor(client, falso, [{"type": "note", "action": "delete", "ref": _ref(n["id"])}])
    assert prop["itens"][0]["problema"] == "erro.assistente.nota_trancada"


# ── apagar e devolver ────────────────────────────────────────────────────

def test_apaga_trilha_com_marcos_e_desfazer_devolve_tudo(client, db_conn, falso):
    _ligar(client, falso)
    xp0 = _xp(db_conn)
    t, ms = _trilha(client, concluidos=2)
    g = client.post("/api/metas", json={"title": "Java", "type": "aprendizado", "target_value": 3,
                                        "linked_track_id": t["id"]}).json()
    xp = _xp(db_conn)
    assert xp > xp0
    cid, mid, _, _ = _propor(client, falso, [{"type": "track", "action": "delete", "ref": _ref(t["id"])}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT COUNT(*) FROM milestones").fetchone()[0] == 0
    assert _xp(db_conn) == xp0  # a rota estornou o xp dos marcos
    assert db_conn.execute("SELECT linked_track_id FROM goals").fetchone()[0] is None
    assert _desfazer(client, lote)["desfeitos"] == 1
    assert [r["id"] for r in db_conn.execute("SELECT id FROM milestones ORDER BY position")] == [m["id"] for m in ms]
    assert [r["status"] for r in db_conn.execute("SELECT status FROM milestones ORDER BY position")] == [
        "concluido", "concluido", "pendente"]
    assert _xp(db_conn) == xp
    assert db_conn.execute("SELECT linked_track_id FROM goals WHERE id = ?", (g["id"],)).fetchone()[0] == t["id"]
    # e dá pra apagar e devolver de novo sem xp infinito
    client.delete(f"/api/aprendizado/tracks/{t['id']}")
    assert _xp(db_conn) == xp0


def test_apaga_habito_com_marcas_e_desfazer_devolve_o_xp(client, db_conn, falso):
    _ligar(client, falso)
    h = client.post("/api/habitos", json={"nome": "ler", "atributo": "aprendizado"}).json()
    client.post(f"/api/habitos/{h['id']}/marcar", json={})
    xp = _xp(db_conn)
    cid, mid, _, _ = _propor(client, falso, [{"type": "habit", "action": "delete", "ref": _ref(h["id"])}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _xp(db_conn) < xp and db_conn.execute("SELECT COUNT(*) FROM habitos_marcas").fetchone()[0] == 0
    _desfazer(client, lote)
    assert _xp(db_conn) == xp and db_conn.execute("SELECT COUNT(*) FROM habitos_marcas").fetchone()[0] == 1
    assert client.get("/api/habitos").json()[0]["feito_hoje"]


@pytest.fixture()
def conta(client):
    banco = client.post("/api/carteira/banks", json={"nome": "Nubank"}).json()
    return client.post(f"/api/carteira/banks/{banco['id']}/accounts", json={
        "nome": "conta", "possui_saldo": True, "saldo_atual": 1000.0}).json()["id"]


def _saldo(db, conta):
    return db.execute("SELECT saldo_atual FROM wallet_accounts WHERE id = ?", (conta,)).fetchone()[0]


def test_corrige_e_apaga_lancamento_e_desfaz(client, db_conn, falso, conta):
    _ligar(client, falso)
    a = client.post("/api/financas/transactions", json={"description": "mercado", "amount": 100, "type": "saida",
                                                        "category": "Mercado", "date": "2026-11-20", "conta_id": conta}).json()
    b = client.post("/api/financas/transactions", json={"description": "padaria", "amount": 20, "type": "saida",
                                                        "category": "Mercado", "date": "2026-11-21", "conta_id": conta}).json()
    xp = _xp(db_conn)
    assert _saldo(db_conn, conta) == 880
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "expense", "action": "update", "ref": _ref(a["id"]), "amount": 150},
        {"type": "expense", "action": "delete", "ref": _ref(b["id"])}])
    assert [i["problema"] for i in prop["itens"]] == [None, None]
    lote = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert _saldo(db_conn, conta) == 850
    _desfazer(client, lote)
    assert _saldo(db_conn, conta) == 880 and _xp(db_conn) == xp
    assert sorted((r["description"], r["amount"]) for r in db_conn.execute("SELECT * FROM transactions")) == [
        ("mercado", 100.0), ("padaria", 20.0)]


# ── concluir, reabrir, ordenar, marco em trilha que existe ───────────────

def test_conclui_marco_com_xp_e_desfaz(client, db_conn, falso):
    _ligar(client, falso)
    t, ms = _trilha(client, concluidos=0)
    xp = _xp(db_conn)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "milestone", "action": "complete", "ref": _ref(ms[0]["id"])},
        {"type": "milestone", "action": "reopen", "ref": _ref(ms[1]["id"])}])
    assert [i["problema"] for i in prop["itens"]] == [None, "erro.assistente.nada_muda"]
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _xp(db_conn) > xp
    _desfazer(client, lote)
    assert _xp(db_conn) == xp
    assert db_conn.execute("SELECT status FROM milestones WHERE id = ?", (ms[0]["id"],)).fetchone()[0] == "pendente"


def test_reordena_marcos_e_poe_marco_em_trilha_que_existe(client, db_conn, falso):
    _ligar(client, falso)
    t, ms = _trilha(client, concluidos=0)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "track", "action": "reorder", "ref": _ref(t["id"]), "milestone_order": [_ref(ms[2]["id"])]},
        {"type": "milestone", "title": "testes", "track_ref": _ref(t["id"])}])
    assert [m["titulo"] for m in prop["itens"][0]["dados"]["ordem"]] == ["streams", "básico", "OO"]
    lote = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert [r["title"] for r in db_conn.execute("SELECT title FROM milestones ORDER BY position")] == [
        "streams", "básico", "OO", "testes"]
    _desfazer(client, lote)
    assert [r["title"] for r in db_conn.execute("SELECT title FROM milestones ORDER BY position")] == ["básico", "OO", "streams"]


def test_renomear_e_reordenar_a_mesma_trilha_vao_juntos(client, db_conn, falso):
    _ligar(client, falso)
    t, ms = _trilha(client, concluidos=0)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "track", "action": "update", "ref": _ref(t["id"]), "title": "Java 21"},
        {"type": "track", "action": "reorder", "ref": _ref(t["id"]), "milestone_order": [_ref(ms[1]["id"])]}])
    assert [i["problema"] for i in prop["itens"]] == [None, None]
    lote = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert db_conn.execute("SELECT name FROM tracks").fetchone()[0] == "Java 21"
    assert _desfazer(client, lote)["desfeitos"] == 2
    assert db_conn.execute("SELECT name FROM tracks").fetchone()[0] == "Java"


def test_tarefas_concluir_renomear_apagar_e_desfazer(client, db_conn, falso):
    from app.routers.entrada import adicionar_tarefa

    for t in ("comprar café", "ligar pro banco", "lavar o carro"):
        adicionar_tarefa(db_conn, t)
    db_conn.commit()
    _ligar(client, falso)
    cid, mid, prop, _ = _propor(client, falso, [
        {"type": "task", "action": "complete", "ref": "comprar café"},
        {"type": "task", "action": "update", "ref": "ligar pro banco", "new_title": "ligar pro banco às 10h"},
        {"type": "task", "action": "delete", "ref": "lavar"}])
    assert [i["problema"] for i in prop["itens"]] == [None, None, None]
    lote = _aplicar(client, cid, mid, [{"indice": i} for i in range(3)]).json()["lote"]
    conteudo = db_conn.execute("SELECT conteudo FROM notas WHERE titulo = 'tarefas'").fetchone()[0]
    assert conteudo == "- [x] comprar café\n- [ ] ligar pro banco às 10h"
    assert _desfazer(client, lote)["desfeitos"] == 3
    conteudo = db_conn.execute("SELECT conteudo FROM notas WHERE titulo = 'tarefas'").fetchone()[0]
    assert conteudo == "- [ ] comprar café\n- [ ] ligar pro banco\n- [ ] lavar o carro"


def test_marca_habito_hoje_pelo_assistente(client, db_conn, falso):
    _ligar(client, falso)
    h = client.post("/api/habitos", json={"nome": "ler", "atributo": "aprendizado"}).json()
    xp = _xp(db_conn)
    cid, mid, _, _ = _propor(client, falso, [{"type": "habit", "action": "complete", "ref": _ref(h["id"])}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _xp(db_conn) > xp and client.get("/api/habitos").json()[0]["feito_hoje"]
    _desfazer(client, lote)
    assert _xp(db_conn) == xp and not client.get("/api/habitos").json()[0]["feito_hoje"]


def test_mesmo_item_duas_vezes_volta_pro_modelo(client, falso):
    _ligar(client, falso)
    t, _ = _trilha(client)
    falso.responder("/v1/chat/completions", sse=_pede(("propose_actions", {"items": [
        {"type": "track", "action": "update", "ref": _ref(t["id"]), "title": "a"},
        {"type": "track", "action": "delete", "ref": _ref(t["id"])}]})))
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    _eventos(client, "x")
    assert "only once per proposal" in falso.recebidas[1]["json"]["messages"][-1]["content"]
