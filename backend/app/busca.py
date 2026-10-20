"""
Busca global (ORG-03) — o que a paleta Ctrl+K procura no banco.

Uma consulta por fonte (notas, metas, trilhas, marcos, lançamentos,
contas fixas, assinaturas, dívidas, compras parceladas, contas,
eventos, conquistas, posições, formações, links, repositórios e
e-mails), todas com o mesmo critério:

  - ignora acento e maiúscula (P-41): "acao" acha "Ação". A comparação
    usa sem_acento(), função Python registrada em toda conexão
    (database.get_connection) — o SQLite não tem isso nativo;
  - cada palavra digitada precisa aparecer em algum dos campos da fonte
    (tanto faz a ordem): "conta luz" acha "Luz — conta fixa";
  - ranking no Python: título igual > começa com > todas as palavras no
    começo de palavras do título > todas no título > só nos outros campos.

Por que LIKE e não FTS5 (o card citava os dois): o volume de um app
pessoal é pequeno (medido: 20 mil lançamentos + 2 mil e-mails respondem
em ~40 ms), e o FTS5 exigiria um índice espelhando ~17 tabelas com
gatilhos de insert/update/delete em cada uma — muito mais coisa pra
quebrar (e migrar) do que o ganho. Se um dia precisar, a interface
(buscar(db, q)) não muda.

Nota trancada entra só pelo título; o texto dela nunca é lido aqui.
"""
import re
import unicodedata
from typing import Optional

LIMITE_POR_TIPO = 6
LIMITE_TOTAL = 40
CANDIDATOS_POR_FONTE = 60
TRECHO_MAX = 110


def _tabela_sem_acento() -> dict:
    """Letra acentuada -> letra base, pros blocos Latin-1 e Latin
    Extended-A (todo acento do português e das línguas vizinhas). Feita
    uma vez; str.translate roda em C — a versão caractere a caractere com
    unicodedata levava ~300 ms numa busca sem acerto em 20 mil linhas."""
    tabela = {}
    for cp in range(0xC0, 0x250):
        c = chr(cp)
        base = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x))
        if base and base != c and base.isascii():
            tabela[cp] = base.lower()
    return tabela


_SEM_ACENTO = _tabela_sem_acento()


def sem_acento(texto: Optional[str]) -> str:
    """'Ação Única' -> 'acao unica'. Registrada no SQLite (database.py)."""
    if not texto:
        return ""
    return str(texto).lower().translate(_SEM_ACENTO)


# Cada fonte: tipo, SELECT com as colunas padronizadas (id, titulo,
# detalhe, data, valor, ref) e os campos onde a busca procura.
# `detalhe` é o texto de apoio mostrado abaixo do título; `ref` é o que
# a tela precisa pra abrir o item (conta do e-mail, trilha do marco…).
FONTES = [
    {
        "tipo": "nota",
        "select": "id, CASE WHEN titulo = '' THEN '(sem título)' ELSE titulo END AS titulo, CASE WHEN trancada = 1 THEN '' ELSE conteudo END AS detalhe, atualizada_em AS data, NULL AS valor, trancada AS ref",
        "de": 'FROM notas n WHERE arquivada = 0',
        "campos": [
            "titulo",
            "CASE WHEN trancada = 1 THEN '' ELSE conteudo END",
            "(SELECT group_concat(tag, ' ') FROM notas_tags t WHERE t.nota_id = n.id)",
        ],
    },
    {
        "tipo": "meta",
        "select": "id, title AS titulo, type || CASE WHEN status = 'concluida' THEN ' · concluída' ELSE '' END AS detalhe, deadline AS data, NULL AS valor, NULL AS ref",
        "de": 'FROM goals',
        "campos": ["title"],
    },
    {
        "tipo": "trilha",
        "select": "id, name AS titulo, COALESCE(general_goal, '') AS detalhe, NULL AS data, NULL AS valor, NULL AS ref",
        "de": 'FROM tracks',
        "campos": ["name", "general_goal"],
    },
    {
        "tipo": "marco",
        "select": "m.id, m.title AS titulo, 'trilha ' || t.name AS detalhe, NULL AS data, NULL AS valor, m.track_id AS ref",
        "de": 'FROM milestones m JOIN tracks t ON t.id = m.track_id',
        "campos": ["m.title", "m.description", "m.notes"],
    },
    {
        "tipo": "lancamento",
        "select": "id, description AS titulo, CASE type WHEN 'saida' THEN 'saída' WHEN 'transferencia' THEN 'transferência' ELSE type END || COALESCE(' · ' || category, '') AS detalhe, date AS data, amount AS valor, NULL AS ref",
        "de": 'FROM transactions',
        "campos": ["description", "category"],
    },
    {
        "tipo": "conta_fixa",
        "select": "id, name AS titulo, 'conta fixa · dia ' || due_day AS detalhe, NULL AS data, amount AS valor, NULL AS ref",
        "de": 'FROM fixed_bills',
        "campos": ["name", "categoria"],
    },
    {
        "tipo": "assinatura",
        "select": "id, nome AS titulo, 'assinatura · dia ' || dia_cobranca AS detalhe, NULL AS data, valor_esperado AS valor, NULL AS ref",
        "de": 'FROM wallet_subscriptions',
        "campos": ["nome", "categoria"],
    },
    {
        "tipo": "divida",
        "select": "id, description AS titulo, COALESCE(counterparty, '') AS detalhe, due_date AS data, amount AS valor, NULL AS ref",
        "de": 'FROM debts',
        "campos": ["description", "counterparty"],
    },
    {
        "tipo": "parcela",
        "select": "id, nome AS titulo, num_parcelas || ' parcelas' AS detalhe, NULL AS data, valor_total AS valor, NULL AS ref",
        "de": 'FROM compras_parceladas',
        "campos": ["nome"],
    },
    {
        "tipo": "conta",
        "select": 'a.id, a.nome AS titulo, b.nome AS detalhe, NULL AS data, NULL AS valor, NULL AS ref',
        "de": 'FROM wallet_accounts a JOIN wallet_banks b ON b.id = a.bank_id',
        "campos": ["a.nome", "b.nome"],
    },
    {
        "tipo": "evento",
        "select": "id, title AS titulo, COALESCE(notes, '') AS detalhe, date AS data, NULL AS valor, date AS ref",
        "de": 'FROM calendar_events',
        "campos": ["title", "notes"],
    },
    {
        "tipo": "conquista",
        "select": 'id, title AS titulo, description AS detalhe, unlocked_at AS data, NULL AS valor, CASE WHEN unlocked_at IS NULL THEN 0 ELSE 1 END AS ref',
        # secreta ainda bloqueada fica de fora (a API já mascara como "???";
        # a busca não pode ser o spoiler)
        "de": 'FROM achievements WHERE NOT (secreta = 1 AND unlocked_at IS NULL)',
        "campos": ["title", "description"],
    },
    {
        "tipo": "posicao",
        "select": "id, role AS titulo, company || COALESCE(' · ' || area, '') AS detalhe, start_date AS data, NULL AS valor, NULL AS ref",
        "de": 'FROM career_positions',
        "campos": ["role", "company", "area"],
    },
    {
        "tipo": "formacao",
        "select": 'id, curso AS titulo, instituicao AS detalhe, NULL AS data, NULL AS valor, NULL AS ref',
        "de": 'FROM career_educations',
        "campos": ["curso", "instituicao"],
    },
    {
        "tipo": "link",
        "select": 'id, title AS titulo, url AS detalhe, NULL AS data, NULL AS valor, url AS ref',
        "de": 'FROM links',
        "campos": ["title", "url", "category"],
    },
    {
        "tipo": "repositorio",
        "select": "id, repo_full_name AS titulo, 'github' AS detalhe, NULL AS data, NULL AS valor, NULL AS ref",
        "de": 'FROM github_repos',
        "campos": ["repo_full_name"],
    },
    {
        "tipo": "email",
        "select": 'id, subject AS titulo, sender AS detalhe, received_at AS data, NULL AS valor, account_id AS ref',
        "de": 'FROM email_cache',
        "campos": ["subject", "sender"],
    },
]


def palavras(q: str) -> list[str]:
    return [p for p in re.split(r"\s+", sem_acento(q).strip()) if p][:8]


def _like(p: str) -> str:
    return "%" + p.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _pontos(titulo: str, ps: list[str], frase: str) -> int:
    t = sem_acento(titulo)
    if t == frase:
        return 100
    if t.startswith(frase):
        return 85
    inicios = re.findall(r"\w+", t)
    if all(any(w.startswith(p) for w in inicios) for p in ps):
        return 70
    if all(p in t for p in ps):
        return 55
    return 30  # achou só nos outros campos (texto, remetente, categoria…)


def _trecho(texto: str, ps: list[str]) -> str:
    """Pedaço do texto em volta da primeira palavra achada (nota, evento…)."""
    plano = " ".join((texto or "").split())
    if len(plano) <= TRECHO_MAX:
        return plano
    norm = sem_acento(plano)  # mesmo comprimento: NFKD+remoção só tira marcas
    pos = min((norm.find(p) for p in ps if norm.find(p) >= 0), default=0)
    ini = max(0, pos - 30)
    fim = ini + TRECHO_MAX
    return ("…" if ini else "") + plano[ini:fim].strip() + ("…" if fim < len(plano) else "")


def buscar(db, q: str, tipos: Optional[set] = None) -> list[dict]:
    ps = palavras(q)
    if not ps:
        return []
    frase = " ".join(ps)
    from app.email_texto import separar_remetente
    from app.routers.notas import previa_de_markdown  # import tardio (evita ciclo)

    achados = []
    for fonte in FONTES:
        if tipos and fonte["tipo"] not in tipos:
            continue
        # cada palavra em algum campo (AND entre palavras, OR entre campos)
        cond = " AND ".join(
            "(" + " OR ".join(f"sem_acento({c}) LIKE ? ESCAPE '\\'" for c in fonte["campos"]) + ")" for _ in ps
        )
        args = [_like(p) for p in ps for _ in fonte["campos"]]
        juntar = " AND " if " WHERE " in fonte["de"].upper() else " WHERE "
        sql = f"SELECT {fonte['select']} {fonte['de']}{juntar}{cond} LIMIT {CANDIDATOS_POR_FONTE}"
        itens = []
        for r in db.execute(sql, args).fetchall():
            detalhe = r["detalhe"] or ""
            if fonte["tipo"] == "nota" and detalhe:
                detalhe = previa_de_markdown(detalhe, 400)
            elif fonte["tipo"] == "email":
                detalhe = separar_remetente(detalhe)[0]  # só o nome, sem <endereço>
            itens.append({
                "tipo": fonte["tipo"],
                "id": r["id"],
                "titulo": r["titulo"] or "",
                "detalhe": _trecho(str(detalhe), ps),
                "data": r["data"],
                "valor": r["valor"],
                "ref": None if r["ref"] is None else str(r["ref"]),
                "pontos": _pontos(r["titulo"] or "", ps, frase),
            })
        # melhor pontuação primeiro; empate: o mais recente
        itens.sort(key=lambda i: (-i["pontos"], _inverter(i["data"])))
        achados.extend(itens[:LIMITE_POR_TIPO])

    achados.sort(key=lambda i: -i["pontos"])  # estável: mantém a ordem dentro do tipo
    return achados[:LIMITE_TOTAL]


def _inverter(data) -> str:
    """Chave de ordenação decrescente pra datas ISO (sem data vai pro fim)."""
    if not data:
        return "~"
    return "".join(chr(0x10FFFF - ord(c)) for c in str(data))
