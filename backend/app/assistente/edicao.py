"""
Assistente: alterar, apagar, concluir/reabrir e reordenar (2026-11).

Até aqui o assistente só criava (acoes.py). Agora ele mexe também no que
já existe — sempre pelo mesmo cartão de prévia (princípio 4: a IA propõe,
a pessoa aprova) e sempre desfazível pelo lote:

    alterar      campos de uma coisa que existe; o cartão mostra o antes e
                 deixa a pessoa corrigir o depois. Desfazer = gravar o antes
                 de volta, pela mesma rota.
    apagar       pela rota de apagar (estorna o xp como na tela). Antes,
                 guarda as linhas da coisa e dos filhos (marcos da trilha,
                 marcas do hábito, contribuições da meta, tags da nota) e os
                 registros de xp que a rota vai estornar; desfazer devolve
                 tudo com os mesmos ids e o mesmo xp (o inverso exato de
                 actions.revert_actions). Lançamento é a exceção: volta pela
                 rota de lançar, que refaz o saldo/fatura.
    concluir /   marco (status), tarefa (a caixinha na nota "tarefas") e
    reabrir      hábito (marcar/desmarcar hoje) — o xp é o das rotas.
    ordenar      a ordem dos marcos de uma trilha.

O modelo aponta a coisa pelo `ref` que as ferramentas de leitura devolvem:
o começo do id (REF_TAM letras), curto pra modelo pequeno copiar sem errar.

Item de proposta (além de "tipo" e "dados" como na criação):
    {"acao", "alvo": id, "antes": {...}, "extra": {...}}
`antes` tem o mesmo formato de `dados` (o cartão compara um com o outro);
`extra` guarda o que o cartão não mostra mas a rota precisa reenviar
(vínculo do lembrete, cor do evento, conta do lançamento…).
"""
import re
import unicodedata

from app.database import local_now
from app.mensagens import ErroKami

REF_TAM = 8
ACOES = {"create": "criar", "update": "alterar", "delete": "excluir", "complete": "concluir",
         "reopen": "reabrir", "reorder": "ordenar"}
TABELA = {"nota": "notas", "lembrete": "lembretes", "evento": "calendar_events", "habito": "habitos",
          "lancamento": "transactions", "meta": "goals", "trilha": "tracks", "marco": "milestones", "link": "links"}
_NOME_EN = {"nota": "note", "lembrete": "reminder", "evento": "event", "habito": "habit", "lancamento": "money entry",
            "meta": "goal", "trilha": "track", "marco": "milestone", "link": "link", "tarefa": "task"}
# o que cada tipo aceita além de alterar e apagar
_CONCLUI = ("marco", "tarefa", "habito")
_STATUS = {"trilha": {"active": "ativa", "paused": "pausada", "stopped": "parada"},
           "habito": {"active": "ativo", "paused": "pausado", "archived": "arquivado"}}
_HEX = re.compile(r"^[0-9a-f-]{4,36}$")


def ref(id_: str | None) -> str:
    return (id_ or "")[:REF_TAM]


# a coluna do nome de cada tipo: o modelo pequeno às vezes manda o nome em
# vez do ref (teste com o qwen3.5:4b: "renomeia a trilha X" virou leitura
# errada em vez de ref) — o Kami acha pelo nome quando não há dúvida
_COLUNA_NOME = {"nota": "titulo", "lembrete": "titulo", "evento": "title", "habito": "nome", "lancamento": "description",
                "meta": "title", "trilha": "name", "marco": "title", "link": "title"}


def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", " ".join(texto.split()).lower()) if not unicodedata.combining(c))


def achar(conn, tipo: str, r) -> str:
    """ref (ou o nome atual) → id completo. ValueError (em inglês, volta pro modelo)."""
    nome = _NOME_EN[tipo]
    r = r.strip() if isinstance(r, str) else ""
    if not r:
        raise ValueError(f"`ref` is required to change a {nome} — copy it from the read tools")
    if _HEX.match(r.lower()):
        rows = conn.execute(f"SELECT id FROM {TABELA[tipo]} WHERE id LIKE ? LIMIT 2", (r.lower() + "%",)).fetchall()
        if len(rows) == 1:
            return rows[0]["id"]
        if len(rows) > 1:
            raise ValueError(f"ref {r!r} matches more than one {nome} — send the full ref")
    alvo = _sem_acento(r.strip("'\"“”"))
    todos = [(row["id"], _sem_acento(row["n"] or "")) for row in
             conn.execute(f"SELECT id, {_COLUNA_NOME[tipo]} AS n FROM {TABELA[tipo]}")]
    for achados in ([i for i, n in todos if n == alvo], [i for i, n in todos if alvo and alvo in n]):
        if len(achados) == 1:
            return achados[0]
        if len(achados) > 1:
            raise ValueError(f"more than one {nome} matches {r!r} — read them and send the `ref`")
    raise ValueError(f"there is no {nome} with ref or name {r!r} — use the refs from the read tools")


def _csv(v) -> list[int]:
    return sorted({int(x) for x in str(v or "").split(",") if x.strip().isdigit()})


# ── o que existe, no formato de `dados` ───────────────────────────────────

def atual(conn, tipo: str, id_: str) -> tuple[dict, dict]:
    """(dados, extra) da coisa como está agora."""
    row = conn.execute(f"SELECT * FROM {TABELA[tipo]} WHERE id = ?", (id_,)).fetchone()
    if row is None:
        raise ErroKami(404, "erro.assistente.alvo_sumiu", "isso não existe mais")
    r = dict(row)
    if tipo == "nota":
        tags = [t["tag"] for t in conn.execute("SELECT tag FROM notas_tags WHERE nota_id = ? ORDER BY tag", (id_,))]
        return {"titulo": r["titulo"] or "", "conteudo": r["conteudo"] or "", "tags": tags}, {"trancada": bool(r["trancada"])}
    if tipo == "lembrete":
        return ({"titulo": r["titulo"], "data": r["data"] or "", "hora": r["hora"] or "09:00", "repeticao": r["repeticao"],
                 "dias_semana": _csv(r["dias_semana"])},
                {"vinculo_tipo": r["vinculo_tipo"], "vinculo_id": r["vinculo_id"]})
    if tipo == "evento":
        return ({"titulo": r["title"], "data": r["date"], "hora": r["time"] or "", "notas": r["notes"] or "",
                 "repeticao": r["recurrence"] or "none"},
                {k: r[k] for k in ("recurrence_end", "reminder_minutes_before", "color")})
    if tipo == "habito":
        return ({"nome": r["nome"], "frequencia": r["frequencia"], "dias_semana": _csv(r["dias_semana"]),
                 "vezes_semana": r["vezes_semana"] or 3, "atributo": r["atributo"], "status": r["status"]}, {})
    if tipo == "lancamento":
        return ({"descricao": r["description"], "valor": float(r["amount"]), "tipo": r["type"], "categoria": r["category"],
                 "data": r["date"]},
                {"conta_id": r["conta_id"], "forma": r["forma_pagamento"]})
    if tipo == "meta":
        return ({"titulo": r["title"], "tipo": r["type"], "alvo": float(r["target_value"] or 0), "rotulo": r["unit_label"] or "",
                 "prazo": (r["deadline"] or "")[:10], "peso": r["weight"], "conta_id": r["linked_conta_id"] or ""},
                {"status": r["status"]})
    if tipo == "trilha":
        return {"nome": r["name"], "objetivo": r["general_goal"] or "", "status": r["status"]}, {}
    if tipo == "marco":
        return ({"titulo": r["title"], "descricao": r["description"] or "", "status": r["status"]},
                {"trilha_id": r["track_id"]})
    return {"titulo": r["title"], "url": r["url"], "categoria": r["category"]}, {}  # link


# ── o que o modelo pediu pra mudar ────────────────────────────────────────

def _texto(v, maximo):
    from app.assistente.acoes import _txt
    return _txt(v, maximo)


def _repete(tipo: str, v):
    if tipo == "lembrete":
        return {"none": "nao", "daily": "diario", "weekdays": "dias", "weekly": "dias", "monthly": "mensal",
                "yearly": "anual"}.get(v)
    if tipo == "evento":
        return {"none": "none", "daily": "daily", "weekdays": "weekly", "weekly": "weekly", "monthly": "monthly",
                "yearly": "yearly"}.get(v)
    return {"daily": "diario", "weekdays": "dias", "weekly": "semana"}.get(v)  # hábito


def mudancas(tipo: str, a: dict) -> dict:
    """Só os campos que o modelo mandou, já no formato de `dados`."""
    from app.assistente.acoes import METAS, _data_ou_vazio, _dias, _num

    m = {}
    tem = lambda k: k in a and a[k] is not None  # noqa: E731
    titulo = {"habito": "nome", "trilha": "nome", "lancamento": "descricao"}.get(tipo, "titulo")
    if tem("title") and _texto(a["title"], 200):
        m[titulo] = _texto(a["title"], 120 if tipo in ("habito", "trilha") else 200)
    if tem("content") and isinstance(a["content"], str):
        campo = {"nota": "conteudo", "evento": "notas", "trilha": "objetivo", "marco": "descricao"}.get(tipo)
        if campo:
            m[campo] = a["content"][: {"nota": 20_000, "trilha": 500}.get(tipo, 2000)]
    if tipo == "nota" and isinstance(a.get("tags"), list):
        m["tags"] = [_texto(t, 40) for t in a["tags"] if isinstance(t, str) and _texto(t, 40)][:10]
    if tipo in ("lembrete", "evento", "lancamento") and isinstance(a.get("date"), str):
        m["data"] = a["date"]
    if tipo in ("lembrete", "evento") and isinstance(a.get("time"), str):
        m["hora"] = a["time"]
    if tipo in ("lembrete", "evento", "habito") and _repete(tipo, a.get("repeat")):
        m["repeticao" if tipo != "habito" else "frequencia"] = _repete(tipo, a["repeat"])
    if tipo in ("lembrete", "habito") and isinstance(a.get("weekdays"), list):
        m["dias_semana"] = _dias(a["weekdays"])
        if tipo == "lembrete" and "repeticao" not in m and m["dias_semana"]:
            m["repeticao"] = "dias"
        if tipo == "habito" and "frequencia" not in m and m["dias_semana"]:
            m["frequencia"] = "dias"
    if tipo == "habito":
        v = a.get("times_per_week")
        if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 7:
            m["vezes_semana"] = v
        if isinstance(a.get("attribute"), str):
            m["atributo"] = a["attribute"]
    if tipo in _STATUS and isinstance(a.get("status"), str):
        m["status"] = _STATUS[tipo].get(a["status"], a["status"])
    if tipo == "lancamento":
        if tem("amount"):
            m["valor"] = round(abs(_num(a["amount"])), 2)
        if tem("category"):
            m["categoria"] = _texto(a["category"], 60)
    if tipo == "meta":
        if tem("target"):
            m["alvo"] = round(_num(a["target"]), 2)
        if tem("unit_label"):
            m["rotulo"] = _texto(a["unit_label"], 30)
        if tem("deadline"):
            m["prazo"] = _data_ou_vazio(a["deadline"])
        if a.get("goal_type") in METAS:
            m["tipo"] = a["goal_type"]
    if tipo == "link":
        if tem("url"):
            m["url"] = _texto(a["url"], 500)
        if tem("category"):
            m["categoria"] = _texto(a["category"], 60)
    return m


# ── tarefas: linhas "- [ ] texto" da nota "tarefas" ──────────────────────

_LINHA = re.compile(r"^- \[([ xX])\] (.*)$")


def nota_de_tarefas(conn):
    from app.routers.entrada import NOTA_TAREFAS
    return conn.execute("SELECT id, conteudo FROM notas WHERE lower(titulo) = ? AND trancada = 0 AND arquivada = 0 "
                        "ORDER BY criada_em LIMIT 1", (NOTA_TAREFAS,)).fetchone()


def tarefas(conn) -> list[dict]:
    nota = nota_de_tarefas(conn)
    if not nota:
        return []
    out = []
    for linha in (nota["conteudo"] or "").split("\n"):
        m = _LINHA.match(linha.rstrip())
        if m:
            out.append({"texto": m.group(2), "feita": m.group(1) != " "})
    return out


def _achar_tarefa(conn, texto: str) -> tuple[str, int, bool]:
    """(id da nota, índice da linha, se está feita). ValueError pro modelo."""
    nota = nota_de_tarefas(conn)
    alvo = " ".join(texto.split()).lower() if isinstance(texto, str) else ""
    if not nota or not alvo:
        raise ValueError("task not found — use the exact text from the tasks tool")
    linhas = (nota["conteudo"] or "").split("\n")
    achadas = [(k, m) for k, m in ((k, _LINHA.match(l.rstrip())) for k, l in enumerate(linhas)) if m]
    for k, m in achadas:
        if m.group(2).strip().lower() == alvo:
            return nota["id"], k, m.group(1) != " "
    parecidas = [(k, m) for k, m in achadas if alvo in m.group(2).lower()]
    if len(parecidas) == 1:
        k, m = parecidas[0]
        return nota["id"], k, m.group(1) != " "
    raise ValueError("task not found — use the exact text from the tasks tool")


# ── do modelo pra item da proposta ────────────────────────────────────────

def item(conn, tipo: str, acao: str, a: dict) -> dict:
    """Um item de alterar/apagar/concluir/reabrir/ordenar. ValueError (em
    inglês) quando o pedido não faz sentido — volta pro modelo corrigir."""
    nome = _NOME_EN[tipo]
    if tipo == "tarefa":
        return _item_tarefa(conn, acao, a)
    if acao in ("concluir", "reabrir") and tipo not in _CONCLUI:
        raise ValueError(f"a {nome} cannot be completed or reopened — use action update"
                         + (" with status" if tipo in _STATUS else ""))
    if acao == "ordenar" and tipo != "trilha":
        raise ValueError("only a learning track's milestones can be reordered (type track, action reorder)")
    id_ = achar(conn, tipo, a.get("ref"))
    antes, extra = atual(conn, tipo, id_)
    out = {"tipo": tipo, "acao": acao, "alvo": id_, "antes": antes, "extra": extra, "entrada": None}
    if acao == "alterar":
        novos = mudancas(tipo, a)
        out["dados"] = {**antes, **novos}
    elif acao == "ordenar":
        out["antes"] = {"ordem": _marcos(conn, id_)}
        out["dados"] = {"ordem": _nova_ordem(conn, id_, out["antes"]["ordem"], a.get("milestone_order"))}
        out["extra"] = {"nome": antes["nome"]}
    else:
        out["dados"] = dict(antes)
    return out


def _item_tarefa(conn, acao: str, a: dict) -> dict:
    if acao == "ordenar":
        raise ValueError("tasks cannot be reordered")
    nota_id, k, feita = _achar_tarefa(conn, a.get("ref") or a.get("title"))
    linha = (conn.execute("SELECT conteudo FROM notas WHERE id = ?", (nota_id,)).fetchone()["conteudo"].split("\n"))[k]
    texto = _LINHA.match(linha.rstrip()).group(2)
    antes = {"texto": texto, "feita": feita}
    dados = dict(antes)
    if acao == "alterar":
        novo = _texto(a.get("new_title") or "", 500)
        if not novo:
            raise ValueError("to rename a task send its current text in `ref` and the new text in `new_title`")
        dados["texto"] = novo
    return {"tipo": "tarefa", "acao": acao, "alvo": nota_id, "antes": antes, "dados": dados, "extra": {}, "entrada": None}


def _marcos(conn, trilha_id: str) -> list[dict]:
    return [{"id": r["id"], "titulo": r["title"]} for r in
            conn.execute("SELECT id, title FROM milestones WHERE track_id = ? ORDER BY position", (trilha_id,))]


def _nova_ordem(conn, trilha_id: str, atuais: list[dict], pedida) -> list[dict]:
    """Os marcos citados, na ordem pedida, e depois os outros na ordem de hoje."""
    if not isinstance(pedida, list) or not pedida:
        raise ValueError("send `milestone_order`: the milestone refs in the new order")
    escolhidos = []
    for r in pedida:
        id_ = achar(conn, "marco", r)
        m = next((x for x in atuais if x["id"] == id_), None)
        if m is None:
            raise ValueError(f"milestone {r!r} is not in this track")
        if m not in escolhidos:
            escolhidos.append(m)
    return escolhidos + [m for m in atuais if m not in escolhidos]


# ── validação (antes de mostrar e antes de gravar) ────────────────────────

def _mudou(it: dict, *campos) -> bool:
    return any(it["dados"].get(c) != it["antes"].get(c) for c in campos)


def conferir(conn, it: dict, ctx: dict) -> None:
    """Levanta ErroKami com a chave do problema, como acoes._conferir_item."""
    from app.assistente import acoes
    from app.routers.financas import lancamentos

    tipo, acao, d = it["tipo"], it["acao"], it["dados"]
    if tipo == "tarefa":
        if _tarefa_agora(conn, it) is None:
            raise ErroKami(404, "erro.assistente.alvo_sumiu", "isso não existe mais")
        if acao == "alterar" and not d["texto"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        if acao == "concluir" and it["antes"]["feita"] or acao == "reabrir" and not it["antes"]["feita"]:
            raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
        return
    if not conn.execute(f"SELECT 1 FROM {TABELA[tipo]} WHERE id = ?", (it["alvo"],)).fetchone():
        raise ErroKami(404, "erro.assistente.alvo_sumiu", "isso não existe mais")
    if tipo == "nota" and it["extra"].get("trancada"):
        raise ErroKami(422, "erro.assistente.nota_trancada", "nota trancada: só pela tela, com o PIN")
    if tipo == "lancamento":
        lancamentos._get_avulsa_or_error(conn, it["alvo"])  # veio de conta fixa, parcela…: desfaz-se por lá
        if it["antes"]["tipo"] == "transferencia":
            raise ErroKami(422, "erro.assistente.transferencia", "transferências só pela tela")
    if acao == "excluir":
        return
    if acao in ("concluir", "reabrir"):
        if tipo == "marco" and (it["antes"]["status"] == "concluido") == (acao == "concluir"):
            raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
        if tipo == "habito":
            feito = _feito_hoje(conn, it["alvo"])
            if feito == (acao == "concluir"):
                raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
            if acao == "concluir" and it["antes"]["status"] != "ativo":
                raise ErroKami(422, "erro.assistente.habito_parado", "hábito pausado ou arquivado não se marca")
        return
    if acao == "ordenar":
        if {m["id"] for m in d["ordem"]} != {m["id"] for m in _marcos(conn, it["alvo"])}:
            raise ErroKami(409, "erro.assistente.alvo_sumiu", "isso não existe mais")
        if [m["id"] for m in d["ordem"]] == [m["id"] for m in it["antes"]["ordem"]]:
            raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
        return
    # alterar
    if d == it["antes"]:
        raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
    if tipo in _STATUS and d.get("status") not in _STATUS[tipo].values():
        raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
    if tipo == "trilha":
        if not d["nome"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        return
    if tipo == "marco":
        if not d["titulo"].strip():
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        return
    if tipo == "link":
        if not (d["titulo"].strip() and d["url"].strip() and d["categoria"].strip()):
            raise ErroKami(422, "erro.assistente.acao_vazia", "item vazio")
        return
    if tipo == "lancamento":
        return acoes._conferir_lancamento(conn, d, {"conta_id": it["extra"]["conta_id"], "forma": it["extra"]["forma"]})
    try:
        if tipo == "meta":
            return acoes._conferir_meta(conn, d)
        acoes._conferir_item(conn, tipo, d, ctx)
    except ErroKami as e:
        # prazo/horário que JÁ estava no passado e não mudou: não é problema desta edição
        if e.chave == "erro.assistente.data_passada" and not _mudou(it, "prazo"):
            return
        if e.chave == "erro.lembretes.esse_horario_ja_passou" and not _mudou(it, "data", "hora", "repeticao", "dias_semana"):
            return
        raise


def _feito_hoje(conn, habito_id: str) -> bool:
    return conn.execute("SELECT 1 FROM habitos_marcas WHERE habito_id = ? AND dia = ?",
                        (habito_id, local_now().date().isoformat())).fetchone() is not None


def _tarefa_agora(conn, it: dict):
    """(índice, feita) da linha da tarefa agora, ou None se sumiu."""
    row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (it["alvo"],)).fetchone()
    if row is None:
        return None
    for k, l in enumerate((row["conteudo"] or "").split("\n")):
        m = _LINHA.match(l.rstrip())
        if m and m.group(2) == it["antes"]["texto"]:
            return k, m.group(1) != " "
    return None


# ── gravar ────────────────────────────────────────────────────────────────

def _gravar(conn, tipo: str, id_: str, d: dict, extra: dict) -> str:
    """Grava `d` na coisa pela rota de editar. Devolve o id (o lançamento
    editado ganha id novo — é assim na rota)."""
    from app.routers import aprendizado, calendario, habitos, lembretes, metas, notas
    from app.routers.financas import lancamentos
    from app.routers.organizacao import links

    if tipo == "nota":
        notas.editar_nota(id_, notas.NotaUpdate(titulo=d["titulo"], conteudo=d["conteudo"], tags=d["tags"]), db=conn)
    elif tipo == "lembrete":
        lembretes.editar(id_, lembretes.LembreteIn(
            titulo=d["titulo"], data=d["data"], hora=d["hora"], repeticao=d["repeticao"],
            dias_semana=d["dias_semana"] if d["repeticao"] == "dias" else [],
            vinculo_tipo=extra.get("vinculo_tipo"), vinculo_id=extra.get("vinculo_id")), db=conn)
    elif tipo == "evento":
        calendario.update_evento(id_, calendario.EventoIn(
            title=d["titulo"], date=d["data"], time=d["hora"] or None, notes=d["notas"] or None,
            recurrence=d["repeticao"], **extra), db=conn)
    elif tipo == "habito":
        habitos.editar(id_, habitos.HabitoUpdate(
            nome=d["nome"], frequencia=d["frequencia"], dias_semana=d["dias_semana"] if d["frequencia"] == "dias" else [],
            vezes_semana=d["vezes_semana"], atributo=d["atributo"], status=d["status"]), db=conn)
    elif tipo == "lancamento":
        out = lancamentos.update_transaction(id_, lancamentos.TransactionIn(
            description=d["descricao"], amount=d["valor"], type=d["tipo"], category=d["categoria"], date=d["data"],
            conta_id=extra["conta_id"], forma_pagamento=extra["forma"] if d["tipo"] == "saida" else None), db=conn)
        return out["id"]
    elif tipo == "meta":
        metas.update_goal(id_, metas.GoalUpdate(
            title=d["titulo"], target_value=d["alvo"] if d["tipo"] not in ("aprendizado", "academica") else None,
            type=d["tipo"] if d["tipo"] not in ("aprendizado", "academica") else None,
            deadline=d["prazo"] or None, clear_deadline=not d["prazo"], weight=d["peso"],
            unit_label=d["rotulo"] or None, clear_unit_label=not d["rotulo"],
            linked_conta_id=d["conta_id"] or None, clear_linked_conta_id=d["tipo"] == "financeira" and not d["conta_id"]),
            db=conn)
    elif tipo == "trilha":
        aprendizado.update_track(id_, aprendizado.TrackUpdate(name=d["nome"].strip(), general_goal=d["objetivo"].strip(),
                                                              status=d["status"]), db=conn)
    elif tipo == "marco":
        aprendizado.update_milestone(id_, aprendizado.MilestoneUpdate(title=d["titulo"].strip(),
                                                                      description=d["descricao"].strip()), db=conn)
    elif tipo == "link":
        links.update_link(id_, links.LinkUpdate(title=d["titulo"].strip(), url=d["url"].strip(),
                                                category=d["categoria"].strip()), db=conn)
    return id_


def _status_marco(conn, id_: str, status: str) -> None:
    from app.routers import aprendizado
    aprendizado.update_milestone(id_, aprendizado.MilestoneUpdate(status=status), db=conn)


def _marcar_habito(conn, id_: str, feito: bool) -> None:
    from app.routers import habitos
    if feito:
        habitos.marcar(id_, habitos.MarcarIn(), db=conn)
    else:
        habitos.desmarcar(id_, dia=None, db=conn)


def _linha_tarefa(conn, nota_id: str, k: int, nova: str | None) -> None:
    """Troca (ou apaga, com `nova` None) a linha k da nota de tarefas."""
    from app.database import now_iso
    row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (nota_id,)).fetchone()
    linhas = row["conteudo"].split("\n")
    if nova is None:
        del linhas[k]
    else:
        linhas[k] = nova
    conn.execute("UPDATE notas SET conteudo = ?, atualizada_em = ? WHERE id = ?", ("\n".join(linhas), now_iso(), nota_id))
    conn.commit()


def _ordenar(conn, trilha_id: str, ids: list[str]) -> None:
    from app.routers import aprendizado
    aprendizado.reorder_milestones(trilha_id, aprendizado.MilestoneReorderIn(milestone_ids=ids), db=conn)


def retrato(conn, entrada: dict):
    """O estado que o lote compara pra saber se a pessoa mexeu depois."""
    from app.assistente.acoes import _retrato
    tipo, acao = entrada["tipo"], entrada["acao"]
    if tipo == "tarefa":
        row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (entrada["id"],)).fetchone()
        return None if row is None else entrada.get("linha_depois") in row["conteudo"].split("\n")
    if acao == "ordenar":
        return [m["id"] for m in _marcos(conn, entrada["id"])]
    if tipo == "habito" and acao in ("concluir", "reabrir"):
        return _feito_hoje(conn, entrada["id"])
    return _retrato(conn, tipo, entrada["id"])


def aplicar(conn, it: dict) -> dict:
    """Grava um item (já conferido) e devolve a entrada do lote."""
    tipo, acao, id_, d = it["tipo"], it["acao"], it["alvo"], it["dados"]
    titulo = (it["antes"].get("titulo") or it["antes"].get("nome") or it["antes"].get("descricao")
              or it["antes"].get("texto") or it.get("extra", {}).get("nome") or "")
    e = {"tipo": tipo, "acao": acao, "id": id_, "titulo": titulo, "antes": it["antes"], "extra": it.get("extra") or {}}
    if tipo == "tarefa":
        k, _ = _tarefa_agora(conn, it)
        marca = "x" if (acao == "concluir" or (acao != "reabrir" and it["antes"]["feita"])) else " "
        nova = None if acao == "excluir" else f"- [{marca}] {d['texto']}"
        e.update(indice=k, linha_antes=f"- [{'x' if it['antes']['feita'] else ' '}] {it['antes']['texto']}", linha_depois=nova)
        _linha_tarefa(conn, id_, k, nova)
    elif acao == "alterar":
        e["id"] = _gravar(conn, tipo, id_, d, it.get("extra") or {})
    elif acao in ("concluir", "reabrir"):
        if tipo == "marco":
            _status_marco(conn, id_, "concluido" if acao == "concluir" else "pendente")
        else:
            _marcar_habito(conn, id_, acao == "concluir")
    elif acao == "ordenar":
        _ordenar(conn, id_, [m["id"] for m in d["ordem"]])
    else:  # apagar
        from app.assistente.acoes import _apagar
        if tipo == "lancamento":
            e["copia"] = None  # volta pela rota de lançar
        else:
            e["copia"] = copiar(conn, tipo, id_)
        _apagar(conn, {"tipo": tipo, "id": id_})
        return e
    e["retrato"] = retrato(conn, e)
    return e


# ── apagar e devolver: as linhas e o xp, com os mesmos ids ────────────────

# filhos que somem junto (CASCADE) e o que só perde o vínculo (SET NULL)
_FILHOS = {"trilha": [("milestones", "track_id")], "meta": [("goal_contributions", "goal_id")],
           "habito": [("habitos_marcas", "habito_id"), ("habitos_pausas", "habito_id")],
           "nota": [("notas_tags", "nota_id")]}
_VINCULOS = {"trilha": [("goals", "linked_track_id")]}


def _linhas(conn, tabela: str, coluna: str, valor: str) -> list[dict]:
    return [dict(r) for r in conn.execute(f"SELECT * FROM {tabela} WHERE {coluna} = ?", (valor,))]


def copiar(conn, tipo: str, id_: str) -> dict:
    """Tudo que a rota de apagar leva: a linha, os filhos, os vínculos e o
    xp (logs da coisa e dos filhos, com os bônus de cada log)."""
    from app.bonus import REF_BONUS

    copia = {"linhas": {TABELA[tipo]: _linhas(conn, TABELA[tipo], "id", id_)}, "vinculos": [], "logs": []}
    ids = [id_]
    for tabela, coluna in _FILHOS.get(tipo, []):
        filhos = _linhas(conn, tabela, coluna, id_)
        copia["linhas"][tabela] = filhos
        ids += [f["id"] for f in filhos if "id" in f]
    for tabela, coluna in _VINCULOS.get(tipo, []):
        copia["vinculos"] += [[tabela, coluna, r["id"]] for r in
                              conn.execute(f"SELECT id FROM {tabela} WHERE {coluna} = ?", (id_,))]
    marcas = "?, " * (len(ids) - 1) + "?"
    logs = [dict(r) for r in conn.execute(f"SELECT * FROM action_logs WHERE referencia_id IN ({marcas})", ids)]
    bonus = [dict(r) for r in conn.execute(
        f"SELECT * FROM action_logs WHERE referencia_tipo = ? AND referencia_id IN ({', '.join('?' for _ in logs) or 'NULL'})",
        (REF_BONUS, *[l["id"] for l in logs]))]
    for log in logs + bonus:
        log["_atributos"] = [r["attribute_id"] for r in conn.execute(
            "SELECT attribute_id FROM action_log_attributes WHERE action_log_id = ?", (log["id"],))]
        copia["logs"].append(log)
    return copia


def _inserir(conn, tabela: str, linha: dict) -> None:
    cols = [c for c in linha if not c.startswith("_")]
    conn.execute(f"INSERT INTO {tabela} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                 [linha[c] for c in cols])


def devolver(conn, entrada: dict) -> None:
    """Desfaz um apagar."""
    from app.achievements import check_achievements
    from app.actions import _set_attribute_xp
    from app.missoes import avaliar_missoes

    tipo = entrada["tipo"]
    if tipo == "tarefa":
        row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (entrada["id"],)).fetchone()
        linhas = row["conteudo"].split("\n")
        linhas.insert(min(entrada["indice"], len(linhas)), entrada["linha_antes"])
        conn.execute("UPDATE notas SET conteudo = ? WHERE id = ?", ("\n".join(linhas), entrada["id"]))
        conn.commit()
        return
    if tipo == "lancamento":
        from app.routers.financas import lancamentos
        d, x = entrada["antes"], entrada["extra"]
        out = lancamentos._apply_transaction(conn, lancamentos.TransactionIn(
            description=d["descricao"], amount=d["valor"], type=d["tipo"], category=d["categoria"], date=d["data"],
            conta_id=x["conta_id"], forma_pagamento=x["forma"] if d["tipo"] == "saida" else None))
        conn.commit()
        lancamentos._credit_transaction_xp(conn, out)
        return
    copia = entrada["copia"]
    for tabela, linhas in copia["linhas"].items():
        for linha in linhas:
            _inserir(conn, tabela, linha)
    for tabela, coluna, alvo in copia["vinculos"]:
        conn.execute(f"UPDATE {tabela} SET {coluna} = ? WHERE id = ? AND {coluna} IS NULL", (entrada["id"], alvo))
    for log in copia["logs"]:
        if conn.execute("SELECT 1 FROM action_logs WHERE id = ?", (log["id"],)).fetchone():
            continue
        _inserir(conn, "action_logs", log)
        for attr_id in log["_atributos"]:
            conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log["id"], attr_id))
            row = conn.execute("SELECT * FROM attributes WHERE id = ?", (attr_id,)).fetchone()
            if row:
                _set_attribute_xp(conn, row, row["current_xp"] + log["xp_gained"])
    conn.commit()
    if tipo in ("trilha", "marco"):
        from app.routers.metas import sync_learning_goals
        trilha = entrada["id"] if tipo == "trilha" else copia["linhas"]["milestones"][0]["track_id"]
        sync_learning_goals(conn, trilha)
    if copia["logs"]:
        avaliar_missoes(conn)
        check_achievements(conn)
    conn.commit()


def reverter(conn, entrada: dict) -> None:
    """Desfaz alterar/concluir/reabrir/ordenar/apagar de uma entrada do lote."""
    tipo, acao, id_ = entrada["tipo"], entrada["acao"], entrada["id"]
    if acao == "excluir":
        return devolver(conn, entrada)
    if tipo == "tarefa":
        row = conn.execute("SELECT conteudo FROM notas WHERE id = ?", (id_,)).fetchone()
        linhas = row["conteudo"].split("\n")
        k = linhas.index(entrada["linha_depois"]) if entrada["linha_depois"] in linhas else entrada["indice"]
        return _linha_tarefa(conn, id_, k, entrada["linha_antes"])
    if acao == "alterar":
        return _gravar(conn, tipo, id_, entrada["antes"], entrada["extra"])
    if acao == "ordenar":
        atuais = {m["id"] for m in _marcos(conn, id_)}
        ordem = [m["id"] for m in entrada["antes"]["ordem"] if m["id"] in atuais]
        return _ordenar(conn, id_, ordem + [i for i in atuais if i not in ordem])
    if tipo == "marco":
        return _status_marco(conn, id_, entrada["antes"]["status"])
    return _marcar_habito(conn, id_, acao == "reabrir")  # hábito: o contrário do que foi feito


def situacao(conn, entrada: dict) -> str:
    """intacto | editado | sumiu, como acoes._situacao."""
    if entrada["acao"] == "excluir":
        if entrada["tipo"] == "tarefa":
            return "intacto" if conn.execute("SELECT 1 FROM notas WHERE id = ?", (entrada["id"],)).fetchone() else "sumiu"
        if entrada["tipo"] == "lancamento":
            return "intacto"
        volta = conn.execute(f"SELECT 1 FROM {TABELA[entrada['tipo']]} WHERE id = ?", (entrada["id"],)).fetchone()
        return "sumiu" if volta else "intacto"  # já voltou por outro caminho: não duplica
    if entrada["tipo"] != "tarefa" and not conn.execute(
            f"SELECT 1 FROM {TABELA[entrada['tipo']]} WHERE id = ?", (entrada["id"],)).fetchone():
        return "sumiu"
    agora = retrato(conn, entrada)
    if agora is None:
        return "sumiu"
    if entrada["tipo"] == "tarefa" and agora is False:
        return "editado"
    return "intacto" if agora == entrada.get("retrato") else "editado"

