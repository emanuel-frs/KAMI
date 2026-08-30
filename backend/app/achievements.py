"""
Conquistas automáticas por regra fixa (v1 — 'ai_generated' é pós-mvp).

`criteria_json` guarda a regra em JSON. Tipos suportados hoje:
  - count_by_attribute:  {"type": "count_by_attribute", "attribute": "aprendizado", "count": 10}
  - count_total:         {"type": "count_total", "count": 50}
  - streak_days:         {"type": "streak_days", "days": 7}
  - goal_completed:      {"type": "goal_completed", "count": 1} — desbloqueia quando pelo
                         menos `count` metas (goals.status='concluida') existirem
                         ("count" é opcional, default 1). Passou a disparar de verdade
                         com a implementação do módulo Metas (routers/metas.py); antes
                         ficava registrada mas nunca era avaliada porque o módulo que
                         gera o dado (goals) ainda não existia.
  - milestone_completed: {"type": "milestone_completed"} — desbloqueia quando existir
                         pelo menos 1 marco de Aprendizado com status='concluido' e
                         que nunca tenha passado por 'esquecido' (milestones.was_ever_stale
                         = 0). was_ever_stale é setado por _apply_staleness em
                         routers/aprendizado.py e nunca volta a 0, mesmo que o marco
                         seja reaberto e concluído de novo depois — passou a disparar
                         de verdade agora que a coluna existe (antes o tipo estava
                         registrado no seed mas _meets_criteria não tinha um `if` pra
                         ele, então nunca desbloqueava).

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
    {
        "title": "planejador",
        "description": "10 ações registradas em metas",
        "criteria": {"type": "count_by_attribute", "attribute": "metas", "count": 10},
    },
    {
        "title": "colecionador de metas",
        "description": "5 metas pessoais concluídas",
        "criteria": {"type": "goal_completed", "count": 5},
    },
    {
        "title": "hábito formado",
        "description": "100 ações registradas no total",
        "criteria": {"type": "count_total", "count": 100},
    },
    {
        "title": "um mês de disciplina",
        "description": "registrou pelo menos 1 ação por 30 dias seguidos",
        "criteria": {"type": "streak_days", "days": 30},
    },
]


def seed_achievements(conn) -> None:
    """
    Idempotente por título: insere só as conquistas do ACHIEVEMENT_SEED que
    ainda não existem no banco, em vez de checar "a tabela está vazia?" e
    desistir inteira se não estiver. Sem isso, quem já tinha um kami.db
    com as conquistas antigas nunca ganharia as novas que forem adicionadas
    ao seed depois — rodava a cada start só pra não fazer nada.
    """
    cur = conn.cursor()
    existing_titles = {
        r["title"] for r in cur.execute("SELECT title FROM achievements").fetchall()
    }
    for item in ACHIEVEMENT_SEED:
        if item["title"] in existing_titles:
            continue
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


def _has_milestone_completed_without_staleness(conn) -> bool:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM milestones "
        "WHERE status = 'concluido' AND was_ever_stale = 0"
    ).fetchone()
    return row["c"] > 0


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
    if t == "milestone_completed":
        return _has_milestone_completed_without_staleness(conn)
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