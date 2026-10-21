"""
Missões diárias e semanais (GAM-07).

Todo dia local nascem até 3 missões diárias, sorteadas entre as que dá pra
cumprir HOJE com o estado real do app (nada de "pague a conta X" sem conta
cadastrada), e toda semana (segunda a domingo) 1 missão semanal maior.
Regras combinadas com o Emanuel em 2026-10-09:

  - Concluída automaticamente quando a ação acontece, com xp bônus (+10
    diária, +40 semanal) no atributo da missão.
  - Ação manual do Núcleo (source 'form') NÃO conclui missão — o
    formulário "faz" qualquer coisa num clique e a missão perderia a graça.
  - Desfazer a ação volta a missão pra pendente e estorna o bônus (mesma
    coerência da Parte 1).
  - O log do bônus (referencia_tipo 'missao') não conta como ação nas
    conquistas de contagem (ver achievements.REFS_BONUS).
  - Missão não cumprida só expira, sem penalidade. Sem troca de missão por
    enquanto.

Geração preguiçosa e idempotente (sem job em background): na primeira
leitura do dia/semana (`GET /api/nucleo/missoes`) ou na primeira ação
registrada — ANTES de gravar o log da ação, senão a ação que gerou as
missões já chegava concluindo uma delas. O sorteio usa o dia (ou o início
da semana) como semente, e UNIQUE(periodo, referencia, posicao) garante
no máximo 3 diárias e 1 semanal mesmo com duas requisições ao mesmo tempo.

Avaliação SEM estado próprio: a missão está cumprida se os action_logs do
dia/semana satisfazem a regra dela. `avaliar_missoes` roda depois de cada
ação registrada e de cada estorno (app/actions.py) e só sincroniza: cumprida
e não marcada → marca e credita o bônus; marcada e não mais cumprida →
desmarca e estorna o bônus. Só missões do dia/semana atuais são avaliadas
— as passadas ficam como terminaram.
"""
import datetime
import random

from app.database import new_id, now_iso
from app.habitos import carregar as carregar_habitos, dias_com_tudo_feito

REF_MISSAO = "missao"
BONUS_DIARIA = 10
BONUS_SEMANAL = 40
DIARIAS_POR_DIA = 3

# desligada só pela suíte de testes (conftest.py): com missões sorteadas
# por data, qualquer teste antigo que confere o xp de uma ação passaria a
# depender do dia em que roda. Os testes de missões religam.
GERACAO_ATIVA = True

# logs que contam como "ação de verdade" pras missões: nem bônus (de
# missão ou de xp, GAM-08), nem ação manual do Núcleo
_LOG_VALIDO = "COALESCE(l.referencia_tipo, '') NOT IN ('missao', 'bonus') AND l.source != 'form'"

SEMANAIS = {
    "dias_ativos": {"titulo": "aja em 5 dias diferentes da semana", "quantidade": 5, "atributo": "metas"},
    "lancamentos": {"titulo": "lance 10 gastos ou entradas na semana", "quantidade": 10, "atributo": "financas"},
    "marcos": {"titulo": "conclua 2 marcos na semana", "quantidade": 2, "atributo": "aprendizado"},
    "atributos": {"titulo": "aja em 4 atributos diferentes na semana", "quantidade": 4, "atributo": "metas"},
    # ORG-04 (P-58): só sorteada com hábito de dia (diário/dias fixos) ativo
    "habitos_dias": {"titulo": "cumpra todos os hábitos do dia em 4 dias da semana", "quantidade": 4, "atributo": "organizacao"},
}


def semana_inicio(dia: datetime.date) -> datetime.date:
    return dia - datetime.timedelta(days=dia.weekday())


# ---------------- candidatos (só o que dá pra cumprir hoje) ----------------

def _candidatos_diarios(db, hoje: datetime.date) -> list:
    """(tipo, alvo_id, titulo, atributo) de cada missão possível hoje."""
    out = [("lancamento", None, "lance um gasto ou uma entrada", "financas")]

    # conta fixa só gera ação (e xp) quando tem conta vinculada — ver
    # routers/financas.py::pay_fixed_bill_period
    for b in db.execute(
        "SELECT b.id, b.name FROM fixed_bills b "
        "WHERE b.active = 1 AND b.conta_id IS NOT NULL AND b.due_day <= ? "
        "AND NOT EXISTS (SELECT 1 FROM fixed_bill_periods p "
        "                WHERE p.fixed_bill_id = b.id AND p.mes_ano = ? AND p.paga = 1)",
        (hoje.day, hoje.strftime("%Y-%m")),
    ).fetchall():
        out.append(("conta_fixa", b["id"], f'pague a conta fixa "{b["name"]}"', "financas"))

    # renda idem: só gera ação com conta vinculada na fonte
    for e in db.execute(
        "SELECT e.id, s.nome FROM income_entries e JOIN income_sources s ON s.id = e.income_source_id "
        "WHERE e.status = 'previsto' AND e.expected_date <= ? AND s.conta_id IS NOT NULL",
        (hoje.isoformat(),),
    ).fetchall():
        out.append(("renda", e["id"], f'receba a renda "{e["nome"]}"', "financas"))

    # metas de trilha/formação progridem sozinhas — não aceitam contribuição
    for g in db.execute(
        "SELECT id, title FROM goals WHERE status = 'ativa' AND type NOT IN ('aprendizado', 'academica')"
    ).fetchall():
        out.append(("meta", g["id"], f'contribua com a meta "{g["title"]}"', "metas"))

    for t in db.execute(
        "SELECT DISTINCT t.id, t.name FROM tracks t JOIN milestones m ON m.track_id = t.id "
        "WHERE t.status = 'ativa' AND m.status = 'pendente'"
    ).fetchall():
        out.append(("marco", t["id"], f'conclua um marco da trilha "{t["name"]}"', "aprendizado"))

    for m in db.execute("SELECT id, title FROM milestones WHERE status = 'esquecido'").fetchall():
        out.append(("marco_esquecido", m["id"], f'resgate o marco esquecido "{m["title"]}"', "aprendizado"))

    out.append(("link", None, "salve um link", "organizacao"))

    # ORG-04 (P-58): hábito que vale hoje e ainda não foi feito
    for h in carregar_habitos(db, "status = 'ativo'"):
        if h.vale(hoje) and hoje not in h.marcas:
            out.append(("habito", h.row["id"], f'marque o hábito "{h.row["nome"]}"', h.row["atributo"]))
    return out


def _candidatos_semanais(db) -> list:
    tipos = ["dias_ativos", "lancamentos", "atributos"]
    abertos = db.execute(
        "SELECT COUNT(*) AS c FROM milestones WHERE status IN ('pendente', 'esquecido')"
    ).fetchone()["c"]
    if abertos >= SEMANAIS["marcos"]["quantidade"]:
        tipos.append("marcos")
    if db.execute("SELECT 1 FROM habitos WHERE status = 'ativo' AND frequencia != 'semana' LIMIT 1").fetchone():
        tipos.append("habitos_dias")
    return tipos


def _sortear_diarias(candidatos: list, semente: str) -> list:
    """Um alvo por tipo (tipos variados), até DIARIAS_POR_DIA missões."""
    rng = random.Random(semente)
    por_tipo = {}
    for c in candidatos:
        por_tipo.setdefault(c[0], []).append(c)
    tipos = sorted(por_tipo)
    rng.shuffle(tipos)
    return [rng.choice(por_tipo[t]) for t in tipos[:DIARIAS_POR_DIA]]


# ---------------- geração ----------------

def _inserir(db, periodo, referencia, posicao, tipo, alvo_id, titulo, atributo, quantidade, xp_bonus):
    db.execute(
        "INSERT OR IGNORE INTO missoes "
        "(id, periodo, referencia, posicao, tipo, alvo_id, titulo, atributo, quantidade, xp_bonus, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (new_id(), periodo, referencia, posicao, tipo, alvo_id, titulo, atributo, quantidade, xp_bonus, now_iso()),
    )


def garantir_missoes(db, hoje: datetime.date = None) -> None:
    """Gera as missões do dia e da semana se ainda não existem. NÃO comita."""
    if not GERACAO_ATIVA:
        return
    hoje = hoje or datetime.date.today()
    dia = hoje.isoformat()
    if not db.execute("SELECT 1 FROM missoes WHERE periodo = 'dia' AND referencia = ?", (dia,)).fetchone():
        escolhidas = _sortear_diarias(_candidatos_diarios(db, hoje), f"kami-missoes-{dia}")
        for posicao, (tipo, alvo_id, titulo, atributo) in enumerate(escolhidas):
            _inserir(db, "dia", dia, posicao, tipo, alvo_id, titulo, atributo, 1, BONUS_DIARIA)

    semana = semana_inicio(hoje).isoformat()
    if not db.execute("SELECT 1 FROM missoes WHERE periodo = 'semana' AND referencia = ?", (semana,)).fetchone():
        tipo = random.Random(f"kami-missao-semanal-{semana}").choice(_candidatos_semanais(db))
        s = SEMANAIS[tipo]
        _inserir(db, "semana", semana, 0, tipo, None, s["titulo"], s["atributo"], s["quantidade"], BONUS_SEMANAL)


# ---------------- progresso ----------------

def _conta(db, where: str, args: tuple, inicio: str, fim: str, select: str = "COUNT(*)") -> int:
    return db.execute(
        f"SELECT {select} AS c FROM action_logs l "
        f"WHERE {_LOG_VALIDO} AND substr(l.created_at, 1, 10) BETWEEN ? AND ? AND ({where})",
        (inicio, fim, *args),
    ).fetchone()["c"]


def progresso(db, m) -> int:
    """Quanto da missão já foi feito no dia/semana dela (0..quantidade)."""
    if m["periodo"] == "dia":
        inicio = fim = m["referencia"]
    else:
        inicio = m["referencia"]
        fim = (datetime.date.fromisoformat(inicio) + datetime.timedelta(days=6)).isoformat()
    tipo, alvo = m["tipo"], m["alvo_id"]

    if tipo in ("lancamento", "lancamentos"):
        # lançamento = log de transação: desde o CONF-07 ele tem referência
        # 'transacao'; os antigos (de antes do vínculo) não têm nenhuma
        feito = _conta(
            db, "l.source = 'financas' AND (l.referencia_tipo = 'transacao' OR l.referencia_tipo IS NULL)",
            (), inicio, fim,
        )
    elif tipo == "conta_fixa":
        feito = _conta(
            db,
            "l.referencia_tipo = 'conta_fixa_periodo' AND l.referencia_id IN "
            "(SELECT id FROM fixed_bill_periods WHERE fixed_bill_id = ? AND mes_ano = ?)",
            (alvo, inicio[:7]), inicio, fim,
        )
    elif tipo == "renda":
        feito = _conta(db, "l.referencia_tipo = 'renda_entrada' AND l.referencia_id = ?", (alvo,), inicio, fim)
    elif tipo == "meta":
        feito = _conta(
            db, "l.referencia_tipo IN ('meta_contribuicao', 'meta_conclusao') AND l.referencia_id = ?",
            (alvo,), inicio, fim,
        )
    elif tipo == "marco":
        feito = _conta(
            db, "l.referencia_tipo = 'marco' AND l.referencia_id IN (SELECT id FROM milestones WHERE track_id = ?)",
            (alvo,), inicio, fim,
        )
    elif tipo == "marco_esquecido":
        feito = _conta(db, "l.referencia_tipo = 'marco' AND l.referencia_id = ?", (alvo,), inicio, fim)
    elif tipo == "marcos":
        feito = _conta(db, "l.referencia_tipo = 'marco'", (), inicio, fim)
    elif tipo == "link":
        feito = _conta(db, "l.referencia_tipo = 'link'", (), inicio, fim)
    elif tipo == "dias_ativos":
        feito = _conta(db, "1", (), inicio, fim, select="COUNT(DISTINCT substr(l.created_at, 1, 10))")
    elif tipo == "atributos":
        feito = db.execute(
            f"SELECT COUNT(DISTINCT ala.attribute_id) AS c FROM action_logs l "
            f"JOIN action_log_attributes ala ON ala.action_log_id = l.id "
            f"WHERE {_LOG_VALIDO} AND substr(l.created_at, 1, 10) BETWEEN ? AND ?",
            (inicio, fim),
        ).fetchone()["c"]
    elif tipo == "habito":
        feito = _conta(
            db, "l.referencia_tipo = 'habito_marca' AND l.referencia_id IN "
            "(SELECT id FROM habitos_marcas WHERE habito_id = ? AND dia = ?)",
            (alvo, inicio), inicio, fim,
        )
    elif tipo == "habitos_dias":
        feito = dias_com_tudo_feito(db, datetime.date.fromisoformat(inicio), datetime.date.fromisoformat(fim))
    else:
        feito = 0  # tipo desconhecido (banco mais novo que o código): nunca conclui
    return min(feito, m["quantidade"])


# ---------------- avaliação ----------------

def _atuais(db, hoje: datetime.date) -> list:
    return db.execute(
        "SELECT * FROM missoes WHERE (periodo = 'dia' AND referencia = ?) "
        "OR (periodo = 'semana' AND referencia = ?) ORDER BY periodo, posicao",
        (hoje.isoformat(), semana_inicio(hoje).isoformat()),
    ).fetchall()


def avaliar_missoes(db, hoje: datetime.date = None) -> list:
    """
    Sincroniza as missões do dia/semana atuais com os logs (ver docstring do
    módulo). Credita/estorna o bônus pelos caminhos de sempre
    (register_action/revert_actions com referencia 'missao'), que comitam.
    Devolve os títulos das missões concluídas agora.
    """
    from app.actions import register_action, revert_actions  # import local: actions importa este módulo

    hoje = hoje or datetime.date.today()
    concluidas = []
    for m in _atuais(db, hoje):
        cumprida = progresso(db, m) >= m["quantidade"]
        if cumprida and not m["concluida_em"]:
            db.execute("UPDATE missoes SET concluida_em = ? WHERE id = ?", (now_iso(), m["id"]))
            register_action(
                db,
                description=f"missão concluída: {m['titulo']}",
                categories=[m["atributo"]],
                xp=m["xp_bonus"],
                source=REF_MISSAO,
                referencia_tipo=REF_MISSAO,
                referencia_id=m["id"],
            )
            concluidas.append(m["titulo"])
        elif not cumprida and m["concluida_em"]:
            db.execute("UPDATE missoes SET concluida_em = NULL WHERE id = ?", (m["id"],))
            revert_actions(db, REF_MISSAO, m["id"])
    return concluidas


def listar_missoes(db, hoje: datetime.date = None) -> dict:
    """Missões do dia e da semana atuais, com progresso (pro widget)."""
    hoje = hoje or datetime.date.today()
    inicio = semana_inicio(hoje)

    def out(m):
        return {
            "id": m["id"],
            "tipo": m["tipo"],
            "titulo": m["titulo"],
            "atributo": m["atributo"],
            "xp_bonus": m["xp_bonus"],
            "progresso": progresso(db, m),
            "quantidade": m["quantidade"],
            "concluida": m["concluida_em"] is not None,
            "concluida_em": m["concluida_em"],
        }

    atuais = _atuais(db, hoje)
    semanal = [out(m) for m in atuais if m["periodo"] == "semana"]
    return {
        "hoje": hoje.isoformat(),
        "semana_inicio": inicio.isoformat(),
        "semana_fim": (inicio + datetime.timedelta(days=6)).isoformat(),
        "diarias": [out(m) for m in atuais if m["periodo"] == "dia"],
        "semanal": semanal[0] if semanal else None,
    }
