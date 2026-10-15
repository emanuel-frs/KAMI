"""
Revisão de xp — corrige o xp acumulado ANTES da integridade do xp
(action_logs.referencia_tipo/referencia_id, ver app/actions.py).

Logs antigos não sabem qual entidade os gerou, então desfazer algo
(desmarcar um pagamento, apagar uma posição, reabrir um marco...)
não tinha como estornar o log certo, e "fazer e desfazer" deixava xp
e registros sobrando. A revisão olha cada log antigo gerado por um
módulo, reconhece pela descrição de qual tipo de entidade ele veio e:

  - VINCULA o log à entidade que ainda existe (preenche a referência),
    pra que daqui pra frente desfazê-la estorne normalmente;
  - REMOVE os logs que sobram — mais logs do que entidades vivas
    (ex: 5x "pagou conta fixa: aluguel" pra 1 mês pago), ou repetições
    no mesmo dia do que hoje só rende xp 1x por dia (sync, contribuição);
  - LIMITA ações manuais do Núcleo a MAX_MANUAL_XP (teto atual do form).

Depois recalcula o xp de cada atributo como a soma do log (o log passa
a ser a fonte da verdade) e reavalia as conquistas nos dois sentidos
(desbloqueia o que passou a valer, rebloqueia o que deixou de valer).

Pareamento por nome: as descrições antigas guardam o nome da entidade
(título do marco, empresa/cargo, nome da conta fixa...), não o id. Quando
há mais logs que entidades com aquele nome, ficam os logs mais recentes
(os da última vez que a entidade foi concluída/paga — os anteriores são
os que foram desfeitos). Salário não tem nome na descrição: pareia pelo
horário de criação (log e registro nascem no mesmo request).

Regras que mantêm o comportamento atual dos módulos:
  - pagamentos de uma conta fixa/assinatura/renda que NÃO existe mais
    ficam como estão: apagar a conta nunca estornou o pagamento (a
    transação real continua em Finanças);
  - transações lançadas e importações automáticas do GitHub não têm
    como ser desfeitas, então não são revistas.

`review_xp(conn, apply)` roda tudo numa transação: com apply=False
desfaz ao final (simulação, usada na prévia), com apply=True comita.
Quem aplica de verdade deve antes guardar uma cópia do banco
(database.backup_database), como faz POST /api/nucleo/xp-review.
"""
import datetime
import json
import re
from collections import defaultdict

from app.achievements import achievement_progress, relock_unmet_achievements
from app.database import now_iso
from app.xp import level_from_xp

MAX_MANUAL_XP = 50  # mesmo teto de routers/nucleo.py (formulário do Núcleo)
SALARY_MATCH_SECONDS = 10


class _Review:
    def __init__(self, conn):
        self.conn = conn
        self.linked = 0
        self.removed = []
        self.capped = []

    # ── operações ────────────────────────────────────────────────────

    def link(self, log, tipo, ref_id):
        self.conn.execute(
            "UPDATE action_logs SET referencia_tipo = ?, referencia_id = ? WHERE id = ?",
            (tipo, ref_id, log["id"]),
        )
        self.linked += 1

    def remove(self, log, motivo):
        self.conn.execute("DELETE FROM action_logs WHERE id = ?", (log["id"],))
        self.removed.append(
            {
                "description": log["description"],
                "xp": log["xp_gained"],
                "created_at": log["created_at"],
                "motivo": motivo,
            }
        )

    # ── consultas ────────────────────────────────────────────────────

    def legacy_logs(self, source, pattern):
        """{chave extraída da descrição: [logs do mais antigo pro mais novo]}"""
        out = defaultdict(list)
        rows = self.conn.execute(
            "SELECT * FROM action_logs WHERE referencia_tipo IS NULL AND source = ? ORDER BY created_at",
            (source,),
        ).fetchall()
        for row in rows:
            m = pattern.match(row["description"])
            if m:
                out[m.group(1)].append(row)
        return out

    def linked_ids(self, tipo):
        return {
            r["referencia_id"]
            for r in self.conn.execute(
                "SELECT referencia_id FROM action_logs WHERE referencia_tipo = ?", (tipo,)
            ).fetchall()
        }

    def match_by_key(self, logs_by_key, entities_by_key, tipo, motivo, keep_unknown_keys=False):
        """
        Pareia logs e entidades de mesma chave. `entities_by_key` traz só
        entidades ainda sem log vinculado, da mais antiga pra mais nova.
        Sobrando logs, ficam os mais recentes; o resto é removido. Com
        keep_unknown_keys, chaves sem nenhuma entidade com esse nome no
        banco não são tocadas (ver pagamentos no docstring do módulo).
        """
        for key, logs in logs_by_key.items():
            if key not in entities_by_key:
                if keep_unknown_keys:
                    continue
                for log in logs:
                    self.remove(log, motivo)
                continue
            ents = entities_by_key[key]
            keep = logs[-len(ents):] if ents else []
            for log in logs[: len(logs) - len(keep)]:
                self.remove(log, motivo)
            for log, ent_id in zip(keep, ents[-len(keep):] if keep else []):
                self.link(log, tipo, ent_id)

    def once_per_day(self, logs_by_key, tipo, ref_for_key, motivo):
        """
        Deixa no máximo 1 log por chave por dia (regra atual de sync e de
        contribuição). Conta também os logs já vinculados daquele dia.
        `ref_for_key(chave)` devolve o referencia_id a gravar (ou None pra
        só deduplicar, sem vincular).
        """
        taken = defaultdict(set)
        for r in self.conn.execute(
            "SELECT referencia_id, substr(created_at, 1, 10) AS d FROM action_logs WHERE referencia_tipo = ?",
            (tipo,),
        ).fetchall():
            taken[r["referencia_id"]].add(r["d"])
        for key, logs in logs_by_key.items():
            ref_id = ref_for_key(key)
            seen = taken[ref_id] if ref_id else set()
            for log in logs:
                day = log["created_at"][:10]
                if day in seen:
                    self.remove(log, motivo)
                    continue
                seen.add(day)
                if ref_id:
                    self.link(log, tipo, ref_id)


def _group(rows, key_fn):
    out = defaultdict(list)
    for r in rows:
        out[key_fn(r)].append(r["id"])
    return out


def _unlinked(rows, linked):
    return [r for r in rows if r["id"] not in linked]


# ── regras por tipo de log ───────────────────────────────────────────────

def _review_manual(rv):
    rows = rv.conn.execute(
        "SELECT * FROM action_logs WHERE source = 'form' AND xp_gained > ?", (MAX_MANUAL_XP,)
    ).fetchall()
    for row in rows:
        rv.conn.execute("UPDATE action_logs SET xp_gained = ? WHERE id = ?", (MAX_MANUAL_XP, row["id"]))
        rv.capped.append(
            {"description": row["description"], "xp_antes": row["xp_gained"], "xp_depois": MAX_MANUAL_XP,
             "created_at": row["created_at"]}
        )


def _review_milestones(rv):
    logs = rv.legacy_logs("aprendizado", re.compile(r"^concluiu marco: (.*)$"))
    rows = rv.conn.execute(
        "SELECT id, title FROM milestones WHERE status = 'concluido' ORDER BY completed_at"
    ).fetchall()
    ents = _group(_unlinked(rows, rv.linked_ids("marco")), lambda r: r["title"])
    rv.match_by_key(logs, ents, "marco", "marco reaberto ou removido depois de concluído")


def _review_educations(rv):
    logs = rv.legacy_logs("carreira", re.compile(r"^concluiu formação: (.*)$"))
    rows = rv.conn.execute(
        "SELECT id, curso, instituicao FROM career_educations WHERE status = 'concluido' ORDER BY updated_at"
    ).fetchall()
    ents = _group(_unlinked(rows, rv.linked_ids("formacao")), lambda r: f"{r['curso']} ({r['instituicao']})")
    rv.match_by_key(logs, ents, "formacao", "formação reaberta ou removida depois de concluída")


def _review_positions(rv):
    logs = rv.legacy_logs(
        "carreira",
        re.compile(r"^(?:primeira posição registrada|novo cargo|registrou posição retroativa): (.*)$"),
    )
    rows = rv.conn.execute("SELECT id, role, company FROM career_positions ORDER BY created_at").fetchall()
    ents = _group(_unlinked(rows, rv.linked_ids("posicao")), lambda r: f"{r['role']} na {r['company']}")
    rv.match_by_key(logs, ents, "posicao", "posição removida (ou cadastrada de novo)")


def _parse_ts(value):
    try:
        dt = datetime.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.astimezone()


def _review_salaries(rv):
    pattern = re.compile(r"^(registrou o primeiro salário|novo reajuste salarial|registrou salário retroativo)")
    logs = [log for group in rv.legacy_logs("carreira", pattern).values() for log in group]
    linked = rv.linked_ids("salario")
    records = [
        (r["id"], _parse_ts(r["created_at"]))
        for r in rv.conn.execute("SELECT id, created_at FROM career_salary_records").fetchall()
        if r["id"] not in linked
    ]
    for log in logs:
        log_ts = _parse_ts(log["created_at"])
        match = None
        if log_ts:
            for i, (rec_id, rec_ts) in enumerate(records):
                if rec_ts and abs((rec_ts - log_ts).total_seconds()) <= SALARY_MATCH_SECONDS:
                    match = records.pop(i)[0]
                    break
        if match:
            rv.link(log, "salario", match)
        else:
            rv.remove(log, "registro salarial removido")


def _review_links(rv):
    logs = rv.legacy_logs("organizacao", re.compile(r"^adicionou link: (.*)$"))
    rows = rv.conn.execute("SELECT id, title FROM links").fetchall()
    ents = _group(_unlinked(rows, rv.linked_ids("link")), lambda r: r["title"])
    rv.match_by_key(logs, ents, "link", "link removido")


def _review_github(rv):
    logs = rv.legacy_logs("organizacao", re.compile(r"^conectou repositório: (.*)$"))
    rows = rv.conn.execute("SELECT id, repo_full_name FROM github_repos").fetchall()
    ents = _group(_unlinked(rows, rv.linked_ids("github_repo")), lambda r: r["repo_full_name"])
    rv.match_by_key(logs, ents, "github_repo", "repositório removido (ou conectado de novo)")

    syncs = rv.legacy_logs("organizacao", re.compile(r"^sincronizou repositório: (.*)$"))
    rv.once_per_day(syncs, "github_sync", lambda name: name, "sync repetido no mesmo dia")


def _review_email(rv):
    logs = rv.legacy_logs("organizacao", re.compile(r"^sincronizou e-mail: (.*)$"))
    usernames = defaultdict(set)
    for r in rv.conn.execute("SELECT label, username FROM email_accounts").fetchall():
        usernames[r["label"]].add(r["username"])

    def ref(label):
        # o limite diário atual é por usuário da conta; só dá pra vincular
        # se o rótulo antigo aponta pra exatamente uma conta
        users = usernames.get(label, set())
        return next(iter(users)) if len(users) == 1 else None

    rv.once_per_day(logs, "email_sync", ref, "sync repetido no mesmo dia")


def _review_goals(rv):
    goals = rv.conn.execute("SELECT id, title, status FROM goals").fetchall()
    ids_by_title = _group(goals, lambda r: r["title"])

    contributions = rv.legacy_logs("metas", re.compile(r'^contribuiu para "(.*)"$'))
    for title in list(contributions):
        if title not in ids_by_title:
            for log in contributions.pop(title):
                rv.remove(log, "meta removida")

    def ref(title):
        ids = ids_by_title.get(title, [])
        return ids[0] if len(ids) == 1 else None

    rv.once_per_day(contributions, "meta_contribuicao", ref, "contribuição repetida no mesmo dia")

    completions = rv.legacy_logs(
        "metas", re.compile(r'^concluiu a meta "(.*)" \((?:trilha, |formação, )?xp bônus\)$')
    )
    done = [g for g in goals if g["status"] == "concluida"]
    ents = _group(_unlinked(done, rv.linked_ids("meta_conclusao")), lambda r: r["title"])
    rv.match_by_key(completions, ents, "meta_conclusao", "meta removida ou bônus duplicado")


def _review_payments(rv):
    specs = [
        (
            r"^pagou conta fixa: (.*)$", "conta_fixa_periodo",
            "SELECT name AS nome FROM fixed_bills",
            "SELECT p.id, b.name AS nome FROM fixed_bill_periods p JOIN fixed_bills b ON b.id = p.fixed_bill_id "
            "WHERE p.paga = 1 AND p.transaction_id IS NOT NULL ORDER BY p.mes_ano",
        ),
        (
            r"^pagou assinatura: (.*)$", "assinatura_periodo",
            "SELECT nome FROM wallet_subscriptions",
            "SELECT p.id, s.nome FROM wallet_subscription_periods p JOIN wallet_subscriptions s ON s.id = p.subscription_id "
            "WHERE p.paga = 1 AND p.transaction_id IS NOT NULL ORDER BY p.mes_ano",
        ),
        (
            r"^recebeu renda: (.*)$", "renda_entrada",
            "SELECT nome FROM income_sources",
            "SELECT e.id, s.nome FROM income_entries e JOIN income_sources s ON s.id = e.income_source_id "
            "WHERE e.status = 'pago' AND e.transaction_id IS NOT NULL ORDER BY e.expected_date",
        ),
    ]
    for pattern, tipo, names_sql, paid_sql in specs:
        logs = rv.legacy_logs("financas", re.compile(pattern))
        known = {r["nome"] for r in rv.conn.execute(names_sql).fetchall()}
        paid = _unlinked(rv.conn.execute(paid_sql).fetchall(), rv.linked_ids(tipo))
        ents = _group(paid, lambda r: r["nome"])
        for name in known:
            ents.setdefault(name, [])
        rv.match_by_key(logs, ents, tipo, "pagamento desmarcado (ou marcado de novo)", keep_unknown_keys=True)


RULES = [
    _review_manual,
    _review_milestones,
    _review_educations,
    _review_positions,
    _review_salaries,
    _review_links,
    _review_github,
    _review_email,
    _review_goals,
    _review_payments,
]


# ── recálculo ────────────────────────────────────────────────────────────

def _attribute_xp(conn):
    return {r["name"]: r["current_xp"] for r in conn.execute("SELECT name, current_xp FROM attributes").fetchall()}


def _recompute_attributes(conn):
    rows = conn.execute(
        "SELECT a.id, COALESCE(SUM(l.xp_gained), 0) AS total FROM attributes a "
        "LEFT JOIN action_log_attributes ala ON ala.attribute_id = a.id "
        "LEFT JOIN action_logs l ON l.id = ala.action_log_id "
        "GROUP BY a.id"
    ).fetchall()
    for r in rows:
        conn.execute(
            "UPDATE attributes SET current_xp = ?, current_level = ? WHERE id = ?",
            (r["total"], level_from_xp(r["total"])["level"], r["id"]),
        )


def _unlock_met(conn):
    unlocked = []
    for row in conn.execute("SELECT * FROM achievements WHERE unlocked_at IS NULL").fetchall():
        current, target = achievement_progress(conn, json.loads(row["criteria_json"]))
        if current >= target:
            conn.execute("UPDATE achievements SET unlocked_at = ? WHERE id = ?", (now_iso(), row["id"]))
            unlocked.append(row["title"])
    return unlocked


def review_xp(conn, apply: bool = False) -> dict:
    """
    Roda a revisão inteira. Com apply=False é só simulação (rollback no
    fim); com apply=True comita. Devolve o relatório do que mudou.
    """
    conn.commit()  # parte de um estado limpo, sem transação pendente
    xp_before = _attribute_xp(conn)
    try:
        rv = _Review(conn)
        for rule in RULES:
            rule(rv)
        _recompute_attributes(conn)
        relocked = relock_unmet_achievements(conn)
        unlocked = _unlock_met(conn)
        xp_after = _attribute_xp(conn)
        report = {
            "aplicada": apply,
            "vinculados": rv.linked,
            "removidos": rv.removed,
            "limitados": rv.capped,
            "atributos": [
                {"nome": name, "xp_antes": xp_before[name], "xp_depois": xp_after.get(name, 0)}
                for name in sorted(xp_before)
            ],
            "conquistas_rebloqueadas": relocked,
            "conquistas_desbloqueadas": unlocked,
        }
    except Exception:
        conn.rollback()
        raise
    if apply:
        conn.commit()
    else:
        conn.rollback()
    return report
