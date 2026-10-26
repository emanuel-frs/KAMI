"""
Retrospectiva mensal (GAM-12). No primeiro acesso de um mês novo, o mês
que acabou vira um resumo: xp por atributo, ações, dias ativos, melhor
sequência, missões concluídas, conquistas liberadas, a "ação do mês" (a de
mais xp) e a comparação com o mês anterior. Regras combinadas com o
Emanuel em 2026-10-09.

O resumo é calculado UMA vez e guardado em `retrospectivas.dados_json`:
a retrospectiva é uma foto do mês, não muda se depois uma ação antiga for
desfeita ou uma conquista rebloqueada. Geração preguiçosa (mesmo padrão
das missões e da proteção de sequência): `garantir_retrospectiva` roda na
leitura (`GET /api/nucleo/retrospectivas`) e só gera o mês ANTERIOR ao
atual — e só se ele teve alguma ação (mês vazio não vira retrospectiva).
Não gera meses mais antigos de uma vez: quem atualiza o app não ganha uma
pilha de retrospectivas antigas.

"Ação" aqui segue as outras regras da gamificação: logs de bônus (missão,
GAM-07; xp, GAM-08) contam no xp do mês — é xp ganho —, mas não como ação
nem pra dias ativos / ação do mês.
"""
import datetime
import json

from app.achievements import REFS_BONUS
from app.database import now_iso

_NOT_BONUS = "(l.referencia_tipo IS NULL OR l.referencia_tipo NOT IN ({}))".format(
    ", ".join(f"'{r}'" for r in REFS_BONUS)
)


def mes_anterior(mes: str) -> str:
    """'2026-10' → '2026-09'."""
    ano, m = int(mes[:4]), int(mes[5:7])
    return f"{ano - 1}-12" if m == 1 else f"{ano}-{m - 1:02d}"


def _dias_no_mes(mes: str) -> int:
    ano, m = int(mes[:4]), int(mes[5:7])
    proximo = datetime.date(ano + (m == 12), 1 if m == 12 else m + 1, 1)
    return (proximo - datetime.date(ano, m, 1)).days


def _numeros(db, mes: str) -> dict:
    """Números que entram na comparação com o mês anterior."""
    xp = db.execute(
        "SELECT COALESCE(SUM(l.xp_gained), 0) AS t FROM action_logs l "
        "JOIN action_log_attributes ala ON ala.action_log_id = l.id "
        "WHERE substr(l.created_at, 1, 7) = ?",
        (mes,),
    ).fetchone()["t"]
    acoes = db.execute(
        f"SELECT COUNT(*) AS c, COUNT(DISTINCT substr(l.created_at, 1, 10)) AS d FROM action_logs l "
        f"WHERE substr(l.created_at, 1, 7) = ? AND {_NOT_BONUS}",
        (mes,),
    ).fetchone()
    missoes = db.execute(
        "SELECT COUNT(*) AS c FROM missoes WHERE substr(concluida_em, 1, 7) = ?", (mes,)
    ).fetchone()["c"]
    return {"xp_total": xp, "acoes": acoes["c"], "dias_ativos": acoes["d"], "missoes": missoes}


def _melhor_sequencia(db, mes: str) -> int:
    """Maior sequência de dias seguidos DENTRO do mês (dia com ação ou protegido, GAM-06)."""
    dias = {
        r["d"]
        for r in db.execute(
            f"SELECT DISTINCT substr(l.created_at, 1, 10) AS d FROM action_logs l "
            f"WHERE substr(l.created_at, 1, 7) = ? AND {_NOT_BONUS}",
            (mes,),
        ).fetchall()
    } | {r["dia"] for r in db.execute("SELECT dia FROM dias_protegidos WHERE substr(dia, 1, 7) = ?", (mes,)).fetchall()}
    melhor = atual = 0
    inicio = datetime.date(int(mes[:4]), int(mes[5:7]), 1)
    for n in range(_dias_no_mes(mes)):
        if (inicio + datetime.timedelta(days=n)).isoformat() in dias:
            atual += 1
            melhor = max(melhor, atual)
        else:
            atual = 0
    return melhor


def resumo_mes(db, mes: str) -> dict:
    xp_por_atributo = {
        r["name"]: r["t"]
        for r in db.execute(
            "SELECT a.name, COALESCE(SUM(l.xp_gained), 0) AS t FROM attributes a "
            "LEFT JOIN action_log_attributes ala ON ala.attribute_id = a.id "
            "LEFT JOIN action_logs l ON l.id = ala.action_log_id AND substr(l.created_at, 1, 7) = ? "
            "GROUP BY a.id ORDER BY a.name",
            (mes,),
        ).fetchall()
    }
    acao = db.execute(
        f"SELECT l.description, l.descricao_chave, l.descricao_vars, l.xp_gained, substr(l.created_at, 1, 10) AS dia FROM action_logs l "
        f"WHERE substr(l.created_at, 1, 7) = ? AND {_NOT_BONUS} "
        f"ORDER BY l.xp_gained DESC, l.created_at LIMIT 1",
        (mes,),
    ).fetchone()
    # I18N: título em português + chave (o frontend traduz pela chave; a
    # personalizada não tem). Retrospectiva gravada antes disso tem só o
    # título (string) — o frontend aceita os dois formatos.
    conquistas = [
        {"titulo": r["title"], "chave": r["chave"]}
        for r in db.execute(
            "SELECT title, chave FROM achievements WHERE substr(unlocked_at, 1, 7) = ? ORDER BY unlocked_at", (mes,)
        ).fetchall()
    ]
    return {
        "mes": mes,
        "dias_no_mes": _dias_no_mes(mes),
        **_numeros(db, mes),
        "melhor_sequencia": _melhor_sequencia(db, mes),
        "xp_por_atributo": xp_por_atributo,
        "conquistas": conquistas,
        "acao_do_mes": {
            "descricao": acao["description"], "xp": acao["xp_gained"], "dia": acao["dia"],
            # I18N: chave + variáveis do texto (nulas quando é texto da pessoa)
            "chave": acao["descricao_chave"], "vars": json.loads(acao["descricao_vars"] or "{}"),
        } if acao else None,
        "anterior": {"mes": mes_anterior(mes), **_numeros(db, mes_anterior(mes))},
    }


def garantir_retrospectiva(db, hoje: datetime.date = None) -> None:
    """Gera a retrospectiva do mês anterior, se ainda não existe e o mês teve ação. NÃO comita."""
    hoje = hoje or datetime.date.today()
    mes = mes_anterior(hoje.strftime("%Y-%m"))
    if db.execute("SELECT 1 FROM retrospectivas WHERE mes = ?", (mes,)).fetchone():
        return
    teve_acao = db.execute(
        f"SELECT 1 FROM action_logs l WHERE substr(l.created_at, 1, 7) = ? AND {_NOT_BONUS} LIMIT 1", (mes,)
    ).fetchone()
    if not teve_acao:
        return
    db.execute(
        "INSERT OR IGNORE INTO retrospectivas (mes, dados_json, created_at) VALUES (?, ?, ?)",
        (mes, json.dumps(resumo_mes(db, mes), ensure_ascii=False), now_iso()),
    )
