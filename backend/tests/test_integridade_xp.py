"""
Integridade do XP: desfazer uma ação (desmarcar pagamento, reabrir,
apagar) estorna o log e o xp dela, e ações repetíveis têm limite
diário. Cada teste aqui reproduz um jeito de ganhar xp sem esforço
real que existia antes (ver app/actions.py::revert_actions).
"""
import sqlite3

from app import database

MONTH = "2026-03"


# ==================== helpers ====================

def _xp(client, attribute):
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    return attrs[attribute]["current_xp"]


def _log(client, **params):
    return client.get("/api/nucleo/log", params=params).json()


def _create_account(client, nome="conta teste", saldo_atual=1000):
    bank = client.post("/api/carteira/banks", json={"nome": f"banco {nome}"}).json()
    resp = client.post(
        f"/api/carteira/banks/{bank['id']}/accounts",
        json={"nome": nome, "possui_saldo": True, "saldo_atual": saldo_atual, "possui_credito": False},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_milestone(client):
    track = client.post("/api/aprendizado/tracks", json={"name": "Rust"}).json()
    ms = client.post(f"/api/aprendizado/tracks/{track['id']}/milestones", json={"title": "ler"}).json()
    return track, ms


def _set_milestone(client, ms_id, status):
    resp = client.put(f"/api/aprendizado/milestones/{ms_id}", json={"status": status})
    assert resp.status_code == 200, resp.text


GITHUB_BODY = {
    "full_name": "usuario/repo",
    "description": "app pessoal",
    "stargazers_count": 3,
    "open_issues_count": 1,
    "default_branch": "main",
    "pushed_at": "2026-03-01T10:00:00Z",
    "html_url": "https://github.com/usuario/repo",
}

EMAIL_ACCOUNT = {
    "label": "gmail",
    "imap_host": "imap.gmail.com",
    "imap_port": 993,
    "username": "voce@exemplo.com",
    "app_password": "secreta",
}


# ==================== pagamentos ====================

def test_pay_unpay_fixed_bill_does_not_farm_xp(client):
    conta = _create_account(client)
    client.post(
        "/api/financas/fixed-bills",
        json={"name": "Aluguel", "amount": 10, "due_day": 5, "conta_id": conta["id"]},
    )
    period = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]

    for _ in range(3):
        client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
        client.put(f"/api/financas/fixed-bills/periods/{period['id']}/unpay")
    assert _xp(client, "financas") == 0
    assert _log(client) == []

    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    assert _xp(client, "financas") == 4


def test_paying_already_paid_fixed_bill_twice_credits_once(client):
    conta = _create_account(client)
    client.post(
        "/api/financas/fixed-bills",
        json={"name": "Aluguel", "amount": 10, "due_day": 5, "conta_id": conta["id"]},
    )
    period = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    assert _xp(client, "financas") == 4


def test_pay_unpay_subscription_does_not_farm_xp(client):
    conta = _create_account(client)
    client.post(
        "/api/carteira/subscriptions",
        json={"nome": "Revista", "valor_esperado": 25.0, "dia_cobranca": 10, "conta_id": conta["id"]},
    )
    period = client.get("/api/carteira/subscriptions/periods", params={"month": MONTH}).json()[0]

    client.put(f"/api/carteira/subscriptions/periods/{period['id']}/pay", json={})
    assert _xp(client, "financas") == 4
    client.put(f"/api/carteira/subscriptions/periods/{period['id']}/unpay")
    assert _xp(client, "financas") == 0
    assert _log(client) == []


def test_pay_unpay_income_does_not_farm_xp(client):
    conta = _create_account(client)
    source = client.post(
        "/api/financas/income-sources",
        json={
            "nome": "freela", "valor": 500, "conta_id": conta["id"],
            "frequencia": "mensal", "tipo_data": "dia_fixo", "dia_mes": 10,
        },
    ).json()
    entries = client.get("/api/financas/income-entries", params={"month": MONTH}).json()
    entry = next(e for e in entries if e["income_source_id"] == source["id"])

    client.put(f"/api/financas/income-entries/{entry['id']}/pay", json={})
    assert _xp(client, "financas") == 4
    client.put(f"/api/financas/income-entries/{entry['id']}/unpay")
    assert _xp(client, "financas") == 0
    assert _log(client) == []


# ==================== apagar cadastro recorrente (P-14, CONF-04) ====================
# Apagar a conta fixa / assinatura / fonte de renda estorna o xp dos meses
# pagos (antes ficava: criar, pagar, apagar e recriar rendia xp de novo).
# As transações reais lançadas continuam em Finanças.

def _transactions(client):
    """Transações do mês do período E do mês atual (o pagamento é lançado com a data de hoje)."""
    import datetime

    months = {MONTH, datetime.date.today().strftime("%Y-%m")}
    return [t for m in months for t in client.get("/api/financas/transactions", params={"month": m}).json()]


def test_fin_12_deleting_fixed_bill_refunds_paid_months_but_keeps_transaction(client):
    conta = _create_account(client)
    bill = client.post(
        "/api/financas/fixed-bills",
        json={"name": "Aluguel", "amount": 10, "due_day": 5, "conta_id": conta["id"]},
    ).json()
    period = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    assert _xp(client, "financas") == 4

    assert client.delete(f"/api/financas/fixed-bills/{bill['id']}").status_code == 200
    assert _xp(client, "financas") == 0
    assert _log(client) == []
    assert len(_transactions(client)) == 1  # o dinheiro saiu de verdade


def test_fin_12_deleting_subscription_refunds_paid_months_but_keeps_transaction(client):
    conta = _create_account(client)
    sub = client.post(
        "/api/carteira/subscriptions",
        json={"nome": "Revista", "valor_esperado": 25.0, "dia_cobranca": 10, "conta_id": conta["id"]},
    ).json()
    period = client.get("/api/carteira/subscriptions/periods", params={"month": MONTH}).json()[0]
    client.put(f"/api/carteira/subscriptions/periods/{period['id']}/pay", json={})
    assert _xp(client, "financas") == 4

    assert client.delete(f"/api/carteira/subscriptions/{sub['id']}").status_code == 200
    assert _xp(client, "financas") == 0
    assert len(_transactions(client)) == 1


def test_fin_12_deleting_income_source_refunds_received_entries_but_keeps_transaction(client):
    conta = _create_account(client)
    source = client.post(
        "/api/financas/income-sources",
        json={
            "nome": "freela", "valor": 500, "conta_id": conta["id"],
            "frequencia": "mensal", "tipo_data": "dia_fixo", "dia_mes": 10,
        },
    ).json()
    entries = client.get("/api/financas/income-entries", params={"month": MONTH}).json()
    entry = next(e for e in entries if e["income_source_id"] == source["id"])
    client.put(f"/api/financas/income-entries/{entry['id']}/pay", json={})
    assert _xp(client, "financas") == 4

    assert client.delete(f"/api/financas/income-sources/{source['id']}").status_code == 200
    assert _xp(client, "financas") == 0
    assert len(_transactions(client)) == 1


def test_fin_12_recreating_and_paying_again_does_not_farm_xp(client):
    """O jeito de farmar que existia: criar, pagar, apagar, recriar, pagar..."""
    conta = _create_account(client)
    for _ in range(3):
        bill = client.post(
            "/api/financas/fixed-bills",
            json={"name": "Aluguel", "amount": 10, "due_day": 5, "conta_id": conta["id"]},
        ).json()
        period = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]
        client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
        client.delete(f"/api/financas/fixed-bills/{bill['id']}")
    assert _xp(client, "financas") == 0


# ==================== aprendizado ====================

def test_reopening_milestone_removes_completion_log(client):
    _, ms = _create_milestone(client)
    for _ in range(3):
        _set_milestone(client, ms["id"], "concluido")
        _set_milestone(client, ms["id"], "pendente")
    assert _xp(client, "aprendizado") == 0
    assert _log(client) == []


def test_completed_to_esquecido_and_back_does_not_farm_xp(client):
    _, ms = _create_milestone(client)
    for _ in range(3):
        _set_milestone(client, ms["id"], "concluido")
        _set_milestone(client, ms["id"], "esquecido")
    _set_milestone(client, ms["id"], "concluido")
    assert _xp(client, "aprendizado") == 20
    assert len(_log(client)) == 1


def test_deleting_completed_milestone_refunds_xp(client):
    _, ms = _create_milestone(client)
    _set_milestone(client, ms["id"], "concluido")
    client.delete(f"/api/aprendizado/milestones/{ms['id']}")
    assert _xp(client, "aprendizado") == 0


def test_deleting_track_refunds_completed_milestones(client):
    track, ms = _create_milestone(client)
    _set_milestone(client, ms["id"], "concluido")
    client.delete(f"/api/aprendizado/tracks/{track['id']}")
    assert _xp(client, "aprendizado") == 0
    assert _log(client) == []


def test_count_achievement_ignores_reverted_completions(client):
    _, ms = _create_milestone(client)
    for _ in range(10):
        _set_milestone(client, ms["id"], "concluido")
        _set_milestone(client, ms["id"], "pendente")
    achievements = {a["title"]: a for a in client.get("/api/nucleo/achievements").json()}
    assert achievements["10 em aprendizado"]["unlocked"] is False


def test_legacy_completion_without_reference_still_debits_xp(client, db_conn):
    _, ms = _create_milestone(client)
    _set_milestone(client, ms["id"], "concluido")
    # simula um marco concluído antes da migração: log sem referência
    db_conn.execute("UPDATE action_logs SET referencia_tipo = NULL, referencia_id = NULL")
    db_conn.commit()

    _set_milestone(client, ms["id"], "pendente")
    assert _xp(client, "aprendizado") == 0
    assert len(_log(client)) == 1  # log legado fica no histórico


# ==================== organização ====================

def test_add_and_delete_link_does_not_farm_xp(client):
    for _ in range(3):
        link = client.post(
            "/api/organizacao/links",
            json={"title": "docs", "url": "https://exemplo.com", "category": "dev"},
        ).json()
        client.delete(f"/api/organizacao/links/{link['id']}")
    assert _xp(client, "organizacao") == 0


def test_github_manual_sync_credits_once_per_day(client, mock_github_urlopen):
    mock_github_urlopen(json_body=GITHUB_BODY)
    repo = client.post("/api/organizacao/github-repos", json={"repo_full_name": "usuario/repo"}).json()
    assert _xp(client, "organizacao") == 3  # conectar

    for _ in range(5):
        client.put(f"/api/organizacao/github-repos/{repo['id']}/sync")
    assert _xp(client, "organizacao") == 6  # + 1 sync no dia


def test_github_delete_and_readd_does_not_reset_daily_sync_limit(client, mock_github_urlopen):
    mock_github_urlopen(json_body=GITHUB_BODY)
    for _ in range(3):
        repo = client.post("/api/organizacao/github-repos", json={"repo_full_name": "usuario/repo"}).json()
        client.put(f"/api/organizacao/github-repos/{repo['id']}/sync")
        client.delete(f"/api/organizacao/github-repos/{repo['id']}")
    # conectar é estornado ao remover; o sync do dia conta uma vez só
    assert _xp(client, "organizacao") == 3


def test_email_manual_sync_credits_once_per_day(client, isolated_fernet_key, mock_imap):
    account = client.post("/api/organizacao/email-accounts", json=EMAIL_ACCOUNT).json()
    for _ in range(4):
        mock_imap(messages=[])
        client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")
    assert _xp(client, "organizacao") == 3


# ==================== metas ====================

def test_goal_contribution_xp_once_per_day(client):
    goal = client.post("/api/metas", json={"title": "viagem", "type": "livre", "target_value": 100}).json()
    for _ in range(5):
        client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    assert _xp(client, "metas") == 5

    # a conclusão ainda rende o bônus, mesmo no mesmo dia
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 95})
    assert _xp(client, "metas") == 5 + 30


def test_deleting_goal_refunds_contributions_and_bonus(client):
    for _ in range(3):
        goal = client.post(
            "/api/metas", json={"title": "x", "type": "livre", "target_value": 1, "weight": "epico"}
        ).json()
        client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
        client.delete(f"/api/metas/{goal['id']}")
    assert _xp(client, "metas") == 0
    assert _log(client) == []


# ==================== núcleo ====================

def test_manual_action_xp_is_capped(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "x", "categories": ["metas"], "xp": 1_000_000},
    )
    assert resp.status_code == 422
    resp = client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 50})
    assert resp.status_code == 200


def test_repeated_category_counts_once(client):
    resp = client.post(
        "/api/nucleo/actions",
        json={"description": "x", "categories": ["metas", "metas", "metas"], "xp": 10},
    )
    assert resp.status_code == 200
    assert resp.json()["categories"] == ["metas"]
    assert _xp(client, "metas") == 10


# ==================== migração ====================

def test_migration_adds_reference_columns_to_old_database(temp_db_path):
    conn = sqlite3.connect(temp_db_path)
    conn.execute(
        "CREATE TABLE action_logs (id TEXT PRIMARY KEY, description TEXT NOT NULL, "
        "xp_gained INTEGER NOT NULL, impact_note INTEGER, source TEXT NOT NULL DEFAULT 'form', "
        "created_at TEXT NOT NULL)"
    )
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, created_at) "
        "VALUES ('antigo', 'ação antiga', 5, '2026-01-01T10:00:00')"
    )
    conn.commit()
    conn.close()

    database.init_db()

    conn = database.get_connection()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(action_logs)").fetchall()}
    assert {"referencia_tipo", "referencia_id"} <= cols
    row = conn.execute("SELECT * FROM action_logs WHERE id = 'antigo'").fetchone()
    assert row["referencia_tipo"] is None
    conn.close()
