"""
PIN opcional pra abrir o app (SEG-02, docs/REGRAS-DE-NEGOCIO.md SEG-15..21).
"""
import json
import os
import re
import stat

import pytest

from app import pin

PIN = "4821"


def _reabrir():
    """Simula fechar e abrir o app: o backend novo nasce bloqueado."""
    pin._resetar_para_testes()


def _ligar(client, valor=PIN):
    resp = client.post("/api/seguranca/pin", json={"pin": valor})
    assert resp.status_code == 201, resp.text
    return resp.json()["codigo_recuperacao"]


def test_seg_15_without_pin_the_app_opens_as_before(client):
    assert client.get("/api/seguranca/pin").json()["ativo"] is False
    assert client.get("/api/perfil").status_code == 200


def test_seg_15_turning_on_shows_a_recovery_code_once_and_keeps_only_hashes(client):
    codigo = _ligar(client)
    assert re.fullmatch(r"KAMI-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}", codigo)
    assert client.get("/api/perfil").status_code == 200  # quem ligou continua usando
    texto = pin.PIN_PATH.read_text()
    assert PIN not in texto and codigo[5:9] not in texto
    if os.name != "nt":
        assert stat.S_IMODE(pin.PIN_PATH.stat().st_mode) == 0o600
    assert "codigo_recuperacao" not in client.get("/api/seguranca/pin").json()


def test_seg_16_locked_app_serves_no_data_through_the_api(client):
    _ligar(client)
    _reabrir()
    resp = client.get("/api/perfil")
    assert resp.status_code == 423 and resp.json()["codigo"] == "bloqueado"
    assert client.get("/api/sistema/export").status_code == 423
    assert client.put("/api/seguranca/pin", json={"pin_atual": PIN, "pin_novo": "1111"}).status_code == 423
    assert client.get("/health").status_code == 200
    assert client.get("/api/seguranca/pin").json()["bloqueado"] is True
    assert client.post("/api/sistema/erro-frontend", json={"mensagem": "x"}).status_code == 204


def test_seg_16_right_pin_unlocks_wrong_pin_does_not(client):
    _ligar(client)
    _reabrir()
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": "0000"}).status_code == 422
    assert client.get("/api/perfil").status_code == 423
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": PIN}).status_code == 200
    assert client.get("/api/perfil").status_code == 200


def test_seg_17_five_wrong_attempts_make_it_wait_and_restart_does_not_reset(client, monkeypatch):
    agora = [1_000_000.0]
    monkeypatch.setattr(pin.time, "time", lambda: agora[0])
    _ligar(client)
    _reabrir()
    for _ in range(5):
        assert client.post("/api/seguranca/pin/desbloquear", json={"pin": "0000"}).status_code == 422
    resp = client.post("/api/seguranca/pin/desbloquear", json={"pin": PIN})  # até o certo espera
    assert resp.status_code == 429 and resp.headers["Retry-After"] == "30"
    _reabrir()
    assert client.get("/api/seguranca/pin").json()["espera_s"] == 30

    agora[0] += 31
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": "0000"}).status_code == 422
    assert client.get("/api/seguranca/pin").json()["espera_s"] == 60  # cada erro a mais dobra
    agora[0] += 61
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": PIN}).status_code == 200
    assert json.loads(pin.PIN_PATH.read_text())["erros"] == 0


def test_seg_17_wait_is_capped_at_15_minutes(client, monkeypatch):
    agora = [1_000_000.0]
    monkeypatch.setattr(pin.time, "time", lambda: agora[0])
    _ligar(client)
    _reabrir()
    for _ in range(20):
        client.post("/api/seguranca/pin/desbloquear", json={"pin": "0000"})
        agora[0] += 10_000
    client.post("/api/seguranca/pin/desbloquear", json={"pin": "0000"})
    assert client.get("/api/seguranca/pin").json()["espera_s"] == 15 * 60


def test_seg_18_recovery_code_sets_a_new_pin_and_a_new_code(client):
    codigo = _ligar(client)
    _reabrir()
    resp = client.post("/api/seguranca/pin/recuperar", json={"codigo": "KAMI-0000-0000-0000", "pin_novo": "9999"})
    assert resp.status_code == 422 and resp.json()["detail"] == "código de recuperação errado"

    digitado = codigo.lower().replace("-", " ").replace("0", "o")  # do jeito que a pessoa digita
    resp = client.post("/api/seguranca/pin/recuperar", json={"codigo": digitado, "pin_novo": "9999"})
    assert resp.status_code == 200, resp.text
    novo = resp.json()["codigo_recuperacao"]
    assert novo != codigo
    assert client.get("/api/perfil").status_code == 200

    _reabrir()
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": PIN}).status_code == 422
    assert client.post("/api/seguranca/pin/desbloquear", json={"pin": "9999"}).status_code == 200
    _reabrir()
    assert client.post("/api/seguranca/pin/recuperar", json={"codigo": codigo, "pin_novo": "1234"}).status_code == 422


def test_seg_18_deleting_the_pin_file_is_the_last_resort_and_keeps_the_data(client):
    client.put("/api/perfil", json={"display_name": "Ana"})
    _ligar(client)
    _reabrir()
    pin.PIN_PATH.unlink()
    assert client.get("/api/perfil").json()["display_name"] == "Ana"


def test_seg_19_changing_or_removing_the_pin_asks_for_the_current_one(client):
    _ligar(client)
    assert client.put("/api/seguranca/pin", json={"pin_atual": "0000", "pin_novo": "5555"}).status_code == 422
    assert client.put("/api/seguranca/pin", json={"pin_atual": PIN, "pin_novo": "5555"}).status_code == 200
    assert client.post("/api/seguranca/pin/desativar", json={"pin_atual": PIN}).status_code == 422
    assert client.post("/api/seguranca/pin/desativar", json={"pin_atual": "5555"}).status_code == 200
    assert not pin.PIN_PATH.exists()
    _reabrir()
    assert client.get("/api/perfil").status_code == 200


@pytest.mark.parametrize("ruim", ["123", "123456789", "12a4", "", "١٢٣٤"])
def test_seg_19_pin_has_4_to_8_digits(client, ruim):
    assert client.post("/api/seguranca/pin", json={"pin": ruim}).status_code == 422


def test_seg_20_inactivity_lock_is_optional_and_locks_on_request(client):
    _ligar(client)
    assert client.get("/api/seguranca/pin").json()["inatividade_min"] is None  # desligado por padrão
    assert client.put("/api/seguranca/pin/inatividade", json={"minutos": 7}).status_code == 422
    assert client.put("/api/seguranca/pin/inatividade", json={"minutos": 15}).json()["inatividade_min"] == 15
    assert client.post("/api/seguranca/pin/bloquear").status_code == 200
    assert client.get("/api/perfil").status_code == 423


def test_seg_21_damaged_pin_file_does_not_lock_the_person_out(client):
    pin.PIN_PATH.write_text("{isso não é json")
    _reabrir()
    assert client.get("/api/perfil").status_code == 200


def test_seg_21_pin_hash_uses_slow_scrypt():
    assert pin.SCRYPT_PADRAO == {"n": 2**17, "r": 8, "p": 1}
