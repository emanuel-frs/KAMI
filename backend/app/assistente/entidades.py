"""
Assistente: o resto do Kami pelo mesmo cartão (2.1.0).

acoes.py e edicao.py cuidam, tipo a tipo, do que o assistente já fazia
(nota, tarefa, lembrete, evento, hábito, lançamento, meta, trilha, marco,
link). Os tipos daqui são descritos por dados — cada `Entidade` diz os
campos (o que o cartão mostra e edita), como ler a linha, e quais funções
de rota criam, alteram, apagam, pagam/recebem — e o caminho comum é o mesmo:
o modelo propõe, a pessoa confere no cartão, aplica pela rota da tela
(mesmas regras e xp) e o lote desfaz.

Pagar, receber, contribuir pra meta e transferir mexem em dinheiro: só
quando a pessoa pede com todas as letras (instruções), e o cartão mostra a
conta e o valor antes. O desfazer devolve saldo, fatura e xp pelas rotas
de desfazer (desmarcar pagamento, apagar lançamento) ou, quando a tela não
tem rota inversa (contribuição), pelo inverso exato do que foi gravado.

Campos (`Campo.tipo`): texto, area, valor (dinheiro), inteiro, dia (1–31),
data (YYYY-MM-DD), mes (YYYY-MM), escolha (`opcoes`), conta (id da
carteira; o modelo manda o nome), atributo (área de xp), sim_nao. O cartão
desenha cada um pelo tipo — o rótulo é `assistente.proposta.campo.<chave>`
e a opção de uma escolha `assistente.proposta.opcao.<chave>.<valor>`.
"""
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from app.database import local_now
from app.mensagens import ErroKami

_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MES = re.compile(r"^\d{4}-\d{2}$")


@dataclass
class Campo:
    chave: str
    modelo: str  # nome da propriedade em propose_actions
    tipo: str
    obrigatorio: bool = False
    opcoes: tuple = ()
    mapa: dict = field(default_factory=dict)  # valor do modelo → valor do Kami (escolha)
    padrao: Any = None
    maximo: int = 200
    rotulo: str = ""  # chave do rótulo quando não é a própria `chave`
    quando: dict = field(default_factory=dict)  # só aparece se outros campos valem isto ({campo: (valores)})


@dataclass
class Entidade:
    tipo: str
    modelo: str
    nome_en: str
    tabela: str
    coluna_nome: str
    area: str  # permissão de leitura (config.AREAS) que mostra os refs
    campos: list
    ler: Callable  # row → dados
    criar: Callable  # (conn, dados) → id
    apagar: Callable  # (conn, id)
    gravar: Optional[Callable] = None  # (conn, id, dados, extra) → id; None = não se altera
    extra: Callable = lambda row: {}  # o que a rota precisa reenviar e o cartão não mostra
    conferir: Callable = lambda conn, d: None  # regras além de obrigatório/formato
    filhos: list = field(default_factory=list)  # (tabela, coluna) que somem junto (CASCADE)
    vinculos: list = field(default_factory=list)  # (tabela, coluna) que viram NULL (SET NULL)
    eh_log: bool = False  # a própria linha é um registro de xp (ação do núcleo)
    devolver: Optional[Callable] = None  # (conn, entrada) desfaz um apagar sem a cópia crua
    pagar: Optional[Callable] = None  # concluir = pagar/receber o mês; (conn, id, dados) → estado
    despagar: Optional[Callable] = None  # (conn, id, estado) desfaz o pagar
    pago: Optional[Callable] = None  # (conn, id) → bool (já pago/recebido neste mês)
    acao_pagar: tuple = ()  # campos que o pagar usa (valor, forma…)


# ── normalizar o que o modelo mandou ──────────────────────────────────────

def _txt(v, maximo=200) -> str:
    return " ".join(v.split())[:maximo] if isinstance(v, str) else ""


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "."))
        except ValueError:
            return None
    return None


def normalizar(c: Campo, v, conn=None, contas=None):
    """Valor do modelo → valor de `dados` (None = não veio / não serve)."""
    if v is None:
        return None
    if c.tipo in ("texto", "area"):
        return v[: c.maximo] if c.tipo == "area" and isinstance(v, str) else _txt(v, c.maximo)
    if c.tipo == "valor":
        n = _num(v)
        return round(abs(n), 2) if n is not None else None
    if c.tipo in ("inteiro", "dia"):
        n = _num(v)
        return int(n) if n is not None else None
    if c.tipo == "data":
        return v if isinstance(v, str) and _DATA.match(v) else None
    if c.tipo == "mes":
        if isinstance(v, str) and _DATA.match(v):
            v = v[:7]
        return v if isinstance(v, str) and _MES.match(v) else None
    if c.tipo == "escolha":
        v = c.mapa.get(v, v) if isinstance(v, str) else None
        return v if v in c.opcoes else None
    if c.tipo == "sim_nao":
        return bool(v) if isinstance(v, bool) else {"yes": True, "no": False, "true": True, "false": False}.get(str(v).lower())
    if c.tipo == "atributo":
        return v if isinstance(v, str) and v else None
    if c.tipo == "conta":
        return conta_pelo_nome(contas or [], v)
    return v


def conta_pelo_nome(contas: list, nome) -> str:
    alvo = _txt(nome, 120).lower()
    if not alvo:
        return ""
    for c in contas:
        nomes = {c["nome"].lower(), f"{c['banco']} {c['nome']}".lower(), c["banco"].lower(), c["id"]}
        if alvo in nomes or any(alvo in n or n in alvo for n in nomes if len(n) >= 3):
            return c["id"]
    return ""


def _vazio(c: Campo):
    if c.padrao is not None:
        return c.padrao
    return 0 if c.tipo in ("valor", "inteiro", "dia") else ""


def dados_novos(campos: list, a: dict, contas: list) -> dict:
    d = {}
    for c in campos:
        v = normalizar(c, a.get(c.modelo), contas=contas)
        d[c.chave] = v if v is not None else _vazio(c)
    return d


def mudancas(campos: list, a: dict, contas: list) -> dict:
    m = {}
    for c in campos:
        if c.modelo in a and a[c.modelo] is not None:
            v = normalizar(c, a[c.modelo], contas=contas)
            if v is not None:
                m[c.chave] = v
    return m


def campos_ui(campos: list) -> list[dict]:
    """O que o cartão desenha (na ordem)."""
    out = []
    for c in campos:
        x = {"chave": c.chave, "tipo": c.tipo}
        if c.opcoes:
            x["opcoes"] = list(c.opcoes)
        if c.rotulo:
            x["rotulo"] = c.rotulo
        if c.obrigatorio:
            x["obrigatorio"] = True
        if c.quando:
            x["quando"] = {k: list(v) for k, v in c.quando.items()}
        out.append(x)
    return out


def conferir_campos(conn, campos: list, d: dict) -> None:
    """Obrigatório e formato de cada campo."""
    for c in campos:
        v = d.get(c.chave)
        vazio = v in (None, "") or (c.tipo in ("valor", "inteiro", "dia") and not v)
        if c.obrigatorio and vazio:
            raise ErroKami(422, "erro.assistente.falta_campo", "falta preencher: {campo}", campo=c.chave)
        if vazio:
            continue
        if c.tipo == "dia" and not 1 <= int(v) <= 31:
            raise ErroKami(422, "erro.assistente.dia_invalido", "dia do mês entre 1 e 31")
        if c.tipo == "data" and not _DATA.match(str(v)):
            raise ErroKami(422, "erro.calendario.date_deve_ser_yyyy_mm", "'date' deve ser 'YYYY-MM-DD'")
        if c.tipo == "mes" and not _MES.match(str(v)):
            raise ErroKami(422, "erro.assistente.mes_invalido", "mês no formato AAAA-MM")
        if c.tipo == "escolha" and v not in c.opcoes:
            raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
        if c.tipo == "conta" and not conn.execute("SELECT 1 FROM wallet_accounts WHERE id = ?", (v,)).fetchone():
            raise ErroKami(422, "erro.comum.conta_nao_encontrada", "conta não encontrada")
        if c.tipo == "atributo" and not conn.execute("SELECT 1 FROM attributes WHERE name = ?", (v,)).fetchone():
            raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")


def _mes_atual() -> str:
    return local_now().strftime("%Y-%m")


def _hoje() -> str:
    return local_now().date().isoformat()


def _conta(conn, conta_id):
    return conn.execute("SELECT * FROM wallet_accounts WHERE id = ?", (conta_id or "",)).fetchone()


def _forma_ok(conn, conta_id, forma) -> None:
    """Conta com saldo E crédito precisa da forma (a rota recusaria)."""
    c = _conta(conn, conta_id)
    if c and c["possui_saldo"] and c["possui_credito"] and forma not in ("saldo", "credito"):
        raise ErroKami(422, "erro.assistente.escolha_a_forma", "escolha se foi no saldo ou no crédito")


FORMA = Campo("forma", "payment", "escolha", opcoes=("", "saldo", "credito"), mapa={"balance": "saldo", "credit": "credito"}, padrao="")
# o que "concluir" (pagar/receber) de cada tipo mostra no cartão
PAGAR = {"valor_pago": Campo("valor_pago", "amount", "valor"), "forma": FORMA,
         "conta_pagamento": Campo("conta_pagamento", "account", "conta"),
         "data_pagamento": Campo("data_pagamento", "date", "data")}


# ── contas fixas ──────────────────────────────────────────────────────────

def _conta_fixa_criar(conn, d):
    from app.routers.financas import contas
    return contas.create_fixed_bill(contas.FixedBillIn(
        name=d["nome"], amount=d["valor"], due_day=d["dia"], active=d["ativa"] is not False,
        conta_id=d["conta_id"] or None, categoria=d["categoria"] or None), db=conn)["id"]


def _conta_fixa_gravar(conn, id_, d, extra):
    from app.routers.financas import contas
    contas.update_fixed_bill(id_, contas.FixedBillIn(
        name=d["nome"], amount=d["valor"], due_day=d["dia"], active=d["ativa"] is not False,
        conta_id=d["conta_id"] or None, categoria=d["categoria"] or None), db=conn)
    return id_


def _periodo(conn, tabela, coluna, id_, listar):
    """O período deste mês (a listagem da rota cria se ainda não existe)."""
    listar(_mes_atual())
    return conn.execute(f"SELECT * FROM {tabela} WHERE {coluna} = ? AND mes_ano = ?", (id_, _mes_atual())).fetchone()


def _conta_fixa_periodo(conn, id_):
    from app.routers.financas import contas
    return _periodo(conn, "fixed_bill_periods", "fixed_bill_id", id_, lambda m: contas.list_fixed_bill_periods(m, db=conn))


def _conta_fixa_pagar(conn, id_, d):
    from app.routers.financas import contas
    p = _conta_fixa_periodo(conn, id_)
    if p is None:
        raise ErroKami(422, "erro.assistente.inativa", "está desativada")
    contas.pay_fixed_bill_period(p["id"], contas.PayFixedBillPeriodPayload(
        valor_pago=d.get("valor_pago") or None, forma_pagamento=d.get("forma") or None), db=conn)
    return {"periodo": p["id"]}


def _conta_fixa_despagar(conn, id_, estado):
    from app.routers.financas import contas
    contas.unpay_fixed_bill_period(estado["periodo"], db=conn)


def _conta_fixa_pago(conn, id_):
    p = _conta_fixa_periodo(conn, id_)
    return bool(p and p["paga"])


# ── assinaturas ───────────────────────────────────────────────────────────

def _assinatura_in(d):
    from app.routers import carteira
    return carteira.SubscriptionIn(nome=d["nome"], valor_esperado=d["valor"], dia_cobranca=d["dia"],
                                   conta_id=d["conta_id"] or None, active=d["ativa"] is not False,
                                   categoria=d["categoria"] or None)


def _assinatura_periodo(conn, id_):
    from app.routers import carteira
    return _periodo(conn, "wallet_subscription_periods", "subscription_id", id_,
                    lambda m: carteira.list_subscription_periods(m, db=conn))


def _assinatura_pagar(conn, id_, d):
    from app.routers import carteira
    p = _assinatura_periodo(conn, id_)
    if p is None:
        raise ErroKami(422, "erro.assistente.inativa", "está desativada")
    carteira.pay_period(p["id"], carteira.PayPeriodPayload(valor_pago=d.get("valor_pago") or None,
                                                          forma_pagamento=d.get("forma") or None), db=conn)
    return {"periodo": p["id"]}


def _assinatura_despagar(conn, id_, estado):
    from app.routers import carteira
    carteira.unpay_period(estado["periodo"], db=conn)


# ── compras parceladas ────────────────────────────────────────────────────

def _parcelada_in(d):
    from app.routers import carteira
    return carteira.CompraParceladaIn(nome=d["nome"], valor_total=d["valor"], num_parcelas=d["parcelas"],
                                      conta_id=d["conta_id"] or None, mes_primeira_parcela=d["primeiro_mes"])


def _parcelada_devolver(conn, entrada):
    """A rota de apagar tira o total da fatura; voltar pela rota de criar
    põe de volta (id novo) e o ajuste de parcelas volta como estava."""
    from app.routers import carteira
    linha = entrada["copia"]["linhas"]["compras_parceladas"][0]
    d = {"nome": linha["nome"], "valor": linha["valor_total"], "parcelas": linha["num_parcelas"],
         "conta_id": linha["conta_id"] or "", "primeiro_mes": linha["mes_primeira_parcela"]}
    novo = carteira.create_compra_parcelada(_parcelada_in(d), db=conn)["id"]
    conn.execute("UPDATE compras_parceladas SET ajuste_parcelas = ? WHERE id = ?", (linha["ajuste_parcelas"], novo))
    conn.commit()


def _parcelada_conferir(conn, d):
    if d["parcelas"] < 1:
        raise ErroKami(422, "erro.assistente.acao_invalida", "item com dados inválidos")
    if d["conta_id"]:
        c = _conta(conn, d["conta_id"])
        if c and not c["possui_credito"]:
            raise ErroKami(422, "erro.carteira.conta_vinculada_precisa_ter_credito", "a conta vinculada precisa ter crédito cadastrado")


# ── dívidas ───────────────────────────────────────────────────────────────

def _divida_in(d, status):
    from app.routers.financas import contas
    return contas.DebtIn(description=d["nome"], counterparty=d["credor"] or None, amount=d["valor"],
                         due_date=d["vencimento"] or None, status=status)


def _divida_pagar(conn, id_, d):
    from app.routers.financas import contas
    contas.pay_debt(id_, contas.PayDebtPayload(conta_id=d.get("conta_pagamento") or None,
                                               forma_pagamento=d.get("forma") or None), db=conn)
    return {}


def _divida_despagar(conn, id_, estado):
    from app.routers.financas import contas
    contas.unpay_debt(id_, db=conn)


# ── fontes de renda ───────────────────────────────────────────────────────

_RENDA_EXTRA = ("intervalo_dias", "data_base", "fonte_referencia_id", "offset_dias_uteis")


def _renda_in(d, extra):
    from app.routers.financas import renda
    tipo = d["tipo_data"] or None
    return renda.IncomeSourceIn(
        nome=d["nome"], valor=d["valor"], conta_id=d["conta_id"] or None, categoria=d["categoria"] or None,
        frequencia=d["frequencia"], tipo_data=None if d["frequencia"] == "avulsa" else tipo,
        dia_mes=d["dia"] or None if tipo == "dia_fixo" else None,
        nth_dia_util=d["dia_util"] or None if tipo == "dia_util" else None,
        data_avulsa=d["data"] or None if d["frequencia"] == "avulsa" else None,
        active=d["ativa"] is not False, **{k: extra.get(k) for k in _RENDA_EXTRA})


def _renda_conferir(conn, d):
    if d["frequencia"] == "avulsa":
        if not d["data"]:
            raise ErroKami(422, "erro.assistente.falta_campo", "falta preencher: {campo}", campo="data")
        return
    if d["tipo_data"] == "dia_fixo" and not d["dia"]:
        raise ErroKami(422, "erro.assistente.falta_campo", "falta preencher: {campo}", campo="dia")
    if d["tipo_data"] == "dia_util" and not d["dia_util"]:
        raise ErroKami(422, "erro.assistente.falta_campo", "falta preencher: {campo}", campo="dia_util")


def _renda_entrada(conn, id_):
    """A entrada deste mês ainda prevista (a primeira, se a fonte é semanal/quinzenal)."""
    from app.routers.financas import renda
    renda.get_income_entries(_mes_atual(), db=conn)
    return conn.execute("SELECT * FROM income_entries WHERE income_source_id = ? AND substr(expected_date, 1, 7) = ? "
                        "ORDER BY status = 'pago', expected_date LIMIT 1", (id_, _mes_atual())).fetchone()


def _renda_pagar(conn, id_, d):
    from app.routers.financas import renda
    e = _renda_entrada(conn, id_)
    if e is None or e["status"] == "pago":
        raise ErroKami(422, "erro.assistente.nada_muda", "isso já está assim")
    renda.pay_income_entry(e["id"], renda.PayIncomePayload(valor_recebido=d.get("valor_pago") or None,
                                                          paid_date=d.get("data_pagamento") or None), db=conn)
    return {"entrada": e["id"]}


def _renda_despagar(conn, id_, estado):
    from app.routers.financas import renda
    renda.unpay_income_entry(estado["entrada"], db=conn)


def _renda_pago(conn, id_):
    e = _renda_entrada(conn, id_)
    return bool(e) and e["status"] == "pago"


# ── núcleo: conquista personalizada e ação ───────────────────────────────

def _conquista_ler(row):
    c = json.loads(row["criteria_json"] or "{}")
    return {"titulo": row["title"], "atributo": c.get("attribute") or "", "quantidade": c.get("count") or 1,
            "palavra": c.get("keyword") or ""}


def _conquista_in(d):
    from app.routers import nucleo
    return nucleo.CustomAchievementIn(title=d["titulo"], attribute=d["atributo"] or None, count=d["quantidade"],
                                      keyword=d["palavra"] or None)


def _acao_criar(conn, d):
    from app.routers import nucleo
    return nucleo.register_action(nucleo.ActionCreate(description=d["descricao"], categories=[d["atributo"]], xp=d["xp"],
                                                      impact=d["impacto"] or None), db=conn)["id"]


def _acao_conferir(conn, d):
    from app.routers.nucleo import MAX_MANUAL_XP
    if not 1 <= d["xp"] <= MAX_MANUAL_XP:
        raise ErroKami(422, "erro.assistente.xp_fora", "xp entre 1 e {max}", max=MAX_MANUAL_XP)


def _acao_ler(row):
    return {"descricao": row["description"], "xp": row["xp_gained"], "impacto": row["impact_note"] or 0, "atributo": ""}


# ── carreira ──────────────────────────────────────────────────────────────

def _posicao_in(d):
    from app.routers import carreira
    return carreira.PositionIn(company=d["empresa"], role=d["cargo"], area=d["area"] or None,
                               employment_type=d["vinculo"] or None, start_date=d["inicio"], end_date=d["fim"] or None,
                               expected_contract_end=d["fim_contrato"] or None,
                               expected_salary_review=d["revisao_salarial"] or None)


def _formacao_criar(conn, d):
    from app.routers import carreira
    return carreira.create_education(carreira.EducationIn(
        curso=d["curso"], instituicao=d["instituicao"], nivel=d["nivel"], status=d["situacao"],
        previsao_conclusao=d["previsao"] or None), db=conn)["id"]


def _formacao_gravar(conn, id_, d, extra):
    from app.routers import carreira
    carreira.update_education(id_, carreira.EducationUpdate(
        curso=d["curso"], instituicao=d["instituicao"], nivel=d["nivel"], status=d["situacao"],
        previsao_conclusao=d["previsao"] or None, clear_previsao_conclusao=not d["previsao"]), db=conn)
    return id_


def _salario_in(d, extra):
    from app.routers import carreira
    return carreira.SalaryRecordIn(amount=d["valor"], currency=d["moeda"] or "BRL", employment_type=d["vinculo"] or None,
                                   date=d["data"], reason=d["motivo"] or None, position_id=extra.get("position_id"))


def _interesse_in(d):
    from app.routers import carreira
    return carreira.InterestIn(tag=d["tag"])


def _repo_in(d):
    from app.routers.organizacao import github
    return github.GithubRepoIn(repo_full_name=d["repo"])


def _repo_conferir(conn, d):
    if not re.match(r"^[\w.-]+/[\w.-]+$", d["repo"]):
        raise ErroKami(422, "erro.assistente.repo_invalido", "use o formato usuario/repositorio")


# ── transferência ─────────────────────────────────────────────────────────

def _transferencia_criar(conn, d):
    from app.routers.financas import lancamentos
    out = lancamentos._apply_transaction(conn, lancamentos.TransactionIn(
        description=d["descricao"] or "transferência", amount=d["valor"], type="transferencia", category="transferência",
        date=d["data"], conta_id=d["conta_id"], conta_destino_id=d["destino_id"] or None,
        destino_externo=d["destino_externo"] or None))
    conn.commit()
    lancamentos._credit_transaction_xp(conn, out)
    return out["id"]


def _transferencia_conferir(conn, d):
    if not d["destino_id"] and not d["destino_externo"]:
        raise ErroKami(422, "erro.assistente.falta_campo", "falta preencher: {campo}", campo="destino_id")
    if d["destino_id"] and d["destino_id"] == d["conta_id"]:
        raise ErroKami(422, "erro.assistente.mesma_conta", "a conta de origem e a de destino são a mesma")


def _transferencia_ler(row):
    return {"descricao": row["description"], "valor": row["amount"], "data": row["date"], "conta_id": row["conta_id"],
            "destino_id": row["conta_destino_id"] or "", "destino_externo": row["destino_externo"] or ""}


# ── o registro ────────────────────────────────────────────────────────────

ATIVA = Campo("ativa", "active", "sim_nao", padrao=True)
CATEGORIA = Campo("categoria", "category", "texto", maximo=60)
CONTA = Campo("conta_id", "account", "conta")

ENTIDADES: dict[str, Entidade] = {}


def _registrar(e: Entidade):
    ENTIDADES[e.tipo] = e


def _rota(modulo, funcao):
    """Chama a função da rota com db=conn (import tardio)."""
    def chamar(conn, *args):
        import importlib
        return getattr(importlib.import_module(f"app.routers.{modulo}"), funcao)(*args, db=conn)
    return chamar


_registrar(Entidade(
    "conta_fixa", "fixed_bill", "fixed bill", "fixed_bills", "name", "financas",
    [Campo("nome", "title", "texto", obrigatorio=True, maximo=120), Campo("valor", "amount", "valor", obrigatorio=True),
     Campo("dia", "day", "dia", obrigatorio=True), CONTA, CATEGORIA, ATIVA],
    ler=lambda r: {"nome": r["name"], "valor": r["amount"], "dia": r["due_day"], "conta_id": r["conta_id"] or "",
                   "categoria": r["categoria"] or "", "ativa": bool(r["active"])},
    criar=_conta_fixa_criar, gravar=_conta_fixa_gravar,
    apagar=lambda conn, id_: _rota("financas.contas", "delete_fixed_bill")(conn, id_),
    filhos=[("fixed_bill_periods", "fixed_bill_id")],
    pagar=_conta_fixa_pagar, despagar=_conta_fixa_despagar, pago=_conta_fixa_pago, acao_pagar=("valor_pago", "forma"),
))

_registrar(Entidade(
    "assinatura", "subscription", "subscription", "wallet_subscriptions", "nome", "financas",
    [Campo("nome", "title", "texto", obrigatorio=True, maximo=120), Campo("valor", "amount", "valor", obrigatorio=True),
     Campo("dia", "day", "dia", obrigatorio=True), CONTA, CATEGORIA, ATIVA],
    ler=lambda r: {"nome": r["nome"], "valor": r["valor_esperado"], "dia": r["dia_cobranca"], "conta_id": r["conta_id"] or "",
                   "categoria": r["categoria"] or "", "ativa": bool(r["active"])},
    criar=lambda conn, d: _rota("carteira", "create_subscription")(conn, _assinatura_in(d))["id"],
    gravar=lambda conn, id_, d, x: (_rota("carteira", "update_subscription")(conn, id_, _assinatura_in(d)), id_)[1],
    apagar=lambda conn, id_: _rota("carteira", "delete_subscription")(conn, id_),
    filhos=[("wallet_subscription_periods", "subscription_id")],
    pagar=_assinatura_pagar, despagar=_assinatura_despagar,
    pago=lambda conn, id_: bool((p := _assinatura_periodo(conn, id_)) and p["paga"]), acao_pagar=("valor_pago", "forma"),
))

_registrar(Entidade(
    "parcelada", "installment_purchase", "installment purchase", "compras_parceladas", "nome", "financas",
    [Campo("nome", "title", "texto", obrigatorio=True, maximo=120), Campo("valor", "amount", "valor", obrigatorio=True, rotulo="valor_total"),
     Campo("parcelas", "installments", "inteiro", obrigatorio=True), CONTA,
     Campo("primeiro_mes", "first_month", "mes", obrigatorio=True)],
    ler=lambda r: {"nome": r["nome"], "valor": r["valor_total"], "parcelas": r["num_parcelas"], "conta_id": r["conta_id"] or "",
                   "primeiro_mes": r["mes_primeira_parcela"]},
    criar=lambda conn, d: _rota("carteira", "create_compra_parcelada")(conn, _parcelada_in(d))["id"],
    gravar=lambda conn, id_, d, x: (_rota("carteira", "update_compra_parcelada")(conn, id_, _parcelada_in(d)), id_)[1],
    apagar=lambda conn, id_: _rota("carteira", "delete_compra_parcelada")(conn, id_),
    conferir=_parcelada_conferir, devolver=_parcelada_devolver,
))

_registrar(Entidade(
    "divida", "debt", "debt", "debts", "description", "financas",
    [Campo("nome", "title", "texto", obrigatorio=True, maximo=120), Campo("credor", "counterparty", "texto", maximo=120),
     Campo("valor", "amount", "valor", obrigatorio=True), Campo("vencimento", "deadline", "data")],
    ler=lambda r: {"nome": r["description"], "credor": r["counterparty"] or "", "valor": r["amount"],
                   "vencimento": (r["due_date"] or "")[:10]},
    extra=lambda r: {"status": r["status"]},
    criar=lambda conn, d: _rota("financas.contas", "create_debt")(conn, _divida_in(d, "aberta"))["id"],
    gravar=lambda conn, id_, d, x: (_rota("financas.contas", "update_debt")(conn, id_, _divida_in(d, x.get("status") or "aberta")), id_)[1],
    apagar=lambda conn, id_: _rota("financas.contas", "delete_debt")(conn, id_),
    pagar=_divida_pagar, despagar=_divida_despagar,
    pago=lambda conn, id_: conn.execute("SELECT status FROM debts WHERE id = ?", (id_,)).fetchone()["status"] == "paga",
    acao_pagar=("conta_pagamento", "forma"),
))

_FREQ = Campo("frequencia", "frequency", "escolha", opcoes=("mensal", "quinzenal", "semanal", "avulsa"), padrao="mensal",
              mapa={"monthly": "mensal", "biweekly": "quinzenal", "weekly": "semanal", "once": "avulsa"})
_TIPO_DATA = Campo("tipo_data", "pay_day_kind", "escolha", opcoes=("dia_fixo", "dia_util"), padrao="dia_fixo",
                   mapa={"fixed_day": "dia_fixo", "business_day": "dia_util"},
                   quando={"frequencia": ("mensal", "quinzenal", "semanal")})
_registrar(Entidade(
    "renda", "income_source", "income source", "income_sources", "nome", "financas",
    [Campo("nome", "title", "texto", obrigatorio=True, maximo=120), Campo("valor", "amount", "valor", obrigatorio=True),
     _FREQ, _TIPO_DATA,
     Campo("dia", "day", "dia", quando={"frequencia": ("mensal", "quinzenal", "semanal"), "tipo_data": ("dia_fixo",)}),
     Campo("dia_util", "business_day", "inteiro", quando={"frequencia": ("mensal", "quinzenal", "semanal"), "tipo_data": ("dia_util",)}),
     Campo("data", "date", "data", quando={"frequencia": ("avulsa",)}), CONTA, CATEGORIA, ATIVA],
    ler=lambda r: {"nome": r["nome"], "valor": r["valor"], "frequencia": r["frequencia"], "tipo_data": r["tipo_data"] or "dia_fixo",
                   "dia": r["dia_mes"] or 0, "dia_util": r["nth_dia_util"] or 0, "data": r["data_avulsa"] or "",
                   "conta_id": r["conta_id"] or "", "categoria": r["categoria"] or "", "ativa": bool(r["active"])},
    extra=lambda r: {k: r[k] for k in _RENDA_EXTRA},
    criar=lambda conn, d: _rota("financas.renda", "create_income_source")(conn, _renda_in(d, {}))["id"],
    gravar=lambda conn, id_, d, x: (_rota("financas.renda", "update_income_source")(conn, id_, _renda_in(d, x)), id_)[1],
    apagar=lambda conn, id_: _rota("financas.renda", "delete_income_source")(conn, id_),
    conferir=_renda_conferir, filhos=[("income_entries", "income_source_id")],
    vinculos=[("income_sources", "fonte_referencia_id")],
    pagar=_renda_pagar, despagar=_renda_despagar, pago=_renda_pago, acao_pagar=("valor_pago",),
))

_registrar(Entidade(
    "conquista", "custom_achievement", "custom achievement", "achievements", "title", "progresso",
    [Campo("titulo", "title", "texto", obrigatorio=True, maximo=60), Campo("atributo", "attribute", "atributo"),
     Campo("quantidade", "count", "inteiro", obrigatorio=True), Campo("palavra", "keyword", "texto", maximo=40)],
    ler=_conquista_ler,
    criar=lambda conn, d: _rota("nucleo", "create_custom_achievement")(conn, _conquista_in(d))["id"],
    gravar=lambda conn, id_, d, x: (_rota("nucleo", "update_custom_achievement")(conn, id_, _conquista_in(d)), id_)[1],
    apagar=lambda conn, id_: _rota("nucleo", "delete_custom_achievement")(conn, id_),
))

_registrar(Entidade(
    "acao", "core_action", "core action", "action_logs", "description", "progresso",
    [Campo("descricao", "title", "texto", obrigatorio=True, maximo=200), Campo("atributo", "attribute", "atributo", obrigatorio=True),
     Campo("xp", "xp", "inteiro", obrigatorio=True), Campo("impacto", "impact", "inteiro")],
    ler=_acao_ler, criar=_acao_criar, conferir=_acao_conferir, eh_log=True,
    apagar=lambda conn, id_: _rota("nucleo", "delete_action")(conn, id_),
))

_registrar(Entidade(
    "interesse", "career_interest", "career interest", "career_interests", "tag", "carreira",
    [Campo("tag", "title", "texto", obrigatorio=True, maximo=60)],
    ler=lambda r: {"tag": r["tag"]},
    criar=lambda conn, d: _rota("carreira", "create_interest")(conn, _interesse_in(d))["id"],
    apagar=lambda conn, id_: _rota("carreira", "delete_interest")(conn, id_),
))

_registrar(Entidade(
    "posicao", "career_position", "career position", "career_positions", "role", "carreira",
    [Campo("cargo", "role", "texto", obrigatorio=True, maximo=120), Campo("empresa", "company", "texto", obrigatorio=True, maximo=120),
     Campo("area", "area", "texto", maximo=80), Campo("vinculo", "employment_type", "texto", maximo=40),
     Campo("inicio", "date", "data", obrigatorio=True), Campo("fim", "end_date", "data"),
     Campo("fim_contrato", "contract_end", "data"), Campo("revisao_salarial", "salary_review", "data")],
    ler=lambda r: {"cargo": r["role"], "empresa": r["company"], "area": r["area"] or "", "vinculo": r["employment_type"] or "",
                   "inicio": r["start_date"], "fim": r["end_date"] or "", "fim_contrato": r["expected_contract_end"] or "",
                   "revisao_salarial": r["expected_salary_review"] or ""},
    criar=lambda conn, d: _rota("carreira", "create_position")(conn, _posicao_in(d))["id"],
    gravar=lambda conn, id_, d, x: (_rota("carreira", "update_position")(conn, id_, _posicao_in(d)), id_)[1],
    apagar=lambda conn, id_: _rota("carreira", "delete_position")(conn, id_),
    vinculos=[("career_salary_records", "position_id")],
))

_registrar(Entidade(
    "formacao", "education", "education", "career_educations", "curso", "carreira",
    [Campo("curso", "title", "texto", obrigatorio=True, maximo=120), Campo("instituicao", "institution", "texto", obrigatorio=True, maximo=120),
     Campo("nivel", "level", "escolha", obrigatorio=True,
           opcoes=("certificacao", "tecnico", "graduacao", "pos_graduacao", "mestrado", "doutorado"),
           mapa={"certificate": "certificacao", "technical": "tecnico", "bachelor": "graduacao", "postgraduate": "pos_graduacao",
                 "master": "mestrado", "doctorate": "doutorado"}),
     Campo("situacao", "status", "escolha", opcoes=("em_andamento", "concluido", "trancado"), padrao="em_andamento",
           mapa={"in_progress": "em_andamento", "done": "concluido", "paused": "trancado"}),
     Campo("previsao", "deadline", "data")],
    ler=lambda r: {"curso": r["curso"], "instituicao": r["instituicao"], "nivel": r["nivel"], "situacao": r["status"],
                   "previsao": r["previsao_conclusao"] or ""},
    criar=_formacao_criar, gravar=_formacao_gravar,
    apagar=lambda conn, id_: _rota("carreira", "delete_education")(conn, id_),
    vinculos=[("goals", "linked_education_id")],
))

_registrar(Entidade(
    "salario", "salary_record", "salary record", "career_salary_records", "reason", "carreira",
    [Campo("valor", "amount", "valor", obrigatorio=True), Campo("data", "date", "data", obrigatorio=True),
     Campo("moeda", "currency", "texto", maximo=3, padrao="BRL"), Campo("vinculo", "employment_type", "texto", maximo=40),
     Campo("motivo", "content", "texto", maximo=200)],
    ler=lambda r: {"valor": r["amount"], "data": r["date"], "moeda": r["currency"], "vinculo": r["employment_type"] or "",
                   "motivo": r["reason"] or ""},
    extra=lambda r: {"position_id": r["position_id"]},
    criar=lambda conn, d: _rota("carreira", "create_salary_record")(conn, _salario_in(d, {}))["id"],
    gravar=lambda conn, id_, d, x: (_rota("carreira", "update_salary_record")(conn, id_, _salario_in(d, x)), id_)[1],
    apagar=lambda conn, id_: _rota("carreira", "delete_salary_record")(conn, id_),
))

_registrar(Entidade(
    "repositorio", "github_repo", "GitHub repository", "github_repos", "repo_full_name", "github",
    [Campo("repo", "title", "texto", obrigatorio=True, maximo=140)],
    ler=lambda r: {"repo": r["repo_full_name"]},
    criar=lambda conn, d: _rota("organizacao.github", "create_github_repo")(conn, _repo_in(d))["id"],
    apagar=lambda conn, id_: _rota("organizacao.github", "delete_github_repo")(conn, id_),
    conferir=_repo_conferir,
))

_registrar(Entidade(
    "transferencia", "transfer", "transfer", "transactions", "description", "financas",
    [Campo("descricao", "title", "texto", maximo=200), Campo("valor", "amount", "valor", obrigatorio=True),
     Campo("data", "date", "data", obrigatorio=True), Campo("conta_id", "account", "conta", obrigatorio=True, rotulo="conta_origem"),
     Campo("destino_id", "to_account", "conta", rotulo="conta_destino"),
     Campo("destino_externo", "to_external", "texto", maximo=120)],
    ler=_transferencia_ler, criar=_transferencia_criar, conferir=_transferencia_conferir,
    apagar=lambda conn, id_: _rota("financas.lancamentos", "delete_transaction")(conn, id_),
    devolver=lambda conn, entrada: _transferencia_criar(conn, entrada["antes"]),
))


TIPOS = tuple(ENTIDADES)
MODELOS = {e.modelo: e.tipo for e in ENTIDADES.values()}


def de(tipo: str) -> Optional[Entidade]:
    return ENTIDADES.get(tipo)


def filtro_tabela(tipo: str) -> str:
    """Condição extra pra achar a coisa na tabela (a tabela é dividida)."""
    return {"conquista": " AND rule_type = 'custom'", "transferencia": " AND type = 'transferencia'",
            "acao": " AND source = 'form' AND referencia_tipo IS NULL"}.get(tipo, "")


# ── contribuir pra meta (não tem rota de desfazer: o inverso é exato) ─────

CONTRIBUIR = [Campo("valor", "amount", "valor", obrigatorio=True),
              Campo("origem", "source", "escolha", opcoes=("conta", "externo"), padrao="conta",
                    mapa={"account": "conta", "external": "externo"}),
              Campo("conta_id", "account", "conta")]


def contribuir(conn, meta_id: str, d: dict) -> dict:
    """Aporta pela rota e devolve o que precisa pra desfazer exatamente."""
    from app.routers import metas
    g = conn.execute("SELECT * FROM goals WHERE id = ?", (meta_id,)).fetchone()
    logs_antes = {r["id"] for r in conn.execute("SELECT id FROM action_logs")}
    contrib_antes = {r["id"] for r in conn.execute("SELECT id FROM goal_contributions WHERE goal_id = ?", (meta_id,))}
    financeira = g["type"] == "financeira"
    metas.contribute_goal(meta_id, metas.ContributeIn(
        amount=d["valor"], origem=d["origem"] if financeira else None,
        conta_id=(d["conta_id"] or None) if financeira and d["origem"] == "conta" else None), db=conn)
    nova = conn.execute("SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY rowid DESC", (meta_id,)).fetchall()
    nova = next((r for r in nova if r["id"] not in contrib_antes), None)
    logs = [r["id"] for r in conn.execute("SELECT id FROM action_logs") if r["id"] not in logs_antes]
    return {"contribuicao": nova["id"] if nova else None, "transacao": nova["transaction_id"] if nova else None,
            "logs": logs, "valor_antes": g["current_value"], "status_antes": g["status"]}


def descontribuir(conn, meta_id: str, estado: dict) -> None:
    from app.achievements import relock_unmet_achievements
    from app.actions import _revert_one
    from app.routers.financas import lancamentos
    if estado.get("transacao"):
        tx = conn.execute("SELECT * FROM transactions WHERE id = ?", (estado["transacao"],)).fetchone()
        if tx:
            lancamentos._undo_transaction(conn, tx)
    if estado.get("contribuicao"):
        conn.execute("DELETE FROM goal_contributions WHERE id = ?", (estado["contribuicao"],))
    conn.execute("UPDATE goals SET current_value = ?, status = ? WHERE id = ?",
                 (estado["valor_antes"], estado["status_antes"], meta_id))
    for log_id in estado.get("logs") or []:
        log = conn.execute("SELECT id, xp_gained FROM action_logs WHERE id = ?", (log_id,)).fetchone()
        if log:
            _revert_one(conn, log)
    relock_unmet_achievements(conn)
    conn.commit()


def contribuicao_ok(conn, meta_id: str, d: dict) -> None:
    g = conn.execute("SELECT * FROM goals WHERE id = ?", (meta_id,)).fetchone()
    if g["type"] in ("aprendizado", "academica"):
        raise ErroKami(422, "erro.metas.meta_tipo_type_progride_sozinha",
                       "meta do tipo '{type}' progride sozinha junto com a {origem_label} — não aceita contribuição manual",
                       type=g["type"], origem_label="trilha" if g["type"] == "aprendizado" else "formação")
    if g["status"] == "concluida":
        raise ErroKami(422, "erro.metas.meta_ja_concluida_nao_aceita", "meta já concluída — não aceita novas contribuições")
    if not d.get("valor"):
        raise ErroKami(422, "erro.metas.valor_contribuicao_precisa_ser_maior", "valor da contribuição precisa ser maior que zero")
    if g["type"] == "financeira" and d.get("origem") == "conta":
        conta_id = d.get("conta_id") or g["linked_conta_id"]
        c = _conta(conn, conta_id)
        if not c:
            raise ErroKami(422, "erro.assistente.escolha_a_conta", "escolha a conta dos lançamentos")
        if not c["possui_saldo"]:
            raise ErroKami(422, "erro.metas.essa_conta_nao_possui_saldo", "essa conta não possui saldo")




def estado_pago(conn, tipo: str, id_: str) -> dict:
    """O que "reabrir" desfaz: o período (ou a entrada de renda) pago deste mês."""
    if tipo == "conta_fixa":
        return {"periodo": _conta_fixa_periodo(conn, id_)["id"]}
    if tipo == "assinatura":
        return {"periodo": _assinatura_periodo(conn, id_)["id"]}
    if tipo == "renda":
        e = conn.execute("SELECT id FROM income_entries WHERE income_source_id = ? AND substr(expected_date, 1, 7) = ? "
                         "AND status = 'pago' ORDER BY expected_date DESC LIMIT 1", (id_, _mes_atual())).fetchone()
        return {"entrada": e["id"]}
    return {}
