"""
2.1.0 — o assistente alcança o resto do Kami pelo mesmo cartão:
contas fixas, assinaturas, compras parceladas, dívidas, fontes de renda,
transferências, contribuição pra meta, conquistas personalizadas, ações do
núcleo, carreira (interesses, posições, formações, salários) e GitHub.

Invariantes conferidas em cada tipo: o cartão mostra o item, aplicar grava
pela rota da tela (mesmo xp), e desfazer o lote volta saldo, fatura, xp e
as linhas exatamente como estavam.
"""
import pytest

from app import database
from app.assistente import edicao
from test_assistente_acoes import _aplicar, _eventos, _ligar, _pede, _propor, _xp, falso  # noqa: F401
from provedor_falso import openai_texto


@pytest.fixture()
def conta(client):
    banco = client.post("/api/carteira/banks", json={"nome": "Nubank"}).json()
    c = client.post(f"/api/carteira/banks/{banco['id']}/accounts", json={
        "nome": "conta", "possui_saldo": True, "saldo_atual": 1000.0,
        "possui_credito": True, "fatura_atual": 0.0, "limite_total": 5000.0, "dia_vencimento": 10}).json()
    return c["id"]


def _saldo(db, conta):
    r = db.execute("SELECT saldo_atual, fatura_atual FROM wallet_accounts WHERE id = ?", (conta,)).fetchone()
    return (round(r["saldo_atual"], 2), round(r["fatura_atual"] or 0, 2))


def _desfazer(client, lote, **extra):
    return client.post(f"/api/assistente/lotes/{lote['id']}/desfazer", json=extra).json()


def _contar(db, tabela, where="1 = 1"):
    return db.execute(f"SELECT COUNT(*) FROM {tabela} WHERE {where}").fetchone()[0]


def _ref(id_):
    return edicao.ref(id_)


def _prop(client, falso, itens):
    falso.limpar()  # cada proposta é uma conversa nova, com as respostas dela
    return _propor(client, falso, itens)


# ── o resumo financeiro colado: cada linha no lugar certo ────────────────

def test_resumo_financeiro_vira_cada_coisa_no_lugar_certo(client, db_conn, falso, conta):
    _ligar(client, falso)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "fixed_bill", "title": "aluguel", "amount": 1500, "day": 5, "account": "conta", "category": "moradia"},
        {"type": "income_source", "title": "salário", "amount": 5000, "frequency": "monthly",
         "pay_day_kind": "business_day", "business_day": 5, "account": "Nubank conta"},
        {"type": "subscription", "title": "Netflix", "amount": 39.9, "day": 12},
        {"type": "installment_purchase", "title": "geladeira", "amount": 3000, "installments": 10,
         "first_month": "2026-11", "account": "conta"},
        {"type": "debt", "title": "empréstimo do João", "counterparty": "João", "amount": 400},
    ])
    assert [i["problema"] for i in prop["itens"]] == [None] * 5, prop["itens"]
    assert prop["contas"] and prop["itens"][0]["dados"]["conta_id"] == conta
    assert [c["chave"] for c in prop["itens"][0]["campos"]][:3] == ["nome", "valor", "dia"]
    xp = _xp(db_conn)
    lote = _aplicar(client, cid, mid, [{"indice": i} for i in range(5)]).json()["lote"]
    assert _contar(db_conn, "fixed_bills") == _contar(db_conn, "income_sources") == _contar(db_conn, "wallet_subscriptions") == 1
    assert _contar(db_conn, "compras_parceladas") == _contar(db_conn, "debts") == 1
    assert _saldo(db_conn, conta) == (1000.0, 3000.0)  # a parcelada entra na fatura, como na tela
    assert _contar(db_conn, "transactions") == 0  # nada vira lançamento avulso
    assert _desfazer(client, lote)["desfeitos"] == 5
    for t in ("fixed_bills", "income_sources", "wallet_subscriptions", "compras_parceladas", "debts"):
        assert _contar(db_conn, t) == 0, t
    assert _saldo(db_conn, conta) == (1000.0, 0.0) and _xp(db_conn) == xp


def test_campo_obrigatorio_e_conta_de_credito_viram_problema(client, falso, conta):
    _ligar(client, falso)
    banco = client.post("/api/carteira/banks", json={"nome": "Inter"}).json()
    so_saldo = client.post(f"/api/carteira/banks/{banco['id']}/accounts", json={"nome": "corrente", "possui_saldo": True,
                                                                                  "saldo_atual": 10.0}).json()
    _, _, prop, _ = _prop(client, falso, [
        {"type": "fixed_bill", "title": "luz", "amount": 120},  # sem dia
        {"type": "installment_purchase", "title": "tv", "amount": 900, "installments": 3, "first_month": "2026-12",
         "account": "corrente"},  # conta sem crédito
        {"type": "income_source", "title": "bico", "amount": 300, "frequency": "once"},  # avulsa sem data
    ])
    assert prop["itens"][1]["dados"]["conta_id"] == so_saldo["id"]
    assert [i["problema"] for i in prop["itens"]] == [
        "erro.assistente.falta_campo", "erro.carteira.conta_vinculada_precisa_ter_credito", "erro.assistente.falta_campo"]


# ── pagar e receber ──────────────────────────────────────────────────────

def test_pagar_conta_fixa_e_receber_renda_e_desfazer(client, db_conn, falso, conta):
    _ligar(client, falso)
    b = client.post("/api/financas/fixed-bills", json={"name": "internet", "amount": 100, "due_day": 10, "conta_id": conta}).json()
    r = client.post("/api/financas/income-sources", json={"nome": "salário", "valor": 2000, "frequencia": "mensal",
                                                           "tipo_data": "dia_fixo", "dia_mes": 5, "conta_id": conta}).json()
    xp = _xp(db_conn)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "fixed_bill", "action": "complete", "ref": "internet", "payment": "balance"},
        {"type": "income_source", "action": "complete", "ref": _ref(r["id"]), "amount": 2100}])
    assert [i["problema"] for i in prop["itens"]] == [None, None], prop["itens"]
    assert prop["itens"][0]["dados"]["valor_pago"] == 100  # o previsto, editável
    lote = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert _saldo(db_conn, conta) == (1000 - 100 + 2100, 0.0)
    assert _xp(db_conn) > xp
    # pagar de novo o que já está pago: nada muda
    _, _, prop2, _ = _prop(client, falso, [{"type": "fixed_bill", "action": "complete", "ref": "internet", "payment": "balance"}])
    assert prop2["itens"][0]["problema"] == "erro.assistente.nada_muda"
    assert _desfazer(client, lote)["desfeitos"] == 2
    assert _saldo(db_conn, conta) == (1000.0, 0.0) and _xp(db_conn) == xp
    assert _contar(db_conn, "transactions") == 0
    assert b["id"] and _contar(db_conn, "fixed_bill_periods", "paga = 1") == 0


def test_conta_com_saldo_e_credito_pede_a_forma(client, falso, conta):
    _ligar(client, falso)
    client.post("/api/financas/fixed-bills", json={"name": "luz", "amount": 80, "due_day": 10, "conta_id": conta})
    _, _, prop, _ = _prop(client, falso, [{"type": "fixed_bill", "action": "complete", "ref": "luz"}])
    assert prop["itens"][0]["problema"] == "erro.assistente.escolha_a_forma"


def test_quitar_divida_por_uma_conta_e_reabrir(client, db_conn, falso, conta):
    _ligar(client, falso)
    d = client.post("/api/financas/debts", json={"description": "empréstimo", "amount": 300}).json()
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "debt", "action": "complete", "ref": "empréstimo", "account": "conta", "payment": "balance"}])
    assert prop["itens"][0]["problema"] is None
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT status FROM debts").fetchone()[0] == "paga" and _saldo(db_conn, conta)[0] == 700
    # reabrir pelo assistente também
    cid2, mid2, _, _ = _prop(client, falso, [{"type": "debt", "action": "reopen", "ref": _ref(d["id"])}])
    lote2 = _aplicar(client, cid2, mid2, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT status FROM debts").fetchone()[0] == "aberta" and _saldo(db_conn, conta)[0] == 1000
    _desfazer(client, lote2)  # paga de novo
    assert db_conn.execute("SELECT status FROM debts").fetchone()[0] == "paga"


# ── contribuir pra meta, transferir ──────────────────────────────────────

def test_contribuir_pra_meta_financeira_e_desfazer_exato(client, db_conn, falso, conta):
    _ligar(client, falso)
    g = client.post("/api/metas", json={"title": "viagem", "type": "financeira", "target_value": 1000,
                                        "linked_conta_id": conta}).json()
    xp = _xp(db_conn)
    cid, mid, prop, _ = _prop(client, falso, [{"type": "goal", "action": "contribute", "ref": "viagem", "amount": 250}])
    item = prop["itens"][0]
    assert item["problema"] is None and item["dados"]["conta_id"] == conta and item["dados"]["origem"] == "conta"
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT current_value FROM goals").fetchone()[0] == 250 and _saldo(db_conn, conta)[0] == 750
    assert _xp(db_conn) > xp
    assert _desfazer(client, lote)["desfeitos"] == 1
    assert db_conn.execute("SELECT current_value FROM goals").fetchone()[0] == 0
    assert _saldo(db_conn, conta)[0] == 1000 and _xp(db_conn) == xp
    assert _contar(db_conn, "goal_contributions") == _contar(db_conn, "transactions") == 0
    assert g["id"]


def test_contribuir_que_conclui_a_meta_volta_a_ativa(client, db_conn, falso):
    _ligar(client, falso)
    client.post("/api/metas", json={"title": "ler", "type": "leitura", "target_value": 2, "unit_label": "livros"})
    xp = _xp(db_conn)
    cid, mid, prop, _ = _prop(client, falso, [{"type": "goal", "action": "contribute", "ref": "ler", "amount": 2}])
    assert [c["chave"] for c in prop["itens"][0]["campos"]] == ["valor"]  # meta sem dinheiro: só a quantidade
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert db_conn.execute("SELECT status FROM goals").fetchone()[0] == "concluida"
    _desfazer(client, lote)
    assert db_conn.execute("SELECT status, current_value FROM goals").fetchone()[:] == ("ativa", 0)
    assert _xp(db_conn) == xp


def test_transferir_entre_contas_e_desfazer(client, db_conn, falso, conta):
    _ligar(client, falso)
    banco = client.post("/api/carteira/banks", json={"nome": "Inter"}).json()
    outra = client.post(f"/api/carteira/banks/{banco['id']}/accounts", json={"nome": "poupança", "possui_saldo": True,
                                                                              "saldo_atual": 0.0}).json()["id"]
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "transfer", "amount": 200, "account": "Nubank conta", "to_account": "poupança"}])
    assert prop["itens"][0]["problema"] is None and prop["itens"][0]["dados"]["data"]
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _saldo(db_conn, conta)[0] == 800 and _saldo(db_conn, outra)[0] == 200
    _desfazer(client, lote)
    assert _saldo(db_conn, conta)[0] == 1000 and _saldo(db_conn, outra)[0] == 0


def test_transferencia_sem_destino_e_mesma_conta(client, falso, conta):
    _ligar(client, falso)
    _, _, prop, _ = _prop(client, falso, [
        {"type": "transfer", "amount": 50, "account": "conta"},
        {"type": "transfer", "amount": 50, "account": "conta", "to_account": "conta"}])
    assert [i["problema"] for i in prop["itens"]] == ["erro.assistente.falta_campo", "erro.assistente.mesma_conta"]


# ── núcleo ───────────────────────────────────────────────────────────────

def test_conquista_personalizada_criar_alterar_apagar_e_desfazer(client, db_conn, falso):
    _ligar(client, falso)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "custom_achievement", "title": "maratonista", "attribute": "metas", "count": 3, "keyword": "corrida"}])
    assert prop["itens"][0]["problema"] is None
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    a = db_conn.execute("SELECT * FROM achievements WHERE rule_type = 'custom'").fetchone()
    assert a["title"] == "maratonista"
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "custom_achievement", "action": "update", "ref": "maratonista", "count": 5}])
    assert prop["itens"][0]["antes"]["quantidade"] == 3 and prop["itens"][0]["dados"]["quantidade"] == 5
    lote2 = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert '"count": 5' in db_conn.execute("SELECT criteria_json FROM achievements WHERE id = ?", (a["id"],)).fetchone()[0]
    _desfazer(client, lote2)
    assert '"count": 3' in db_conn.execute("SELECT criteria_json FROM achievements WHERE id = ?", (a["id"],)).fetchone()[0]
    # uma conquista do catálogo não é "personalizada": o assistente não acha
    fixa = db_conn.execute("SELECT title FROM achievements WHERE rule_type != 'custom' LIMIT 1").fetchone()[0]
    falso.limpar()
    falso.responder("/v1/chat/completions", sse=_pede(("propose_actions", {"items": [
        {"type": "custom_achievement", "action": "delete", "ref": fixa}]})))
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    _eventos(client, "apaga")
    assert "no custom achievement" in falso.recebidas[1]["json"]["messages"][-1]["content"]
    _desfazer(client, lote)
    assert _contar(db_conn, "achievements", "rule_type = 'custom'") == 0


def test_acao_do_nucleo_registrar_apagar_e_devolver_o_xp(client, db_conn, falso):
    _ligar(client, falso)
    xp = _xp(db_conn)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "core_action", "title": "ajudei um colega com o deploy", "attribute": "carreira", "xp": 15}])
    assert prop["itens"][0]["problema"] is None
    _aplicar(client, cid, mid, [{"indice": 0}])
    assert _xp(db_conn) == xp + 15
    log = db_conn.execute("SELECT id FROM action_logs WHERE source = 'form'").fetchone()["id"]
    cid, mid, _, _ = _prop(client, falso, [{"type": "core_action", "action": "delete", "ref": _ref(log)}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _xp(db_conn) == xp
    _desfazer(client, lote)
    assert _xp(db_conn) == xp + 15 and db_conn.execute("SELECT 1 FROM action_logs WHERE id = ?", (log,)).fetchone()
    # xp acima do teto do formulário: problema
    _, _, prop, _ = _prop(client, falso, [{"type": "core_action", "title": "x", "attribute": "metas", "xp": 80}])
    assert prop["itens"][0]["problema"] == "erro.assistente.xp_fora"


# ── carreira e GitHub ────────────────────────────────────────────────────

def test_carreira_posicao_formacao_salario_interesse(client, db_conn, falso):
    _ligar(client, falso)
    xp = _xp(db_conn)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "career_position", "role": "dev backend", "company": "ACME", "date": "2025-02-01", "employment_type": "CLT"},
        {"type": "education", "title": "Ciência da Computação", "institution": "UFX", "level": "bachelor", "status": "done"},
        {"type": "salary_record", "amount": 6000, "date": "2025-02-01", "content": "contratação"},
        {"type": "career_interest", "title": "Rust"}])
    assert [i["problema"] for i in prop["itens"]] == [None] * 4, prop["itens"]
    lote = _aplicar(client, cid, mid, [{"indice": i} for i in range(4)]).json()["lote"]
    assert _xp(db_conn) > xp  # formação concluída rende xp, como na tela
    pos = db_conn.execute("SELECT id FROM career_positions").fetchone()["id"]
    cid, mid, _, _ = _prop(client, falso, [
        {"type": "career_position", "action": "update", "ref": "dev backend", "role": "dev backend pleno"},
        {"type": "education", "action": "delete", "ref": "Ciência da Computação"}])
    lote2 = _aplicar(client, cid, mid, [{"indice": 0}, {"indice": 1}]).json()["lote"]
    assert db_conn.execute("SELECT role FROM career_positions").fetchone()[0] == "dev backend pleno"
    xp_meio = _xp(db_conn)
    _desfazer(client, lote2)
    assert db_conn.execute("SELECT role FROM career_positions WHERE id = ?", (pos,)).fetchone()[0] == "dev backend"
    assert _contar(db_conn, "career_educations") == 1 and _xp(db_conn) > xp_meio
    _desfazer(client, lote)
    for t in ("career_positions", "career_educations", "career_salary_records", "career_interests"):
        assert _contar(db_conn, t) == 0, t
    assert _xp(db_conn) == xp


def test_repositorio_github_formato(client, falso):
    _ligar(client, falso)
    _, _, prop, _ = _prop(client, falso, [{"type": "github_repo", "title": "nao-e-repo"}])
    assert prop["itens"][0]["problema"] == "erro.assistente.repo_invalido"


def test_apagar_conta_fixa_paga_e_devolver_com_o_historico(client, db_conn, falso, conta):
    _ligar(client, falso)
    b = client.post("/api/financas/fixed-bills", json={"name": "água", "amount": 60, "due_day": 3, "conta_id": conta}).json()
    mes = database.local_now().strftime("%Y-%m")
    periodo = next(p for p in client.get(f"/api/financas/fixed-bills/periods?month={mes}").json()
                   if p["fixed_bill_id"] == b["id"])
    client.put(f"/api/financas/fixed-bills/periods/{periodo['id']}/pay", json={"forma_pagamento": "saldo"})
    xp = _xp(db_conn)
    cid, mid, _, _ = _prop(client, falso, [{"type": "fixed_bill", "action": "delete", "ref": "água"}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _contar(db_conn, "fixed_bills") == 0 and _xp(db_conn) < xp
    _desfazer(client, lote)
    assert db_conn.execute("SELECT paga FROM fixed_bill_periods WHERE id = ?", (periodo["id"],)).fetchone()[0] == 1
    assert _xp(db_conn) == xp


# ── leituras: o ref e as conclusões que o Kami calcula ───────────────────

def test_leitura_de_financas_recorrentes(client, db_conn, conta):
    from app.assistente import ferramentas
    b = client.post("/api/financas/fixed-bills", json={"name": "aluguel", "amount": 1500, "due_day": 5, "conta_id": conta}).json()
    client.post("/api/carteira/subscriptions", json={"nome": "Netflix", "valor_esperado": 40, "dia_cobranca": 12})
    client.post("/api/financas/debts", json={"description": "João", "amount": 200})
    r = ferramentas._financas_recorrentes(db_conn, {})
    assert r["fixed_bills"][0]["ref"] == _ref(b["id"]) and r["fixed_bills"][0]["account"] == "Nubank conta"
    c = r["conclusions"]
    assert (c["monthly_bills_total"], c["still_to_pay_this_month"], c["open_debts_total"]) == (1540, 1540, 200)
    assert edicao.achar(db_conn, "conta_fixa", r["fixed_bills"][0]["ref"]) == b["id"]


def test_leitura_de_carreira_e_conquistas_personalizadas(client, db_conn):
    from app.assistente import ferramentas
    client.post("/api/carreira/posicoes", json={"company": "ACME", "role": "dev", "start_date": "2024-01-10"})
    client.post("/api/carreira/salarios", json={"amount": 5000, "date": "2024-01-10"})
    client.post("/api/carreira/salarios", json={"amount": 5500, "date": "2025-01-10"})
    r = ferramentas._carreira(db_conn, {})
    assert r["conclusions"]["current_position"]["company"] == "ACME" and r["conclusions"]["last_salary_change_pct"] == 10.0
    a = client.post("/api/nucleo/achievements/custom", json={"title": "x", "count": 2}).json()
    p = ferramentas._progresso(db_conn, {})
    assert p["custom_achievements"][0]["ref"] == _ref(a["id"])


def test_transferencia_aparece_na_busca_de_lancamentos(client, db_conn, falso, conta):
    from app.assistente import ferramentas
    _ligar(client, falso)
    cid, mid, _, _ = _prop(client, falso, [{"type": "transfer", "amount": 30, "account": "conta", "to_external": "Ana"}])
    _aplicar(client, cid, mid, [{"indice": 0}])
    r = ferramentas._achar_lancamentos(db_conn, {})
    assert [t["type"] for t in r["transactions"]] == ["transfer"]
    cid, mid, prop, _ = _prop(client, falso, [{"type": "transfer", "action": "delete", "ref": r["transactions"][0]["ref"]}])
    assert prop["itens"][0]["problema"] is None
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    assert _saldo(db_conn, conta)[0] == 1000
    _desfazer(client, lote)
    assert _saldo(db_conn, conta)[0] == 970


# ── calendário ───────────────────────────────────────────────────────────

def test_evento_com_repeticao_ate_e_aviso_criar_alterar_desfazer(client, db_conn, falso):
    _ligar(client, falso)
    amanha = (database.local_now().date() + __import__("datetime").timedelta(days=1)).isoformat()
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "event", "title": "inglês", "date": amanha, "time": "19:00", "repeat": "weekly",
         "repeat_until": "2027-06-30", "remind_minutes_before": 15}])
    assert prop["itens"][0]["problema"] is None
    _aplicar(client, cid, mid, [{"indice": 0}])
    ev = db_conn.execute("SELECT * FROM calendar_events").fetchone()
    assert (ev["recurrence"], ev["recurrence_end"], ev["reminder_minutes_before"]) == ("weekly", "2027-06-30", 15)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "event", "action": "update", "ref": "inglês", "time": "20:00", "remind_minutes_before": 30}])
    item = prop["itens"][0]
    assert (item["antes"]["aviso"], item["dados"]["aviso"], item["dados"]["ate"]) == ("15", "30", "2027-06-30")
    # a pessoa muda o aviso no cartão (o campo devolve texto) e vale o que ela pôs
    lote = _aplicar(client, cid, mid, [{"indice": 0, "dados": {"aviso": "45"}}]).json()["lote"]
    assert db_conn.execute("SELECT reminder_minutes_before FROM calendar_events").fetchone()[0] == 45
    _desfazer(client, lote)
    cid, mid, prop, _ = _prop(client, falso, [
        {"type": "event", "action": "update", "ref": "inglês", "time": "20:00", "remind_minutes_before": 30}])
    lote = _aplicar(client, cid, mid, [{"indice": 0}]).json()["lote"]
    ev = db_conn.execute("SELECT * FROM calendar_events").fetchone()
    assert (ev["time"], ev["reminder_minutes_before"], ev["recurrence_end"]) == ("20:00", 30, "2027-06-30")
    _desfazer(client, lote)
    ev = db_conn.execute("SELECT * FROM calendar_events").fetchone()
    assert (ev["time"], ev["reminder_minutes_before"]) == ("19:00", 15)
