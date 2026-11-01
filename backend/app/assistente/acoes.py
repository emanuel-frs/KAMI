"""
Ações do assistente (IA-05, princípio 4 — "a IA propõe, a pessoa aprova").

O modelo NUNCA grava nada. A única ferramenta de escrita que ele tem é
`propose_actions`: devolve uma lista de itens que vira um cartão de prévia
no chat (P-123). Daí em diante é tudo pela tela, em rotas próprias que o
modelo não alcança:

    propor()     args do modelo → proposta no formato do Kami, cada item já
                 conferido pelas MESMAS validações das rotas (item com
                 problema vem marcado e desmarcado, nunca some)
    aplicar()    os itens que a pessoa marcou (com as edições dela) →
                 cópia do banco (P-127) → cria pelas funções das rotas
                 (mesmas regras, xp e conquistas — P-125) → lote
    conferir()   o que de um lote ainda está como foi criado, o que a
                 pessoa mexeu depois e o que já sumiu (P-124)
    desfazer()   apaga o que o lote criou (o editado só se a pessoa pedir),
                 estorna o xp exato e devolve à caixa de entrada o que saiu
                 de lá (P-128)

Tipos:
- F1 (IA-05a): nota, tarefa (linha na nota "tarefas"), lembrete, evento e
  hábito — cada um pode vir de um item da caixa de entrada (`entrada`),
  que sai de lá ao aplicar;
- F2 (IA-05b): lançamento (gasto/entrada — inclusive um extrato colado,
  P-129), meta (P-137) e plano de estudo (P-131/P-138: trilha + marcos +
  meta de aprendizado ligada + evento na data de cada marco). Os
  lançamentos usam UMA conta e UMA forma de pagamento pro lote inteiro
  (P-136), escolhidas no topo do cartão (`proposta["conta_id"]`,
  `["forma"]`); os itens do plano dependem da trilha (`depende` = índice
  dela) e só vão junto com ela.

Item com `problema` (chave do erro) não pode ser aplicado como está; item
com `aviso` (ex.: parece repetido de um lançamento que já existe) pode,
mas vem desmarcado — a pessoa decide.

Os nomes que o modelo vê (tipos, campos, valores de repetição) são em
inglês, como o resto das ferramentas; aqui dentro tudo vira o formato das
rotas do Kami.
"""
import json
import re
from datetime import date

from pydantic import ValidationError

from app import backup_auto
from app.actions import revert_actions
from app.assistente.tipos import Ferramenta
from app.database import local_now, new_id, now_iso
from app.mensagens import ErroKami

NOME = "propose_actions"
ITENS_MAX = 50
MARCOS_MAX = 20
TEXTO_TAREFA_MAX = 500
TIPOS = ("nota", "tarefa", "lembrete", "evento", "habito", "lancamento", "meta", "trilha", "marco")
_TIPO_DO_MODELO = {"note": "nota", "task": "tarefa", "reminder": "lembrete", "event": "evento", "habit": "habito",
                   "expense": "lancamento", "income": "lancamento", "goal": "meta", "learning_plan": "trilha"}
_REPETE = ("none", "daily", "weekdays", "weekly", "monthly", "yearly")
# P-137: acadêmica depende de uma formação cadastrada; aprendizado vem pelo plano
METAS = ("livre", "financeira", "saude", "leitura", "habito")
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# o que a pessoa pode mudar em cada coisa criada: se mudou depois do lote,
# desfazer pergunta antes de apagar (P-124)
_TABELA = {"nota": "notas", "lembrete": "lembretes", "evento": "calendar_events", "habito": "habitos",
           "lancamento": "transactions", "meta": "goals", "trilha": "tracks", "marco": "milestones"}
_RETRATO = {
    "nota": ("titulo", "conteudo", "trancada", "arquivada"),
    "lembrete": ("titulo", "data", "hora", "repeticao", "dias_semana"),
    "evento": ("title", "date", "time", "notes", "recurrence", "recurrence_end", "reminder_minutes_before"),
    "habito": ("nome", "frequencia", "dias_semana", "vezes_semana", "atributo", "status"),
    "lancamento": ("description", "amount", "type", "category", "conta_id", "date", "forma_pagamento"),
    "meta": ("title", "type", "target_value", "deadline", "weight", "current_value", "status", "unit_label"),
    "trilha": ("name", "general_goal", "status"),
    "marco": ("title", "description", "status", "notes"),
}

ESTADOS = ("pendente", "aplicada", "descartada", "desfeita")


def ferramenta(atributos: list[str]) -> Ferramenta:
    return Ferramenta(
        NOME,
        "Propose creating things in Kami: notes, to-do tasks, reminders, calendar events, habits, money entries "
        "(expense/income — one item per line of a pasted statement), goals and learning plans. NOTHING is saved by "
        "this call: Kami shows the items to the person as a preview card, and they edit, choose and apply them. Use "
        "it only when the person asks you to create or organize something (including sorting their inbox). Send all "
        "items of the request in ONE call (max 50).",
        {
            "type": "object",
            "properties": {
                "account": {"type": "string",
                            "description": "expense/income: name of the person's account they belong to (from "
                                           "accounts_and_categories); the person confirms it in the card."},
                "payment": {"type": "string", "enum": ["balance", "credit"],
                            "description": "expenses: paid from the balance or on the credit card (a card bill "
                                           "statement = credit)."},
                "items": {
                    "type": "array",
                    "maxItems": ITENS_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": list(_TIPO_DO_MODELO)},
                            "title": {"type": "string",
                                      "description": "Note/reminder/event/goal title, habit name, task text, money "
                                                     "entry description, or the learning plan's track name."},
                            "content": {"type": "string",
                                        "description": "note: Markdown body. event: optional notes. learning_plan: "
                                                       "the overall objective."},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "note only."},
                            "date": {"type": "string",
                                     "description": "YYYY-MM-DD. reminder, event, expense/income: required."},
                            "time": {"type": "string", "description": "HH:MM, 24h. reminder: default 09:00; event: optional."},
                            "repeat": {"type": "string", "enum": list(_REPETE),
                                       "description": "reminder/event/habit. weekdays = on the days in `weekdays`; "
                                                      "habit weekly = `times_per_week` on any days."},
                            "weekdays": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6},
                                         "description": "0 = Monday … 6 = Sunday."},
                            "times_per_week": {"type": "integer", "minimum": 1, "maximum": 7},
                            "attribute": {"type": "string", "enum": atributos,
                                          "description": "habit: the attribute that earns its xp."},
                            "amount": {"type": "number", "description": "expense/income: positive value."},
                            "category": {"type": "string",
                                         "description": "expense/income: reuse one of the person's categories when it fits."},
                            "source_line": {"type": "string",
                                            "description": "expense/income from a pasted statement: the original line."},
                            "unclear": {"type": "boolean",
                                        "description": "expense/income: true when you could not read this statement "
                                                       "line for sure — never guess values; put the line in source_line."},
                            "goal_type": {"type": "string", "enum": list(METAS)},
                            "target": {"type": "number", "description": "goal: the target value (money for financeira)."},
                            "unit_label": {"type": "string", "description": "goal: unit for non-money goals (kg, pages…)."},
                            "deadline": {"type": "string", "description": "goal: optional YYYY-MM-DD."},
                            "milestones": {
                                "type": "array", "maxItems": MARCOS_MAX,
                                "description": "learning_plan: the steps, in order, each with an optional target date.",
                                "items": {"type": "object", "properties": {
                                    "title": {"type": "string"}, "description": {"type": "string"},
                                    "date": {"type": "string", "description": "optional YYYY-MM-DD."}},
                                    "required": ["title"]},
                            },
                            "inbox_ref": {"type": "string",
                                          "description": "REQUIRED when the item comes from the inbox: that inbox "
                                                         "item's `ref`. It leaves the inbox when applied; without it, "
                                                         "it stays there duplicated."},
                        },
                        "required": ["type", "title"],
                    },
                },
            },
            "required": ["items"],
        },
    )


def atributos(conn) -> list[str]:
    return [r["name"] for r in conn.execute("SELECT name FROM attributes WHERE is_active = 1 ORDER BY name")]


def contas(conn) -> list[dict]:
    """As contas da carteira, pro seletor do cartão (P-136)."""
    rows = conn.execute(
        "SELECT a.id, a.nome, b.nome AS banco, a.possui_saldo, a.possui_credito FROM wallet_accounts a "
        "JOIN wallet_banks b ON b.id = a.bank_id ORDER BY b.nome, a.nome"
    ).fetchall()
    return [{"id": r["id"], "nome": r["nome"], "banco": r["banco"], "saldo": bool(r["possui_saldo"]),
             "credito": bool(r["possui_credito"])} for r in rows]


# ── do modelo pro formato do Kami ─────────────────────────────────────────

def _txt(v, maximo: int = 200) -> str:
    return " ".join(v.split())[:maximo] if isinstance(v, str) else ""


def _num(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _dias(v) -> list[int]:
    if not isinstance(v, list):
        return []
    return sorted({int(d) for d in v if isinstance(d, (int, float)) and not isinstance(d, bool) and 0 <= d <= 6})


def _data_ou_vazio(v) -> str:
    return v if isinstance(v, str) and _DATA.match(v) else ""


def _dados(tipo: str, a: dict) -> dict:
    titulo = _txt(a.get("title"))
    repete = a.get("repeat") if a.get("repeat") in _REPETE else "none"
    dias = _dias(a.get("weekdays"))
    data = a.get("date") if isinstance(a.get("date"), str) else ""
    hora = a.get("time") if isinstance(a.get("time"), str) and _HORA.match(a.get("time")) else ""
    if tipo == "nota":
        tags = [_txt(t, 40) for t in a.get("tags") or [] if isinstance(t, str) and _txt(t, 40)][:10]
        conteudo = a.get("content") if isinstance(a.get("content"), str) else ""
        return {"titulo": titulo, "conteudo": conteudo[:20_000], "tags": tags}
    if tipo == "tarefa":
        return {"texto": _txt(a.get("title"), TEXTO_TAREFA_MAX)}
    if tipo == "lembrete":
        if repete == "weekly" and not dias and _DATA.match(data):
            try:
                dias = [date.fromisoformat(data).weekday()]
            except ValueError:
                pass
        repeticao = {"daily": "diario", "weekdays": "dias", "weekly": "dias", "monthly": "mensal", "yearly": "anual"}.get(repete, "nao")
        return {"titulo": titulo, "data": data, "hora": hora or "09:00", "repeticao": repeticao,
                "dias_semana": dias if repeticao == "dias" else []}
    if tipo == "evento":
        recorrencia = {"daily": "daily", "weekdays": "weekly", "weekly": "weekly", "monthly": "monthly", "yearly": "yearly"}.get(repete, "none")
        notas = a.get("content") if isinstance(a.get("content"), str) else ""
        return {"titulo": titulo, "data": data, "hora": hora, "notas": notas[:2000], "repeticao": recorrencia}
    if tipo == "lancamento":
        return {"descricao": titulo, "valor": round(abs(_num(a.get("amount"))), 2),
                "tipo": "entrada" if a.get("type") == "income" else "saida",
                "categoria": _txt(a.get("category"), 60), "data": data}
    if tipo == "meta":
        tipo_meta = a.get("goal_type") if a.get("goal_type") in METAS else "livre"
        return {"titulo": titulo, "tipo": tipo_meta, "alvo": round(_num(a.get("target")), 2),
                "rotulo": _txt(a.get("unit_label"), 30) if tipo_meta != "financeira" else "",
                "prazo": _data_ou_vazio(a.get("deadline")), "peso": "medio", "conta_id": ""}
    # hábito
    vezes = a.get("times_per_week")
    vezes = int(vezes) if isinstance(vezes, (int, float)) and not isinstance(vezes, bool) and 1 <= vezes <= 7 else 3
    frequencia = {"weekdays": "dias", "weekly": "semana"}.get(repete, "diario")
    if frequencia == "dias" and not dias:
        frequencia = "diario"
    return {"nome": titulo, "frequencia": frequencia, "dias_semana": dias if frequencia == "dias" else [],
            "vezes_semana": vezes, "atributo": a.get("attribute") if isinstance(a.get("attribute"), str) else "organizacao"}


def _plano(a: dict, inicio: int) -> list[dict]:
    """learning_plan → trilha + marcos + meta de aprendizado (P-131/P-138).
    `inicio` é o índice que a trilha vai ter na proposta."""
    marcos = [m for m in (a.get("milestones") or []) if isinstance(m, dict)][:MARCOS_MAX]
    trilha = {"tipo": "trilha", "dados": {"nome": _txt(a.get("title"), 120),
                                          "objetivo": _txt(a.get("content"), 500)}, "entrada": None}
    itens = [trilha]
    for m in marcos:
        descricao = m.get("description") if isinstance(m.get("description"), str) else ""
        itens.append({"tipo": "marco", "depende": inicio, "entrada": None,
                      "dados": {"titulo": _txt(m.get("title")), "descricao": descricao[:2000],
                                "data": _data_ou_vazio(m.get("date"))}})
    datas = sorted(m["dados"]["data"] for m in itens[1:] if m["dados"]["data"])
    if len(itens) > 1:
        itens.append({"tipo": "meta", "depende": inicio, "entrada": None,
                      "dados": {"titulo": trilha["dados"]["nome"], "tipo": "aprendizado", "alvo": float(len(itens) - 1),
                                "rotulo": "", "prazo": datas[-1] if datas else "", "peso": "medio", "conta_id": ""}})
    return itens


# ── validação (as mesmas das rotas) ───────────────────────────────────────

def _modelo(tipo: str, d: dict, ctx: dict | None = None):
    """O payload da rota que cria este tipo. ValidationError/ErroKami se não serve."""
    from app.routers import aprendizado, calendario, habitos, lembretes, metas, notas
    from app.routers.financas import lancamentos

    if tipo == "nota":
        if not d["titulo"].strip() and not d["conteudo"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        return notas.NotaIn(titulo=d["titulo"], conteudo=d["conteudo"], tags=d["tags"])
    if tipo == "lembrete":
        return lembretes.LembreteIn(titulo=d["titulo"], data=d["data"], hora=d["hora"],
                                    repeticao=d["repeticao"], dias_semana=d["dias_semana"])
    if tipo == "evento":
        return calendario.EventoIn(title=d["titulo"], date=d["data"], time=d["hora"] or None,
                                   notes=d["notas"] or None, recurrence=d["repeticao"])
    if tipo == "habito":
        return habitos.HabitoIn(nome=d["nome"], frequencia=d["frequencia"], dias_semana=d["dias_semana"],
                                vezes_semana=d["vezes_semana"], atributo=d["atributo"])
    if tipo == "lancamento":
        ctx = ctx or {}
        return lancamentos.TransactionIn(
            description=d["descricao"], amount=d["valor"], type=d["tipo"], category=d["categoria"], date=d["data"],
            conta_id=ctx.get("conta_id") or "", forma_pagamento=ctx.get("forma") if d["tipo"] == "saida" else None)
    if tipo == "meta":
        return metas.GoalIn(title=d["titulo"], type=d["tipo"], target_value=d["alvo"], deadline=d["prazo"] or None,
                            weight=d["peso"], unit_label=d["rotulo"] or None,
                            linked_conta_id=(d["conta_id"] or None) if d["tipo"] == "financeira" else None,
                            linked_track_id=(ctx or {}).get("trilha_id"))
    if tipo == "trilha":
        return aprendizado.TrackIn(name=d["nome"].strip(), general_goal=d["objetivo"].strip() or None)
    if tipo == "marco":
        return aprendizado.MilestoneIn(title=d["titulo"].strip(), description=d["descricao"].strip() or None)
    return None


def _conferir_lancamento(conn, d: dict, ctx: dict) -> None:
    if not d["descricao"].strip():
        raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
    if d["valor"] <= 0:
        raise ErroKami(422, "erro.assistente.valor_invalido", "valor precisa ser maior que zero")
    if not d["categoria"].strip():
        raise ErroKami(422, "erro.assistente.sem_categoria", "falta a categoria")
    _conferir_data(d["data"], obrigatoria=True)
    conta = conn.execute("SELECT * FROM wallet_accounts WHERE id = ?", (ctx.get("conta_id") or "",)).fetchone()
    if not conta:
        raise ErroKami(422, "erro.assistente.escolha_a_conta", "escolha a conta dos lançamentos")
    # as mesmas regras de finance_utils (o saldo suficiente só dá pra saber
    # na hora de aplicar, em ordem — aplicar() devolve o índice)
    if d["tipo"] == "entrada" and not conta["possui_saldo"]:
        raise ErroKami(422, "erro.assistente.conta_sem_saldo", "essa conta não recebe entradas (só crédito)")
    if d["tipo"] == "saida" and conta["possui_saldo"] and conta["possui_credito"] and ctx.get("forma") not in ("saldo", "credito"):
        raise ErroKami(422, "erro.assistente.escolha_a_forma", "escolha se foi no saldo ou no crédito")


def _conferir_data(v: str, obrigatoria: bool = False, futura: bool = False) -> None:
    """`futura`: marco de plano e prazo de meta — data que já passou é
    engano do modelo (visto no teste: plano de 3 meses com marco em janeiro
    do ano corrente)."""
    if not v and not obrigatoria:
        return
    try:
        if not _DATA.match(v):
            raise ValueError
        dia = date.fromisoformat(v)
    except ValueError:
        raise ErroKami(422, "erro.calendario.date_deve_ser_yyyy_mm", "'date' deve ser 'YYYY-MM-DD'") from None
    if futura and dia < local_now().date():
        raise ErroKami(422, "erro.assistente.data_passada", "essa data já passou")


def _conferir_meta(conn, d: dict) -> None:
    from app.routers import metas

    if not d["titulo"].strip():
        raise ErroKami(422, "erro.comum.titulo_obrigatorio", "título é obrigatório")
    if d["tipo"] not in METAS and d["tipo"] != "aprendizado":
        raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
    if d["tipo"] != "aprendizado" and d["alvo"] <= 0:  # aprendizado: o alvo é o nº de marcos
        raise ErroKami(422, "erro.metas.alvo_precisa_ser_maior_zero", "alvo precisa ser maior que zero")
    if d["peso"] not in metas.GOAL_WEIGHTS:
        raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
    _conferir_data(d["prazo"], futura=True)
    if d["tipo"] == "financeira" and d["conta_id"] and not conn.execute(
            "SELECT 1 FROM wallet_accounts WHERE id = ?", (d["conta_id"],)).fetchone():
        raise ErroKami(422, "erro.metas.conta_padrao_nao_encontrada", "conta padrão não encontrada")


def _conferir_item(conn, tipo: str, d: dict, ctx: dict) -> None:
    """Levanta ErroKami com a chave do problema (a mesma que a tela mostraria)."""
    from app.routers import calendario, habitos, lembretes

    if tipo == "tarefa":
        if not d["texto"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        return
    if tipo == "lancamento":
        return _conferir_lancamento(conn, d, ctx)
    if tipo == "meta":
        return _conferir_meta(conn, d)
    if tipo in ("trilha", "marco"):
        if not (d.get("nome") or d.get("titulo") or "").strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        if tipo == "marco":
            _conferir_data(d["data"], futura=True)
        return
    try:
        p = _modelo(tipo, d)
    except ValidationError:
        raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos") from None
    if tipo == "lembrete":
        lembretes._validar(conn, p)
        if lembretes._proxima(lembretes._regra(p)) is None:
            raise ErroKami(422, "erro.lembretes.esse_horario_ja_passou", "esse horário já passou")
    elif tipo == "evento":
        calendario._validate_evento(p)
    elif tipo == "habito":
        habitos._validar(conn, p.frequencia, p.dias_semana, p.atributo)


def _erro(conn, item: dict, ctx: dict) -> ErroKami | None:
    if item.get("ilegivel"):
        return ErroKami(422, "erro.assistente.linha_ilegivel", "o assistente não entendeu esta linha — confira e corrija")
    try:
        _conferir_item(conn, item["tipo"], item["dados"], ctx)
    except ErroKami as e:
        return e
    if item.get("entrada") and not conn.execute("SELECT 1 FROM caixa_entrada WHERE id = ?", (item["entrada"]["id"],)).fetchone():
        return ErroKami(409, "erro.assistente.entrada_sumiu", "esse item já saiu da caixa de entrada")
    return None


def _problema(conn, item: dict, ctx: dict) -> str | None:
    e = _erro(conn, item, ctx)
    return e.chave if e else None


def _aviso(conn, item: dict) -> str | None:
    """P-129: lançamento igual (data + valor + tipo) a um que já existe
    vem desmarcado — o extrato costuma repetir o que já foi lançado à mão."""
    if item["tipo"] != "lancamento":
        return None
    d = item["dados"]
    if conn.execute("SELECT 1 FROM transactions WHERE date = ? AND type = ? AND abs(amount - ?) < 0.005",
                    (d["data"], d["tipo"], d["valor"])).fetchone():
        return "assistente.proposta.parece_repetido"
    return None


def _conta_sugerida(lista: list[dict], nome) -> str:
    """A conta que o modelo citou pelo nome; senão, a primeira com saldo."""
    alvo = _txt(nome, 120).lower()
    if alvo:
        for c in lista:
            nomes = {c["nome"].lower(), f"{c['banco']} {c['nome']}".lower(), c["banco"].lower()}
            if alvo in nomes or any(alvo in n or n in alvo for n in nomes if len(n) >= 3):
                return c["id"]
    com_saldo = [c for c in lista if c["saldo"]]
    return (com_saldo or lista or [{"id": ""}])[0]["id"]


def propor(conn, args: dict) -> dict:
    """A proposta pronta pro cartão: {"itens", e, com lançamento ou meta
    financeira, "contas", "conta_id", "forma"}. ValueError (texto em
    inglês, volta pro modelo se corrigir) se não dá pra montar nada."""
    brutos = args.get("items") if isinstance(args, dict) else None
    # IA-07a: modelo pequeno às vezes manda UM item solto, sem a lista
    # ({"type": "note", "title": …}) e repete o erro até acabar as rodadas —
    # um item solto vale como lista de um
    if brutos is None and isinstance(args, dict) and args.get("type") and (args.get("title") or args.get("content")):
        brutos = [{k: v for k, v in args.items() if k != "items"}]
    if isinstance(brutos, str):  # a lista veio como texto JSON
        try:
            brutos = json.loads(brutos)
        except ValueError:
            brutos = None
    if not isinstance(brutos, list) or not brutos:
        raise ValueError('items must be a non-empty list, e.g. {"items": [{"type": "note", "title": "...", "content": "..."}]}')
    itens, refs = [], set()
    for a in brutos:
        if not isinstance(a, dict) or a.get("type") not in _TIPO_DO_MODELO:
            raise ValueError(f"each item needs a type: {', '.join(_TIPO_DO_MODELO)}")
        if a["type"] == "learning_plan":
            itens += _plano(a, len(itens))
            continue
        tipo = _TIPO_DO_MODELO[a["type"]]
        entrada = None
        ref = a.get("inbox_ref")
        if isinstance(ref, str) and ref and ref not in refs:
            row = conn.execute("SELECT id, texto, criado_em FROM caixa_entrada WHERE id = ?", (ref,)).fetchone()
            if row is None:
                raise ValueError(f"inbox_ref {ref!r} is not in the inbox — use the refs from the inbox tool")
            refs.add(ref)
            entrada = dict(row)
        item = {"tipo": tipo, "dados": _dados(tipo, a), "entrada": entrada}
        if tipo == "lancamento":
            if isinstance(a.get("source_line"), str) and a["source_line"].strip():
                item["linha"] = a["source_line"].strip()[:300]
            if a.get("unclear") is True:
                item["ilegivel"] = True
        itens.append(item)
    if len(itens) > ITENS_MAX:
        raise ValueError(f"at most {ITENS_MAX} items per proposal (a learning plan counts its track, milestones and goal)")
    proposta = {"itens": itens}
    if any(i["tipo"] == "lancamento" or (i["tipo"] == "meta" and i["dados"]["tipo"] == "financeira") for i in itens):
        lista = contas(conn)
        proposta["contas"] = lista
        proposta["conta_id"] = _conta_sugerida(lista, args.get("account"))
        conta = next((c for c in lista if c["id"] == proposta["conta_id"]), None)
        pedido = {"balance": "saldo", "credit": "credito"}.get(args.get("payment"))
        proposta["forma"] = pedido if conta and conta["saldo"] and conta["credito"] else None
    ctx = _ctx(proposta)
    for item in itens:
        item["problema"] = _problema(conn, item, ctx)
        item["aviso"] = _aviso(conn, item)
    return proposta


def _ctx(proposta: dict) -> dict:
    return {"conta_id": proposta.get("conta_id"), "forma": proposta.get("forma")}


def resultado_pro_modelo(proposta: dict) -> str:
    itens = proposta["itens"]
    com_problema = sum(1 for i in itens if i["problema"])
    return json.dumps({
        "status": "shown_to_the_person",
        "items": len(itens),
        "items_with_problems": com_problema,
        "note": "Nothing was saved. The person reviews, edits and applies the items in the preview card. Do not say "
                "you created anything. Reply in one short sentence asking them to review the card"
                + (", and mention the items marked with a problem." if com_problema else "."),
    })


def estado_pro_modelo(proposta: dict) -> str:
    """Anexado ao resultado da ferramenta no histórico: o modelo sabe se a
    pessoa aplicou, descartou ou desfez (sem isso, ele diria "criei")."""
    estado = proposta.get("estado")
    if estado == "aplicada":
        n = len(proposta.get("aplicados") or [])
        return f"\n[later: the person applied {n} of {len(proposta['itens'])} items]"
    return {
        "descartada": "\n[later: the person discarded this proposal; nothing was created]",
        "desfeita": "\n[later: the person applied and then undid this proposal; nothing remains]",
    }.get(estado, "\n[the person has not applied this proposal yet]")


# ── aplicar ───────────────────────────────────────────────────────────────

def _retrato(conn, tipo: str, id_: str) -> dict | None:
    if tipo == "tarefa":
        return None
    cols = _RETRATO[tipo]
    row = conn.execute(f"SELECT {', '.join(cols)} FROM {_TABELA[tipo]} WHERE id = ?", (id_,)).fetchone()
    if row is None:
        return None
    r = dict(row)
    if tipo == "habito":
        r["marcas"] = conn.execute("SELECT COUNT(*) FROM habitos_marcas WHERE habito_id = ?", (id_,)).fetchone()[0]
    return r


def _marcar(conn, tipo: str, id_: str) -> dict:
    conn.execute(f"UPDATE {_TABELA[tipo]} SET criado_por = 'assistente' WHERE id = ?", (id_,))
    conn.commit()
    return _retrato(conn, tipo, id_)


def _criar(conn, item: dict, ctx: dict) -> list[dict]:
    """Cria pelas funções das rotas (mesmas regras e xp) e marca criado_por.
    Devolve o que entrou no lote (um marco com data também cria o evento)."""
    from app.routers import aprendizado, calendario, entrada, habitos, lembretes, metas, notas

    tipo, d = item["tipo"], item["dados"]
    if tipo == "tarefa":
        nota_id, criada = entrada.adicionar_tarefa(conn, d["texto"])
        if criada:
            conn.execute("UPDATE notas SET criado_por = 'assistente' WHERE id = ?", (nota_id,))
        conn.commit()
        return [{"tipo": tipo, "id": nota_id, "titulo": d["texto"], "linha": entrada.linha_de_tarefa(d["texto"]),
                 "nota_criada": criada}]
    if tipo == "marco":
        p = _modelo(tipo, d)
        id_ = aprendizado.create_milestone(ctx["trilha_id"], p, db=conn)["id"]
        feitos = [{"tipo": tipo, "id": id_, "titulo": d["titulo"], "retrato": _marcar(conn, tipo, id_)}]
        if d["data"]:  # P-131: a data do marco vira um evento no calendário
            ev = calendario.EventoIn(title=d["titulo"], date=d["data"], notes=ctx.get("trilha_nome") or None)
            ev_id = calendario.create_evento(ev, db=conn)["id"]
            feitos.append({"tipo": "evento", "id": ev_id, "titulo": d["titulo"], "retrato": _marcar(conn, "evento", ev_id)})
        return feitos
    p = _modelo(tipo, d, ctx)
    if tipo == "nota":
        id_ = notas.criar_nota(p, db=conn)["id"]
    elif tipo == "lembrete":
        id_ = lembretes.criar(p, db=conn)["id"]
    elif tipo == "evento":
        id_ = calendario.create_evento(p, db=conn)["id"]
    elif tipo == "habito":
        id_ = habitos.criar(p, db=conn)["id"]
    elif tipo == "meta":
        id_ = metas.create_goal(p, db=conn)["id"]
    else:  # trilha
        id_ = aprendizado.create_track(p, db=conn)["id"]
    titulo = d.get("titulo") or d.get("nome") or ""
    return [{"tipo": tipo, "id": id_, "titulo": titulo, "retrato": _marcar(conn, tipo, id_)}]


def _criar_lancamentos(conn, escolhidos: list, ctx: dict) -> list[dict]:
    """Todos os lançamentos numa transação só, ANTES do resto: o saldo de
    cada um depende dos anteriores e só se sabe na hora — se um falhar
    (saldo ou limite), nada do lote é gravado e a tela recebe o índice."""
    from app.routers.financas import lancamentos

    saidas = []
    for i, item in escolhidos:
        try:
            saidas.append((item, lancamentos._apply_transaction(conn, _modelo("lancamento", item["dados"], ctx))))
        except ErroKami as e:
            conn.rollback()
            e.vars = {**(e.vars or {}), "indice": i}
            raise
    conn.commit()
    feitos = []
    for item, out in saidas:
        lancamentos._credit_transaction_xp(conn, out)  # P-125/P-135: o mesmo xp do lançamento à mão
        feitos.append({"tipo": "lancamento", "id": out["id"], "titulo": item["dados"]["descricao"],
                       "retrato": _marcar(conn, "lancamento", out["id"])})
    return feitos


def _escolhidos(proposta: dict, escolhas: list[dict]) -> list[tuple[int, dict]]:
    itens = proposta["itens"]
    vistos, escolhidos = set(), []
    for e in escolhas:
        i = e.get("indice")
        if not isinstance(i, int) or not 0 <= i < len(itens) or i in vistos:
            raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
        vistos.add(i)
        item = dict(itens[i])
        if isinstance(e.get("dados"), dict):
            # só os campos que o tipo já tem, com o mesmo tipo de valor — a
            # tela não inventa campo (número inteiro serve onde é decimal)
            def mesmo_tipo(novo, velho):
                return type(novo) is type(velho) or (isinstance(velho, float) and type(novo) is int)
            item["dados"] = {k: (float(e["dados"][k]) if isinstance(v, float) else e["dados"][k])
                             if mesmo_tipo(e["dados"].get(k), v) else v
                             for k, v in item["dados"].items()}
        escolhidos.append((i, item))
    if not escolhidos:
        raise ErroKami(422, "erro.assistente.nada_escolhido", "marque pelo menos um item")
    # P-138: marco e meta do plano só vão junto com a trilha
    for i, item in escolhidos:
        if "depende" in item and item["depende"] not in vistos:
            raise ErroKami(422, "erro.assistente.depende_da_trilha", "marque a trilha do plano junto", indice=i)
    # a meta do plano conta os marcos que vão (alvo = nº de marcos)
    for i, item in escolhidos:
        if item["tipo"] == "meta" and item["dados"]["tipo"] == "aprendizado":
            n = sum(1 for _, x in escolhidos if x["tipo"] == "marco" and x.get("depende") == item.get("depende"))
            if not n:
                raise ErroKami(422, "erro.assistente.plano_sem_marcos", "a meta do plano precisa de pelo menos um marco", indice=i)
            item["dados"] = {**item["dados"], "alvo": float(n)}
    return escolhidos


def aplicar(conn, proposta: dict, escolhas: list[dict], conversa_id: str | None, mensagem_id: str | None,
            conta_id: str | None = None, forma: str | None = None) -> dict:
    """`escolhas` = [{"indice", "dados"?}] — os itens marcados, com as
    edições da pessoa; `conta_id`/`forma` = o topo do cartão (P-136). Tudo
    é conferido ANTES de gravar o primeiro: um item com problema recusa o
    lote inteiro (422 com o índice), pra nunca ficar meio aplicado. Devolve
    o lote."""
    if proposta.get("estado") != "pendente":
        raise ErroKami(409, "erro.assistente.proposta_fechada", "esta proposta já foi aplicada ou descartada")
    if "contas" in proposta:
        if conta_id is not None:
            proposta["conta_id"] = conta_id
        if forma is not None:
            proposta["forma"] = forma or None
    ctx = _ctx(proposta)
    escolhidos = _escolhidos(proposta, escolhas)
    for i, item in escolhidos:
        e = _erro(conn, item, ctx)
        if e:
            e.vars = {**(e.vars or {}), "indice": i}  # a tela marca a linha
            raise e

    copia = backup_auto.copia_antes_de(conn, "assistente")
    lancs = [(i, x) for i, x in escolhidos if x["tipo"] == "lancamento"]
    criados = _criar_lancamentos(conn, lancs, ctx) if lancs else []
    trilhas = {}  # índice da trilha → (id, nome)
    for i, item in escolhidos:
        if item["tipo"] == "lancamento":
            continue
        dep = item.get("depende")
        ctx_item = {**ctx, "trilha_id": trilhas[dep][0], "trilha_nome": trilhas[dep][1]} if dep is not None else ctx
        feitos = _criar(conn, item, ctx_item)
        if item["tipo"] == "trilha":
            trilhas[i] = (feitos[0]["id"], item["dados"]["nome"])
        if item.get("entrada"):
            feitos[0]["entrada"] = item["entrada"]
            conn.execute("DELETE FROM caixa_entrada WHERE id = ?", (item["entrada"]["id"],))
            conn.commit()
        criados += feitos
    for i, item in escolhidos:
        proposta["itens"][i] = item  # a proposta guarda o item como a pessoa deixou
    lote = {"id": new_id(), "conversa_id": conversa_id, "mensagem_id": mensagem_id, "itens": criados,
            "aplicado_em": now_iso(), "desfeito_em": None, "copia": copia.name}
    conn.execute(
        "INSERT INTO assistente_lotes (id, conversa_id, mensagem_id, itens, aplicado_em, copia) VALUES (?, ?, ?, ?, ?, ?)",
        (lote["id"], conversa_id, mensagem_id, json.dumps(criados, ensure_ascii=False), lote["aplicado_em"], lote["copia"]),
    )
    conn.commit()
    proposta.update(estado="aplicada", lote_id=lote["id"], aplicados=[i for i, _ in escolhidos])
    return lote


def descartar(proposta: dict) -> None:
    if proposta.get("estado") != "pendente":
        raise ErroKami(409, "erro.assistente.proposta_fechada", "esta proposta já foi aplicada ou descartada")
    proposta["estado"] = "descartada"


# ── lotes: conferir e desfazer ────────────────────────────────────────────

def _lote_de_row(row) -> dict:
    d = dict(row)
    d["itens"] = json.loads(d["itens"])
    return d


def obter_lote(conn, lote_id: str) -> dict:
    row = conn.execute("SELECT * FROM assistente_lotes WHERE id = ?", (lote_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.assistente.lote_inexistente", "lote não encontrado")
    return _lote_de_row(row)


def listar_lotes(conn, limite: int = 100) -> list[dict]:
    rows = conn.execute("SELECT * FROM assistente_lotes ORDER BY aplicado_em DESC LIMIT ?", (limite,)).fetchall()
    return [_resumo(conn, _lote_de_row(r)) for r in rows]


def _linha_da_tarefa(conteudo: str, linha: str) -> tuple[int | None, bool]:
    """(índice da linha da tarefa na nota, se continua desmarcada)."""
    texto = linha[len("- [ ] "):]
    linhas = conteudo.split("\n")
    for k, l in enumerate(linhas):
        if l.rstrip() == linha:
            return k, True
    for k, l in enumerate(linhas):
        m = re.match(r"^- \[[xX]\] (.*)$", l.rstrip())
        if m and m.group(1) == texto:
            return k, False
    return None, False


def _situacao(conn, item: dict) -> str:
    """intacto | editado | sumiu"""
    if item["tipo"] == "tarefa":
        row = conn.execute("SELECT conteudo, trancada FROM notas WHERE id = ?", (item["id"],)).fetchone()
        if row is None or row["trancada"]:
            return "sumiu" if row is None else "editado"
        k, aberta = _linha_da_tarefa(row["conteudo"], item["linha"])
        return "sumiu" if k is None else ("intacto" if aberta else "editado")
    atual = _retrato(conn, item["tipo"], item["id"])
    if atual is None:
        return "sumiu"
    return "intacto" if atual == item.get("retrato") else "editado"


def _resumo(conn, lote: dict) -> dict:
    """O lote com a situação de cada item (pra tela e pro "desfazer")."""
    itens = [{"tipo": i["tipo"], "titulo": i["titulo"],
              "situacao": "desfeito" if lote["desfeito_em"] else _situacao(conn, i)} for i in lote["itens"]]
    return {"id": lote["id"], "conversa_id": lote["conversa_id"], "mensagem_id": lote["mensagem_id"],
            "aplicado_em": lote["aplicado_em"], "desfeito_em": lote["desfeito_em"], "itens": itens}


def conferir(conn, lote_id: str) -> dict:
    return _resumo(conn, obter_lote(conn, lote_id))


def _apagar(conn, item: dict) -> None:
    from app.routers import aprendizado, calendario, habitos, lembretes, metas, notas
    from app.routers.financas import lancamentos

    tipo, id_ = item["tipo"], item["id"]
    if tipo == "tarefa":
        row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (id_,)).fetchone()
        k, _ = _linha_da_tarefa(row["conteudo"], item["linha"])
        linhas = row["conteudo"].split("\n")
        del linhas[k]
        resto = "\n".join(linhas).strip()
        if item.get("nota_criada") and not resto:
            conn.execute("DELETE FROM notas_tags WHERE nota_id = ?", (id_,))
            conn.execute("DELETE FROM notas WHERE id = ?", (id_,))
        else:
            conn.execute("UPDATE notas SET conteudo = ?, atualizada_em = ? WHERE id = ?", ("\n".join(linhas), now_iso(), id_))
        conn.commit()
    elif tipo == "nota":
        notas.apagar_nota(id_, chave=None, db=conn)
        revert_actions(conn, "nota", id_)  # P-125: estorna mesmo que não seja do dia
    elif tipo == "lembrete":
        lembretes.apagar(id_, db=conn)
    elif tipo == "evento":
        calendario.delete_evento(id_, db=conn)
    elif tipo == "habito":
        habitos.apagar(id_, db=conn)  # estorna o xp das marcas
    elif tipo == "lancamento":
        lancamentos.delete_transaction(id_, db=conn)  # devolve o saldo/fatura e estorna o xp
    elif tipo == "meta":
        metas.delete_goal(id_, db=conn)
    elif tipo == "marco":
        aprendizado.delete_milestone(id_, db=conn)
    elif tipo == "trilha":
        aprendizado.delete_track(id_, db=conn)


def _trilha_ocupada(conn, item: dict) -> bool:
    """Trilha com marco que ficou (mexido depois, ou criado pela pessoa):
    apagar a trilha levaria o marco junto — ela fica."""
    return item["tipo"] == "trilha" and conn.execute(
        "SELECT 1 FROM milestones WHERE track_id = ?", (item["id"],)).fetchone() is not None


def desfazer(conn, lote_id: str, apagar_editados: bool = False) -> dict:
    """Apaga o que o lote criou, do último pro primeiro (a meta e os marcos
    antes da trilha). O que a pessoa mexeu depois fica, a não ser com
    `apagar_editados` (P-124)."""
    lote = obter_lote(conn, lote_id)
    if lote["desfeito_em"]:
        raise ErroKami(409, "erro.assistente.lote_ja_desfeito", "este lote já foi desfeito")
    contagem = {"desfeitos": 0, "mantidos": 0, "sumidos": 0}
    for item in reversed(lote["itens"]):
        situacao = _situacao(conn, item)
        trancada = item["tipo"] == "nota" and conn.execute(
            "SELECT trancada FROM notas WHERE id = ?", (item["id"],)).fetchone()
        if situacao == "sumiu":
            contagem["sumidos"] += 1
        elif (situacao == "editado" and (not apagar_editados or (trancada and trancada["trancada"]))) \
                or _trilha_ocupada(conn, item):
            contagem["mantidos"] += 1  # nota trancada só a pessoa apaga (precisa do PIN)
        else:
            _apagar(conn, item)
            contagem["desfeitos"] += 1
            # o que veio da caixa de entrada volta pra lá (só se saiu de fato
            # do Kami: o que ficou, ficou no lugar novo)
            e = item.get("entrada")
            if e and not conn.execute("SELECT 1 FROM caixa_entrada WHERE id = ?", (e["id"],)).fetchone():
                conn.execute("INSERT INTO caixa_entrada (id, texto, criado_em) VALUES (?, ?, ?)",
                             (e["id"], e["texto"], e["criado_em"]))
    lote["desfeito_em"] = now_iso()
    conn.execute("UPDATE assistente_lotes SET desfeito_em = ? WHERE id = ?", (lote["desfeito_em"], lote_id))
    conn.commit()
    return {**_resumo(conn, lote), **contagem}
