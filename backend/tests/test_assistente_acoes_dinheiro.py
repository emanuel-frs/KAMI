"""
IA-05b: ações com dinheiro, metas e planos — o modelo só propõe, a pessoa
aplica, e desfazer volta TUDO exatamente (saldo, fatura e xp).

- extrato colado (P-129): uma linha = um lançamento; a conta sugerida pelo
  nome e a forma de pagamento valem pro lote (P-136); linha que o modelo
  não entendeu vem marcada; lançamento que parece repetido vem desmarcado;
- saldo que não cobre no meio do lote → nada gravado, o índice volta;
- meta (P-137) e plano de estudo (P-131/P-138): trilha + marcos + meta de
  aprendizado ligada + evento na data do marco; dependentes só com a
  trilha; desfazer não leva marco que a pessoa já mexeu;
- invariantes (CONF-04): aplicar e desfazer deixa saldo, fatura e xp
  exatamente como estavam;
- P-139: cartão e CPF somem do que a pessoa escreveu antes de sair.
"""
import datetime as dt
import json

import pytest

from app import database
from app.assistente import conversas, ferramentas
from provedor_falso import ProvedorFalso, openai_texto


@pytest.fixture()
def falso():
    f = ProvedorFalso()
    yield f
    f.fechar()
    conversas.esquecer_memoria()


@pytest.fixture()
def carteira(client):
    banco = client.post("/api/carteira/banks", json={"nome": "Nubank"}).json()
    conta = client.post(f"/api/carteira/banks/{banco['id']}/accounts", json={
        "nome": "conta", "possui_saldo": True, "saldo_atual": 1000.0,
        "possui_credito": True, "fatura_atual": 0.0, "limite_total": 500.0, "dia_vencimento": 10}).json()
    outro = client.post("/api/carteira/banks", json={"nome": "Inter"}).json()
    so_saldo = client.post(f"/api/carteira/banks/{outro['id']}/accounts", json={
        "nome": "corrente", "possui_saldo": True, "saldo_atual": 50.0}).json()
    return {"nubank": conta["id"], "inter": so_saldo["id"]}


def _ligar(client, falso, **config):
    client.post("/api/assistente/provedores", json={"catalogo": "ollama", "url_base": falso.url, "modelo": "m"})
    assert client.put("/api/assistente/config", json={"ativo": True, **config}).json()["pronto"]


def _eventos(client, texto, **extra):
    with client.stream("POST", "/api/assistente/mensagens", json={"texto": texto, "idioma": "pt", **extra}) as r:
        return [json.loads(l[6:]) for l in r.iter_lines() if l.startswith("data: ")]


def _pede(nome, args):
    return [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "t0", "function": {"name": nome, "arguments": json.dumps(args)}}]}}]},
            {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}, "[DONE]"]


def _propor(client, falso, args, texto="lança isso"):
    falso.responder("/v1/chat/completions", sse=_pede("propose_actions", args))
    falso.responder("/v1/chat/completions", sse=openai_texto("Confira o cartão."))
    ev = _eventos(client, texto)
    prop = next(e for e in ev if e["tipo"] == "proposta")
    return ev[0]["conversa_id"], prop["mensagem_id"], prop["proposta"]


def _aplicar(client, cid, mid, indices, **extra):
    return client.post("/api/assistente/propostas/aplicar", json={
        "conversa_id": cid, "mensagem_id": mid, "itens": [{"indice": i} for i in indices], **extra})


def _foto(db):
    """O que tem que voltar exatamente depois de desfazer."""
    contas = [tuple(r) for r in db.execute("SELECT id, saldo_atual, fatura_atual FROM wallet_accounts ORDER BY id")]
    xp = [tuple(r) for r in db.execute("SELECT name, current_xp, current_level FROM attributes ORDER BY name")]
    perfil = tuple(db.execute("SELECT COUNT(*) FROM achievements WHERE unlocked_at IS NOT NULL").fetchone())
    tabelas = {t: db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
               for t in ("transactions", "goals", "tracks", "milestones", "calendar_events", "action_logs")}
    return contas, xp, perfil, tabelas


EXTRATO = {
    "account": "nubank", "payment": "credit",
    "items": [
        {"type": "expense", "title": "mercado", "amount": 120.5, "category": "alimentação", "date": "2026-10-20",
         "source_line": "20/10 SUPERMERCADO BOM 120,50"},
        {"type": "expense", "title": "uber", "amount": 23.9, "category": "transporte", "date": "2026-10-21"},
        {"type": "expense", "title": "?", "amount": 0, "category": "", "date": "2026-10-22", "unclear": True,
         "source_line": "22/10 PG *XPTO 4X"},
        {"type": "income", "title": "reembolso", "amount": 40, "category": "outros", "date": "2026-10-23"},
    ],
}


# ── extrato ──────────────────────────────────────────────────────────────

def test_extrato_vira_proposta_com_conta_e_forma_e_nada_e_gravado(client, db_conn, falso, carteira):
    _ligar(client, falso)
    antes = _foto(db_conn)
    _, _, prop = _propor(client, falso, EXTRATO)
    assert _foto(db_conn) == antes
    assert prop["conta_id"] == carteira["nubank"] and prop["forma"] == "credito"
    assert {c["nome"] for c in prop["contas"]} == {"conta", "corrente"}
    assert "saldo_atual" not in json.dumps(prop["contas"])
    itens = prop["itens"]
    assert [i["dados"]["tipo"] for i in itens] == ["saida", "saida", "saida", "entrada"]
    assert itens[0]["dados"] == {"descricao": "mercado", "valor": 120.5, "tipo": "saida", "categoria": "alimentação",
                                 "data": "2026-10-20"}
    assert itens[0]["linha"] == "20/10 SUPERMERCADO BOM 120,50"
    assert itens[2]["problema"] == "erro.assistente.linha_ilegivel" and itens[2]["linha"] == "22/10 PG *XPTO 4X"
    assert [i["problema"] for i in (itens[0], itens[1], itens[3])] == [None, None, None]


def test_aplicar_e_desfazer_o_extrato_volta_saldo_fatura_e_xp_exatos(client, db_conn, falso, carteira):
    _ligar(client, falso)
    antes = _foto(db_conn)
    cid, mid, _ = _propor(client, falso, EXTRATO)
    r = _aplicar(client, cid, mid, [0, 1, 3])
    assert r.status_code == 200, r.text
    conta = db_conn.execute("SELECT saldo_atual, fatura_atual FROM wallet_accounts WHERE id = ?", (carteira["nubank"],)).fetchone()
    assert conta["fatura_atual"] == pytest.approx(144.4) and conta["saldo_atual"] == pytest.approx(1040.0)
    assert db_conn.execute("SELECT COUNT(*) FROM transactions WHERE criado_por = 'assistente'").fetchone()[0] == 3
    # P-135: o mesmo xp do lançamento à mão (3 por lançamento, mais bônus do dia)
    assert db_conn.execute("SELECT COUNT(*) FROM action_logs WHERE referencia_tipo = 'transacao'").fetchone()[0] == 3
    lote = r.json()["lote"]
    r = client.post(f"/api/assistente/lotes/{lote['id']}/desfazer", json={}).json()
    assert r["desfeitos"] == 3
    assert _foto(db_conn) == antes


def test_trocar_conta_e_forma_no_cartao(client, db_conn, falso, carteira):
    _ligar(client, falso)
    cid, mid, _ = _propor(client, falso, EXTRATO)
    r = _aplicar(client, cid, mid, [1], conta_id=carteira["nubank"], forma_pagamento="saldo")
    assert r.status_code == 200
    conta = db_conn.execute("SELECT saldo_atual, fatura_atual FROM wallet_accounts WHERE id = ?", (carteira["nubank"],)).fetchone()
    assert conta["saldo_atual"] == pytest.approx(976.1) and conta["fatura_atual"] == 0
    assert r.json()["proposta"]["forma"] == "saldo"


def test_saldo_que_nao_cobre_no_meio_nao_grava_nada(client, db_conn, falso, carteira):
    _ligar(client, falso)
    antes = _foto(db_conn)
    cid, mid, _ = _propor(client, falso, {"account": "inter", "items": [
        {"type": "expense", "title": "a", "amount": 30, "category": "x", "date": "2026-10-20"},
        {"type": "expense", "title": "b", "amount": 30, "category": "x", "date": "2026-10-21"},
    ]})
    r = _aplicar(client, cid, mid, [0, 1])
    assert r.status_code == 422 and r.json()["vars"]["indice"] == 1
    assert _foto(db_conn) == antes
    assert db_conn.execute("SELECT COUNT(*) FROM assistente_lotes").fetchone()[0] == 0


def test_sem_forma_numa_conta_com_saldo_e_credito_e_problema(client, falso, carteira):
    _ligar(client, falso)
    _, _, prop = _propor(client, falso, {"account": "nubank", "items": [
        {"type": "expense", "title": "a", "amount": 10, "category": "x", "date": "2026-10-20"},
        {"type": "income", "title": "b", "amount": 10, "category": "x", "date": "2026-10-20"}]})
    assert prop["forma"] is None
    assert [i["problema"] for i in prop["itens"]] == ["erro.assistente.escolha_a_forma", None]


def test_lancamento_que_parece_repetido_vem_com_aviso(client, falso, carteira):
    _ligar(client, falso)
    client.post("/api/financas/transactions", json={"description": "mercado", "amount": 120.5, "type": "saida",
                                                    "category": "alimentação", "date": "2026-10-20",
                                                    "conta_id": carteira["nubank"], "forma_pagamento": "saldo"})
    _, _, prop = _propor(client, falso, EXTRATO)
    assert prop["itens"][0]["aviso"] == "assistente.proposta.parece_repetido" and prop["itens"][0]["problema"] is None
    assert prop["itens"][1]["aviso"] is None


def test_sem_conta_nenhuma(client, falso):
    _ligar(client, falso)
    _, _, prop = _propor(client, falso, {"items": [{"type": "expense", "title": "a", "amount": 10, "category": "x", "date": "2026-10-20"}]})
    assert prop["contas"] == [] and prop["itens"][0]["problema"] == "erro.assistente.escolha_a_conta"


def test_contas_e_categorias_so_nomes(client, db_conn, carteira):
    client.post("/api/financas/transactions", json={"description": "x", "amount": 1, "type": "saida", "category": "mercado",
                                                    "date": database.local_now().date().isoformat(),
                                                    "conta_id": carteira["inter"]})
    dado = ferramentas._contas_e_categorias(db_conn, {})
    assert {(c["bank"], c["name"], c["has_credit"]) for c in dado["accounts"]} == {("Nubank", "conta", True), ("Inter", "corrente", False)}
    assert dado["categories"] == ["mercado"]
    assert "1000" not in json.dumps(dado) and carteira["nubank"] not in json.dumps(dado)


# ── metas e plano de estudo ──────────────────────────────────────────────

def _daqui(dias: int) -> str:
    return (database.local_now().date() + dt.timedelta(days=dias)).isoformat()


D1, D2 = _daqui(14), _daqui(50)
PLANO = {"items": [{"type": "learning_plan", "title": "Rust", "content": "fazer um CLI", "milestones": [
    {"title": "o livro, cap. 1-6", "date": D1},
    {"title": "ownership e borrowing", "description": "exercícios do rustlings"},
    {"title": "projeto: um CLI", "date": D2}]}]}


def test_plano_vira_trilha_marcos_meta_e_eventos(client, db_conn, falso):
    _ligar(client, falso)
    antes = _foto(db_conn)
    cid, mid, prop = _propor(client, falso, PLANO, texto="monta um plano pra estudar Rust")
    tipos = [(i["tipo"], i.get("depende")) for i in prop["itens"]]
    assert tipos == [("trilha", None), ("marco", 0), ("marco", 0), ("marco", 0), ("meta", 0)]
    assert prop["itens"][4]["dados"]["tipo"] == "aprendizado" and prop["itens"][4]["dados"]["prazo"] == D2
    # marco sem a trilha não vai
    r = _aplicar(client, cid, mid, [1, 2])
    assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.depende_da_trilha"
    # a meta conta os marcos marcados
    r = _aplicar(client, cid, mid, [0, 1, 3, 4])
    assert r.status_code == 200, r.text
    trilha = db_conn.execute("SELECT * FROM tracks").fetchone()
    assert trilha["name"] == "Rust" and trilha["general_goal"] == "fazer um CLI" and trilha["criado_por"] == "assistente"
    assert [m["title"] for m in db_conn.execute("SELECT title FROM milestones ORDER BY position")] == ["o livro, cap. 1-6", "projeto: um CLI"]
    meta = db_conn.execute("SELECT * FROM goals").fetchone()
    assert (meta["type"], meta["target_value"], meta["linked_track_id"]) == ("aprendizado", 2, trilha["id"])
    eventos = [(e["title"], e["date"], e["notes"]) for e in db_conn.execute("SELECT * FROM calendar_events ORDER BY date")]
    assert eventos == [("o livro, cap. 1-6", D1, "Rust"), ("projeto: um CLI", D2, "Rust")]
    lote = r.json()["lote"]
    assert [i["tipo"] for i in lote["itens"]] == ["trilha", "marco", "evento", "marco", "evento", "meta"]
    client.post(f"/api/assistente/lotes/{lote['id']}/desfazer", json={})
    assert _foto(db_conn) == antes


def test_desfazer_plano_com_marco_concluido_mantem_trilha_e_marco(client, db_conn, falso):
    _ligar(client, falso)
    cid, mid, _ = _propor(client, falso, PLANO)
    lote = _aplicar(client, cid, mid, [0, 1, 2, 3, 4]).json()["lote"]
    marco = db_conn.execute("SELECT id FROM milestones ORDER BY position").fetchone()["id"]
    assert client.put(f"/api/aprendizado/milestones/{marco}", json={"status": "concluido"}).status_code == 200
    r = client.post(f"/api/assistente/lotes/{lote['id']}/desfazer", json={}).json()
    # o marco concluído (editado) fica, a meta andou (editada) fica, a trilha
    # fica porque tem marco; os outros 2 marcos e os 2 eventos saem
    assert r["desfeitos"] == 4 and r["mantidos"] == 3
    assert db_conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0] == 1
    assert db_conn.execute("SELECT COUNT(*) FROM milestones").fetchone()[0] == 1


def test_meta_financeira_com_conta_e_meta_invalida(client, db_conn, falso, carteira):
    _ligar(client, falso)
    cid, mid, prop = _propor(client, falso, {"items": [
        {"type": "goal", "title": "reserva", "goal_type": "financeira", "target": 5000, "deadline": _daqui(240)},
        {"type": "goal", "title": "ler 12 livros", "goal_type": "leitura", "target": 12, "unit_label": "livros"},
        {"type": "goal", "title": "sem alvo", "goal_type": "livre"}]})
    assert [i["problema"] for i in prop["itens"]] == [None, None, "erro.metas.alvo_precisa_ser_maior_zero"]
    assert "contas" in prop  # meta financeira pode ligar a uma conta
    r = client.post("/api/assistente/propostas/aplicar", json={"conversa_id": cid, "mensagem_id": mid, "itens": [
        {"indice": 0, "dados": {"conta_id": carteira["nubank"], "alvo": 6000}}, {"indice": 1}]})
    assert r.status_code == 200, r.text
    metas = {g["title"]: g for g in db_conn.execute("SELECT * FROM goals")}
    assert metas["reserva"]["linked_conta_id"] == carteira["nubank"] and metas["reserva"]["target_value"] == 6000
    assert metas["reserva"]["deadline"] == _daqui(240) and metas["ler 12 livros"]["unit_label"] == "livros"


def test_aprendizado_direto_nao_e_tipo_de_meta(client, falso):
    _ligar(client, falso)
    _, _, prop = _propor(client, falso, {"items": [{"type": "goal", "title": "x", "goal_type": "aprendizado", "target": 3}]})
    assert prop["itens"][0]["dados"]["tipo"] == "livre"


# ── P-139: números da pessoa ─────────────────────────────────────────────

def test_cartao_e_cpf_somem_antes_de_sair_e_valores_ficam(client, db_conn, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    texto = "lança: 20/10 mercado 120,50 no cartão 4111 1111 1111 1111, CPF 123.456.789-09, ag 1234 cc 56789-0"
    ev = _eventos(client, texto)
    masc = next(e for e in ev if e["tipo"] == "mascarado")
    assert masc["n"] == 3 and "4111" not in masc["texto"] and "120,50" in masc["texto"] and "20/10" in masc["texto"]
    enviado = json.dumps(falso.recebidas[0]["json"]["messages"], ensure_ascii=False)
    assert "4111" not in enviado and "123.456.789-09" not in enviado and "56789" not in enviado
    assert "120,50" in enviado
    cid = ev[0]["conversa_id"]
    guardado = client.get(f"/api/assistente/conversas/{cid}").json()
    assert "4111" not in json.dumps(guardado, ensure_ascii=False)
    assert "4111" not in json.dumps(client.get("/api/assistente/envios").json(), ensure_ascii=False)
    # texto sem nada pra mascarar: nenhum evento
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    assert not [e for e in _eventos(client, "gastei 45,90 no dia 21/10") if e["tipo"] == "mascarado"]


def test_data_que_ja_passou_no_plano_e_no_prazo_e_problema(client, falso):
    """Visto no teste do Emanuel: plano de 3 meses com marco em janeiro do
    ano corrente — o modelo errou o ano."""
    _ligar(client, falso)
    _, _, prop = _propor(client, falso, {"items": [
        {"type": "learning_plan", "title": "inglês", "milestones": [{"title": "a", "date": _daqui(30)}, {"title": "b", "date": _daqui(-270)}]},
        {"type": "goal", "title": "x", "goal_type": "livre", "target": 1, "deadline": _daqui(-1)}]})
    assert [i["problema"] for i in prop["itens"]] == [None, None, "erro.assistente.data_passada", None, "erro.assistente.data_passada"]
