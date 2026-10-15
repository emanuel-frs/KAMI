"""
GAM-07: missões diárias e semanais. Geração preguiçosa e idempotente por
dia/semana local, só missões possíveis, conclusão automática com bônus,
desfazer volta a missão pra pendente, bônus fora das contagens de
conquista, ação manual do Núcleo não conclui missão.

As missões são desligadas por padrão na suíte (conftest.py) — aqui a
fixture `missoes_ligadas` religa. Pra testar uma missão específica sem
depender do sorteio, os testes gravam a missão do dia direto na tabela.
"""
import datetime

import pytest

from app import database
from app.achievements import achievement_progress
from app.database import new_id, now_iso
from app.missoes import (
    _candidatos_diarios,
    _candidatos_semanais,
    _sortear_diarias,
    avaliar_missoes,
    garantir_missoes,
    semana_inicio,
)

pytestmark = pytest.mark.usefixtures("missoes_ligadas")

QUARTA = datetime.date(2026, 6, 17)  # semana de 15/06 (segunda) a 21/06


# ==================== helpers ====================

def _missao(conn, tipo, *, periodo="dia", referencia=None, alvo_id=None, atributo="financas",
            quantidade=1, xp_bonus=10, posicao=0):
    """Grava a missão do dia (ou da semana) na mão, sem sorteio."""
    referencia = referencia or datetime.date.today().isoformat()
    # ocupa o dia/semana pra garantir_missoes não sortear outras por cima
    conn.execute("DELETE FROM missoes WHERE periodo = ? AND referencia = ?", (periodo, referencia))
    mid = new_id()
    conn.execute(
        "INSERT INTO missoes (id, periodo, referencia, posicao, tipo, alvo_id, titulo, atributo, "
        "quantidade, xp_bonus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (mid, periodo, referencia, posicao, tipo, alvo_id, f"missão {tipo}", atributo, quantidade, xp_bonus, now_iso()),
    )
    if periodo == "dia":
        # semana ocupada por uma missão inofensiva (marcos sem marco nenhum)
        semana = semana_inicio(datetime.date.fromisoformat(referencia)).isoformat()
        if not conn.execute("SELECT 1 FROM missoes WHERE periodo = 'semana' AND referencia = ?", (semana,)).fetchone():
            conn.execute(
                "INSERT INTO missoes (id, periodo, referencia, posicao, tipo, titulo, atributo, quantidade, "
                "xp_bonus, created_at) VALUES (?, 'semana', ?, 0, 'marcos', 'x', 'aprendizado', 99, 40, ?)",
                (new_id(), semana, now_iso()),
            )
    conn.commit()
    return mid


def _status(conn, mid):
    return conn.execute("SELECT concluida_em FROM missoes WHERE id = ?", (mid,)).fetchone()["concluida_em"]


def _xp(client, name):
    return {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}[name]["current_xp"]


def _account(client):
    bank = client.post("/api/carteira/banks", json={"nome": "banco"}).json()
    return client.post(
        f"/api/carteira/banks/{bank['id']}/accounts",
        json={"nome": "conta", "possui_saldo": True, "possui_credito": False, "saldo_atual": 1000},
    ).json()


def _tx(client, conta):
    resp = client.post("/api/financas/transactions", json={
        "description": "mercado", "amount": 10, "type": "saida", "category": "alimentacao",
        "date": datetime.date.today().isoformat(), "conta_id": conta["id"],
    })
    assert resp.status_code == 200, resp.text


def _log(conn, day, *, source="financas", referencia_tipo=None, attribute="financas"):
    log_id = new_id()
    created_at = datetime.datetime(day.year, day.month, day.day, 12).astimezone().isoformat()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at, referencia_tipo) "
        "VALUES (?, 'x', 1, ?, ?, ?)",
        (log_id, source, created_at, referencia_tipo),
    )
    attr_id = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()["id"]
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr_id))
    conn.commit()


# ==================== geração ====================

def test_missoes_geradas_uma_vez_por_dia(client):
    first = client.get("/api/nucleo/missoes").json()
    second = client.get("/api/nucleo/missoes").json()
    assert first == second
    assert first["hoje"] == datetime.date.today().isoformat()
    assert 1 <= len(first["diarias"]) <= 3
    assert first["semanal"] is not None
    assert first["semanal"]["quantidade"] > 1


def test_banco_vazio_so_tem_missoes_possiveis(client):
    tipos = {m["tipo"] for m in client.get("/api/nucleo/missoes").json()["diarias"]}
    assert tipos == {"lancamento", "link"}  # sem conta, renda, meta ou trilha cadastrada


def test_primeira_acao_do_dia_gera_as_missoes_antes_de_gravar(db_conn):
    from app.actions import register_action
    register_action(db_conn, "x", ["metas"], 5, source="metas")
    assert db_conn.execute("SELECT COUNT(*) AS c FROM missoes WHERE periodo = 'dia'").fetchone()["c"] >= 1


def test_sorteio_um_alvo_por_tipo_no_maximo_3_e_deterministico():
    cands = [("meta", f"g{i}", "t", "metas") for i in range(5)] + [
        ("link", None, "t", "organizacao"), ("lancamento", None, "t", "financas"), ("marco", "t1", "t", "aprendizado"),
    ]
    a = _sortear_diarias(cands, "kami-missoes-2026-06-17")
    assert a == _sortear_diarias(cands, "kami-missoes-2026-06-17")
    assert len(a) == 3
    assert len({c[0] for c in a}) == 3


def test_candidatos_respeitam_o_estado_real(client, db_conn):
    hoje = datetime.date.today()
    conta = _account(client)
    # conta fixa sem conta vinculada não gera ação → não vira missão
    client.post("/api/financas/fixed-bills", json={"name": "sem conta", "amount": 10, "due_day": 1})
    client.post("/api/financas/fixed-bills", json={"name": "luz", "amount": 10, "due_day": 1, "conta_id": conta["id"]})
    client.post("/api/metas", json={"title": "viagem", "type": "livre", "target_value": 10})
    cands = _candidatos_diarios(db_conn, hoje)
    titulos = {c[2] for c in cands}
    assert 'pague a conta fixa "luz"' in titulos
    assert 'pague a conta fixa "sem conta"' not in titulos
    assert 'contribua com a meta "viagem"' in titulos


def test_semanal_de_marcos_so_com_2_marcos_abertos(db_conn):
    assert "marcos" not in _candidatos_semanais(db_conn)
    db_conn.execute("INSERT INTO tracks (id, name, created_at) VALUES ('t', 'trilha', ?)", (now_iso(),))
    for i in range(2):
        db_conn.execute("INSERT INTO milestones (id, track_id, title) VALUES (?, 't', 'm')", (f"m{i}",))
    db_conn.commit()
    assert "marcos" in _candidatos_semanais(db_conn)


# ==================== conclusão e estorno ====================

def test_lancamento_conclui_missao_com_bonus(client, db_conn):
    conta = _account(client)
    mid = _missao(db_conn, "lancamento")
    _tx(client, conta)
    assert _status(db_conn, mid) is not None
    assert _xp(client, "financas") == 3 + 10  # transação + bônus
    log = client.get("/api/nucleo/log").json()[0]
    assert log["description"] == "missão concluída: missão lancamento"
    missoes = client.get("/api/nucleo/missoes").json()
    assert missoes["diarias"][0]["concluida"] is True
    assert missoes["diarias"][0]["progresso"] == 1


def test_bonus_so_uma_vez(client, db_conn):
    conta = _account(client)
    _missao(db_conn, "lancamento")
    _tx(client, conta)
    _tx(client, conta)
    assert _xp(client, "financas") == 3 + 3 + 10


def test_acao_manual_do_nucleo_nao_conclui_missao(client, db_conn):
    mid = _missao(db_conn, "link", atributo="organizacao")
    client.post("/api/nucleo/actions", json={"description": "salvei um link", "categories": ["organizacao"], "xp": 5})
    assert _status(db_conn, mid) is None


def test_desfazer_volta_missao_pra_pendente_e_estorna_bonus(client, db_conn):
    mid = _missao(db_conn, "link", atributo="organizacao")
    link = client.post("/api/organizacao/links", json={"title": "a", "url": "https://a.com", "category": "c"}).json()
    assert _status(db_conn, mid) is not None
    assert _xp(client, "organizacao") == 2 + 10

    client.delete(f"/api/organizacao/links/{link['id']}")
    assert _status(db_conn, mid) is None
    assert _xp(client, "organizacao") == 0
    assert db_conn.execute("SELECT COUNT(*) AS c FROM action_logs WHERE referencia_tipo = 'missao'").fetchone()["c"] == 0


def test_bonus_nao_conta_nas_conquistas_de_contagem(client, db_conn):
    conta = _account(client)
    _missao(db_conn, "lancamento")
    _tx(client, conta)
    assert achievement_progress(db_conn, {"type": "count_total", "count": 50})[0] == 1
    assert achievement_progress(db_conn, {"type": "count_by_attribute", "attribute": "financas", "count": 10})[0] == 1


# ==================== semanais ====================

def test_semanal_dias_ativos_conta_dias_distintos_sem_acao_manual(db_conn):
    monday = semana_inicio(QUARTA)
    mid = _missao(db_conn, "dias_ativos", periodo="semana", referencia=monday.isoformat(),
                  atributo="metas", quantidade=3, xp_bonus=40)
    _log(db_conn, monday)
    _log(db_conn, monday)  # mesmo dia não conta duas vezes
    _log(db_conn, monday + datetime.timedelta(days=1), source="form", attribute="metas")  # manual não conta
    _log(db_conn, monday - datetime.timedelta(days=1))  # domingo da semana anterior
    assert avaliar_missoes(db_conn, hoje=QUARTA) == []
    assert _status(db_conn, mid) is None

    _log(db_conn, monday + datetime.timedelta(days=1))
    _log(db_conn, QUARTA)
    assert avaliar_missoes(db_conn, hoje=QUARTA) == ["missão dias_ativos"]
    assert _status(db_conn, mid) is not None
    bonus = db_conn.execute("SELECT xp_gained FROM action_logs WHERE referencia_tipo = 'missao'").fetchone()
    assert bonus["xp_gained"] == 40


def test_semanal_atributos_distintos(db_conn):
    monday = semana_inicio(QUARTA)
    mid = _missao(db_conn, "atributos", periodo="semana", referencia=monday.isoformat(),
                  atributo="metas", quantidade=2, xp_bonus=40)
    _log(db_conn, monday, attribute="financas")
    _log(db_conn, QUARTA, attribute="financas")
    avaliar_missoes(db_conn, hoje=QUARTA)
    assert _status(db_conn, mid) is None
    _log(db_conn, QUARTA, source="aprendizado", attribute="aprendizado")
    avaliar_missoes(db_conn, hoje=QUARTA)
    assert _status(db_conn, mid) is not None


def test_missao_de_outro_dia_nao_e_reavaliada(db_conn):
    ontem = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    mid = _missao(db_conn, "lancamento", referencia=ontem)
    _log(db_conn, datetime.date.today())  # lançamento hoje não cumpre a missão de ontem
    avaliar_missoes(db_conn)
    assert _status(db_conn, mid) is None


# ==================== widget no layout ====================

def test_widget_entra_no_topo_do_nucleo_de_quem_ja_usava_uma_vez(initialized_db):
    conn = database.get_connection()
    # simula banco de antes do GAM-07: layout sem o widget (posições 0..n) e sem a tabela
    conn.execute("DELETE FROM dashboard_widgets WHERE widget_type = 'missoes'")
    conn.execute("UPDATE dashboard_widgets SET position = position - 1 WHERE screen = 'nucleo'")
    conn.execute("DROP TABLE missoes")
    conn.commit()
    conn.close()

    database.init_db()
    conn = database.get_connection()
    rows = conn.execute(
        "SELECT widget_type, position FROM dashboard_widgets WHERE screen = 'nucleo' ORDER BY position"
    ).fetchall()
    assert rows[0]["widget_type"] == "missoes"
    assert [r["position"] for r in rows] == list(range(len(rows)))

    # removido pelo usuário, não volta na próxima inicialização
    conn.execute("DELETE FROM dashboard_widgets WHERE widget_type = 'missoes'")
    conn.commit()
    conn.close()
    database.init_db()
    conn = database.get_connection()
    assert conn.execute("SELECT 1 FROM dashboard_widgets WHERE widget_type = 'missoes'").fetchone() is None
    conn.close()


def test_geracao_respeita_o_dia_local_passado(db_conn):
    garantir_missoes(db_conn, hoje=QUARTA)
    garantir_missoes(db_conn, hoje=QUARTA)
    rows = db_conn.execute("SELECT periodo, referencia FROM missoes").fetchall()
    dias = [r for r in rows if r["periodo"] == "dia"]
    assert {r["referencia"] for r in dias} == {QUARTA.isoformat()}
    assert len(dias) <= 3
    assert [r["referencia"] for r in rows if r["periodo"] == "semana"] == ["2026-06-15"]
