"""
Avisos proativos (IA-06) — as regras, no código, sem IA (P-133, P-141..P-144).

Cada regra devolve o que está "fora do lugar" agora, uma `Ocorrencia` por
item: o id do item (`alvo_id`), o `ciclo` (qual rodada da regra é — o mês
da categoria ou da conta fixa, o dia do último aporte, xp ou marco) e as
variáveis do texto. O texto em si fica no frontend (`avisos.<regra>.*`
nos dicionários), como os erros (P-97).

  categoria_acima    o gasto da categoria no mês passou ≥ 20% o do mês
                     anterior, que teve ≥ 3 lançamentos (P-141)
  conta_sem_saldo    conta fixa não paga vence em ≤ 3 dias e o saldo não
                     cobre — o da conta ligada; sem conta, a soma das contas
                     com saldo; menos as outras fixas não pagas que vencem
                     antes (P-143)
  meta_parada        meta ativa sem aporte há 21 dias (P-142: conta da
                     criação; meta de antes da 1.17 conta da 1ª checagem)
  atributo_esquecido atributo ativo, que já ganhou xp, sem xp há 14 dias;
                     nada nos primeiros 14 dias de uso (P-144)
  trilha_parada      trilha ativa com marco pendente e sem marco concluído
                     há 14 dias (conta da criação se nunca concluiu nenhum)

Metas de aprendizado ficam de fora de "meta parada": o progresso delas vem
dos marcos da trilha, que já tem a própria regra. Acadêmica também (vem da
formação, em carreira).
"""
import calendar
import datetime
from dataclasses import dataclass, field

from app.database import ate_o_fim, local_now, new_id, now_iso

REGRAS = ("categoria_acima", "conta_sem_saldo", "meta_parada", "atributo_esquecido", "trilha_parada")

ACIMA_PCT = 0.20
ACIMA_MIN_LANCAMENTOS = 3
VENCE_EM_DIAS = 3
META_DIAS = 21
ATRIBUTO_DIAS = 14
TRILHA_DIAS = 14


@dataclass
class Ocorrencia:
    regra: str
    alvo_id: str
    ciclo: str
    nome: str
    vars: dict = field(default_factory=dict)


def hoje() -> datetime.date:
    return local_now().date()


def _mes(d: datetime.date) -> str:
    return d.strftime("%Y-%m")


def _mes_anterior(d: datetime.date) -> str:
    return _mes(d.replace(day=1) - datetime.timedelta(days=1))


def _dia(iso: str | None) -> datetime.date | None:
    return datetime.date.fromisoformat(iso[:10]) if iso else None


# ---------------- regras ----------------

def categoria_acima(db, dia: datetime.date) -> list[Ocorrencia]:
    mes, anterior = _mes(dia), _mes_anterior(dia)
    soma = {
        r["category"]: (r["total"], r["n"])
        for r in db.execute(
            "SELECT category, SUM(amount) AS total, COUNT(*) AS n FROM transactions "
            "WHERE type = 'saida' AND date >= ? AND date < ? GROUP BY category",
            (anterior, ate_o_fim(anterior)),
        ).fetchall()
    }
    saida = []
    for r in db.execute(
        "SELECT category, SUM(amount) AS total FROM transactions "
        "WHERE type = 'saida' AND date >= ? AND date < ? GROUP BY category",
        (mes, ate_o_fim(mes)),
    ).fetchall():
        antes, n = soma.get(r["category"], (0, 0))
        if n < ACIMA_MIN_LANCAMENTOS or antes <= 0 or r["total"] < antes * (1 + ACIMA_PCT):
            continue
        saida.append(Ocorrencia("categoria_acima", r["category"], mes, r["category"], {
            "categoria": r["category"],
            "valor_mes": round(r["total"], 2),
            "valor_anterior": round(antes, 2),
            "pct": round((r["total"] / antes - 1) * 100),
        }))
    return saida


def _vencimento(ano: int, mes: int, dia_venc: int) -> datetime.date:
    # dia 31 em novembro cai no 30 (mesma regra do calendário)
    return datetime.date(ano, mes, min(dia_venc, calendar.monthrange(ano, mes)[1]))


def _fixas_a_vencer(db, dia: datetime.date, ate: datetime.date) -> list[dict]:
    """Contas fixas ativas não pagas com vencimento entre `dia` e `ate`."""
    meses = {(dia.year, dia.month)}
    prox = dia.replace(day=28) + datetime.timedelta(days=4)
    meses.add((prox.year, prox.month))
    pagas = {
        (r["fixed_bill_id"], r["mes_ano"])
        for r in db.execute("SELECT fixed_bill_id, mes_ano FROM fixed_bill_periods WHERE paga = 1").fetchall()
    }
    saida = []
    for b in db.execute("SELECT * FROM fixed_bills WHERE active = 1").fetchall():
        for ano, mes in meses:
            venc = _vencimento(ano, mes, b["due_day"])
            mes_ano = f"{ano:04d}-{mes:02d}"
            if dia <= venc <= ate and (b["id"], mes_ano) not in pagas:
                saida.append({"id": b["id"], "nome": b["name"], "valor": b["amount"], "conta_id": b["conta_id"],
                              "vence": venc, "mes_ano": mes_ano})
    return sorted(saida, key=lambda f: (f["vence"], f["nome"]))


def conta_sem_saldo(db, dia: datetime.date) -> list[Ocorrencia]:
    janela = dia + datetime.timedelta(days=VENCE_EM_DIAS)
    # as que vencem antes também comem o saldo: olha até o fim da janela
    fixas = _fixas_a_vencer(db, dia, janela)
    if not fixas:
        return []
    contas = {r["id"]: r for r in db.execute("SELECT * FROM wallet_accounts").fetchall()}
    total_saldo = sum((c["saldo_atual"] or 0) for c in contas.values() if c["possui_saldo"])
    saida = []
    for i, f in enumerate(fixas):
        conta = contas.get(f["conta_id"]) if f["conta_id"] else None
        if conta is not None and not conta["possui_saldo"]:
            continue  # só crédito: cai na fatura, saldo não entra
        if conta is not None:
            saldo = conta["saldo_atual"] or 0
            antes = [o for o in fixas[:i] if o["conta_id"] == f["conta_id"]]
        else:
            saldo = total_saldo
            antes = fixas[:i]
        livre = saldo - sum(o["valor"] for o in antes)
        if livre >= f["valor"]:
            continue
        saida.append(Ocorrencia("conta_sem_saldo", f["id"], f["mes_ano"], f["nome"], {
            "conta": f["nome"],
            "valor": round(f["valor"], 2),
            "valor_saldo": round(max(livre, 0), 2),
            "data": f["vence"].isoformat(),
            "dias": (f["vence"] - dia).days,
            "conta_carteira": conta["nome"] if conta is not None else None,
        }))
    return saida


def meta_parada(db, dia: datetime.date) -> list[Ocorrencia]:
    # P-142: meta de antes da 1.17 (sem data) conta a partir de agora
    db.execute("UPDATE goals SET created_at = ? WHERE created_at IS NULL", (now_iso(),))
    saida = []
    for g in db.execute(
        "SELECT g.id, g.title, g.created_at, MAX(c.date) AS ultimo FROM goals g "
        "LEFT JOIN goal_contributions c ON c.goal_id = g.id "
        "WHERE g.status = 'ativa' AND g.type NOT IN ('aprendizado', 'academica') "
        "AND g.current_value < g.target_value GROUP BY g.id"
    ).fetchall():
        desde = max(d for d in (_dia(g["ultimo"]), _dia(g["created_at"])) if d)
        dias = (dia - desde).days
        if dias >= META_DIAS:
            saida.append(Ocorrencia("meta_parada", g["id"], desde.isoformat(), g["title"],
                                    {"meta": g["title"], "dias": dias, "aporte": g["ultimo"] is not None}))
    return saida


def atributo_esquecido(db, dia: datetime.date) -> list[Ocorrencia]:
    primeiro = db.execute("SELECT MIN(created_at) AS d FROM action_logs").fetchone()["d"]
    if not primeiro or (dia - _dia(primeiro)).days < ATRIBUTO_DIAS:
        return []  # P-144: nada nos primeiros 14 dias de uso
    saida = []
    for a in db.execute(
        "SELECT a.id, a.name, MAX(l.created_at) AS ultimo FROM attributes a "
        "JOIN action_log_attributes la ON la.attribute_id = a.id "
        "JOIN action_logs l ON l.id = la.action_log_id AND l.xp_gained > 0 "
        "WHERE a.is_active = 1 GROUP BY a.id"
    ).fetchall():
        desde = _dia(a["ultimo"])
        dias = (dia - desde).days
        if dias >= ATRIBUTO_DIAS:
            saida.append(Ocorrencia("atributo_esquecido", a["id"], desde.isoformat(), a["name"],
                                    {"atributo": a["name"], "dias": dias}))
    return saida


def trilha_parada(db, dia: datetime.date) -> list[Ocorrencia]:
    saida = []
    for t in db.execute(
        "SELECT t.id, t.name, t.created_at, MAX(m.completed_at) AS ultimo, "
        "SUM(m.status = 'pendente') AS pendentes FROM tracks t "
        "LEFT JOIN milestones m ON m.track_id = t.id "
        "WHERE t.status = 'ativa' GROUP BY t.id"
    ).fetchall():
        if not t["pendentes"]:
            continue  # sem marco pendente: terminou (ou ainda vazia)
        desde = _dia(t["ultimo"]) or _dia(t["created_at"])
        dias = (dia - desde).days
        if dias >= TRILHA_DIAS:
            saida.append(Ocorrencia("trilha_parada", t["id"], desde.isoformat(), t["name"],
                                    {"trilha": t["name"], "dias": dias, "concluiu": t["ultimo"] is not None}))
    return saida


_FUNCOES = {
    "categoria_acima": categoria_acima,
    "conta_sem_saldo": conta_sem_saldo,
    "meta_parada": meta_parada,
    "atributo_esquecido": atributo_esquecido,
    "trilha_parada": trilha_parada,
}


# ---------------- estado (dispensar, silenciar) ----------------

def silenciados(db) -> set[tuple[str, str]]:
    return {(r["regra"], r["alvo_id"]) for r in db.execute("SELECT regra, alvo_id FROM avisos_silenciados").fetchall()}


def ligados(sil: set[tuple[str, str]]) -> bool:
    return ("*", "") not in sil


def checar(db, dia: datetime.date | None = None) -> list[dict]:
    """
    Roda as regras ligadas e devolve os avisos ativos (não dispensados nem
    silenciados), com o id da linha. Guarda um por regra+item: ciclo novo
    substitui o anterior (e desfaz o "dispensar" dele); o que deixou de
    valer (conta paga, aporte feito) sai.
    """
    dia = dia or hoje()
    sil = silenciados(db)
    if not ligados(sil):
        return []
    agora = now_iso()
    linhas = {(r["regra"], r["alvo_id"]): r for r in db.execute("SELECT * FROM avisos").fetchall()}
    vistos, saida = set(), []
    for regra in REGRAS:
        if (regra, "") in sil:
            continue
        for oc in _FUNCOES[regra](db, dia):
            chave = (oc.regra, oc.alvo_id)
            vistos.add(chave)
            linha = linhas.get(chave)
            if linha is None or linha["ciclo"] != oc.ciclo:
                aviso_id = linha["id"] if linha else None
                if linha:
                    db.execute(
                        "UPDATE avisos SET ciclo = ?, criado_em = ?, dispensado_em = NULL, notificado_em = NULL WHERE id = ?",
                        (oc.ciclo, agora, aviso_id),
                    )
                else:
                    aviso_id = new_id()
                    db.execute(
                        "INSERT INTO avisos (id, regra, alvo_id, ciclo, criado_em) VALUES (?, ?, ?, ?, ?)",
                        (aviso_id, oc.regra, oc.alvo_id, oc.ciclo, agora),
                    )
                linha = {"id": aviso_id, "dispensado_em": None, "notificado_em": None, "criado_em": agora}
            if linha["dispensado_em"] or chave in sil:
                continue
            saida.append({
                "id": linha["id"], "regra": oc.regra, "alvo_id": oc.alvo_id, "nome": oc.nome,
                "vars": oc.vars, "criado_em": linha["criado_em"], "notificado": linha["notificado_em"] is not None,
            })
    # o que deixou de valer sai; o dispensado fica, pra não voltar no mesmo
    # ciclo (categoria que caiu e subiu de novo no mês)
    for chave, linha in linhas.items():
        if chave not in vistos and not linha["dispensado_em"]:
            db.execute("DELETE FROM avisos WHERE id = ?", (linha["id"],))
    db.commit()
    return saida
