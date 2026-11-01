"""Avisos proativos (IA-06) — regras em app/avisos.py, rotas em app/routers/avisos.py."""
import datetime as dt

import pytest

from app import avisos
from app.database import new_id

BASE = "/api/avisos"
HOJE = dt.date(2026, 10, 20)


@pytest.fixture()
def dia(monkeypatch):
    """Data controlada: dia.hoje = date(...)."""
    class D:
        hoje = HOJE
    monkeypatch.setattr(avisos, "hoje", lambda: D.hoje)
    return D


def _gasto(db, categoria, valor, data, tipo="saida"):
    db.execute(
        "INSERT INTO transactions (id, description, amount, type, category, date) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id(), categoria, valor, tipo, categoria, data),
    )


def _conta(db, nome, saldo=None, credito=False):
    banco = new_id()
    db.execute("INSERT INTO wallet_banks (id, nome, created_at) VALUES (?, ?, ?)", (banco, f"banco {nome}", "2026-01-01"))
    conta = new_id()
    db.execute(
        "INSERT INTO wallet_accounts (id, bank_id, nome, possui_saldo, saldo_atual, possui_credito) VALUES (?, ?, ?, ?, ?, ?)",
        (conta, banco, nome, int(saldo is not None), saldo, int(credito)),
    )
    return conta


def _fixa(db, nome, valor, dia_venc, conta_id=None):
    fid = new_id()
    db.execute(
        "INSERT INTO fixed_bills (id, name, amount, due_day, conta_id) VALUES (?, ?, ?, ?, ?)",
        (fid, nome, valor, dia_venc, conta_id),
    )
    return fid


def _regras(db, d=HOJE):
    return {(a["regra"], a["nome"]) for a in avisos.checar(db, d)}


# ---------------- regras ----------------

def test_categoria_acima_so_com_20_pct_e_3_lancamentos(db_conn):
    for v in (100, 100, 100):
        _gasto(db_conn, "mercado", v, "2026-09-10")
    _gasto(db_conn, "mercado", 359, "2026-10-05")  # +19,7%: não
    for v in (10, 10):
        _gasto(db_conn, "uber", v, "2026-09-10")  # só 2 no mês anterior
    _gasto(db_conn, "uber", 500, "2026-10-05")
    _gasto(db_conn, "farmácia", 80, "2026-10-05")  # sem gasto no anterior
    _gasto(db_conn, "mercado", 999, "2026-10-06", tipo="entrada")  # entrada não conta
    assert avisos.categoria_acima(db_conn, HOJE) == []
    _gasto(db_conn, "mercado", 1, "2026-10-07")  # 360 = +20%
    [oc] = avisos.categoria_acima(db_conn, HOJE)
    assert (oc.alvo_id, oc.ciclo, oc.vars["pct"], oc.vars["valor_anterior"]) == ("mercado", "2026-10", 20, 300)


def test_conta_sem_saldo_conta_ligada_e_as_que_vencem_antes(db_conn):
    nu = _conta(db_conn, "nu", saldo=150)
    _fixa(db_conn, "internet", 100, 21, nu)
    _fixa(db_conn, "luz", 80, 23, nu)  # 150 - 100 = 50 < 80
    _fixa(db_conn, "aluguel", 2000, 30, nu)  # fora da janela de 3 dias
    [oc] = avisos.conta_sem_saldo(db_conn, HOJE)
    assert (oc.nome, oc.ciclo, oc.vars["valor_saldo"], oc.vars["data"], oc.vars["dias"]) == ("luz", "2026-10", 50, "2026-10-23", 3)
    # internet paga: ela não come mais o saldo
    db_conn.execute(
        "INSERT INTO fixed_bill_periods (id, fixed_bill_id, mes_ano, paga) "
        "SELECT ?, id, '2026-10', 1 FROM fixed_bills WHERE name = 'internet'", (new_id(),)
    )
    db_conn.execute("UPDATE wallet_accounts SET saldo_atual = 50 WHERE id = ?", (nu,))
    assert [o.nome for o in avisos.conta_sem_saldo(db_conn, HOJE)] == ["luz"]
    db_conn.execute("UPDATE wallet_accounts SET saldo_atual = 80 WHERE id = ?", (nu,))
    assert avisos.conta_sem_saldo(db_conn, HOJE) == []


def test_conta_sem_saldo_sem_conta_usa_a_soma_e_ignora_so_credito(db_conn):
    _conta(db_conn, "a", saldo=30)
    _conta(db_conn, "b", saldo=40)
    cartao = _conta(db_conn, "cartão", credito=True)
    _fixa(db_conn, "academia", 60, 20)  # 70 cobre
    _fixa(db_conn, "streaming", 999, 21, cartao)  # vai na fatura
    assert avisos.conta_sem_saldo(db_conn, HOJE) == []
    _fixa(db_conn, "curso", 20, 22)  # 70 - 60 = 10 < 20
    assert [o.nome for o in avisos.conta_sem_saldo(db_conn, HOJE)] == ["curso"]


def test_conta_sem_saldo_vira_o_mes_e_dia_31(db_conn):
    _conta(db_conn, "nu", saldo=0)
    _fixa(db_conn, "seguro", 50, 31)
    _fixa(db_conn, "condomínio", 50, 2)
    [a] = avisos.conta_sem_saldo(db_conn, dt.date(2026, 11, 28))  # dia 31 em novembro = 30
    assert (a.nome, a.vars["data"]) == ("seguro", "2026-11-30")
    nomes = {(o.nome, o.ciclo) for o in avisos.conta_sem_saldo(db_conn, dt.date(2026, 12, 30))}
    assert nomes == {("seguro", "2026-12"), ("condomínio", "2027-01")}


def test_meta_parada_conta_da_criacao_e_do_ultimo_aporte(db_conn):
    def meta(titulo, tipo="livre", criada="2026-09-01T10:00:00-03:00", atual=0):
        gid = new_id()
        db_conn.execute(
            "INSERT INTO goals (id, title, type, current_value, target_value, created_at) VALUES (?, ?, ?, ?, 10, ?)",
            (gid, titulo, tipo, atual, criada),
        )
        return gid

    viagem = meta("viagem")
    meta("nova", criada="2026-10-10T10:00:00-03:00")
    meta("rust", tipo="aprendizado")  # vem da trilha
    meta("feita", atual=10)
    meta("antiga", criada=None)  # de antes da 1.17
    assert {o.nome for o in avisos.meta_parada(db_conn, HOJE)} == {"viagem"}
    assert db_conn.execute("SELECT created_at FROM goals WHERE title = 'antiga'").fetchone()[0] is not None
    db_conn.execute(
        "INSERT INTO goal_contributions (id, goal_id, amount, date) VALUES (?, ?, 1, '2026-10-01')", (new_id(), viagem)
    )
    assert avisos.meta_parada(db_conn, HOJE) == []
    [oc] = avisos.meta_parada(db_conn, dt.date(2026, 10, 22))
    assert (oc.ciclo, oc.vars["dias"]) == ("2026-10-01", 21)


def _xp(db, atributo, quando, xp=10):
    log = new_id()
    db.execute(
        "INSERT INTO action_logs (id, description, xp_gained, created_at) VALUES (?, 'x', ?, ?)", (log, xp, quando)
    )
    attr = db.execute("SELECT id FROM attributes WHERE name = ?", (atributo,)).fetchone()[0]
    db.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log, attr))


def test_atributo_esquecido(db_conn):
    db_conn.execute("DELETE FROM action_logs")
    _xp(db_conn, "financas", "2026-10-10T10:00:00-03:00")
    assert avisos.atributo_esquecido(db_conn, dt.date(2026, 10, 23)) == []  # 13 dias de uso
    [oc] = avisos.atributo_esquecido(db_conn, dt.date(2026, 10, 24))
    assert (oc.nome, oc.vars["dias"]) == ("financas", 14)  # carreira nunca teve xp: fica de fora
    _xp(db_conn, "financas", "2026-10-20T10:00:00-03:00", xp=0)  # sem xp não conta
    assert len(avisos.atributo_esquecido(db_conn, dt.date(2026, 10, 24))) == 1
    db_conn.execute("UPDATE attributes SET is_active = 0 WHERE name = 'financas'")
    assert avisos.atributo_esquecido(db_conn, dt.date(2026, 10, 24)) == []


def test_trilha_parada(db_conn):
    def trilha(nome, status="ativa", criada="2026-09-01T10:00:00-03:00"):
        tid = new_id()
        db_conn.execute("INSERT INTO tracks (id, name, status, created_at) VALUES (?, ?, ?, ?)", (tid, nome, status, criada))
        return tid

    def marco(tid, status="pendente", feito=None):
        db_conn.execute(
            "INSERT INTO milestones (id, track_id, title, status, completed_at) VALUES (?, ?, 'm', ?, ?)",
            (new_id(), tid, status, feito),
        )

    rust = trilha("rust")
    marco(rust)
    marco(rust, "concluido", "2026-10-01T10:00:00-03:00")
    marco(trilha("pausada", status="pausada"))
    marco(trilha("terminada"), "concluido", "2026-09-02T10:00:00-03:00")
    trilha("vazia")
    nova = trilha("nova", criada="2026-10-15T10:00:00-03:00")
    marco(nova)
    [oc] = avisos.trilha_parada(db_conn, HOJE)
    assert (oc.nome, oc.ciclo, oc.vars["dias"], oc.vars["concluiu"]) == ("rust", "2026-10-01", 19, True)


# ---------------- estado ----------------

def test_dispensar_vale_ate_o_ciclo_mudar(db_conn):
    _conta(db_conn, "nu", saldo=0)
    fid = _fixa(db_conn, "luz", 80, 21)
    [a] = avisos.checar(db_conn, HOJE)
    db_conn.execute("UPDATE avisos SET dispensado_em = 'x' WHERE id = ?", (a["id"],))
    assert avisos.checar(db_conn, HOJE) == []
    assert avisos.checar(db_conn, dt.date(2026, 11, 19))[0]["alvo_id"] == fid  # novembro: volta
    # um por regra+item
    assert db_conn.execute("SELECT COUNT(*) FROM avisos").fetchone()[0] == 1


def test_o_que_deixou_de_valer_sai(db_conn):
    nu = _conta(db_conn, "nu", saldo=0)
    _fixa(db_conn, "luz", 80, 21)
    assert len(avisos.checar(db_conn, HOJE)) == 1
    db_conn.execute("UPDATE wallet_accounts SET saldo_atual = 100 WHERE id = ?", (nu,))
    assert avisos.checar(db_conn, HOJE) == []
    assert db_conn.execute("SELECT COUNT(*) FROM avisos").fetchone()[0] == 0


# ---------------- rotas ----------------

def test_rotas_dispensar_silenciar_e_config(client, db_conn, dia):
    _conta(db_conn, "nu", saldo=0)
    _fixa(db_conn, "luz", 80, 21)
    _fixa(db_conn, "água", 40, 22)
    db_conn.commit()
    lista = client.get(BASE).json()
    assert [a["nome"] for a in lista] == ["luz", "água"]
    luz, agua = lista
    assert luz["vars"] == {"conta": "luz", "valor": 80, "valor_saldo": 0, "data": "2026-10-21", "dias": 1, "conta_carteira": None}

    assert client.post(f"{BASE}/{luz['id']}/notificado").status_code == 204
    assert client.get(BASE).json()[0]["notificado"] is True
    assert client.post(f"{BASE}/{luz['id']}/dispensar").status_code == 204
    assert [a["nome"] for a in client.get(BASE).json()] == ["água"]

    assert client.post(f"{BASE}/{agua['id']}/silenciar").status_code == 204
    assert client.get(BASE).json() == []
    cfg = client.get(f"{BASE}/config").json()
    assert cfg["ligados"] is True and all(cfg["regras"].values())
    assert [(s["regra"], s["nome"]) for s in cfg["silenciados"]] == [("conta_sem_saldo", "água")]

    cfg = client.delete(f"{BASE}/silenciados/conta_sem_saldo/{agua['alvo_id']}").json()
    assert cfg["silenciados"] == []
    assert [a["nome"] for a in client.get(BASE).json()] == ["água"]

    assert client.put(f"{BASE}/regras/conta_sem_saldo", json={"ligada": False}).json()["regras"]["conta_sem_saldo"] is False
    assert client.get(BASE).json() == []
    client.put(f"{BASE}/regras/conta_sem_saldo", json={"ligada": True})
    assert client.put(f"{BASE}/regras/*", json={"ligada": False}).json()["ligados"] is False
    assert client.get(BASE).json() == []
    client.put(f"{BASE}/regras/*", json={"ligada": True})
    assert len(client.get(BASE).json()) == 1  # luz continua dispensada

    assert client.put(f"{BASE}/regras/nada", json={"ligada": False}).status_code == 422
    assert client.post(f"{BASE}/nada/dispensar").status_code == 404


def test_meta_criada_pela_rota_tem_data(client, db_conn):
    r = client.post("/api/metas", json={"title": "x", "type": "livre", "target_value": 5})
    assert r.status_code in (200, 201), r.text
    assert db_conn.execute("SELECT created_at FROM goals WHERE id = ?", (r.json()["id"],)).fetchone()[0]
