"""
Conquistas automáticas por regra fixa (v1 — 'ai_generated' é pós-mvp).

`criteria_json` guarda a regra em JSON. Tipos suportados hoje:
  - count_by_attribute: {"type": "count_by_attribute", "attribute": "aprendizado", "count": 10}
  - count_total:        {"type": "count_total", "count": 50}
  - streak_days:        {"type": "streak_days", "days": 7}
  - goal_completed:     {"type": "goal_completed"} — desbloqueia quando pelo menos
                        1 meta (goals.status='concluida') existir. Passou a disparar
                        de verdade com a implementação do módulo Metas (routers/metas.py);
                        antes ficava registrada mas nunca era avaliada porque o módulo
                        que gera o dado (goals) ainda não existia.

Tipos já registrados mas que dependem de módulos futuros (ficam
como "nunca disparam" até esses módulos existirem):
  - milestone_completed: já é coberto por Aprendizado desde que o módulo entrou
    (roadmap concluindo marcos é gravado como action_log com categoria
    'aprendizado' via register_action) — mas o tipo aqui é distinto do que
    'count_by_attribute' já cobre, então segue sem checagem própria até
    existir um critério específico pra ele.

`check_achievements(conn)` roda depois de cada ação registrada,
avalia todas as conquistas ainda bloqueadas e desbloqueia as que
baterem critério. Devolve a lista das que acabaram de desbloquear
nesta chamada (pra o frontend poder comemorar na hora).
"""
import json
import datetime

from app.database import new_id, now_iso

ACHIEVEMENT_SEED = [
    {
        "title": "primeira semana",
        "description": "registrou pelo menos 1 ação por 7 dias seguidos",
        "criteria": {"type": "streak_days", "days": 7},
    },
    {
        "title": "10 em aprendizado",
        "description": "10 ações registradas em aprendizado",
        "criteria": {"type": "count_by_attribute", "attribute": "aprendizado", "count": 10},
    },
    {
        "title": "organizador",
        "description": "20 ações em organização",
        "criteria": {"type": "count_by_attribute", "attribute": "organizacao", "count": 20},
    },
    {
        "title": "constância financeira",
        "description": "15 ações registradas em finanças",
        "criteria": {"type": "count_by_attribute", "attribute": "financas", "count": 15},
    },
    {
        "title": "quest concluída",
        "description": "concluiu a primeira meta pessoal",
        "criteria": {"type": "goal_completed"},
    },
    {
        "title": "trilha em dia",
        "description": 'concluiu um marco de aprendizado sem ficar "esquecido"',
        "criteria": {"type": "milestone_completed"},
    },
]


def seed_achievements(conn) -> None:
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM achievements")
    if cur.fetchone()["c"] > 0:
        return
    for item in ACHIEVEMENT_SEED:
        cur.execute(
            "INSERT INTO achievements (id, title, description, rule_type, criteria_json, unlocked_at) "
            "VALUES (?, ?, ?, 'fixed', ?, NULL)",
            (new_id(), item["title"], item["description"], json.dumps(item["criteria"])),
        )
    conn.commit()


def _count_by_attribute(conn, attribute_name: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM action_log_attributes ala "
        "JOIN attributes a ON a.id = ala.attribute_id "
        "WHERE a.name = ?",
        (attribute_name,),
    ).fetchone()
    return row["c"]


def _count_total(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS c FROM action_logs").fetchone()["c"]


def _count_goals_completed(conn) -> int:
    return conn.execute(
        "SELECT COUNT(*) AS c FROM goals WHERE status = 'concluida'"
    ).fetchone()["c"]


def _longest_streak_days(conn) -> int:
    rows = conn.execute(
        "SELECT DISTINCT substr(created_at, 1, 10) AS d FROM action_logs ORDER BY d"
    ).fetchall()
    dates = [datetime.date.fromisoformat(r["d"]) for r in rows]
    if not dates:
        return 0
    longest = 1
    current = 1
    for i in range(1, len(dates)):
        if (dates[i] - dates[i - 1]).days == 1:
            current += 1
            longest = max(longest, current)
        elif (dates[i] - dates[i - 1]).days > 1:
            current = 1
    return longest


def _meets_criteria(conn, criteria: dict) -> bool:
    t = criteria.get("type")
    if t == "count_by_attribute":
        return _count_by_attribute(conn, criteria["attribute"]) >= criteria["count"]
    if t == "count_total":
        return _count_total(conn) >= criteria["count"]
    if t == "streak_days":
        return _longest_streak_days(conn) >= criteria["days"]
    if t == "goal_completed":
        return _count_goals_completed(conn) >= criteria.get("count", 1)
    return False


def check_achievements(conn) -> list:
    newly_unlocked = []
    rows = conn.execute(
        "SELECT * FROM achievements WHERE unlocked_at IS NULL"
    ).fetchall()
    for row in rows:
        criteria = json.loads(row["criteria_json"])
        if _meets_criteria(conn, criteria):
            unlocked_at = now_iso()
            conn.execute(
                "UPDATE achievements SET unlocked_at = ? WHERE id = ?",
                (unlocked_at, row["id"]),
            )
            newly_unlocked.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "description": row["description"],
                    "unlocked_at": unlocked_at,
                }
            )
    if newly_unlocked:
        conn.commit()
    return newly_unlocked