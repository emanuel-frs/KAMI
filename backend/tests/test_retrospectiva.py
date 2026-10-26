"""
GAM-12: retrospectiva mensal — gerada uma vez no 1º acesso do mês novo, só
pro mês anterior e só se ele teve ação; foto guardada (não muda depois).
"""
import datetime
import json

from app.database import new_id
from app.retrospectiva import garantir_retrospectiva, mes_anterior, resumo_mes

OUT = datetime.date(2026, 10, 3)  # "hoje" nos testes → resume setembro


def _log(conn, day, attribute="aprendizado", xp=10, description="x", referencia_tipo=None, source="aprendizado"):
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)",
        (log_id, description, xp, source,
         datetime.datetime(day.year, day.month, day.day, 12).astimezone().isoformat(), referencia_tipo),
    )
    attr = conn.execute("SELECT id FROM attributes WHERE name = ?", (attribute,)).fetchone()["id"]
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr))
    conn.commit()


def _set(day):
    return datetime.date(2026, 9, day)


def test_mes_anterior():
    assert mes_anterior("2026-10") == "2026-09"
    assert mes_anterior("2026-01") == "2025-12"


def test_resumo_do_mes(db_conn):
    for d in (1, 2, 3, 10):
        _log(db_conn, _set(d))
    _log(db_conn, _set(10), attribute="financas", xp=150, description="nova posição", source="carreira")
    _log(db_conn, _set(11), xp=5, description="bônus · primeira ação do dia", referencia_tipo="bonus", source="bonus")
    _log(db_conn, datetime.date(2026, 8, 5), xp=7)  # agosto, mês anterior
    db_conn.execute("INSERT INTO dias_protegidos (dia, created_at) VALUES ('2026-09-04', 'x')")
    db_conn.execute("UPDATE achievements SET unlocked_at = '2026-09-02T10:00:00-03:00' WHERE chave = 'streak_3'")
    db_conn.commit()

    r = resumo_mes(db_conn, "2026-09")
    assert r["xp_total"] == 40 + 150 + 5  # bônus conta no xp
    assert r["acoes"] == 5  # bônus não conta como ação
    assert r["dias_ativos"] == 4
    assert r["dias_no_mes"] == 30
    assert r["melhor_sequencia"] == 4  # 1, 2, 3 + 4 protegido
    assert r["xp_por_atributo"]["financas"] == 150
    assert r["xp_por_atributo"]["aprendizado"] == 45
    assert r["acao_do_mes"] == {"descricao": "nova posição", "xp": 150, "dia": "2026-09-10", "chave": None, "vars": {}}
    assert r["conquistas"] == [{"titulo": "aquecendo", "chave": "streak_3"}]
    assert r["anterior"] == {"mes": "2026-08", "xp_total": 7, "acoes": 1, "dias_ativos": 1, "missoes": 0}


def test_gera_so_o_mes_anterior_uma_vez_e_guarda_a_foto(db_conn):
    _log(db_conn, _set(5))
    garantir_retrospectiva(db_conn, hoje=OUT)
    _log(db_conn, _set(6))  # chega depois: a foto não muda
    garantir_retrospectiva(db_conn, hoje=OUT)
    rows = db_conn.execute("SELECT mes, dados_json FROM retrospectivas").fetchall()
    assert [r["mes"] for r in rows] == ["2026-09"]
    assert json.loads(rows[0]["dados_json"])["acoes"] == 1


def test_mes_sem_acao_nao_vira_retrospectiva(db_conn):
    _log(db_conn, datetime.date(2026, 7, 1))  # julho tem, setembro não
    garantir_retrospectiva(db_conn, hoje=OUT)
    assert db_conn.execute("SELECT COUNT(*) AS c FROM retrospectivas").fetchone()["c"] == 0


def test_api_lista_abre_e_marca_vista(client, db_conn):
    today = datetime.date.today()
    first = today.replace(day=1)
    last_month_day = first - datetime.timedelta(days=3)
    _log(db_conn, last_month_day)
    mes = last_month_day.strftime("%Y-%m")

    assert client.get("/api/nucleo/retrospectivas").json() == [{"mes": mes, "vista": False}]
    r = client.get(f"/api/nucleo/retrospectivas/{mes}").json()
    assert r["mes"] == mes and r["acoes"] == 1 and r["vista"] is False
    assert client.post(f"/api/nucleo/retrospectivas/{mes}/vista").status_code == 204
    assert client.get("/api/nucleo/retrospectivas").json() == [{"mes": mes, "vista": True}]
    assert client.get("/api/nucleo/retrospectivas/1999-01").status_code == 404


def test_backup_leva_as_retrospectivas(client, db_conn):
    db_conn.execute("INSERT INTO retrospectivas (mes, dados_json, created_at) VALUES ('2026-01', '{}', 'x')")
    db_conn.commit()
    backup = client.get("/api/sistema/export").json()["tables"]
    assert [r["mes"] for r in backup["retrospectivas"]] == ["2026-01"]
