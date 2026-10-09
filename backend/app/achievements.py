"""
Conquistas automáticas por regra fixa (v1 — 'ai_generated' é pós-mvp).

`criteria_json` guarda a regra em JSON: {"type": <tipo>, ...parâmetros}.
Cada tipo é uma função registrada em CRITERIA (decorator `@criterion`)
que mede o progresso como (atual, alvo) — a mesma conta decide o
desbloqueio e alimenta a barra "7/10" da galeria. Criar um tipo novo de
regra é escrever uma função dessas; nada mais precisa mudar. Tipos
desconhecidos (ex: banco mais novo que o código) valem (0, 1), ou seja,
nunca desbloqueiam. Tipos registrados hoje:
  - count_by_attribute:  {"attribute": "aprendizado", "count": 10}
  - count_total:         {"count": 50}
  - streak_days:         {"days": 7} — maior sequência da história
  - goal_completed:      {"count": 1} — metas com status 'concluida'
                         ("count" opcional, default 1)
  - milestone_completed: {} — existe marco 'concluido' que nunca passou
                         por 'esquecido' (milestones.was_ever_stale = 0;
                         setado por _apply_staleness em routers/aprendizado.py
                         e nunca volta a 0)

Metadados de cada conquista do seed (colunas próprias em achievements):
  - key (`chave`):        identificador estável entre versões — mudar
                          título/descrição/critério no seed atualiza a
                          linha existente (mantendo unlocked_at) em vez de
                          criar uma duplicata
  - category (`categoria`): área da vida — nucleo, financas, aprendizado,
                          carreira, metas, organizacao (filtro da galeria)
  - tier (`nivel`):       bronze | prata | ouro | None — degraus da mesma
                          regra com alvos crescentes
  - secret (`secreta`):   bloqueada, aparece mascarada ("???") na API

`check_achievements(conn)` roda depois de cada ação registrada,
avalia todas as conquistas ainda bloqueadas e desbloqueia as que
baterem critério. Devolve a lista das que acabaram de desbloquear
nesta chamada (pra o frontend poder comemorar na hora).

`relock_unmet_achievements(conn)` é o caminho inverso: roda depois de
um estorno (app/actions.py::revert_actions) e da revisão de xp
(app/revisao_xp.py) e volta a bloquear as conquistas cujo critério
deixou de valer — sem isso, uma conquista liberada por "fazer e
desfazer" ficava liberada pra sempre.

Sequência de dias (`streak_info`): dias distintos com pelo menos uma
ação, pelo prefixo YYYY-MM-DD de action_logs.created_at — que é o dia
LOCAL de quem usa (ver database.now_iso).
"""
import json
import datetime

from app.database import new_id, now_iso

CATEGORIES = ("nucleo", "financas", "aprendizado", "carreira", "metas", "organizacao")
TIERS = ("bronze", "prata", "ouro")

ACHIEVEMENT_SEED = [
    {
        "key": "streak_7",
        "title": "primeira semana",
        "description": "registrou pelo menos 1 ação por 7 dias seguidos",
        "criteria": {"type": "streak_days", "days": 7},
        "category": "nucleo",
        "tier": "bronze",
    },
    {
        "key": "aprendizado_10",
        "title": "10 em aprendizado",
        "description": "10 ações registradas em aprendizado",
        "criteria": {"type": "count_by_attribute", "attribute": "aprendizado", "count": 10},
        "category": "aprendizado",
        "tier": "bronze",
    },
    {
        "key": "organizacao_20",
        "title": "organizador",
        "description": "20 ações em organização",
        "criteria": {"type": "count_by_attribute", "attribute": "organizacao", "count": 20},
        "category": "organizacao",
        "tier": "bronze",
    },
    {
        "key": "financas_15",
        "title": "constância financeira",
        "description": "15 ações registradas em finanças",
        "criteria": {"type": "count_by_attribute", "attribute": "financas", "count": 15},
        "category": "financas",
        "tier": "bronze",
    },
    {
        "key": "meta_1",
        "title": "quest concluída",
        "description": "concluiu a primeira meta pessoal",
        "criteria": {"type": "goal_completed"},
        "category": "metas",
        "tier": "bronze",
    },
    {
        "key": "marco_em_dia",
        "title": "trilha em dia",
        "description": 'concluiu um marco de aprendizado sem ficar "esquecido"',
        "criteria": {"type": "milestone_completed"},
        "category": "aprendizado",
    },
    {
        "key": "metas_10",
        "title": "planejador",
        "description": "10 ações registradas em metas",
        "criteria": {"type": "count_by_attribute", "attribute": "metas", "count": 10},
        "category": "metas",
        "tier": "bronze",
    },
    {
        "key": "carreira_10",
        "title": "trajetória profissional",
        "description": "10 ações registradas em carreira",
        "criteria": {"type": "count_by_attribute", "attribute": "carreira", "count": 10},
        "category": "carreira",
        "tier": "bronze",
    },
    {
        "key": "meta_5",
        "title": "colecionador de metas",
        "description": "5 metas pessoais concluídas",
        "criteria": {"type": "goal_completed", "count": 5},
        "category": "metas",
        "tier": "prata",
    },
    {
        "key": "acoes_100",
        "title": "hábito formado",
        "description": "100 ações registradas no total",
        "criteria": {"type": "count_total", "count": 100},
        "category": "nucleo",
        "tier": "bronze",
    },
    {
        "key": "streak_30",
        "title": "um mês de disciplina",
        "description": "registrou pelo menos 1 ação por 30 dias seguidos",
        "criteria": {"type": "streak_days", "days": 30},
        "category": "nucleo",
        "tier": "prata",
    },
]


def seed_achievements(conn) -> None:
    """
    Idempotente por `chave`: insere só as conquistas do ACHIEVEMENT_SEED
    que ainda não existem no banco e atualiza o resto dos campos
    (título, descrição, critério, categoria, nível, secreta) das que já
    existem — unlocked_at fica intacto. Linhas antigas, de antes da
    coluna `chave` existir, são reconhecidas pelo título uma única vez e
    ganham a chave — daí em diante o título pode mudar à vontade sem
    duplicar a conquista.
    """
    cur = conn.cursor()
    rows = cur.execute("SELECT id, title, chave FROM achievements").fetchall()
    by_key = {r["chave"]: r["id"] for r in rows if r["chave"]}
    legacy_by_title = {r["title"]: r["id"] for r in rows if not r["chave"]}

    for item in ACHIEVEMENT_SEED:
        fields = (
            item["key"],
            item["title"],
            item["description"],
            json.dumps(item["criteria"]),
            item["category"],
            item.get("tier"),
            1 if item.get("secret") else 0,
        )
        existing_id = by_key.get(item["key"]) or legacy_by_title.pop(item["title"], None)
        if existing_id:
            cur.execute(
                "UPDATE achievements SET chave = ?, title = ?, description = ?, criteria_json = ?, "
                "categoria = ?, nivel = ?, secreta = ? WHERE id = ?",
                (*fields, existing_id),
            )
            continue
        cur.execute(
            "INSERT INTO achievements "
            "(id, chave, title, description, criteria_json, categoria, nivel, secreta, rule_type, unlocked_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fixed', NULL)",
            (new_id(), *fields),
        )
    conn.commit()


# ── registro de critérios ────────────────────────────────────────────────

CRITERIA = {}


def criterion(type_name):
    """Registra `fn(conn, criteria) -> (atual, alvo)` como o tipo `type_name`."""
    def register(fn):
        CRITERIA[type_name] = fn
        return fn
    return register


def _count_by_attribute(conn, attribute_name: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM action_log_attributes ala "
        "JOIN attributes a ON a.id = ala.attribute_id "
        "WHERE a.name = ?",
        (attribute_name,),
    ).fetchone()
    return row["c"]


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


@criterion("count_by_attribute")
def _crit_count_by_attribute(conn, c):
    return _count_by_attribute(conn, c["attribute"]), c["count"]


@criterion("count_total")
def _crit_count_total(conn, c):
    return conn.execute("SELECT COUNT(*) AS c FROM action_logs").fetchone()["c"], c["count"]


@criterion("streak_days")
def _crit_streak_days(conn, c):
    return streak_info(conn)["best"], c["days"]


@criterion("goal_completed")
def _crit_goal_completed(conn, c):
    done = conn.execute("SELECT COUNT(*) AS c FROM goals WHERE status = 'concluida'").fetchone()["c"]
    return done, c.get("count", 1)


@criterion("milestone_completed")
def _crit_milestone_completed(conn, c):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM milestones WHERE status = 'concluido' AND was_ever_stale = 0"
    ).fetchone()
    return int(row["c"] > 0), 1


def achievement_progress(conn, criteria: dict) -> tuple:
    """(atual, alvo) do critério. Atual nunca passa do alvo."""
    fn = CRITERIA.get(criteria.get("type"))
    if not fn:
        return 0, 1
    current, target = fn(conn, criteria)
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
