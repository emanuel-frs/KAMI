"""
SEG-08: banco cifrado em disco (P-167..P-171) — ligar/desligar sem perder
nada, arquivo ilegível sem a chave, código de recuperação, cópias sem
cifra, restaurar cópia do outro modo e a troca esperando as conexões.
"""
import sqlite3
import time

import pytest

from app import backup_auto, cifra, cifra_troca, database
from app import main as app_main

pytestmark = pytest.mark.skipif(not cifra.biblioteca_ok(), reason="sqlcipher3 não instalado")


def _marca(valor: str) -> None:
    conn = database.get_connection()
    try:
        conn.execute(
            "INSERT INTO sistema_info (chave, valor) VALUES ('teste_cifra', ?) "
            "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
            (valor,),
        )
        conn.commit()
    finally:
        conn.close()


def _le_marca() -> str:
    conn = database.get_connection()
    try:
        return conn.execute("SELECT valor FROM sistema_info WHERE chave = 'teste_cifra'").fetchone()["valor"]
    finally:
        conn.close()


def test_seg_24_turning_encryption_on_and_off_loses_nothing(client, initialized_db):
    _marca("antes")
    estado = client.get("/api/seguranca/cifra").json()
    assert estado["ligada"] is False and estado["disponivel"] is True

    r = client.post("/api/seguranca/cifra/ligar", json={})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["ligada"] is True
    assert len(corpo["codigo"].split("-")) == 13
    assert corpo["copias_sem_cifra"] == 0 and corpo["copias_apagadas"] >= 1

    # P-171: o arquivo não abre como SQLite comum
    assert open(initialized_db, "rb").read(16) != cifra.CABECALHO_SQLITE
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(initialized_db).execute("SELECT * FROM sistema_info").fetchall()
    assert _le_marca() == "antes"
    # a cópia nova já sai cifrada (nunca fica sem cópia)
    copias = list(database.backups_dir().glob("kami-semanal-*.db"))
    assert copias and all(cifra.arquivo_cifrado(p) for p in copias)

    _marca("cifrado")
    r = client.post("/api/seguranca/cifra/desligar")
    assert r.status_code == 200, r.text
    assert r.json()["ligada"] is False
    assert open(initialized_db, "rb").read(16) == cifra.CABECALHO_SQLITE
    assert sqlite3.connect(initialized_db).execute(
        "SELECT valor FROM sistema_info WHERE chave = 'teste_cifra'").fetchone()[0] == "cifrado"


def test_seg_24_without_a_vault_encryption_does_not_turn_on(client, monkeypatch):
    monkeypatch.setenv("KAMI_COFRE", "desligado")
    estado = client.get("/api/seguranca/cifra").json()
    assert estado["disponivel"] is False and estado["motivo"] == "cofre"
    r = client.post("/api/seguranca/cifra/ligar", json={})
    assert r.status_code == 422
    assert r.json()["chave"] == "erro.cifra.sem_cofre"


def test_seg_25_lost_vault_key_opens_with_the_recovery_code(client, cofre_de_teste):
    _marca("guardado")
    codigo = client.post("/api/seguranca/cifra/ligar", json={}).json()["codigo"]

    # sistema reinstalado: o cofre não tem mais a chave
    cofre_de_teste.store.clear()
    cifra._resetar_para_testes()
    app_main.on_startup()
    assert cifra_troca.trancado()

    r = client.get("/api/perfil")
    assert r.status_code == 423 and r.json()["codigo"] == "cifra_sem_chave"
    assert client.get("/api/seguranca/cifra").json()["sem_chave"] is True

    errado = "0" * 52
    r = client.post("/api/seguranca/cifra/recuperar", json={"codigo": errado})
    assert r.status_code == 422 and r.json()["chave"] == "erro.cifra.codigo_errado"

    # digitado do jeito que der: minúsculo, com espaço no lugar do hífen
    r = client.post("/api/seguranca/cifra/recuperar", json={"codigo": codigo.lower().replace("-", " ")})
    assert r.status_code == 200, r.text
    assert r.json()["no_cofre"] is True
    assert not cifra_troca.trancado()
    assert client.get("/api/perfil").status_code == 200
    assert _le_marca() == "guardado"


def test_seg_25_recovery_code_round_trip_is_forgiving():
    chave = "00ff" * 16
    codigo = cifra.codigo_da_chave(chave)
    assert cifra.chave_do_codigo(codigo) == chave
    assert cifra.chave_do_codigo(codigo.lower().replace("0", "o").replace("-", "")) == chave
    with pytest.raises(cifra.CodigoErrado):
        cifra.chave_do_codigo("curto")


def test_seg_26_showing_the_code_again_asks_for_the_pin(client):
    codigo = client.post("/api/seguranca/cifra/ligar", json={}).json()["codigo"]
    assert client.post("/api/seguranca/cifra/codigo", json={}).json()["codigo"] == codigo
    client.post("/api/seguranca/pin", json={"pin": "1234"})
    assert client.post("/api/seguranca/cifra/codigo", json={"pin": "9999"}).status_code == 422
    assert client.post("/api/seguranca/cifra/codigo", json={"pin": "1234"}).json()["codigo"] == codigo


def test_seg_27_copies_from_the_other_mode_restore_into_the_current_one(client):
    _marca("na-copia")
    # sem apagar as cópias: a de antes de ligar continua sem cifra
    r = client.post("/api/seguranca/cifra/ligar", json={"apagar_copias_sem_cifra": False})
    assert r.json()["copias_sem_cifra"] >= 1
    antes = next(database.backups_dir().glob("kami-antes-de-cifra-*.db"))
    assert not cifra.arquivo_cifrado(antes)
    _marca("depois")

    r = client.post("/api/backups/restaurar", json={"nome": antes.name, "confirmation": "restaurar"})
    assert r.status_code == 200, r.text
    assert _le_marca() == "na-copia"
    assert cifra.arquivo_cifrado(database.DB_PATH)  # o banco segue cifrado

    # e o caminho de volta: cópia cifrada com o banco já sem cifra
    cifrada = next(database.backups_dir().glob("kami-antes-de-restaurar-*.db"))
    assert cifra.arquivo_cifrado(cifrada)
    client.post("/api/seguranca/cifra/desligar")
    time.sleep(1.1)  # a próxima "antes de restaurar" não pode ter o mesmo nome desta
    client.post("/api/backups/restaurar", json={"nome": cifrada.name, "confirmation": "restaurar"})
    assert _le_marca() == "depois"
    assert not cifra.arquivo_cifrado(database.DB_PATH)


def test_seg_28_swap_waits_for_open_connections_or_gives_up(client, monkeypatch):
    monkeypatch.setattr(database, "TROCA_ESPERA_S", 0.2)
    presa = database.get_connection()
    try:
        r = client.post("/api/seguranca/cifra/ligar", json={})
        assert r.status_code == 409 and r.json()["chave"] == "erro.cifra.ocupado"
    finally:
        presa.close()
    assert not cifra.arquivo_cifrado(database.DB_PATH)
    # liberada a conexão, conexões novas não ficaram travadas
    assert client.get("/api/perfil").status_code == 200


def test_seg_28_sqlcipher_errors_are_classified_like_sqlite():
    from app.erros import classificar
    from sqlcipher3 import dbapi2

    assert classificar(dbapi2.OperationalError("database is locked"))[1] == "banco_ocupado"
    assert classificar(dbapi2.DatabaseError("database disk image is malformed"))[1] == "banco_corrompido"
