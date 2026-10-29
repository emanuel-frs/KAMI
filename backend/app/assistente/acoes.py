"""
Ações do assistente (IA-05a, princípio 4 — "a IA propõe, a pessoa aprova").

O modelo NUNCA grava nada. A única ferramenta de escrita que ele tem é
`propose_actions`: devolve uma lista de itens que vira um cartão de prévia
no chat (P-123). Daí em diante é tudo pela tela, em rotas próprias que o
modelo não alcança:

    propor()     args do modelo → itens no formato do Kami, cada um já
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

Tipos da F1: nota, tarefa (linha na nota "tarefas"), lembrete, evento e
hábito. Cada item pode vir de um item da caixa de entrada (`entrada`), que
sai de lá ao aplicar.

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
from app.database import new_id, now_iso
from app.mensagens import ErroKami

NOME = "propose_actions"
ITENS_MAX = 50
TEXTO_TAREFA_MAX = 500
TIPOS = ("nota", "tarefa", "lembrete", "evento", "habito")
_TIPO_DO_MODELO = {"note": "nota", "task": "tarefa", "reminder": "lembrete", "event": "evento", "habit": "habito"}
_REPETE = ("none", "daily", "weekdays", "weekly", "monthly", "yearly")
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# o que a pessoa pode mudar em cada coisa criada: se mudou depois do lote,
# desfazer pergunta antes de apagar (P-124)
_TABELA = {"nota": "notas", "lembrete": "lembretes", "evento": "calendar_events", "habito": "habitos"}
_RETRATO = {
    "nota": ("titulo", "conteudo", "trancada", "arquivada"),
    "lembrete": ("titulo", "data", "hora", "repeticao", "dias_semana"),
    "evento": ("title", "date", "time", "notes", "recurrence", "recurrence_end", "reminder_minutes_before"),
    "habito": ("nome", "frequencia", "dias_semana", "vezes_semana", "atributo", "status"),
}

ESTADOS = ("pendente", "aplicada", "descartada", "desfeita")


def ferramenta(atributos: list[str]) -> Ferramenta:
    return Ferramenta(
        NOME,
        "Propose creating things in Kami: notes, to-do tasks, reminders, calendar events and habits. NOTHING is "
        "saved by this call: Kami shows the items to the person as a preview card, and they edit, choose and apply "
        "them. Use it only when the person asks you to create or organize something (including sorting their inbox). "
        "Send all items of the request in ONE call (max 50).",
        {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "maxItems": ITENS_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": list(_TIPO_DO_MODELO)},
                            "title": {"type": "string", "description": "Note/reminder/event title, habit name or task text."},
                            "content": {"type": "string", "description": "note: Markdown body. event: optional notes."},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "note only."},
                            "date": {"type": "string", "description": "YYYY-MM-DD. reminder and event: required."},
                            "time": {"type": "string", "description": "HH:MM, 24h. reminder: default 09:00; event: optional."},
                            "repeat": {"type": "string", "enum": list(_REPETE),
                                       "description": "reminder/event/habit. weekdays = on the days in `weekdays`; "
                                                      "habit weekly = `times_per_week` on any days."},
                            "weekdays": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6},
                                         "description": "0 = Monday … 6 = Sunday."},
                            "times_per_week": {"type": "integer", "minimum": 1, "maximum": 7},
                            "attribute": {"type": "string", "enum": atributos,
                                          "description": "habit: the attribute that earns its xp."},
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


# ── do modelo pro formato do Kami ─────────────────────────────────────────

def _txt(v, maximo: int = 200) -> str:
    return " ".join(v.split())[:maximo] if isinstance(v, str) else ""


def _dias(v) -> list[int]:
    if not isinstance(v, list):
        return []
    return sorted({int(d) for d in v if isinstance(d, (int, float)) and not isinstance(d, bool) and 0 <= d <= 6})


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
    # hábito
    vezes = a.get("times_per_week")
    vezes = int(vezes) if isinstance(vezes, (int, float)) and not isinstance(vezes, bool) and 1 <= vezes <= 7 else 3
    frequencia = {"weekdays": "dias", "weekly": "semana"}.get(repete, "diario")
    if frequencia == "dias" and not dias:
        frequencia = "diario"
    return {"nome": titulo, "frequencia": frequencia, "dias_semana": dias if frequencia == "dias" else [],
            "vezes_semana": vezes, "atributo": a.get("attribute") if isinstance(a.get("attribute"), str) else "organizacao"}


# ── validação (as mesmas das rotas) ───────────────────────────────────────

def _modelo(tipo: str, d: dict):
    """O payload da rota que cria este tipo. ValidationError/ErroKami se não serve."""
    from app.routers import calendario, habitos, lembretes, notas

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
    return None


def _conferir_item(conn, tipo: str, d: dict) -> None:
    """Levanta ErroKami com a chave do problema (a mesma que a tela mostraria)."""
    from app.routers import calendario, habitos, lembretes

    if tipo == "tarefa":
        if not d["texto"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
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


def _erro(conn, item: dict) -> ErroKami | None:
    try:
        _conferir_item(conn, item["tipo"], item["dados"])
    except ErroKami as e:
        return e
    if item.get("entrada") and not conn.execute("SELECT 1 FROM caixa_entrada WHERE id = ?", (item["entrada"]["id"],)).fetchone():
        return ErroKami(409, "erro.assistente.entrada_sumiu", "esse item já saiu da caixa de entrada")
    return None


def _problema(conn, item: dict) -> str | None:
    e = _erro(conn, item)
    return e.chave if e else None


def propor(conn, args: dict) -> list[dict]:
    """Os itens da proposta, prontos pro cartão. ValueError (texto em
    inglês, volta pro modelo se corrigir) se não dá pra montar nada."""
    brutos = args.get("items") if isinstance(args, dict) else None
    if not isinstance(brutos, list) or not brutos:
        raise ValueError("items must be a non-empty list")
    if len(brutos) > ITENS_MAX:
        raise ValueError(f"at most {ITENS_MAX} items per proposal")
    itens, refs = [], set()
    for a in brutos:
        if not isinstance(a, dict) or a.get("type") not in _TIPO_DO_MODELO:
            raise ValueError(f"each item needs a type: {', '.join(_TIPO_DO_MODELO)}")
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
        item["problema"] = _problema(conn, item)
        itens.append(item)
    return itens


def resultado_pro_modelo(itens: list[dict]) -> str:
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


def _criar(conn, item: dict) -> dict:
    """Cria pelas funções das rotas (mesmas regras e xp) e marca criado_por."""
    from app.routers import calendario, entrada, habitos, lembretes, notas

    tipo, d = item["tipo"], item["dados"]
    if tipo == "tarefa":
        nota_id, criada = entrada.adicionar_tarefa(conn, d["texto"])
        if criada:
            conn.execute("UPDATE notas SET criado_por = 'assistente' WHERE id = ?", (nota_id,))
        conn.commit()
        return {"tipo": tipo, "id": nota_id, "titulo": d["texto"], "linha": entrada.linha_de_tarefa(d["texto"]),
                "nota_criada": criada}
    p = _modelo(tipo, d)
    if tipo == "nota":
        id_ = notas.criar_nota(p, db=conn)["id"]
    elif tipo == "lembrete":
        id_ = lembretes.criar(p, db=conn)["id"]
    elif tipo == "evento":
        id_ = calendario.create_evento(p, db=conn)["id"]
    else:
        id_ = habitos.criar(p, db=conn)["id"]
    conn.execute(f"UPDATE {_TABELA[tipo]} SET criado_por = 'assistente' WHERE id = ?", (id_,))
    conn.commit()
    titulo = d.get("titulo") or d.get("nome") or ""
    return {"tipo": tipo, "id": id_, "titulo": titulo, "retrato": _retrato(conn, tipo, id_)}


def aplicar(conn, proposta: dict, escolhas: list[dict], conversa_id: str | None, mensagem_id: str | None) -> dict:
    """`escolhas` = [{"indice", "dados"?}] — os itens marcados, com as
    edições da pessoa. Tudo é conferido ANTES de gravar o primeiro: um
    item com problema recusa o lote inteiro (422 com o índice), pra nunca
    ficar meio aplicado. Devolve o lote."""
    if proposta.get("estado") != "pendente":
        raise ErroKami(409, "erro.assistente.proposta_fechada", "esta proposta já foi aplicada ou descartada")
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
            # tela não inventa campo
            item["dados"] = {k: e["dados"][k] if type(e["dados"].get(k)) is type(v) else v
                             for k, v in item["dados"].items()}
        escolhidos.append((i, item))
    if not escolhidos:
        raise ErroKami(422, "erro.assistente.nada_escolhido", "marque pelo menos um item")
    for i, item in escolhidos:
        e = _erro(conn, item)
        if e:
            e.vars = {**(e.vars or {}), "indice": i}  # a tela marca a linha
            raise e

    copia = backup_auto.copia_antes_de(conn, "assistente")
    criados = []
    for i, item in escolhidos:
        feito = _criar(conn, item)
        if item.get("entrada"):
            feito["entrada"] = item["entrada"]
            conn.execute("DELETE FROM caixa_entrada WHERE id = ?", (item["entrada"]["id"],))
            conn.commit()
        criados.append(feito)
        itens[i] = item  # a proposta guarda o item como a pessoa deixou
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
    from app.routers import calendario, habitos, lembretes, notas

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


def desfazer(conn, lote_id: str, apagar_editados: bool = False) -> dict:
    """Apaga o que o lote criou, do último pro primeiro. O que a pessoa
    mexeu depois fica, a não ser com `apagar_editados` (P-124)."""
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
        elif situacao == "editado" and (not apagar_editados or (trancada and trancada["trancada"])):
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
