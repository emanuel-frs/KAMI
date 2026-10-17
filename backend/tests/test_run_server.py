"""
Testes do entrypoint do sidecar (run_server.py).

Cobrem os dois pontos que quebraram o app no Windows:
  1. sys.stdout/sys.stderr = None (PyInstaller com console=False) —
     o uvicorn não conseguia configurar o logging e o backend morria
     em silêncio;
  2. a porta era publicada ANTES do servidor estar de pé, então o
     frontend conectava num processo já morto.
"""
import io
import sys
import threading
import time
import types

import pytest

import run_server


def test_tee_ignora_streams_none_e_diz_que_nao_e_tty():
    buf = io.StringIO()
    tee = run_server._Tee(None, buf)

    assert tee.write("olá") == 3
    tee.flush()

    assert buf.getvalue() == "olá"
    # uvicorn chama sys.stderr.isatty() ao configurar o formatter — era
    # justamente isso que estourava quando sys.stderr era None
    assert tee.isatty() is False


def test_tee_engole_erro_de_escrita_de_um_stream():
    class Quebrado:
        def write(self, _):
            raise OSError("disco cheio")

        def flush(self):
            raise OSError("disco cheio")

    buf = io.StringIO()
    tee = run_server._Tee(Quebrado(), buf)

    tee.write("x")
    tee.flush()

    assert buf.getvalue() == "x"


def test_uvicorn_config_funciona_com_streams_espelhados(monkeypatch):
    """Reproduz o modo sem console: stdout/stderr originais são None."""
    import uvicorn
    from fastapi import FastAPI

    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", run_server._Tee(None, buf))
    monkeypatch.setattr(sys, "stderr", run_server._Tee(None, buf))

    # não pode levantar "Unable to configure formatter 'default'"
    uvicorn.Config(FastAPI(), log_level="info", use_colors=False)


def test_porta_so_e_publicada_depois_do_startup(tmp_path, monkeypatch):
    monkeypatch.setattr("app.paths.get_data_dir", lambda: tmp_path)
    server = types.SimpleNamespace(started=False, should_exit=False)
    port_file = tmp_path / run_server.PORT_FILE_NAME

    t = threading.Thread(
        target=run_server._publish_port_when_ready, args=(server, 51234), daemon=True
    )
    t.start()

    time.sleep(0.4)
    assert not port_file.exists(), "porta publicada antes do servidor subir"

    server.started = True
    t.join(timeout=3)

    assert port_file.read_text(encoding="utf-8") == "51234"
    assert not (tmp_path / (run_server.PORT_FILE_NAME + ".tmp")).exists()


def test_porta_nao_e_publicada_se_o_servidor_desiste(tmp_path, monkeypatch):
    monkeypatch.setattr("app.paths.get_data_dir", lambda: tmp_path)
    server = types.SimpleNamespace(started=False, should_exit=True)

    run_server._publish_port_when_ready(server, 51234)

    assert not (tmp_path / run_server.PORT_FILE_NAME).exists()


def test_log_em_arquivo_so_quando_congelado(tmp_path, monkeypatch):
    monkeypatch.setattr("app.paths.get_data_dir", lambda: tmp_path)

    # não congelado (dev/pytest): não mexe em nada
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert run_server._setup_file_logging() is None
    assert not (tmp_path / run_server.LOG_FILE_NAME).exists()

    # congelado: cria o log e espelha stdout/stderr nele
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    log_path = run_server._setup_file_logging()
    print("linha de teste")

    assert log_path == tmp_path / run_server.LOG_FILE_NAME
    assert "linha de teste" in log_path.read_text(encoding="utf-8")


# ── AJU-05: data e hora em toda linha do log ─────────────────────────────

STAMP = r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}"


def test_tee_com_carimbo_poe_hora_em_cada_linha_inclusive_print_em_pedacos():
    import re

    buf = io.StringIO()
    tee = run_server._Tee(None, buf, stamp=True)

    tee.write("abc")
    tee.write("def\nlinha 2\n")
    tee.write("Traceback (most recent call last):\n  File \"x.py\"\n")

    lines = buf.getvalue().splitlines()
    assert len(lines) == 4
    # o print que chegou em dois pedaços vira UMA linha com UM carimbo
    assert re.fullmatch(STAMP + r" abcdef", lines[0])
    assert all(re.match(STAMP + " ", l) for l in lines)


def test_tee_nao_carimba_duas_vezes_linha_que_ja_veio_do_logging():
    from app.logs import timestamp

    buf = io.StringIO()
    tee = run_server._Tee(None, buf, stamp=True)
    linha = f"{timestamp()} INFO    [uvicorn.error] Application startup complete.\n"

    tee.write(linha)

    assert buf.getvalue() == linha


def test_tee_devolve_o_tamanho_do_texto_original():
    # o contrato de write() é o tamanho do que FOI PEDIDO pra escrever
    tee = run_server._Tee(None, io.StringIO(), stamp=True)
    assert tee.write("olá\n") == 4


def test_log_congelado_tem_hora_no_print_e_no_uvicorn(tmp_path, monkeypatch):
    """Ponta a ponta do modo empacotado: print solto + log do uvicorn."""
    import logging
    import re

    import uvicorn
    from fastapi import FastAPI

    from app.logs import LOG_CONFIG

    monkeypatch.setattr("app.paths.get_data_dir", lambda: tmp_path)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    log_path = run_server._setup_file_logging()
    print("Kami backend v9.9.9 — carregando…")
    uvicorn.Config(FastAPI(), log_level="info", use_colors=False, log_config=LOG_CONFIG)
    logging.getLogger("uvicorn.error").info("Application startup complete.")
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", "/api/x?q=meu+salario&token=abc", "1.1", 200
    )

    content = log_path.read_text(encoding="utf-8")
    body = [l for l in content.splitlines() if l and not l.startswith("=====")]
    assert body, content
    assert all(re.match(STAMP + " ", l) for l in body), content
    assert re.search(STAMP + r" INFO    \[uvicorn.error\] Application startup complete\.", content)
    # access log: sem query string (busca/segredo não vão pro disco)
    assert "127.0.0.1:5000 GET /api/x 200" in content
    assert "salario" not in content and "token=abc" not in content
    # cabeçalho da sessão também com o mesmo formato de hora
    assert re.search(r"===== Kami backend iniciando em " + STAMP, content)
