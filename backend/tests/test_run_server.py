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
