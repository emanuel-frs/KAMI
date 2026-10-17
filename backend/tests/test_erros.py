"""
CONF-01 — nenhum erro do backend sem aviso (app/erros.py).

O caso que motivou: exceção não tratada virava `500 Internal Server
Error` em texto, SEM headers CORS, e o webview mostrava "sem conexão com
o backend" com o backend vivo. Os testes usam a app real (pilha completa:
CORS → token → erros) e fazem o get_db lançar a exceção.
"""
import logging
import re
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.routers import sistema

ORIGIN = {"Origin": "http://tauri.localhost"}


class _Captura(logging.Handler):
    """O logger "app" não propaga pro root (app/logs.py), então o caplog não vê."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


@pytest.fixture()
def log_app():
    handler = _Captura()
    logging.getLogger("app").addHandler(handler)
    yield handler.records
    logging.getLogger("app").removeHandler(handler)


@pytest.fixture()
def client_quebrado(initialized_db):
    """TestClient em que toda rota com banco lança a exceção configurada."""
    estado = {"exc": RuntimeError("explodiu")}

    def _get_db_quebrado():
        raise estado["exc"]
        yield  # pragma: no cover — vira gerador como o get_db real

    app.dependency_overrides[database.get_db] = _get_db_quebrado
    with TestClient(app) as c:
        yield c, estado
    app.dependency_overrides.clear()


def test_erro_inesperado_vira_json_com_codigo_e_cors(client_quebrado, log_app):
    c, _ = client_quebrado
    r = c.get("/api/perfil", headers=ORIGIN)

    assert r.status_code == 500
    # o ponto principal: com CORS o webview entrega o erro à tela
    assert r.headers.get("access-control-allow-origin") == "*"
    body = r.json()
    assert body["codigo"] == "erro_interno"
    assert re.fullmatch(r"[0-9a-f]{6}", body["id"])
    assert f"#{body['id']}" in body["detail"]

    # e o MESMO código aparece no log, com o traceback
    registro = next(r for r in log_app if r.name == "app.erros")
    assert f"#{body['id']}" in registro.getMessage()
    assert "GET /api/perfil" in registro.getMessage()
    assert registro.exc_info and "explodiu" in str(registro.exc_info[1])


@pytest.mark.parametrize(
    "exc, status, codigo, trecho",
    [
        (sqlite3.OperationalError("database is locked"), 503, "banco_ocupado", "ocupado"),
        (sqlite3.OperationalError("database or disk is full"), 507, "sem_espaco", "espaço em disco"),
        (sqlite3.OperationalError("disk I/O error"), 500, "banco_inacessivel", "pasta de dados"),
        (sqlite3.DatabaseError("database disk image is malformed"), 500, "banco_corrompido", "backup"),
    ],
)
def test_erros_do_sqlite_tem_mensagem_propria(client_quebrado, exc, status, codigo, trecho):
    c, estado = client_quebrado
    estado["exc"] = exc
    r = c.get("/api/perfil", headers=ORIGIN)
    assert r.status_code == status
    assert r.json()["codigo"] == codigo
    assert trecho in r.json()["detail"]
    assert r.headers.get("access-control-allow-origin") == "*"


def test_erros_esperados_ganham_codigo_e_mantem_a_mensagem(client):
    r = client.get("/api/rota-que-nao-existe")
    assert r.status_code == 404
    assert r.json()["codigo"] == "nao_encontrado"

    r = client.post("/api/financas/transactions", json={"amount": 0})
    assert r.status_code == 422
    assert r.json()["codigo"] == "validacao"
    assert isinstance(r.json()["detail"], str)


def test_query_string_nao_vai_pro_log_do_erro(client_quebrado, log_app):
    c, _ = client_quebrado
    c.get("/api/perfil?busca=meu+segredo")
    msg = next(r for r in log_app if r.name == "app.erros").getMessage()
    assert "segredo" not in msg and "busca" not in msg


# ── erros de JavaScript da tela → log ─────────────────────────────────────


def test_erro_do_frontend_vai_pro_log(client, log_app, monkeypatch):
    monkeypatch.setattr(sistema, "_frontend_errors_logged", 0)
    r = client.post(
        "/api/sistema/erro-frontend",
        json={"tipo": "erro", "mensagem": "x is undefined", "origem": "js/widgets/log.js", "linha": 42, "coluna": 7, "tela": "nucleo"},
    )
    assert r.status_code == 204
    msg = next(r for r in log_app if r.name == "app.frontend").getMessage()
    assert msg == "erro na tela nucleo: x is undefined (js/widgets/log.js:42:7)"


def test_erro_do_frontend_tem_limite_por_execucao(client, log_app, monkeypatch):
    monkeypatch.setattr(sistema, "_frontend_errors_logged", sistema.FRONTEND_ERRORS_MAX - 1)
    for _ in range(5):
        client.post("/api/sistema/erro-frontend", json={"mensagem": "loop"})
    registros = [r.getMessage() for r in log_app if r.name == "app.frontend"]
    # 1 erro que ainda cabia + o aviso de limite; os outros 4 descartados
    assert len(registros) == 2
    assert "limite" in registros[-1]


def test_erro_do_frontend_rejeita_campo_gigante(client):
    r = client.post("/api/sistema/erro-frontend", json={"mensagem": "x" * 5000})
    assert r.status_code == 422
