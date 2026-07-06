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
