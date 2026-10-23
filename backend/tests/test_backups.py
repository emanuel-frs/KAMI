"""Cópias automáticas do banco (CONF-08): app/backup_auto.py e /api/backups."""
import datetime
import sqlite3

import pytest

from app import backup_auto, database


def _agora_mais(monkeypatch, dias):
    real = database.local_now()
    monkeypatch.setattr(database, "local_now", lambda: real + datetime.timedelta(days=dias))


def _semanais():
    return sorted(p.name for p in database.backups_dir().glob("kami-semanal-*.db"))


def _nome_profile(caminho):
    conn = sqlite3.connect(caminho)
    try:
        return conn.execute("SELECT display_name FROM user_profile").fetchone()[0]
    finally:
        conn.close()


def test_sis_10_weekly_copy_only_when_the_last_one_is_7_days_old(db_conn, monkeypatch):
    assert backup_auto.copia_semanal_se_precisar(db_conn) is not None  # a primeira
    assert backup_auto.copia_semanal_se_precisar(db_conn) is None  # no mesmo dia, não
    _agora_mais(monkeypatch, 6)
    assert backup_auto.copia_semanal_se_precisar(db_conn) is None
    _agora_mais(monkeypatch, 7)
    assert backup_auto.copia_semanal_se_precisar(db_conn) is not None
    assert len(_semanais()) == 2


def test_sis_10_keeps_only_the_4_most_recent_weekly_copies(db_conn, monkeypatch):
    for semana in range(6):
        _agora_mais(monkeypatch, 7 * semana)
        backup_auto.copia_semanal_se_precisar(db_conn)
    nomes = _semanais()
    assert len(nomes) == backup_auto.SEMANAL_MANTER == 4
    # as que ficaram são as 4 últimas (ordem pela data no nome)
    assert nomes == sorted(nomes)[-4:]


def test_sis_10_backend_startup_makes_the_weekly_copy(initialized_db):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app):
        pass
    assert len(_semanais()) == 1


def test_sis_11_import_reset_and_new_key_copy_the_database_first(client, monkeypatch):
    client.put("/api/perfil", json={"display_name": "antes de tudo"})
    exportado = client.get("/api/sistema/export").json()["tables"]

    assert client.post("/api/sistema/import", json={"confirmation": "importar", "tables": exportado}).status_code == 200
    assert client.post("/api/sistema/reset", json={"confirmation": "excluir"}).status_code == 200
    assert client.post("/api/seguranca/chave/redefinir", json={"confirmation": "redefinir"}).status_code == 200

    antes = {c["acao"]: c for c in client.get("/api/backups").json()["copias"] if c["tipo"] == "antes"}
    assert set(antes) == {"importar", "apagar-tudo", "redefinir-chave"}
    # a cópia de antes do "apagar tudo" ainda tem os dados
    assert _nome_profile(database.backups_dir() / antes["apagar-tudo"]["nome"]) == "antes de tudo"


def test_sis_11_wrong_confirmation_makes_no_copy(client):
    client.post("/api/sistema/reset", json={"confirmation": "nao"})
    assert [c for c in client.get("/api/backups").json()["copias"] if c["tipo"] == "antes"] == []


def test_sis_12_restore_brings_the_data_back_and_keeps_the_current_state(client):
    client.put("/api/perfil", json={"display_name": "Ana"})
    copia = client.post("/api/backups/agora").json()["copias"][0]["nome"]
    client.post("/api/sistema/reset", json={"confirmation": "excluir"})
    assert client.get("/api/perfil").json()["display_name"] != "Ana"

    resp = client.post("/api/backups/restaurar", json={"nome": copia, "confirmation": "restaurar"})
    assert resp.status_code == 200
    assert client.get("/api/perfil").json()["display_name"] == "Ana"
    # o estado de antes da restauração ficou guardado (dá pra voltar atrás)
    acoes = [c["acao"] for c in resp.json()["copias"] if c["tipo"] == "antes"]
    assert "restaurar" in acoes


def test_sis_12_restore_needs_the_word_and_a_real_copy(client):
    copia = client.post("/api/backups/agora").json()["copias"][0]["nome"]
    assert client.post("/api/backups/restaurar", json={"nome": copia, "confirmation": "sim"}).status_code == 422
    for nome in ("../kami.db", "kami.db", "kami-semanal-20990101-000000.db", "/etc/passwd"):
        resp = client.post("/api/backups/restaurar", json={"nome": nome, "confirmation": "restaurar"})
        assert resp.status_code == 404, nome


def test_sis_12_restoring_an_older_version_runs_the_migrations(client, db_conn):
    copia = client.post("/api/backups/agora").json()["copias"][0]["nome"]
    arquivo = database.backups_dir() / copia
    velho = sqlite3.connect(arquivo)
    velho.execute("UPDATE sistema_info SET valor = '1.0.0' WHERE chave = 'versao_banco'")
    velho.commit()
    velho.close()
    assert client.post("/api/backups/restaurar", json={"nome": copia, "confirmation": "restaurar"}).status_code == 200
    versao = db_conn.execute("SELECT valor FROM sistema_info WHERE chave = 'versao_banco'").fetchone()[0]
    assert versao == database.KAMI_VERSION
    tipos = {c["tipo"] for c in client.get("/api/backups").json()["copias"]}
    assert "atualizacao" in tipos  # passou pelo backup de antes de migrar (CONF-05)


def test_sis_13_extra_folder_gets_the_weekly_copy(client, tmp_path, monkeypatch):
    extra = tmp_path / "pendrive"
    extra.mkdir()
    (extra / "foto.jpg").write_bytes(b"x")  # nada além das cópias do Kami é tocado
    resp = client.put("/api/backups/pasta-extra", json={"pasta": str(extra)})
    assert resp.status_code == 200
    assert resp.json()["pasta_extra"] == str(extra.resolve())
    assert resp.json()["extra_ok_em"]
    assert len(list(extra.glob("kami-semanal-*.db"))) == 1
    assert (extra / "foto.jpg").exists()

    _agora_mais(monkeypatch, 7)  # a próxima semanal (nome com outra data)
    client.post("/api/backups/verificar")
    assert len(list(extra.glob("kami-semanal-*.db"))) == 2

    assert client.put("/api/backups/pasta-extra", json={"pasta": None}).json()["pasta_extra"] is None


@pytest.mark.parametrize("pasta", ["relativa/kami", "/caminho/que/nao/existe"])
def test_sis_13_extra_folder_must_exist_and_be_absolute(client, pasta):
    assert client.put("/api/backups/pasta-extra", json={"pasta": pasta}).status_code == 422


def test_sis_13_missing_extra_folder_warns_only_after_30_days(client, tmp_path, db_conn, monkeypatch):
    extra = tmp_path / "pendrive"
    extra.mkdir()
    client.put("/api/backups/pasta-extra", json={"pasta": str(extra)})
    extra.rename(tmp_path / "fora")  # pendrive desconectado

    _agora_mais(monkeypatch, 8)
    backup_auto.copia_semanal_se_precisar(db_conn)
    status = backup_auto.status(db_conn)
    assert status["extra_erro"] and not status["extra_atrasada"]

    _agora_mais(monkeypatch, 31)
    assert backup_auto.status(db_conn)["extra_atrasada"] is True

    (tmp_path / "fora").rename(extra)  # voltou: a próxima verificação copia e o aviso some
    backup_auto.copia_semanal_se_precisar(db_conn)
    status = backup_auto.status(db_conn)
    assert status["extra_erro"] is None and status["extra_atrasada"] is False


def test_sis_13_extra_folder_survives_a_restore(client, tmp_path):
    extra = tmp_path / "pendrive"
    extra.mkdir()
    copia = client.post("/api/backups/agora").json()["copias"][0]["nome"]  # cópia SEM a pasta extra
    client.put("/api/backups/pasta-extra", json={"pasta": str(extra)})
    resp = client.post("/api/backups/restaurar", json={"nome": copia, "confirmation": "restaurar"})
    assert resp.json()["pasta_extra"] == str(extra.resolve())


def test_extra_folder_is_not_exported(client, tmp_path):
    extra = tmp_path / "pendrive"
    extra.mkdir()
    client.put("/api/backups/pasta-extra", json={"pasta": str(extra)})
    assert "sistema_info" not in client.get("/api/sistema/export").json()["tables"]


def test_dist_01_copy_before_updating_the_app(client):
    # P-90: o app pede a cópia logo antes de instalar uma versão nova
    client.put("/api/perfil", json={"display_name": "antes da 1.15"})
    resp = client.post("/api/backups/antes-de-atualizar")
    assert resp.status_code == 200
    antes = [c for c in resp.json()["copias"] if c["tipo"] == "antes"]
    assert [c["acao"] for c in antes] == ["atualizar"]
    assert _nome_profile(database.backups_dir() / antes[0]["nome"]) == "antes da 1.15"
