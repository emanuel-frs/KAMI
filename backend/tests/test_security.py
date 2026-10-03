"""
Testes do token de sessão (app/security.py) e do override KAMI_DATA_DIR.

Garantem o contrato de segurança do backend empacotado: sem o header
correto nada da API responde (nem o export completo), mas o /health e o
preflight de CORS continuam abertos pro app conseguir subir e conversar.
"""
import os
import stat
import sys

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.paths import get_data_dir
from app.security import (
    TOKEN_ENV_VAR,
    TOKEN_HEADER,
    generate_token,
    write_token_file,
)

TOKEN = "token-de-teste"


@pytest.fixture()
def client_com_token(monkeypatch):
    monkeypatch.setenv(TOKEN_ENV_VAR, TOKEN)
    return TestClient(app)


def test_sem_token_configurado_middleware_nao_interfere(monkeypatch):
    # dev/testes: variável ausente => comportamento antigo
    monkeypatch.delenv(TOKEN_ENV_VAR, raising=False)
    assert TestClient(app).get("/health").status_code == 200


def test_requisicao_sem_header_recebe_401(client_com_token):
    resp = client_com_token.get("/api/sistema/export")
    assert resp.status_code == 401
    assert "token" in resp.json()["detail"]


def test_token_errado_recebe_401(client_com_token):
    resp = client_com_token.get("/api/sistema/export", headers={"X-Kami-Token": "outro"})
    assert resp.status_code == 401


def test_post_destrutivo_sem_token_recebe_401(client_com_token):
    # o reset é exatamente o que uma página maliciosa tentaria
    resp = client_com_token.post("/api/sistema/reset", json={"confirmation": "qualquer"})
    assert resp.status_code == 401


def test_token_correto_passa_da_camada_de_seguranca(client_com_token):
    # não importa o status final da rota (depende do banco); importa que
    # NÃO foi barrado pelo middleware
    resp = client_com_token.get("/openapi.json", headers={"X-Kami-Token": TOKEN})
    assert resp.status_code == 200


def test_health_continua_aberto(client_com_token):
    assert client_com_token.get("/health").status_code == 200


def test_preflight_cors_continua_aberto_e_401_tem_headers_cors(client_com_token):
    pre = client_com_token.options(
        "/api/sistema/export",
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-kami-token",
        },
    )
    assert pre.status_code == 200
    negado = client_com_token.get("/api/sistema/export", headers={"Origin": "http://tauri.localhost"})
    assert negado.status_code == 401
    # sem isso o webview mostraria "network error" em vez do 401 real
    assert negado.headers.get("access-control-allow-origin") == "*"


def test_generate_token_e_unico_e_longo():
    a, b = generate_token(), generate_token()
    assert a != b
    assert len(a) >= 40


@pytest.mark.skipif(sys.platform == "win32", reason="modo POSIX não se aplica ao Windows")
def test_arquivo_do_token_e_0600(tmp_path):
    alvo = tmp_path / "backend_token.txt"
    write_token_file(alvo, "abc")
    assert alvo.read_text() == "abc"
    assert stat.S_IMODE(os.stat(alvo).st_mode) == 0o600


def test_kami_data_dir_override(tmp_path, monkeypatch):
    destino = tmp_path / "demo" / "dados"
    monkeypatch.setenv("KAMI_DATA_DIR", str(destino))
    assert get_data_dir() == destino
    assert destino.is_dir()


def test_header_constante_bate_com_o_que_o_frontend_envia():
    # o client.js envia "X-Kami-Token"; o ASGI compara em minúsculas
    assert TOKEN_HEADER == b"x-kami-token"
