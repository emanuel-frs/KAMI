"""
Fixtures compartilhadas dos testes do backend do Kami.

Isolamento de banco: cada teste usa um arquivo sqlite temporário próprio
(nunca o kami.db real), criado do zero via `database.init_db()` — que já
roda o schema.sql + seeds + achievements de produção. Cada request feito
via `client` abre/fecha sua própria conexão (mesmo padrão do `get_db` real),
só que apontando pro DB temporário.
"""
import uuid
from unittest.mock import MagicMock

import keyring
import pytest
from cryptography.fernet import Fernet
from keyring.backend import KeyringBackend
from fastapi.testclient import TestClient

from app import bonus, database, crypto, missoes
from app.main import app


@pytest.fixture(autouse=True)
def _missoes_desligadas(monkeypatch):
    """
    GAM-07/08: missões são sorteadas pela data — ligadas, qualquer teste que
    confere o xp de uma ação passaria a depender do dia em que roda (o
    bônus da missão "lance um gasto" somaria +10). Desligadas por padrão;
    os testes de missões religam com a fixture `missoes_ligadas`.
    """
    monkeypatch.setattr(missoes, "GERACAO_ATIVA", False)
    # GAM-08: bônus de xp idem (primeira ação do dia, sequência, atrasado)
    monkeypatch.setattr(bonus, "BONUS_ATIVO", False)


@pytest.fixture()
def missoes_ligadas(monkeypatch):
    monkeypatch.setattr(missoes, "GERACAO_ATIVA", True)


@pytest.fixture()
def bonus_ligado(monkeypatch):
    monkeypatch.setattr(bonus, "BONUS_ATIVO", True)


@pytest.fixture()
def temp_db_path(tmp_path, monkeypatch):
    """Redireciona DB_PATH pra um arquivo sqlite temporário, isolado por teste."""
    db_file = tmp_path / f"test_{uuid.uuid4().hex}.db"
    monkeypatch.setattr(database, "DB_PATH", db_file)
    return db_file


@pytest.fixture()
def initialized_db(temp_db_path):
    """Roda o init_db() real (schema.sql + seeds + achievements) contra o DB temporário."""
    database.init_db()
    yield temp_db_path


@pytest.fixture()
def db_conn(initialized_db):
    """Conexão direta pro teste inspecionar/preparar estado fora da API."""
    conn = database.get_connection()
    yield conn
    conn.close()


@pytest.fixture()
def client(initialized_db):
    """TestClient com get_db sobrescrito pro DB temporário (1 conexão por request, como em produção)."""

    def _override_get_db():
        conn = database.get_connection()
        try:
            yield conn
        finally:
            conn.close()

    app.dependency_overrides[database.get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class MemoryKeyring(KeyringBackend):
    """Cofre de mentira, em memória — os testes nunca tocam o cofre real do sistema."""

    priority = 1

    def __init__(self):
        super().__init__()
        self.store = {}

    def get_password(self, service, username):
        return self.store.get((service, username))

    def set_password(self, service, username, password):
        self.store[(service, username)] = password

    def delete_password(self, service, username):
        self.store.pop((service, username), None)


@pytest.fixture(autouse=True)
def cofre_de_teste(tmp_path, monkeypatch):
    """
    SEG-01: todo teste roda com um cofre em memória e a chave/marcador
    numa pasta temporária — nunca o .secret_key nem o cofre de verdade.
    Devolve o cofre (o `.store` dá pra inspecionar).
    """
    fake = MemoryKeyring()
    previous = keyring.get_keyring()
    keyring.set_keyring(fake)
    pasta = tmp_path / "chave"
    pasta.mkdir()
    monkeypatch.setattr(crypto, "KEY_PATH", pasta / ".secret_key")
    monkeypatch.setattr(crypto, "MARKER_PATH", pasta / ".secret_key_no_cofre")
    monkeypatch.delenv(crypto.COFRE_ENV_VAR, raising=False)
    crypto._resetar_para_testes()
    yield fake
    crypto._resetar_para_testes()
    keyring.set_keyring(previous)


@pytest.fixture()
def isolated_fernet_key(cofre_de_teste):
    """Chave Fernet conhecida já carregada (no cofre de teste)."""
    key = Fernet.generate_key()
    crypto._resetar_para_testes(Fernet(key), {"local": crypto.LOCAL_COFRE, "cofre": "teste", "motivo": None})
    return key


@pytest.fixture()
def mock_github_urlopen(mocker):
    """
    Helper pra simular a resposta do urlopen do GitHub.
    Uso:
      mock_github_urlopen(json_body={...})          -> sucesso
      mock_github_urlopen(http_error_code=404)       -> repo não encontrado
      mock_github_urlopen(http_error_code=403)       -> rate limit
      mock_github_urlopen(url_error=True)            -> falha de rede
    """
    import json
    import urllib.error

    def _configure(json_body=None, http_error_code=None, url_error=False):
        target = "app.routers.organizacao.urllib.request.urlopen"
        if http_error_code is not None:
            return mocker.patch(
                target,
                side_effect=urllib.error.HTTPError(
                    url="x", code=http_error_code, msg="err", hdrs=None, fp=None
                ),
            )
        if url_error:
            return mocker.patch(target, side_effect=urllib.error.URLError("sem rede"))

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(json_body or {}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False
        return mocker.patch(target, return_value=mock_resp)

    return _configure


@pytest.fixture()
def mock_imap(mocker):
    """
    Helper pra simular imaplib.IMAP4_SSL.
    Uso:
      mock_imap(messages=[raw_bytes, ...])   -> sucesso, devolve essas mensagens
      mock_imap(login_error=True)            -> falha de autenticação
      mock_imap(connect_error=True)          -> falha de conexão (OSError)
    """
    import imaplib

    def _configure(login_error=False, connect_error=False, messages=None):
        target = "app.routers.organizacao.imaplib.IMAP4_SSL"
        if connect_error:
            return mocker.patch(target, side_effect=OSError("conexão recusada"))

        mock_conn = MagicMock()
        if login_error:
            mock_conn.login.side_effect = imaplib.IMAP4.error("auth failed")
        else:
            msgs = messages or []
            ids = [str(i).encode() for i in range(1, len(msgs) + 1)]
            mock_conn.search.return_value = ("OK", [b" ".join(ids)] if ids else [b""])

            fetch_results = {mid: ("OK", [(None, raw)]) for mid, raw in zip(ids, msgs)}

            def _fetch(mid, spec):
                return fetch_results.get(mid, ("OK", [None]))

            mock_conn.fetch.side_effect = _fetch

        mocker.patch(target, return_value=mock_conn)
        return mock_conn

    return _configure