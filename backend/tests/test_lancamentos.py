"""
Corrigir e apagar lançamento e ação registrada à mão (CONF-07, P-12).

Antes não havia como desfazer um lançamento digitado errado: o erro ficava
no saldo e no xp pra sempre. Regras (docs/REGRAS-DE-NEGOCIO.md FIN-14..17,
XP-10):
  - apagar desfaz o efeito no saldo/fatura e estorna o xp;
  - corrigir troca o lançamento de uma vez — se o novo não passa na
    validação, o antigo fica exatamente como estava;
  - lançamento gerado por outro módulo só se desfaz pela origem (409).
"""
from app import database

MONTH = "2026-03"


def _bank_account(client, nome="corrente", saldo=1000.0, credito=False, limite=None):
    bank = client.post("/api/carteira/banks", json={"nome": f"banco {nome}"}).json()
    body = {"nome": nome, "possui_saldo": saldo is not None, "saldo_atual": saldo or 0, "possui_credito": credito}
    if credito:
        body |= {"limite_credito": limite or 5000, "fatura_atual": 0}
    resp = client.post(f"/api/carteira/banks/{bank['id']}/accounts", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _account(client, conta_id):
    for bank in client.get("/api/carteira/banks").json():
        for acc in bank["accounts"]:
            if acc["id"] == conta_id:
                return acc
    raise AssertionError("conta não encontrada")


def _xp(client):
    return next(a for a in client.get("/api/nucleo/attributes").json() if a["name"] == "financas")["current_xp"]


def _tx(client, conta_id, **extra):
    body = {"description": "mercado", "amount": 100.0, "type": "saida", "category": "alimentacao",
            "date": f"{MONTH}-10", "conta_id": conta_id, **extra}
    resp = client.post("/api/financas/transactions", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _list(client):
    return client.get("/api/financas/transactions", params={"month": MONTH}).json()


# ==================== apagar ====================

def test_fin_14_deleting_entrada_removes_money_and_xp(client):
    conta = _bank_account(client, saldo=1000)
    tx = _tx(client, conta["id"], type="entrada", description="salário", amount=500)
    assert _account(client, conta["id"])["saldo_atual"] == 1500 and _xp(client) == 3

    assert client.delete(f"/api/financas/transactions/{tx['id']}").status_code == 204
    assert _account(client, conta["id"])["saldo_atual"] == 1000
    assert _xp(client) == 0
    assert _list(client) == []
    assert client.get("/api/nucleo/log").json() == []


def test_fin_14_deleting_saida_returns_balance(client):
    conta = _bank_account(client, saldo=1000)
    tx = _tx(client, conta["id"], amount=300)
    client.delete(f"/api/financas/transactions/{tx['id']}")
    assert _account(client, conta["id"])["saldo_atual"] == 1000


def test_fin_14_deleting_credit_purchase_lowers_the_bill(client):
    conta = _bank_account(client, saldo=None, credito=True, limite=2000)
    tx = _tx(client, conta["id"], amount=250)
    assert _account(client, conta["id"])["fatura_atual"] == 250
    client.delete(f"/api/financas/transactions/{tx['id']}")
    assert _account(client, conta["id"])["fatura_atual"] == 0


def test_fin_14_deleting_transfers_restores_both_sides(client):
    origem = _bank_account(client, "origem", saldo=1000)
    destino = _bank_account(client, "destino", saldo=0)
    interna = _tx(client, origem["id"], type="transferencia", category="transferencia", amount=400,
                  conta_destino_id=destino["id"])
    externa = _tx(client, origem["id"], type="transferencia", category="transferencia", amount=100,
                  destino_externo="amigo")
    assert (_account(client, origem["id"])["saldo_atual"], _account(client, destino["id"])["saldo_atual"]) == (500, 400)

    client.delete(f"/api/financas/transactions/{interna['id']}")
    client.delete(f"/api/financas/transactions/{externa['id']}")
    assert (_account(client, origem["id"])["saldo_atual"], _account(client, destino["id"])["saldo_atual"]) == (1000, 0)


# ==================== corrigir ====================

def test_fin_15_correcting_amount_fixes_balance_and_keeps_one_xp(client):
    conta = _bank_account(client, saldo=1000)
    tx = _tx(client, conta["id"], amount=500)  # digitou 500 em vez de 50
    body = {"description": "mercado", "amount": 50.0, "type": "saida", "category": "alimentacao",
            "date": f"{MONTH}-10", "conta_id": conta["id"]}
    resp = client.put(f"/api/financas/transactions/{tx['id']}", json=body)
    assert resp.status_code == 200, resp.text
    novo = resp.json()
    assert novo["amount"] == 50
    assert _account(client, conta["id"])["saldo_atual"] == 950
    assert _xp(client) == 3
    log = client.get("/api/nucleo/log").json()
    assert len(log) == 1
    assert [t["id"] for t in _list(client)] == [novo["id"]]


def test_fin_15_correction_that_fails_validation_keeps_the_old_transaction(client):
    conta = _bank_account(client, saldo=100)
    tx = _tx(client, conta["id"], amount=80)
    body = {"description": "mercado", "amount": 5000.0, "type": "saida", "category": "alimentacao",
            "date": f"{MONTH}-10", "conta_id": conta["id"]}
    resp = client.put(f"/api/financas/transactions/{tx['id']}", json=body)
    assert resp.status_code == 422
    assert _account(client, conta["id"])["saldo_atual"] == 20
    assert [(t["id"], t["amount"]) for t in _list(client)] == [(tx["id"], 80)]
    assert _xp(client) == 3


def test_fin_15_correction_can_move_to_another_account(client):
    a = _bank_account(client, "a", saldo=1000)
    b = _bank_account(client, "b", saldo=1000)
    tx = _tx(client, a["id"], amount=200)
    body = {"description": "mercado", "amount": 200.0, "type": "saida", "category": "alimentacao",
            "date": f"{MONTH}-10", "conta_id": b["id"]}
    assert client.put(f"/api/financas/transactions/{tx['id']}", json=body).status_code == 200
    assert (_account(client, a["id"])["saldo_atual"], _account(client, b["id"])["saldo_atual"]) == (1000, 800)


# ==================== origem ====================

def test_fin_16_transaction_from_another_module_is_marked_and_only_undone_there(client):
    conta = _bank_account(client, saldo=1000)
    client.post("/api/financas/fixed-bills", json={"name": "Luz", "amount": 90, "due_day": 5, "conta_id": conta["id"]})
    period = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    import datetime

    month_now = datetime.date.today().strftime("%Y-%m")
    tx = next(t for m in {MONTH, month_now}
              for t in client.get("/api/financas/transactions", params={"month": m}).json())
    assert tx["origem"] == "conta fixa"

    resp = client.delete(f"/api/financas/transactions/{tx['id']}")
    assert resp.status_code == 409 and "conta fixa" in resp.json()["detail"]
    assert client.put(f"/api/financas/transactions/{tx['id']}", json={
        "description": "x", "amount": 1.0, "type": "saida", "category": "x", "date": f"{MONTH}-01", "conta_id": conta["id"],
    }).status_code == 409
    assert _account(client, conta["id"])["saldo_atual"] == 910  # nada mudou


def test_fin_16_manual_transaction_has_no_origin(client):
    conta = _bank_account(client)
    _tx(client, conta["id"])
    assert _list(client)[0]["origem"] is None


# ==================== lançamentos antigos (sem vínculo) ====================

def test_fin_17_migration_links_old_transaction_xp_so_deleting_refunds_it(client, db_conn):
    conta = _bank_account(client, saldo=1000)
    a = _tx(client, conta["id"], description="padaria", amount=10)
    b = _tx(client, conta["id"], description="padaria", amount=20)  # mesma descrição: liga pela ordem
    # simula o banco de antes do CONF-07: logs de lançamento sem vínculo
    db_conn.execute("UPDATE action_logs SET referencia_tipo = NULL, referencia_id = NULL WHERE referencia_tipo = 'transacao'")
    db_conn.commit()

    database._migrate_transacao_referencia(db_conn)
    database._migrate_transacao_referencia(db_conn)  # idempotente
    refs = [r["referencia_id"] for r in db_conn.execute(
        "SELECT referencia_id FROM action_logs WHERE referencia_tipo = 'transacao' ORDER BY created_at, rowid"
    ).fetchall()]
    assert refs == [a["id"], b["id"]]

    client.delete(f"/api/financas/transactions/{b['id']}")
    assert _xp(client) == 3


# ==================== ação registrada à mão ====================

def test_xp_10_deleting_manual_action_refunds_xp(client):
    log = client.post("/api/nucleo/actions", json={"description": "estudei", "categories": ["aprendizado", "carreira"], "xp": 20}).json()
    assert client.delete(f"/api/nucleo/actions/{log['id']}").status_code == 204
    attrs = {a["name"]: a["current_xp"] for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["aprendizado"] == 0 and attrs["carreira"] == 0
    assert client.get("/api/nucleo/log").json() == []


def test_xp_10_automatic_action_is_only_undone_at_its_origin(client):
    conta = _bank_account(client)
    _tx(client, conta["id"])
    log = client.get("/api/nucleo/log").json()[0]
    resp = client.delete(f"/api/nucleo/actions/{log['id']}")
    assert resp.status_code == 409
    assert _xp(client) == 3


def test_xp_10_deleting_manual_action_relocks_achievement(client):
    ids = [
        client.post("/api/nucleo/actions", json={"description": "x", "categories": ["financas"], "xp": 1}).json()["id"]
        for _ in range(15)
    ]
    unlocked = lambda: next(a for a in client.get("/api/nucleo/achievements").json() if a["key"] == "financas_15")["unlocked"]  # noqa: E731
    assert unlocked() is True
    client.delete(f"/api/nucleo/actions/{ids[0]}")
    assert unlocked() is False
