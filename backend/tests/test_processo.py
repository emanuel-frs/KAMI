"""
O backend termina junto com o app (app/processo.py, regra SIS-09).
"""
import subprocess
import sys
import threading

from app import processo


def test_sis_09_backend_notices_when_the_app_process_is_gone(monkeypatch):
    app = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    monkeypatch.setenv(processo.APP_PID_ENV, str(app.pid))
    monkeypatch.setattr(processo, "INTERVALO_S", 0.05)
    fechou = threading.Event()

    assert processo.vigiar_o_app(ao_fechar=fechou.set) is True
    assert not fechou.wait(0.3)  # app vivo: nada acontece

    app.kill()
    app.wait()
    assert fechou.wait(5)


def test_sis_09_without_the_app_pid_there_is_nothing_to_watch(monkeypatch):
    monkeypatch.delenv(processo.APP_PID_ENV, raising=False)
    assert processo.vigiar_o_app(ao_fechar=lambda: None) is False
    monkeypatch.setenv(processo.APP_PID_ENV, "abc")
    assert processo.vigiar_o_app(ao_fechar=lambda: None) is False
