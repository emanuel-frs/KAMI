"""
Testes de app/crypto.py — round-trip encrypt/decrypt e falha com dado inválido.
Usa `isolated_fernet_key` pra nunca depender do .secret_key real do projeto.
"""
import pytest

from app import crypto


def test_encrypt_decrypt_round_trip(isolated_fernet_key):
    plain = "minha-senha-de-app-super-secreta"
    encrypted = crypto.encrypt_password(plain)

    assert encrypted != plain
    assert crypto.decrypt_password(encrypted) == plain


def test_encrypt_produces_different_ciphertext_each_time(isolated_fernet_key):
    # Fernet inclui timestamp/nonce — duas chamadas com o mesmo texto não
    # devem produzir o mesmo ciphertext.
    plain = "mesma-senha"
    enc1 = crypto.encrypt_password(plain)
    enc2 = crypto.encrypt_password(plain)
    assert enc1 != enc2
    assert crypto.decrypt_password(enc1) == plain
    assert crypto.decrypt_password(enc2) == plain


def test_decrypt_invalid_token_raises_value_error(isolated_fernet_key):
    with pytest.raises(ValueError):
        crypto.decrypt_password("isso-nao-e-um-token-fernet-valido")


def test_decrypt_with_wrong_key_raises_value_error(isolated_fernet_key, tmp_path, monkeypatch):
    from cryptography.fernet import Fernet

    plain = "senha-qualquer"
    encrypted = crypto.encrypt_password(plain)

    # troca a chave em uso (simula rotação/chave errada) e tenta decriptar
    # o valor cifrado com a chave antiga
    other_key = Fernet.generate_key()
    monkeypatch.setattr(crypto, "_fernet", Fernet(other_key))

    with pytest.raises(ValueError):
        crypto.decrypt_password(encrypted)


# ── SEG-01: chave no cofre do sistema (docs/REGRAS-DE-NEGOCIO.md SEG-01..05) ──

import keyring
from cryptography.fernet import Fernet
from keyring.backends import fail


def _recarregar():
    crypto._resetar_para_testes()
    return crypto.estado_da_chave()


def test_seg_01_new_install_keeps_key_in_the_vault_not_in_a_file(cofre_de_teste):
    estado = _recarregar()
    assert estado["local"] == crypto.LOCAL_COFRE
    assert not crypto.KEY_PATH.exists()
    assert crypto.MARKER_PATH.exists()
    assert crypto.decrypt_password(crypto.encrypt_password("s3nha")) == "s3nha"
    # a próxima abertura lê a mesma chave do cofre
    enc = crypto.encrypt_password("s3nha")
    _recarregar()
    assert crypto.decrypt_password(enc) == "s3nha"


def test_seg_02_old_key_file_moves_to_the_vault_and_secrets_still_open(cofre_de_teste):
    key = Fernet.generate_key()
    crypto.KEY_PATH.write_bytes(key)
    enc = Fernet(key).encrypt(b"senha-antiga").decode()

    estado = _recarregar()
    assert estado["local"] == crypto.LOCAL_COFRE
    assert not crypto.KEY_PATH.exists()
    assert list(cofre_de_teste.store.values()) == [key.decode()]
    assert crypto.decrypt_password(enc) == "senha-antiga"


def test_seg_02_vault_that_does_not_keep_the_key_leaves_the_file_alone(cofre_de_teste, monkeypatch):
    key = Fernet.generate_key()
    crypto.KEY_PATH.write_bytes(key)
    monkeypatch.setattr(cofre_de_teste, "set_password", lambda *a: None)  # "gravou" mas não guardou

    estado = _recarregar()
    assert estado["local"] == crypto.LOCAL_ARQUIVO
    assert crypto.KEY_PATH.read_bytes() == key
    assert not crypto.MARKER_PATH.exists()


def test_seg_03_without_a_vault_the_key_stays_in_a_private_file(cofre_de_teste):
    keyring.set_keyring(fail.Keyring())
    estado = _recarregar()
    assert estado["local"] == crypto.LOCAL_ARQUIVO
    assert estado["motivo"]
    assert crypto.KEY_PATH.exists()
    assert crypto.decrypt_password(crypto.encrypt_password("x")) == "x"


def test_seg_03_vault_can_be_turned_off_by_env(cofre_de_teste, monkeypatch):
    monkeypatch.setenv(crypto.COFRE_ENV_VAR, "desligado")
    assert _recarregar()["local"] == crypto.LOCAL_ARQUIVO
    assert cofre_de_teste.store == {}


def test_seg_04_lost_vault_key_is_never_replaced_silently(cofre_de_teste):
    _recarregar()
    enc = crypto.encrypt_password("s3nha")
    cofre_de_teste.store.clear()  # o cofre "perdeu" a chave

    estado = _recarregar()
    assert estado["local"] == crypto.LOCAL_INDISPONIVEL
    assert not crypto.KEY_PATH.exists()
    assert cofre_de_teste.store == {}
    with pytest.raises(crypto.ChaveIndisponivel):
        crypto.decrypt_password(enc)
    with pytest.raises(crypto.ChaveIndisponivel):
        crypto.encrypt_password("nova")


def test_seg_04_vault_offline_after_migration_does_not_create_a_file_key(cofre_de_teste):
    _recarregar()
    keyring.set_keyring(fail.Keyring())
    assert _recarregar()["local"] == crypto.LOCAL_INDISPONIVEL
    assert not crypto.KEY_PATH.exists()


def test_seg_04_unavailable_key_answers_409_with_its_own_code(client, cofre_de_teste, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    _recarregar()
    cofre_de_teste.store.clear()
    crypto._resetar_para_testes()

    resp = client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc"})
    assert resp.status_code == 409
    assert resp.json()["codigo"] == "chave_indisponivel"
    assert "segurança" in resp.json()["detail"]


def test_seg_05_redefining_the_key_erases_old_secrets_and_works_again(client, cofre_de_teste, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    _recarregar()
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc"})
    cofre_de_teste.store.clear()
    crypto._resetar_para_testes()
    assert client.get("/api/seguranca/chave").json()["local"] == crypto.LOCAL_INDISPONIVEL

    assert client.post("/api/seguranca/chave/redefinir", json={"confirmation": "sim"}).status_code == 422
    resp = client.post("/api/seguranca/chave/redefinir", json={"confirmation": "redefinir"})
    assert resp.status_code == 200
    assert resp.json()["local"] == crypto.LOCAL_COFRE
    assert resp.json()["segredos_apagados"] == 1
    assert client.get("/api/organizacao/search-key").json()["configured"] is False
    assert client.put("/api/organizacao/search-key", json={"api_key": "tvly-novo"}).status_code in (200, 201)


def test_seg_05_redefining_the_key_flags_email_accounts_for_a_new_password(client, cofre_de_teste):
    """ORG-06: depois de redefinir, a conta de e-mail já sai marcada — a
    aba avisa na hora, sem esperar a sincronização falhar em silêncio."""
    _recarregar()
    client.post(
        "/api/organizacao/email-accounts",
        json={"label": "gmail", "imap_host": "imap.gmail.com", "imap_port": 993, "username": "eu", "app_password": "x"},
    )
    client.post("/api/seguranca/chave/redefinir", json={"confirmation": "redefinir"})
    conta = client.get("/api/organizacao/email-accounts").json()[0]
    assert conta["sync_erro"] == "senha" and conta["sync_erro_desde"]


def test_seg_01_each_data_folder_has_its_own_vault_entry(cofre_de_teste, tmp_path, monkeypatch):
    _recarregar()
    outra = tmp_path / "demo"
    outra.mkdir()
    monkeypatch.setattr(crypto, "KEY_PATH", outra / ".secret_key")
    monkeypatch.setattr(crypto, "MARKER_PATH", outra / ".secret_key_no_cofre")
    _recarregar()
    assert len(cofre_de_teste.store) == 2


def test_seg_01_status_and_diagnostic_say_where_the_key_is(client):
    resp = client.get("/api/seguranca/chave").json()
    assert resp["local"] == crypto.LOCAL_COFRE
    assert resp["segredos_salvos"] == 0
    assert "chave dos segredos: cofre" in client.get("/api/sistema/diagnostico").json()["texto"]
