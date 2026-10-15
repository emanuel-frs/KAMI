"""
Revisão de xp (app/revisao_xp.py): corrige logs gravados antes de
action_logs ter referência. Os testes simulam esses logs "antigos"
inserindo direto no banco, sem referência, e creditando o xp no atributo
do mesmo jeito que o register_action antigo fazia.
"""
import datetime
from pathlib import Path

from app import database
from app.database import new_id, now_iso


# ==================== helpers ====================

def _legacy_log(conn, description, source, attribute, xp, created_at=None):
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at) VALUES (?, ?, ?, ?, ?)",
        (log_id, description, xp, source, created_at or now_iso()),
    )
    attr = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr["id"]))
    conn.execute("UPDATE attributes SET current_xp = current_xp + ? WHERE id = ?", (xp, attr["id"]))
    conn.commit()
    return log_id


def _strip_references(conn):
    conn.execute("UPDATE action_logs SET referencia_tipo = NULL, referencia_id = NULL")
    conn.commit()


def _xp(client, attribute):
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    return attrs[attribute]["current_xp"]


def _logs(conn, like):
    return conn.execute("SELECT * FROM action_logs WHERE description LIKE ?", (like,)).fetchall()


def _apply(client):
    resp = client.post("/api/nucleo/xp-review")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_account(client):
    bank = client.post("/api/carteira/banks", json={"nome": "banco"}).json()
    return client.post(
        f"/api/carteira/banks/{bank['id']}/accounts",
        json={"nome": "conta", "possui_saldo": True, "saldo_atual": 1000, "possui_credito": False},
    ).json()


# ==================== prévia e backup ====================

def test_preview_does_not_change_anything(client, db_conn):
    _legacy_log(db_conn, "adicionou link: apagado", "organizacao", "organizacao", 2)
    report = client.get("/api/nucleo/xp-review").json()
    assert report["aplicada"] is False
    assert [r["description"] for r in report["removidos"]] == ["adicionou link: apagado"]
    assert len(_logs(db_conn, "adicionou link%")) == 1
    assert _xp(client, "organizacao") == 2


def test_apply_saves_a_backup_copy_first(client, db_conn):
    _legacy_log(db_conn, "adicionou link: apagado", "organizacao", "organizacao", 2)
    report = _apply(client)
    backup = Path(report["backup"])
    assert backup.exists() and backup.parent == database.DB_PATH.parent
    assert _xp(client, "organizacao") == 0


# ==================== regras ====================

def test_farmed_fixed_bill_payments_keep_one_per_paid_period(client, db_conn):
    conta = _create_account(client)
    client.post("/api/financas/fixed-bills", json={"name": "Aluguel", "amount": 10, "due_day": 5, "conta_id": conta["id"]})
    period = client.get("/api/financas/fixed-bills/periods", params={"month": "2026-03"}).json()[0]
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/pay", json={})
    _strip_references(db_conn)
    for _ in range(3):  # pay/unpay antigos que não estornaram
        _legacy_log(db_conn, "pagou conta fixa: Aluguel", "financas", "financas", 2)

    report = _apply(client)
    logs = _logs(db_conn, "pagou conta fixa%")
    assert len(logs) == 1
    assert (logs[0]["referencia_tipo"], logs[0]["referencia_id"]) == ("conta_fixa_periodo", period["id"])
    assert _xp(client, "financas") == logs[0]["xp_gained"]
    assert len(report["removidos"]) == 3

    # agora vinculado: desmarcar estorna normalmente
    client.put(f"/api/financas/fixed-bills/periods/{period['id']}/unpay")
    assert _xp(client, "financas") == 0


def test_payments_of_deleted_bills_are_kept(client, db_conn):
    _legacy_log(db_conn, "pagou conta fixa: conta que não existe mais", "financas", "financas", 2)
    _apply(client)
    assert len(_logs(db_conn, "pagou conta fixa%")) == 1
    assert _xp(client, "financas") == 2


def test_recreated_first_position_keeps_one_log(client, db_conn):
    client.post("/api/carreira/posicoes", json={"company": "Acme", "role": "dev", "start_date": "2020-01-01"})
    _strip_references(db_conn)
    for _ in range(2):
        _legacy_log(db_conn, "primeira posição registrada: dev na Acme", "carreira", "carreira", 150)
    _apply(client)
    logs = _logs(db_conn, "primeira posição%")
    assert len(logs) == 1 and logs[0]["referencia_tipo"] == "posicao"
    assert _xp(client, "carreira") == 150


def test_reopened_milestone_log_is_removed(client, db_conn):
    track = client.post("/api/aprendizado/tracks", json={"name": "Rust"}).json()
    client.post(f"/api/aprendizado/tracks/{track['id']}/milestones", json={"title": "ler"})
    # concluído e reaberto na versão antiga: log ficou, xp foi debitado
    _legacy_log(db_conn, "concluiu marco: ler", "aprendizado", "aprendizado", 15)
    db_conn.execute("UPDATE attributes SET current_xp = 0 WHERE name = 'aprendizado'")
    db_conn.commit()

    _apply(client)
    assert _logs(db_conn, "concluiu marco%") == []
    assert _xp(client, "aprendizado") == 0


def test_salary_logs_match_records_by_creation_time(client, db_conn):
    client.post("/api/carreira/salarios", json={"amount": 5000, "date": "2019-01-01"})
    _strip_references(db_conn)
    old = (datetime.datetime.now().astimezone() - datetime.timedelta(days=3)).isoformat()
    _legacy_log(db_conn, "novo reajuste salarial (+80.0%)", "carreira", "carreira", 220, created_at=old)
    _apply(client)
    logs = _logs(db_conn, "%salário%") + _logs(db_conn, "novo reajuste%")
    assert [l["referencia_tipo"] for l in logs] == ["salario"]
    assert _xp(client, "carreira") == 15


def test_repeated_syncs_keep_one_per_day(client, db_conn):
    day1 = (datetime.datetime.now().astimezone() - datetime.timedelta(days=2)).isoformat()
    day2 = now_iso()
    for ts in (day1, day1, day1, day2, day2):
        _legacy_log(db_conn, "sincronizou repositório: usuario/repo", "organizacao", "organizacao", 2, created_at=ts)
    _apply(client)
    logs = _logs(db_conn, "sincronizou repositório%")
    assert len(logs) == 2
    assert {l["referencia_id"] for l in logs} == {"usuario/repo"}
    assert _xp(client, "organizacao") == 4


def test_contributions_of_deleted_goal_are_removed(client, db_conn):
    _legacy_log(db_conn, 'contribuiu para "meta apagada"', "metas", "metas", 9)
    _legacy_log(db_conn, 'concluiu a meta "meta apagada" (xp bônus)', "metas", "metas", 90)
    _apply(client)
    assert _xp(client, "metas") == 0


def test_manual_actions_are_capped(client, db_conn):
    _legacy_log(db_conn, "fiz algo enorme", "form", "metas", 1_000_000)
    report = _apply(client)
    assert report["limitados"][0]["xp_depois"] == 50
    assert _xp(client, "metas") == 50


def test_review_relocks_achievements_unlocked_by_farming(client, db_conn):
    for _ in range(10):
        _legacy_log(db_conn, "concluiu marco: ler", "aprendizado", "aprendizado", 15)
    client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 1})  # roda o check
    achievements = {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}
    assert achievements["aprendizado_10"]["unlocked"] is True

    report = _apply(client)
    assert "10 em aprendizado" in report["conquistas_rebloqueadas"]
    achievements = {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}
    assert achievements["aprendizado_10"]["unlocked"] is False


def test_review_is_idempotent(client, db_conn):
    _legacy_log(db_conn, "adicionou link: apagado", "organizacao", "organizacao", 2)
    _apply(client)
    second = _apply(client)
    assert second["removidos"] == [] and second["vinculados"] == 0


# ==================== rebloqueio no fluxo normal ====================

def test_reverting_relocks_achievement(client):
    goal = client.post("/api/metas", json={"title": "x", "type": "livre", "target_value": 1}).json()
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    achievements = {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}
    assert achievements["meta_1"]["unlocked"] is True

    client.delete(f"/api/metas/{goal['id']}")
    achievements = {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}
    assert achievements["meta_1"]["unlocked"] is False
