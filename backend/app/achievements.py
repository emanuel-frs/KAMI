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
  GAM-02 (conquistas novas):
  - attribute_level:     {"level": 5} — algum atributo chegou no nível
  - all_attributes_level: {"level": 5} — todos os atributos no nível
  - action_hour:         {"from": 23, "to": 4} — ação registrada entre
                         essas horas locais (intervalo pode virar a meia-noite)
  - weekend_both:        {"count": 1} — fins de semana com ação no sábado E no domingo
  - days_since_first:    {"days": 365} — dias desde a primeira ação
  - month_positive:      {"count": 1, "consecutive": false} — meses JÁ
                         FECHADOS com entradas > saídas (consecutive: maior
                         sequência de meses seguidos)
  - fixed_bills_all_paid: {"count": 1} — meses com todas as contas fixas pagas
  - debt_paid:           {"count": 1} — dívidas com status 'paga'
  - installment_finished: {"count": 1} — compras parceladas quitadas (mesma
                         conta de routers/carteira.py::_compra_parcelada_out)
  - track_completed:     {"count": 1} — trilhas com todos os marcos concluídos
  - milestones_in_window: {"count": 3, "days": 7} — marcos concluídos numa
                         mesma janela de N dias
  - milestone_resurrected: {} — marco concluído que já tinha ficado esquecido
  - salary_jump:         {"pct": 10} — reajuste ≥ pct% entre registros seguidos
  - education_completed: {"count": 1}
  - career_complete:     {} — posição + formação + salário cadastrados (alvo 3)
  - goal_epic_completed: {"count": 1} — meta de peso 'epico' concluída
  - goal_on_time:        {"count": 1} — meta concluída (última contribuição)
                         até o prazo
  - goal_types:          {"count": 4} — metas de N tipos diferentes
  - links_saved / repos_connected: {"count": N}

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

from app.business_days import months_between
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
    # ── GAM-02 ── núcleo
    {"key": "streak_3", "title": "aquecendo", "description": "3 dias seguidos com pelo menos 1 ação",
     "criteria": {"type": "streak_days", "days": 3}, "category": "nucleo"},
    {"key": "streak_14", "title": "duas semanas firmes", "description": "14 dias seguidos com pelo menos 1 ação",
     "criteria": {"type": "streak_days", "days": 14}, "category": "nucleo", "tier": "bronze"},
    {"key": "streak_60", "title": "dois meses sem parar", "description": "60 dias seguidos com pelo menos 1 ação",
     "criteria": {"type": "streak_days", "days": 60}, "category": "nucleo", "tier": "prata"},
    {"key": "streak_100", "title": "centenário", "description": "100 dias seguidos com pelo menos 1 ação",
     "criteria": {"type": "streak_days", "days": 100}, "category": "nucleo", "tier": "ouro"},
    {"key": "streak_365", "title": "um ano inteiro", "description": "365 dias seguidos com pelo menos 1 ação",
     "criteria": {"type": "streak_days", "days": 365}, "category": "nucleo", "tier": "ouro"},
    {"key": "acoes_500", "title": "rotina sólida", "description": "500 ações registradas no total",
     "criteria": {"type": "count_total", "count": 500}, "category": "nucleo", "tier": "prata"},
    {"key": "acoes_1000", "title": "mil passos", "description": "1000 ações registradas no total",
     "criteria": {"type": "count_total", "count": 1000}, "category": "nucleo", "tier": "ouro"},
    {"key": "atributo_nivel_5", "title": "especialista", "description": "algum atributo chegou ao nível 5",
     "criteria": {"type": "attribute_level", "level": 5}, "category": "nucleo", "tier": "bronze"},
    {"key": "atributo_nivel_10", "title": "mestre", "description": "algum atributo chegou ao nível 10",
     "criteria": {"type": "attribute_level", "level": 10}, "category": "nucleo", "tier": "prata"},
    {"key": "atributo_nivel_25", "title": "lenda", "description": "algum atributo chegou ao nível 25",
     "criteria": {"type": "attribute_level", "level": 25}, "category": "nucleo", "tier": "ouro"},
    {"key": "equilibrado", "title": "equilibrado", "description": "todos os atributos no nível 5 ou mais",
     "criteria": {"type": "all_attributes_level", "level": 5}, "category": "nucleo"},
    {"key": "coruja", "title": "coruja", "description": "registrou uma ação entre 23h e 4h",
     "criteria": {"type": "action_hour", "from": 23, "to": 4}, "category": "nucleo", "secret": True},
    {"key": "madrugador", "title": "madrugador", "description": "registrou uma ação entre 5h e 7h",
     "criteria": {"type": "action_hour", "from": 5, "to": 6}, "category": "nucleo", "secret": True},
    {"key": "fim_de_semana", "title": "fim de semana produtivo", "description": "registrou ações no sábado e no domingo do mesmo fim de semana",
     "criteria": {"type": "weekend_both", "count": 1}, "category": "nucleo"},
    {"key": "um_ano", "title": "um ano de kami", "description": "um ano desde a primeira ação registrada",
     "criteria": {"type": "days_since_first", "days": 365}, "category": "nucleo", "secret": True},
    # finanças
    {"key": "financas_50", "title": "finanças em dia", "description": "50 ações registradas em finanças",
     "criteria": {"type": "count_by_attribute", "attribute": "financas", "count": 50}, "category": "financas", "tier": "prata"},
    {"key": "financas_200", "title": "tesoureiro", "description": "200 ações registradas em finanças",
     "criteria": {"type": "count_by_attribute", "attribute": "financas", "count": 200}, "category": "financas", "tier": "ouro"},
    {"key": "mes_no_azul", "title": "mês no azul", "description": "fechou um mês com mais entradas que saídas",
     "criteria": {"type": "month_positive", "count": 1}, "category": "financas"},
    {"key": "tres_meses_no_azul", "title": "trimestre no azul", "description": "3 meses seguidos com mais entradas que saídas",
     "criteria": {"type": "month_positive", "count": 3, "consecutive": True}, "category": "financas"},
    {"key": "contas_em_dia", "title": "contas em dia", "description": "pagou todas as contas fixas de um mês",
     "criteria": {"type": "fixed_bills_all_paid", "count": 1}, "category": "financas"},
    {"key": "quitado", "title": "quitado", "description": "marcou uma dívida como paga",
     "criteria": {"type": "debt_paid", "count": 1}, "category": "financas"},
    {"key": "ultima_parcela", "title": "última parcela", "description": "terminou de pagar uma compra parcelada",
     "criteria": {"type": "installment_finished", "count": 1}, "category": "financas"},
    # aprendizado
    {"key": "aprendizado_50", "title": "estudante dedicado", "description": "50 ações registradas em aprendizado",
     "criteria": {"type": "count_by_attribute", "attribute": "aprendizado", "count": 50}, "category": "aprendizado", "tier": "prata"},
    {"key": "aprendizado_200", "title": "erudito", "description": "200 ações registradas em aprendizado",
     "criteria": {"type": "count_by_attribute", "attribute": "aprendizado", "count": 200}, "category": "aprendizado", "tier": "ouro"},
    {"key": "trilha_completa", "title": "trilha completa", "description": "concluiu todos os marcos de uma trilha",
     "criteria": {"type": "track_completed", "count": 1}, "category": "aprendizado", "tier": "bronze"},
    {"key": "trilhas_5", "title": "cinco trilhas", "description": "concluiu todos os marcos de 5 trilhas",
     "criteria": {"type": "track_completed", "count": 5}, "category": "aprendizado", "tier": "prata"},
    {"key": "maratona", "title": "maratona", "description": "concluiu 3 marcos em 7 dias",
     "criteria": {"type": "milestones_in_window", "count": 3, "days": 7}, "category": "aprendizado"},
    {"key": "ressurreicao", "title": "ressurreição", "description": "concluiu um marco que tinha ficado esquecido",
     "criteria": {"type": "milestone_resurrected"}, "category": "aprendizado", "secret": True},
    # carreira
    {"key": "carreira_50", "title": "carreira sólida", "description": "50 ações registradas em carreira",
     "criteria": {"type": "count_by_attribute", "attribute": "carreira", "count": 50}, "category": "carreira", "tier": "prata"},
    {"key": "promocao", "title": "promoção", "description": "registrou um reajuste salarial de 10% ou mais",
     "criteria": {"type": "salary_jump", "pct": 10}, "category": "carreira"},
    {"key": "diplomado", "title": "diplomado", "description": "concluiu uma formação",
     "criteria": {"type": "education_completed", "count": 1}, "category": "carreira"},
    {"key": "curriculo_completo", "title": "currículo completo", "description": "cadastrou posição, formação e salário",
     "criteria": {"type": "career_complete"}, "category": "carreira"},
    # metas
    {"key": "metas_50", "title": "estrategista", "description": "50 ações registradas em metas",
     "criteria": {"type": "count_by_attribute", "attribute": "metas", "count": 50}, "category": "metas", "tier": "prata"},
    {"key": "meta_epica", "title": "épico", "description": "concluiu uma meta de peso épico",
     "criteria": {"type": "goal_epic_completed", "count": 1}, "category": "metas"},
    {"key": "no_prazo", "title": "no prazo", "description": "concluiu uma meta antes do prazo",
     "criteria": {"type": "goal_on_time", "count": 1}, "category": "metas"},
    {"key": "versatil", "title": "versátil", "description": "criou metas de 4 tipos diferentes",
     "criteria": {"type": "goal_types", "count": 4}, "category": "metas"},
    # organização
    {"key": "organizacao_50", "title": "arquivista", "description": "50 ações registradas em organização",
     "criteria": {"type": "count_by_attribute", "attribute": "organizacao", "count": 50}, "category": "organizacao", "tier": "prata"},
    {"key": "curador", "title": "curador", "description": "25 links salvos",
     "criteria": {"type": "links_saved", "count": 25}, "category": "organizacao"},
    {"key": "repositorios_5", "title": "mantenedor", "description": "5 repositórios conectados",
     "criteria": {"type": "repos_connected", "count": 5}, "category": "organizacao"},
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


# ── GAM-02 ───────────────────────────────────────────────────────────────

def _attribute_levels(conn) -> list:
    return [r["current_level"] for r in conn.execute("SELECT current_level FROM attributes").fetchall()]


@criterion("attribute_level")
def _crit_attribute_level(conn, c):
    return max(_attribute_levels(conn), default=0), c["level"]


@criterion("all_attributes_level")
def _crit_all_attributes_level(conn, c):
    return min(_attribute_levels(conn), default=0), c["level"]


@criterion("action_hour")
def _crit_action_hour(conn, c):
    # created_at é hora local ('YYYY-MM-DDTHH:...'), então a hora é o
    # trecho 12-13 do texto
    start, end = c["from"], c["to"]
    hours = list(range(start, end + 1)) if start <= end else [*range(start, 24), *range(0, end + 1)]
    placeholders = ", ".join("?" for _ in hours)
    row = conn.execute(
        f"SELECT COUNT(*) AS c FROM action_logs WHERE CAST(substr(created_at, 12, 2) AS INTEGER) IN ({placeholders})",
        hours,
    ).fetchone()
    return row["c"], c.get("count", 1)


@criterion("weekend_both")
def _crit_weekend_both(conn, c):
    by_week = {}
    for d in _activity_dates(conn):
        if d.weekday() >= 5:
            by_week.setdefault(d.isocalendar()[:2], set()).add(d.weekday())
    return sum(1 for days in by_week.values() if days == {5, 6}), c.get("count", 1)


@criterion("days_since_first")
def _crit_days_since_first(conn, c):
    dates = _activity_dates(conn)
    return ((datetime.date.today() - dates[0]).days if dates else 0), c["days"]


def _positive_months(conn) -> list:
    """Meses JÁ FECHADOS (antes do mês atual) com entradas > saídas, em ordem."""
    current = datetime.date.today().strftime("%Y-%m")
    rows = conn.execute(
        "SELECT substr(date, 1, 7) AS m, "
        "SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) AS e, "
        "SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END) AS s "
        "FROM transactions WHERE substr(date, 1, 7) < ? GROUP BY m ORDER BY m",
        (current,),
    ).fetchall()
    return [r["m"] for r in rows if r["e"] > r["s"]]


@criterion("month_positive")
def _crit_month_positive(conn, c):
    months = _positive_months(conn)
    if not c.get("consecutive"):
        return len(months), c["count"]
    best = run = 0
    prev = None
    for m in months:
        run = run + 1 if prev and months_between(prev, m) == 1 else 1
        best = max(best, run)
        prev = m
    return best, c["count"]


@criterion("fixed_bills_all_paid")
def _crit_fixed_bills_all_paid(conn, c):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM (SELECT mes_ano FROM fixed_bill_periods p "
        "JOIN fixed_bills b ON b.id = p.fixed_bill_id WHERE b.active = 1 "
        "GROUP BY mes_ano HAVING COUNT(*) > 0 AND SUM(p.paga) = COUNT(*))"
    ).fetchone()
    return row["c"], c.get("count", 1)


@criterion("debt_paid")
def _crit_debt_paid(conn, c):
    return conn.execute("SELECT COUNT(*) AS c FROM debts WHERE status = 'paga'").fetchone()["c"], c.get("count", 1)


@criterion("installment_finished")
def _crit_installment_finished(conn, c):
    today_month = datetime.date.today().strftime("%Y-%m")
    rows = conn.execute("SELECT mes_primeira_parcela, num_parcelas, ajuste_parcelas FROM compras_parceladas").fetchall()
    done = sum(
        1 for r in rows
        if months_between(r["mes_primeira_parcela"], today_month) + 1 + r["ajuste_parcelas"] > r["num_parcelas"]
    )
    return done, c.get("count", 1)


@criterion("track_completed")
def _crit_track_completed(conn, c):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM (SELECT track_id FROM milestones GROUP BY track_id "
        "HAVING COUNT(*) > 0 AND SUM(status = 'concluido') = COUNT(*))"
    ).fetchone()
    return row["c"], c.get("count", 1)


@criterion("milestones_in_window")
def _crit_milestones_in_window(conn, c):
    dates = sorted(
        datetime.date.fromisoformat(r["d"])
        for r in conn.execute(
            "SELECT substr(completed_at, 1, 10) AS d FROM milestones "
            "WHERE status = 'concluido' AND completed_at IS NOT NULL"
        ).fetchall()
    )
    best = 0
    start = 0
    for end, d in enumerate(dates):
        while (d - dates[start]).days >= c["days"]:
            start += 1
        best = max(best, end - start + 1)
    return best, c["count"]


@criterion("milestone_resurrected")
def _crit_milestone_resurrected(conn, c):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM milestones WHERE status = 'concluido' AND was_ever_stale = 1"
    ).fetchone()
    return int(row["c"] > 0), 1


@criterion("salary_jump")
def _crit_salary_jump(conn, c):
    amounts = [r["amount"] for r in conn.execute(
        "SELECT amount FROM career_salary_records ORDER BY date, created_at"
    ).fetchall()]
    jumped = any(prev > 0 and (cur - prev) / prev * 100 >= c["pct"] for prev, cur in zip(amounts, amounts[1:]))
    return int(jumped), 1


@criterion("education_completed")
def _crit_education_completed(conn, c):
    row = conn.execute("SELECT COUNT(*) AS c FROM career_educations WHERE status = 'concluido'").fetchone()
    return row["c"], c.get("count", 1)


@criterion("career_complete")
def _crit_career_complete(conn, c):
    filled = sum(
        conn.execute(f"SELECT EXISTS(SELECT 1 FROM {table}) AS e").fetchone()["e"]
        for table in ("career_positions", "career_educations", "career_salary_records")
    )
    return filled, 3


@criterion("goal_epic_completed")
def _crit_goal_epic_completed(conn, c):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM goals WHERE status = 'concluida' AND weight = 'epico'"
    ).fetchone()
    return row["c"], c.get("count", 1)


@criterion("goal_on_time")
def _crit_goal_on_time(conn, c):
    # data de conclusão = última contribuição (mesma regra de
    # routers/metas.py::_goal_row_to_out); metas sem contribuição
    # (aprendizado/acadêmica) não têm data de conclusão e não contam
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM goals g WHERE g.status = 'concluida' AND g.deadline IS NOT NULL "
        "AND (SELECT substr(MAX(date), 1, 10) FROM goal_contributions WHERE goal_id = g.id) <= g.deadline"
    ).fetchone()
    return row["c"], c.get("count", 1)


@criterion("goal_types")
def _crit_goal_types(conn, c):
    return conn.execute("SELECT COUNT(DISTINCT type) AS c FROM goals").fetchone()["c"], c["count"]


@criterion("links_saved")
def _crit_links_saved(conn, c):
    return conn.execute("SELECT COUNT(*) AS c FROM links").fetchone()["c"], c["count"]


@criterion("repos_connected")
def _crit_repos_connected(conn, c):
    return conn.execute("SELECT COUNT(*) AS c FROM github_repos").fetchone()["c"], c["count"]


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
