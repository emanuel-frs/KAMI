"""
GAM-06: proteção de sequência. A cada 7 dias com ação, 1 proteção (máx.
2); dia em branco que já passou consome uma e a sequência continua; hoje
nunca consome; nada vale antes de user_profile.sequencia_protecao_desde.

As datas são simuladas: `streak_info(conn, today=...)` recebe um "hoje"
fixo e os logs são gravados com o dia local escolhido — o mesmo prefixo
YYYY-MM-DD que now_iso() grava, então os testes valem em qualquer fuso
(rodar também com TZ=Asia/Tokyo e TZ=Pacific/Kiritimati).
"""
import datetime

from app.achievements import streak_info
from app.database import new_id

HOJE = datetime.date(2026, 6, 30)


# ==================== helpers ====================

def _dia(n):
    """Dia n relativo a HOJE (0 = hoje, -1 = ontem...)."""
    return HOJE + datetime.timedelta(days=n)


def _insert_log(conn, day, hour=12):
    created_at = datetime.datetime(day.year, day.month, day.day, hour).astimezone().isoformat()
    log_id = new_id()
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at) VALUES (?, 'x', 1, 'form', ?)",
        (log_id, created_at),
    )
    attr_id = conn.execute("SELECT id FROM attributes WHERE name = 'metas'").fetchone()["id"]
    conn.execute("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", (log_id, attr_id))
    conn.commit()


def _acoes(conn, dias):
    for n in dias:
        _insert_log(conn, _dia(n))


def _desde(conn, day):
    conn.execute("UPDATE user_profile SET sequencia_protecao_desde = ?", (day.isoformat(),))
    conn.commit()


def _protegidos(conn):
    return [r["dia"] for r in conn.execute("SELECT dia FROM dias_protegidos ORDER BY dia").fetchall()]


# ==================== ganhar ====================

def test_ganha_uma_protecao_a_cada_7_dias_com_acao(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, range(-6, 1))  # 7 dias seguidos terminando hoje
    info = streak_info(db_conn, today=HOJE)
    assert info["protections"] == 1
    assert info["next_protection_in"] == 7


def test_nunca_guarda_mais_de_2(db_conn):
    _desde(db_conn, _dia(-60))
    _acoes(db_conn, range(-27, 1))  # 28 dias = 4 ganhos
    info = streak_info(db_conn, today=HOJE)
    assert info["protections"] == 2
    assert info["current"] == 28


def test_seis_dias_ainda_nao_rendem_protecao(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, range(-5, 1))
    info = streak_info(db_conn, today=HOJE)
    assert info["protections"] == 0
    assert info["next_protection_in"] == 1


# ==================== consumir ====================

def test_dia_em_branco_consome_protecao_e_sequencia_continua(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, [*range(-9, -2), -1, 0])  # 7 dias, buraco em -2, ontem e hoje
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == [_dia(-2).isoformat()]
    assert info["protections"] == 0
    assert info["current"] == 10  # 7 + protegido + ontem + hoje
    assert info["best"] == 10


def test_ontem_protegido_aparece_no_player(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, range(-8, -1))  # 7 dias até anteontem; ontem em branco; hoje ainda sem ação
    info = streak_info(db_conn, today=HOJE)
    assert info["protected_yesterday"] is True
    assert info["active_today"] is False
    assert info["current"] == 8  # sequência viva até ontem (protegido)


def test_hoje_nunca_consome_protecao(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, range(-7, 0))  # 7 dias até ontem, hoje sem ação
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == []
    assert info["protections"] == 1
    assert info["current"] == 7


def test_buraco_maior_que_as_protecoes_gasta_dia_a_dia_e_quebra(db_conn):
    _desde(db_conn, _dia(-60))
    _acoes(db_conn, [*range(-20, -6), 0])  # 14 dias = 2 proteções; buraco de -6 a -1 (6 dias)
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == [_dia(-6).isoformat(), _dia(-5).isoformat()]
    assert info["protections"] == 0
    assert info["current"] == 1  # só hoje: quebrou em -4
    assert info["best"] == 16  # 14 dias + 2 protegidos


def test_dia_protegido_nao_conta_pra_ganhar_a_proxima(db_conn):
    _desde(db_conn, _dia(-60))
    # 7 dias (ganha 1), buraco protegido, mais 6 dias com ação: 13 com ação
    _acoes(db_conn, [*range(-13, -6), *range(-5, 1)])
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == [_dia(-6).isoformat()]
    assert info["protections"] == 0  # o 14º dia com ação ainda não chegou
    assert info["next_protection_in"] == 1


def test_consumo_e_idempotente_e_fica_gravado(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, [*range(-9, -2), -1])
    first = streak_info(db_conn, today=HOJE)
    db_conn.commit()
    second = streak_info(db_conn, today=HOJE)
    assert first == second
    assert _protegidos(db_conn) == [_dia(-2).isoformat()]


def test_dia_protegido_continua_valendo_depois_de_estorno(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, [*range(-9, -2), -1, 0])
    streak_info(db_conn, today=HOJE)
    db_conn.commit()
    # estorno apaga um dos 7 dias que renderam a proteção
    log = db_conn.execute(
        "SELECT id FROM action_logs WHERE substr(created_at, 1, 10) = ?", (_dia(-9).isoformat(),)
    ).fetchone()
    db_conn.execute("DELETE FROM action_logs WHERE id = ?", (log["id"],))
    db_conn.commit()
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == [_dia(-2).isoformat()]
    assert info["current"] == 9
    assert info["protections"] == 0


# ==================== nada retroativo ====================

def test_buraco_antes_da_atualizacao_continua_quebrando(db_conn):
    _desde(db_conn, _dia(-1))
    _acoes(db_conn, [*range(-20, -5), -4, -3])  # 15 dias, buraco em -5 (antes do "desde")
    info = streak_info(db_conn, today=HOJE)
    assert _protegidos(db_conn) == []
    assert info["best"] == 15
    assert info["protections"] == 0


def test_sequencia_em_andamento_ganha_a_primeira_no_dia_multiplo_de_7(db_conn):
    _desde(db_conn, HOJE)
    _acoes(db_conn, range(-20, 1))  # 21º dia é hoje, já depois do "desde"
    assert streak_info(db_conn, today=HOJE)["protections"] == 1


def test_sem_data_grava_hoje_no_primeiro_calculo(db_conn):
    _acoes(db_conn, [*range(-20, -2), 0])
    info = streak_info(db_conn, today=HOJE)
    desde = db_conn.execute("SELECT sequencia_protecao_desde AS d FROM user_profile").fetchone()["d"]
    assert desde == HOJE.isoformat()
    assert _protegidos(db_conn) == []  # buracos do passado não são tapados
    assert info["current"] == 1


# ==================== API e conquistas ====================

def test_player_expoe_protecoes(client):
    client.post("/api/nucleo/actions", json={"description": "x", "categories": ["metas"], "xp": 5})
    player = client.get("/api/nucleo/player").json()
    assert player["streak_protections"] == 0
    assert player["streak_protections_max"] == 2
    assert player["streak_protected_yesterday"] is False
    assert player["streak_next_protection_in"] == 6


def test_conquista_de_sequencia_aceita_dia_protegido(db_conn):
    from app.achievements import achievement_progress
    today = datetime.date.today()
    db_conn.execute("UPDATE user_profile SET sequencia_protecao_desde = ?",
                    ((today - datetime.timedelta(days=60)).isoformat(),))
    for n in [*range(-13, -6), *range(-5, 1)]:  # 7 + protegido + 6 = 14 dias
        _insert_log(db_conn, today + datetime.timedelta(days=n))
    current, target = achievement_progress(db_conn, {"type": "streak_days", "days": 14})
    assert (current, target) == (14, 14)


def test_backup_leva_os_dias_protegidos(client, db_conn):
    db_conn.execute("INSERT INTO dias_protegidos (dia, created_at) VALUES ('2026-01-02', '2026-01-03T09:00:00-03:00')")
    db_conn.commit()
    backup = client.get("/api/sistema/export").json()["tables"]
    assert backup["dias_protegidos"] == [{"dia": "2026-01-02", "created_at": "2026-01-03T09:00:00-03:00", "avisado_em": None}]
    db_conn.execute("DELETE FROM dias_protegidos")
    db_conn.commit()
    resp = client.post("/api/sistema/import", json={"confirmation": "importar", "tables": backup})
    assert resp.status_code == 200, resp.text
    assert _protegidos(db_conn) == ["2026-01-02"]


def test_reset_apaga_os_dias_protegidos(client, db_conn):
    db_conn.execute("INSERT INTO dias_protegidos (dia, created_at) VALUES ('2026-01-02', '2026-01-03T09:00:00-03:00')")
    db_conn.commit()
    assert client.post("/api/sistema/reset", json={"confirmation": "excluir"}).status_code == 200
    assert _protegidos(db_conn) == []


# ==================== aviso "sequência salva" ====================

def test_dia_protegido_da_sequencia_atual_fica_pendente_de_aviso(db_conn):
    _desde(db_conn, _dia(-30))
    _acoes(db_conn, [*range(-9, -2), -1, 0])
    assert streak_info(db_conn, today=HOJE)["saved_unseen"] == [_dia(-2).isoformat()]


def test_dia_protegido_de_sequencia_que_quebrou_nao_avisa(db_conn):
    _desde(db_conn, _dia(-60))
    _acoes(db_conn, [*range(-20, -6), 0])  # 2 proteções gastas em -6/-5, quebrou em -4
    info = streak_info(db_conn, today=HOJE)
    assert len(_protegidos(db_conn)) == 2
    assert info["saved_unseen"] == []


def test_marcar_como_visto_tira_o_aviso(client, db_conn):
    db_conn.execute("UPDATE user_profile SET sequencia_protecao_desde = '2000-01-01'")
    today = datetime.date.today()
    for n in [*range(-8, -1)]:  # 7 dias até anteontem; ontem em branco
        _insert_log(db_conn, today + datetime.timedelta(days=n))
    yesterday = (today - datetime.timedelta(days=1)).isoformat()

    player = client.get("/api/nucleo/player").json()
    assert player["streak_saved_days"] == [yesterday]
    assert player["streak_protected_yesterday"] is True

    resp = client.post("/api/nucleo/streak-saved/seen", json={"days": [yesterday, "1999-01-01"]})
    assert resp.status_code == 204
    assert client.get("/api/nucleo/player").json()["streak_saved_days"] == []
    avisado = db_conn.execute("SELECT avisado_em FROM dias_protegidos").fetchone()["avisado_em"]
    assert avisado is not None


def test_migracao_adiciona_avisado_em_em_tabela_antiga(initialized_db):
    from app import database
    conn = database.get_connection()
    conn.execute("DROP TABLE dias_protegidos")
    conn.execute("CREATE TABLE dias_protegidos (dia TEXT PRIMARY KEY, created_at TEXT NOT NULL)")
    conn.execute("INSERT INTO dias_protegidos VALUES ('2026-01-02', '2026-01-03T09:00:00-03:00')")
    conn.commit()
    conn.close()

    database.init_db()
    conn = database.get_connection()
    row = conn.execute("SELECT * FROM dias_protegidos").fetchone()
    conn.close()
    assert row["dia"] == "2026-01-02"
    assert row["avisado_em"] is None
