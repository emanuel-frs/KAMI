"""
I18N: registros gravados antes da tradução (só o português) ganham chave +
variáveis na migração _migrate_textos_antigos — o que não casa com um
formato conhecido, e o que a pessoa escreveu no Núcleo, fica como está.
"""
import json
from pathlib import Path

from app import database
from app.migracoes import TEXTOS_ANTIGOS_LANCAMENTO, TEXTOS_ANTIGOS_LOG, _migrate_textos_antigos

PT = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "i18n" / "pt.json").read_text(encoding="utf-8"))


def test_formatos_antigos_iguais_ao_pt_json():
    for chave, texto in TEXTOS_ANTIGOS_LOG + TEXTOS_ANTIGOS_LANCAMENTO:
        assert PT.get(chave) == texto, chave


def _log(conn, descricao, source="financas", ref=(None, None)):
    conn.execute(
        "INSERT INTO action_logs (id, description, xp_gained, source, created_at, referencia_tipo, referencia_id) "
        "VALUES (?, ?, 1, ?, '2026-10-01T10:00:00', ?, ?)",
        (descricao, descricao, source, *ref),
    )


def _chave(conn, log_id):
    r = conn.execute("SELECT descricao_chave, descricao_vars FROM action_logs WHERE id = ?", (log_id,)).fetchone()
    return r["descricao_chave"], json.loads(r["descricao_vars"]) if r["descricao_vars"] else {}


def test_converte_os_logs_antigos(temp_db_path):
    database.init_db()
    conn = database.get_connection()
    _log(conn, "pagou conta fixa: Luz (casa)")
    _log(conn, "hábito: ler (12/10)", source="habitos")
    _log(conn, "bônus · sequência de 14 dias 1,3×", source="bonus")
    _log(conn, "pagou conta fixa: escrito à mão", source="form")  # texto da pessoa
    _log(conn, "algo que nenhum formato conhece", source="carreira")
    conn.execute(
        "INSERT INTO missoes (id, periodo, referencia, posicao, tipo, alvo_id, titulo, atributo, quantidade, xp_bonus, created_at) "
        "VALUES ('m1', 'dia', '2026-10-01', 0, 'meta', 'g1', 'contribua com a meta \"viagem\"', 'metas', 1, 10, '2026-10-01')"
    )
    _log(conn, 'missão concluída: contribua com a meta "viagem"', source="missao", ref=("missao", "m1"))
    conn.commit()

    _migrate_textos_antigos(conn)
    _migrate_textos_antigos(conn)  # idempotente

    assert _chave(conn, "pagou conta fixa: Luz (casa)") == ("log.conta_fixa.paga", {"nome": "Luz (casa)"})
    assert _chave(conn, "hábito: ler (12/10)") == ("log.habito.outro_dia", {"nome": "ler", "dia": "12/10"})
    assert _chave(conn, "bônus · sequência de 14 dias 1,3×") == ("log.bonus.sequencia", {"dias": 14, "mult": "1,3"})
    assert _chave(conn, "pagou conta fixa: escrito à mão") == (None, {})
    assert _chave(conn, "algo que nenhum formato conhece") == (None, {})
    assert _chave(conn, 'missão concluída: contribua com a meta "viagem"') == (
        "log.missao.concluida",
        {"missao": 'contribua com a meta "viagem"', "periodo": "dia", "tipo": "meta", "nome": "viagem"},
    )
    conn.close()


def test_lancamento_so_com_origem_do_sistema(temp_db_path):
    database.init_db()
    conn = database.get_connection()
    for tx_id, desc in (("t1", "renda: salário"), ("t2", "renda: escrito à mão")):
        conn.execute(
            "INSERT INTO transactions (id, description, amount, type, category, date) VALUES (?, ?, 10, 'entrada', 'x', '2026-10-01')",
            (tx_id, desc),
        )
    conn.execute(
        "INSERT INTO income_sources (id, nome, valor, frequencia) VALUES ('s1', 'salário', 10, 'mensal')"
    )
    conn.execute(
        "INSERT INTO income_entries (id, income_source_id, expected_date, amount, status, transaction_id) "
        "VALUES ('e1', 's1', '2026-10-01', 10, 'pago', 't1')"
    )
    conn.commit()
    _migrate_textos_antigos(conn)
    rows = {r["id"]: r["descricao_chave"] for r in conn.execute("SELECT id, descricao_chave FROM transactions")}
    assert rows == {"t1": "lancamento.renda", "t2": None}
    conn.close()
