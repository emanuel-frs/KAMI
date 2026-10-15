"""GAM-02: um teste por tipo de critério novo (desbloqueio e/ou progresso)."""
import datetime

from app.achievements import achievement_progress
from app.database import local_now, new_id


# ==================== helpers ====================

def _progress(conn, **criteria):
    return achievement_progress(conn, criteria)


def _log_at(conn, when: datetime.datetime, attribute="metas"):
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at) VALUES (?, 'x', 1, 'form', ?)",
        (log_id, when.astimezone().isoformat()),
    )
    attr = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr["id"]))
    conn.commit()


def _achievements(client):
    return {a["key"]: a for a in client.get("/api/nucleo/achievements").json()}


def _month(offset):
    """'YYYY-MM' de `offset` meses atrás (0 = mês atual)."""
    d = datetime.date.today().replace(day=1)
    for _ in range(offset):
        d = (d - datetime.timedelta(days=1)).replace(day=1)
    return d.strftime("%Y-%m")


def _tx(conn, month, type_, amount):
    conn.execute(
        "INSERT INTO transactions (id, description, amount, type, category, date) VALUES (?, 'x', ?, ?, 'c', ?)",
        (new_id(), amount, type_, f"{month}-10"),
    )
    conn.commit()


# ==================== núcleo ====================

def test_attribute_level_and_all_attributes_level(db_conn):
    db_conn.execute("UPDATE attributes SET current_level = 6 WHERE name = 'metas'")
    db_conn.commit()
    assert _progress(db_conn, type="attribute_level", level=5) == (5, 5)
    assert _progress(db_conn, type="all_attributes_level", level=5) == (1, 5)
    db_conn.execute("UPDATE attributes SET current_level = 5")
    db_conn.commit()
    assert _progress(db_conn, type="all_attributes_level", level=5) == (5, 5)


def test_action_hour_handles_midnight_wrap(db_conn):
    day = datetime.date.today()
    assert _progress(db_conn, type="action_hour", **{"from": 23, "to": 4}) == (0, 1)
    _log_at(db_conn, datetime.datetime(day.year, day.month, day.day, 2, 30))
    assert _progress(db_conn, type="action_hour", **{"from": 23, "to": 4}) == (1, 1)
    assert _progress(db_conn, type="action_hour", **{"from": 5, "to": 6}) == (0, 1)


def test_weekend_both_needs_saturday_and_sunday_of_same_weekend(db_conn):
    saturday = datetime.date(2026, 3, 7)
    _log_at(db_conn, datetime.datetime(2026, 3, 7, 12))
    assert _progress(db_conn, type="weekend_both", count=1) == (0, 1)
    _log_at(db_conn, datetime.datetime(2026, 3, 8, 12))
    assert saturday.weekday() == 5
    assert _progress(db_conn, type="weekend_both", count=1) == (1, 1)


def test_days_since_first_action(db_conn):
    _log_at(db_conn, local_now() - datetime.timedelta(days=400))
    assert _progress(db_conn, type="days_since_first", days=365) == (365, 365)


def test_new_streak_achievement_unlocks_via_api(client, db_conn):
    for days_ago in (1, 2):
        _log_at(db_conn, local_now() - datetime.timedelta(days=days_ago))
    client.post("/api/nucleo/actions", json={"description": "hoje", "categories": ["metas"], "xp": 1})
    assert _achievements(client)["streak_3"]["unlocked"] is True


# ==================== finanças ====================

def test_month_positive_counts_only_closed_months(db_conn):
    _tx(db_conn, _month(0), "entrada", 1000)  # mês atual não conta
    assert _progress(db_conn, type="month_positive", count=1) == (0, 1)
    _tx(db_conn, _month(1), "entrada", 1000)
    _tx(db_conn, _month(1), "saida", 100)
    assert _progress(db_conn, type="month_positive", count=1) == (1, 1)


def test_month_positive_consecutive(db_conn):
    for offset in (1, 2, 4):
        _tx(db_conn, _month(offset), "entrada", 10)
    assert _progress(db_conn, type="month_positive", count=3, consecutive=True) == (2, 3)
    _tx(db_conn, _month(3), "entrada", 10)
    assert _progress(db_conn, type="month_positive", count=3, consecutive=True) == (3, 3)


def test_fixed_bills_all_paid(client, db_conn):
    for name in ("Aluguel", "Internet"):
        client.post("/api/financas/fixed-bills", json={"name": name, "amount": 10, "due_day": 5})
    periods = client.get("/api/financas/fixed-bills/periods", params={"month": "2026-03"}).json()
    client.put(f"/api/financas/fixed-bills/periods/{periods[0]['id']}/pay", json={})
    assert _progress(db_conn, type="fixed_bills_all_paid", count=1) == (0, 1)
    client.put(f"/api/financas/fixed-bills/periods/{periods[1]['id']}/pay", json={})
    assert _progress(db_conn, type="fixed_bills_all_paid", count=1) == (1, 1)


def test_debt_paid(client, db_conn):
    debt = client.post("/api/financas/debts", json={"description": "x", "amount": 10, "status": "aberta"}).json()
    assert _progress(db_conn, type="debt_paid") == (0, 1)
    client.put(f"/api/financas/debts/{debt['id']}", json={"description": "x", "amount": 10, "status": "paga"})
    assert _progress(db_conn, type="debt_paid") == (1, 1)


def test_installment_finished(db_conn):
    db_conn.execute(
        "INSERT INTO compras_parceladas (id, nome, valor_total, num_parcelas, mes_primeira_parcela, created_at) "
        "VALUES (?, 'tv', 300, 3, ?, '2026-01-01T00:00:00-03:00')",
        (new_id(), _month(1)),
    )
    db_conn.commit()
    assert _progress(db_conn, type="installment_finished") == (0, 1)  # na parcela 2 de 3
    db_conn.execute("UPDATE compras_parceladas SET mes_primeira_parcela = ?", (_month(3),))
    db_conn.commit()
    assert _progress(db_conn, type="installment_finished") == (1, 1)


# ==================== aprendizado ====================

def _track_with(client, statuses):
    track = client.post("/api/aprendizado/tracks", json={"name": "t"}).json()
    ids = []
    for i, status in enumerate(statuses):
        ms = client.post(f"/api/aprendizado/tracks/{track['id']}/milestones", json={"title": f"m{i}"}).json()
        if status != "pendente":
            client.put(f"/api/aprendizado/milestones/{ms['id']}", json={"status": status})
        ids.append(ms["id"])
    return track, ids


def test_track_completed(client, db_conn):
    _, ids = _track_with(client, ["concluido", "pendente"])
    assert _progress(db_conn, type="track_completed") == (0, 1)
    client.put(f"/api/aprendizado/milestones/{ids[1]}", json={"status": "concluido"})
    assert _progress(db_conn, type="track_completed") == (1, 1)


def test_milestones_in_window(client, db_conn):
    _, ids = _track_with(client, ["concluido", "concluido", "concluido"])
    assert _progress(db_conn, type="milestones_in_window", count=3, days=7) == (3, 3)
    old = (local_now() - datetime.timedelta(days=10)).isoformat()
    db_conn.execute("UPDATE milestones SET completed_at = ? WHERE id = ?", (old, ids[0]))
    db_conn.commit()
    assert _progress(db_conn, type="milestones_in_window", count=3, days=7) == (2, 3)


def test_milestone_resurrected(client, db_conn):
    _, ids = _track_with(client, ["concluido"])
    assert _progress(db_conn, type="milestone_resurrected") == (0, 1)
    db_conn.execute("UPDATE milestones SET was_ever_stale = 1 WHERE id = ?", (ids[0],))
    db_conn.commit()
    assert _progress(db_conn, type="milestone_resurrected") == (1, 1)


# ==================== carreira ====================

def test_salary_jump(client, db_conn):
    client.post("/api/carreira/salarios", json={"amount": 1000, "date": "2020-01-01"})
    client.post("/api/carreira/salarios", json={"amount": 1050, "date": "2021-01-01"})
    assert _progress(db_conn, type="salary_jump", pct=10) == (0, 1)
    client.post("/api/carreira/salarios", json={"amount": 1200, "date": "2022-01-01"})
    assert _progress(db_conn, type="salary_jump", pct=10) == (1, 1)


def test_education_completed_and_career_complete(client, db_conn):
    assert _progress(db_conn, type="career_complete") == (0, 3)
    client.post("/api/carreira/posicoes", json={"company": "Acme", "role": "dev", "start_date": "2020-01-01"})
    client.post("/api/carreira/formacoes", json={"curso": "cc", "instituicao": "usp", "nivel": "graduacao", "status": "concluido"})
    assert _progress(db_conn, type="education_completed") == (1, 1)
    assert _progress(db_conn, type="career_complete") == (2, 3)
    client.post("/api/carreira/salarios", json={"amount": 1000, "date": "2020-01-01"})
    assert _progress(db_conn, type="career_complete") == (3, 3)


# ==================== metas ====================

def test_goal_epic_and_on_time(client, db_conn):
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    late = client.post("/api/metas", json={"title": "a", "type": "livre", "target_value": 1, "deadline": yesterday}).json()
    client.post(f"/api/metas/{late['id']}/contribute", json={"amount": 1})
    assert _progress(db_conn, type="goal_on_time") == (0, 1)
    assert _progress(db_conn, type="goal_epic_completed") == (0, 1)

    epic = client.post(
        "/api/metas", json={"title": "b", "type": "livre", "target_value": 1, "deadline": tomorrow, "weight": "epico"}
    ).json()
    client.post(f"/api/metas/{epic['id']}/contribute", json={"amount": 1})
    assert _progress(db_conn, type="goal_on_time") == (1, 1)
    assert _progress(db_conn, type="goal_epic_completed") == (1, 1)


def test_goal_types(client, db_conn):
    for type_ in ("livre", "saude", "leitura"):
        client.post("/api/metas", json={"title": type_, "type": type_, "target_value": 1})
    assert _progress(db_conn, type="goal_types", count=4) == (3, 4)
    client.post("/api/metas", json={"title": "h", "type": "habito", "target_value": 1})
    assert _progress(db_conn, type="goal_types", count=4) == (4, 4)


# ==================== organização ====================

def test_links_saved_and_repos_connected(client, db_conn):
    for i in range(3):
        client.post("/api/organizacao/links", json={"title": f"l{i}", "url": "https://x.com", "category": "c"})
    assert _progress(db_conn, type="links_saved", count=25) == (3, 25)
    db_conn.execute(
        "INSERT INTO github_repos (id, repo_full_name, source) VALUES (?, 'u/r', 'manual')", (new_id(),)
    )
    db_conn.commit()
    assert _progress(db_conn, type="repos_connected", count=5) == (1, 5)
