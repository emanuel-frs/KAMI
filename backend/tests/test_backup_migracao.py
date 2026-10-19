"""
Backup automático antes de atualizar o banco (CONF-05, docs/REGRAS-DE-NEGOCIO.md SIS-05..07).
"""
import sqlite3

import pytest

from app import database
from app.version import KAMI_VERSION


def _set_version(versao):
    conn = database.get_connection()
    conn.execute("UPDATE sistema_info SET valor = ? WHERE chave = 'versao_banco'", (versao,))
    conn.commit()
    conn.close()


def _backups():
    folder = database.backups_dir()
    return sorted(p.name for p in folder.glob("kami-antes-da-*.db")) if folder.exists() else []


def _version():
    conn = database.get_connection()
    row = conn.execute("SELECT valor FROM sistema_info WHERE chave = 'versao_banco'").fetchone()
    conn.close()
    return row["valor"]


def test_sis_05_fresh_install_makes_no_backup_and_records_version(temp_db_path):
    database.init_db()
    assert _backups() == []
    assert _version() == KAMI_VERSION


def test_sis_05_opening_a_new_version_backs_up_first_and_only_once(temp_db_path):
    database.init_db()
    _set_version("1.9.1")

    database.init_db()
    assert len(_backups()) == 1
    assert _backups()[0].startswith(f"kami-antes-da-{KAMI_VERSION}-")
    assert _version() == KAMI_VERSION

    database.init_db()  # mesma versão: não copia de novo
    assert len(_backups()) == 1


def test_sis_05_database_from_before_this_feature_is_backed_up(temp_db_path):
    database.init_db()
    conn = database.get_connection()
    conn.execute("DROP TABLE sistema_info")
    conn.commit()
    conn.close()

    database.init_db()
    assert len(_backups()) == 1


def test_sis_05_backup_is_a_full_readable_copy(temp_db_path):
    database.init_db()
    conn = database.get_connection()
    conn.execute("UPDATE user_profile SET display_name = 'Ana'")
    conn.commit()
    conn.close()
    _set_version("1.9.1")
    database.init_db()

    copy = sqlite3.connect(database.backups_dir() / _backups()[0])
    assert copy.execute("SELECT display_name FROM user_profile").fetchone()[0] == "Ana"
    copy.close()


def test_sis_06_keeps_only_the_3_most_recent_backups(temp_db_path, monkeypatch):
    database.init_db()
    stamps = iter([f"2026010{i}-120000" for i in range(1, 6)])
    real_now = database.local_now

    class _Fake:
        def strftime(self, fmt):
            return next(stamps)

    monkeypatch.setattr(database, "local_now", lambda: _Fake())
    for i in range(5):
        _set_version(f"0.0.{i}")
        database.init_db()
    monkeypatch.setattr(database, "local_now", real_now)

    assert [n.rsplit("-", 2)[-2] for n in _backups()] == ["20260103", "20260104", "20260105"]


def test_sis_07_failed_migration_restores_the_backup_and_stops(temp_db_path, monkeypatch):
    database.init_db()
    conn = database.get_connection()
    conn.execute("UPDATE user_profile SET display_name = 'Ana'")
    conn.commit()
    conn.close()
    _set_version("1.9.1")

    def migracao_quebrada(conn):
        # estraga os dados no meio e explode — o pior caso
        conn.execute("DELETE FROM user_profile")
        conn.commit()
        raise sqlite3.OperationalError("migração com bug")

    monkeypatch.setattr(database, "_migrate_transacao_referencia", migracao_quebrada)
    with pytest.raises(database.MigracaoFalhou, match="restaurado"):
        database.init_db()

    conn = database.get_connection()
    assert conn.execute("SELECT display_name FROM user_profile").fetchone()["display_name"] == "Ana"
    assert conn.execute("SELECT valor FROM sistema_info WHERE chave = 'versao_banco'").fetchone()["valor"] == "1.9.1"
    conn.close()


def test_sis_05_export_does_not_carry_database_info(client):
    tables = client.get("/api/sistema/export").json()["tables"]
    assert "sistema_info" not in tables
    assert "user_profile" in tables
