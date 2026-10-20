"""
Backup exportado com senha (SEG-03, docs/REGRAS-DE-NEGOCIO.md SEG-10..14).
"""
import base64
import json

import pytest
from cryptography.fernet import Fernet

from app import backup_cifrado, crypto, database

SENHA = "cavalo-bateria-grampo"


@pytest.fixture()
def dados(client, mock_github_urlopen):
    """Perfil com nome, uma conta de e-mail e a chave da busca salvas."""
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/perfil", json={"display_name": "Ana Secreta"})
    conta = client.post(
        "/api/organizacao/email-accounts",
        json={"label": "pessoal", "imap_host": "imap.exemplo.invalid", "username": "ana@exemplo.invalid",
              "app_password": "senha-de-app-123"},
    ).json()
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-chave-secreta"})
    return conta


def _senha_salva(conta_id):
    conn = database.get_connection()
    enc = conn.execute("SELECT app_password_enc FROM email_accounts WHERE id = ?", (conta_id,)).fetchone()[0]
    conn.close()
    return crypto.decrypt_password(enc)


def _exportar(client, senha=SENHA):
    resp = client.post("/api/sistema/export-protegido", json={"senha": senha})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _importar(client, arquivo, senha=SENHA):
    return client.post("/api/sistema/import", json={"confirmation": "importar", "cifrado": arquivo, "senha": senha})


def _nova_maquina():
    """Outra instalação: chave local diferente (cofre novo, vazio)."""
    crypto._resetar_para_testes(Fernet(Fernet.generate_key()), {"local": "cofre", "cofre": "teste", "motivo": None})


def test_seg_10_protected_backup_cannot_be_read_without_the_password(client, dados):
    resp = _exportar(client)
    texto = json.dumps(resp["arquivo"])
    for segredo in ("Ana Secreta", "senha-de-app-123", "tvly-chave-secreta", "ana@exemplo.invalid", "user_profile"):
        assert segredo not in texto
    assert resp["arquivo"]["kami_backup_cifrado"] == 1
    assert resp["segredos_incluidos"] == 2 and resp["segredos_fora"] == 0


def test_seg_11_right_password_restores_everything_including_saved_passwords(client, dados):
    arquivo = _exportar(client)["arquivo"]
    client.post("/api/sistema/reset", json={"confirmation": "excluir"})

    resp = _importar(client, arquivo)
    assert resp.status_code == 200, resp.text
    assert resp.json()["segredos_restaurados"] == 2
    assert client.get("/api/perfil").json()["display_name"] == "Ana Secreta"
    assert _senha_salva(dados["id"]) == "senha-de-app-123"


def test_seg_12_protected_backup_works_on_another_computer(client, dados):
    arquivo = _exportar(client)["arquivo"]
    _nova_maquina()

    assert _importar(client, arquivo).status_code == 200
    assert _senha_salva(dados["id"]) == "senha-de-app-123"
    assert client.get("/api/organizacao/search-key").json() == {"configured": True}


def test_seg_12_backup_without_password_does_not_carry_passwords_to_another_computer(client, dados):
    tables = client.get("/api/sistema/export").json()["tables"]
    _nova_maquina()

    assert client.post("/api/sistema/import", json={"confirmation": "importar", "tables": tables}).status_code == 200
    with pytest.raises(ValueError):
        _senha_salva(dados["id"])


def test_seg_13_wrong_password_is_refused_and_changes_nothing(client, dados):
    arquivo = _exportar(client)["arquivo"]
    client.put("/api/perfil", json={"display_name": "Depois do backup"})

    resp = _importar(client, arquivo, senha="senha-errada")
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("senha errada")
    assert client.get("/api/perfil").json()["display_name"] == "Depois do backup"
    assert _importar(client, arquivo, senha=None).json()["detail"] == "este backup é protegido — informe a senha"


@pytest.mark.parametrize("onde", ["dados", "cabecalho"])
def test_seg_13_tampered_file_is_refused(client, dados, onde):
    arquivo = _exportar(client)["arquivo"]
    if onde == "dados":
        bruto = bytearray(base64.b64decode(arquivo["dados"]))
        bruto[len(bruto) // 2] ^= 1
        arquivo["dados"] = base64.b64encode(bytes(bruto)).decode()
    else:
        arquivo["exported_at"] = "2020-01-01T00:00:00"  # o cabeçalho também é autenticado
    resp = _importar(client, arquivo)
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("senha errada")


def test_seg_13_absurd_scrypt_parameters_are_refused_before_deriving(client, dados, monkeypatch):
    arquivo = _exportar(client)["arquivo"]
    arquivo["kdf"]["n"] = 2**30  # 1 TB de memória se fosse derivar
    derivou = []
    monkeypatch.setattr(backup_cifrado, "_chave", lambda *a: derivou.append(a))
    resp = _importar(client, arquivo)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "arquivo de backup corrompido"
    assert derivou == []


def test_seg_14_password_needs_8_characters(client):
    resp = client.post("/api/sistema/export-protegido", json={"senha": "1234567"})
    assert resp.status_code == 422


def test_seg_14_protected_export_counts_as_a_backup(client):
    _exportar(client)
    assert client.get("/api/perfil").json()["last_backup_at"]


def test_seg_14_password_that_cannot_be_read_now_stays_out(client, dados):
    conn = database.get_connection()
    conn.execute("UPDATE email_accounts SET app_password_enc = 'corrompido'")
    conn.commit()
    conn.close()
    resp = _exportar(client)
    assert resp["segredos_incluidos"] == 1 and resp["segredos_fora"] == 1


def test_seg_14_key_derivation_uses_owasp_scrypt_parameters():
    env = backup_cifrado.cifrar({"x": 1}, SENHA, kami_version="t", exported_at="t")
    assert env["kdf"]["n"] == 2**17 and env["kdf"]["r"] == 8 and env["kdf"]["p"] == 1
    assert backup_cifrado.decifrar(env, SENHA) == {"x": 1}
    outro = backup_cifrado.cifrar({"x": 1}, SENHA, kami_version="t", exported_at="t")
    assert outro["kdf"]["sal"] != env["kdf"]["sal"] and outro["nonce"] != env["nonce"]
