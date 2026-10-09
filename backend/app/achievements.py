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

`relock_unmet_achievements(conn)` é o caminho inverso: roda depois de
um estorno (app/actions.py::revert_actions) e da revisão de xp
(app/revisao_xp.py) e volta a bloquear as conquistas cujo critério
deixou de valer — sem isso, uma conquista liberada por "fazer e
desfazer" ficava liberada pra sempre.

Cada critério também sabe medir o próprio progresso
(`achievement_progress` -> atual/alvo): é a mesma conta que decide o
desbloqueio, e a galeria usa pra mostrar "7/10" numa conquista ainda
bloqueada.

Toda conquista do seed tem uma `key` estável (coluna `chave`): é ela,
não o título, que identifica a conquista entre versões. Mudar o título,
a descrição ou o critério no seed atualiza a linha existente (mantendo
unlocked_at) em vez de criar uma duplicata.

Sequência de dias (`streak_info`): dias distintos com pelo menos uma
ação, pelo prefixo YYYY-MM-DD de action_logs.created_at — que é o dia
LOCAL de quem usa (ver database.now_iso).
"""
import json
import datetime

from app.database import new_id, now_iso

ACHIEVEMENT_SEED = [
    {
        "key": "streak_7",
        "title": "primeira semana",
        "description": "registrou pelo menos 1 ação por 7 dias seguidos",
        "criteria": {"type": "streak_days", "days": 7},
    },
    {
        "key": "aprendizado_10",
        "title": "10 em aprendizado",
        "description": "10 ações registradas em aprendizado",
        "criteria": {"type": "count_by_attribute", "attribute": "aprendizado", "count": 10},
    },
    {
        "key": "organizacao_20",
        "title": "organizador",
        "description": "20 ações em organização",
        "criteria": {"type": "count_by_attribute", "attribute": "organizacao", "count": 20},
    },
    {
        "key": "financas_15",
        "title": "constância financeira",
        "description": "15 ações registradas em finanças",
        "criteria": {"type": "count_by_attribute", "attribute": "financas", "count": 15},
    },
    {
        "key": "meta_1",
        "title": "quest concluída",
        "description": "concluiu a primeira meta pessoal",
        "criteria": {"type": "goal_completed"},
    },
    {
        "key": "marco_em_dia",
        "title": "trilha em dia",
        "description": 'concluiu um marco de aprendizado sem ficar "esquecido"',
        "criteria": {"type": "milestone_completed"},
    },
    {
        "key": "metas_10",
        "title": "planejador",
        "description": "10 ações registradas em metas",
        "criteria": {"type": "count_by_attribute", "attribute": "metas", "count": 10},
    },
    {
        "key": "carreira_10",
        "title": "trajetória profissional",
        "description": "10 ações registradas em carreira",
        "criteria": {"type": "count_by_attribute", "attribute": "carreira", "count": 10},
    },
    {
        "key": "meta_5",
        "title": "colecionador de metas",
        "description": "5 metas pessoais concluídas",
        "criteria": {"type": "goal_completed", "count": 5},
    },
    {
        "key": "acoes_100",
        "title": "hábito formado",
        "description": "100 ações registradas no total",
        "criteria": {"type": "count_total", "count": 100},
    },
    {
        "key": "streak_30",
        "title": "um mês de disciplina",
        "description": "registrou pelo menos 1 ação por 30 dias seguidos",
        "criteria": {"type": "streak_days", "days": 30},
    },
]


def seed_achievements(conn) -> None:
    """
    Idempotente por `chave`: insere só as conquistas do ACHIEVEMENT_SEED
    que ainda não existem no banco e atualiza título/descrição/critério
    das que já existem (unlocked_at fica intacto). Linhas antigas, de
    antes da coluna `chave` existir, são reconhecidas pelo título uma
    única vez e ganham a chave — daí em diante o título pode mudar à
    vontade sem duplicar a conquista.
    """
    cur = conn.cursor()
    rows = cur.execute("SELECT id, title, chave FROM achievements").fetchall()
    by_key = {r["chave"]: r["id"] for r in rows if r["chave"]}
    legacy_by_title = {r["title"]: r["id"] for r in rows if not r["chave"]}

    for item in ACHIEVEMENT_SEED:
        criteria_json = json.dumps(item["criteria"])
        existing_id = by_key.get(item["key"]) or legacy_by_title.pop(item["title"], None)
        if existing_id:
            cur.execute(
                "UPDATE achievements SET chave = ?, title = ?, description = ?, criteria_json = ? "
                "WHERE id = ?",
                (item["key"], item["title"], item["description"], criteria_json, existing_id),
            )
            continue
        cur.execute(
            "INSERT INTO achievements (id, chave, title, description, rule_type, criteria_json, unlocked_at) "
            "VALUES (?, ?, ?, ?, 'fixed', ?, NULL)",
            (new_id(), item["key"], item["title"], item["description"], criteria_json),
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


def _activity_dates(conn) -> list:
    rows = conn.execute(
        "SELECT DISTINCT substr(created_at, 1, 10) AS d FROM action_logs ORDER BY d"
    ).fetchall()
    return [datetime.date.fromisoformat(r["d"]) for r in rows]


def streak_info(conn, today: datetime.date = None) -> dict:
    """
    Sequência de dias com pelo menos uma ação:
      - best:   maior sequência da história
      - current: sequência que ainda está valendo — termina hoje, ou
                 ontem se hoje ainda não teve ação (o dia não acabou,
                 então a sequência não está perdida). 0 se o último dia
                 com ação foi antes de ontem.
      - active_today: se hoje já teve ação
    `today` é o dia local (date.today()); parâmetro só pra teste.
    """
    today = today or datetime.date.today()
    dates = _activity_dates(conn)
    if not dates:
        return {"current": 0, "best": 0, "active_today": False}

    best = run = 1
    for prev, cur in zip(dates, dates[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        best = max(best, run)

    date_set = set(dates)
    active_today = today in date_set
    cursor = today if active_today else today - datetime.timedelta(days=1)
    current = 0
    while cursor in date_set:
        current += 1
        cursor -= datetime.timedelta(days=1)

    return {"current": current, "best": best, "active_today": active_today}


def achievement_progress(conn, criteria: dict) -> tuple:
    """(atual, alvo) do critério. Atual nunca passa do alvo."""
    t = criteria.get("type")
    if t == "count_by_attribute":
        current, target = _count_by_attribute(conn, criteria["attribute"]), criteria["count"]
    elif t == "count_total":
        current, target = _count_total(conn), criteria["count"]
    elif t == "streak_days":
        current, target = streak_info(conn)["best"], criteria["days"]
    elif t == "goal_completed":
        current, target = _count_goals_completed(conn), criteria.get("count", 1)
    elif t == "milestone_completed":
        current, target = int(_has_milestone_completed_without_staleness(conn)), 1
    else:
        return 0, 1
    return min(current, target), target


def _meets_criteria(conn, criteria: dict) -> bool:
    current, target = achievement_progress(conn, criteria)
    return current >= target


def relock_unmet_achievements(conn) -> list:
    """
    Volta a bloquear (unlocked_at = NULL) as conquistas desbloqueadas
    cujo critério não vale mais. NÃO comita — quem chama decide (a
    revisão de xp roda tudo numa transação que pode ser só simulação).
    Devolve os títulos rebloqueados.
    """
    relocked = []
    rows = conn.execute("SELECT * FROM achievements WHERE unlocked_at IS NOT NULL").fetchall()
    for row in rows:
        if not _meets_criteria(conn, json.loads(row["criteria_json"])):
            conn.execute("UPDATE achievements SET unlocked_at = NULL WHERE id = ?", (row["id"],))
            relocked.append(row["title"])
    return relocked


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
