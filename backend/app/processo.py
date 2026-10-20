"""
O backend termina junto com o app (correção achada no SEG-02).

O sidecar é um executável PyInstaller "onefile": um bootloader que
extrai e roda o Python num processo FILHO. No Linux, o Tauri encerrava
só o bootloader (SIGKILL), e o filho — o backend de verdade — ficava
rodando órfão: cada vez que o app fechava sobrava um backend na memória,
segurando o banco. (No Windows o `taskkill /T` já matava a árvore.)

Duas camadas:
- o Rust manda SIGTERM em vez de SIGKILL no Linux, e o bootloader repassa
  pro filho, que encerra direito;
- e este vigia, pra quando o app some sem avisar (travou, foi morto,
  desligaram a máquina no meio): o Tauri passa o próprio PID em
  `KAMI_APP_PID`, e o backend encerra sozinho quando esse processo deixa
  de existir. No Windows espera no handle do processo (sem polling).
"""
import logging
import os
import sys
import threading
import time

logger = logging.getLogger(__name__)

APP_PID_ENV = "KAMI_APP_PID"
INTERVALO_S = 1.0


def _vivo_posix(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # existe, só não é nosso
    return True


def _esperar_windows(pid: int) -> None:
    import ctypes

    SYNCHRONIZE = 0x00100000
    INFINITE = 0xFFFFFFFF
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        return  # já não existe
    kernel32.WaitForSingleObject(handle, INFINITE)
    kernel32.CloseHandle(handle)


def esperar_o_app_fechar(pid: int) -> None:
    """Bloqueia até o processo `pid` não existir mais."""
    if sys.platform == "win32":
        _esperar_windows(pid)
        return
    while _vivo_posix(pid):
        time.sleep(INTERVALO_S)


def _encerrar() -> None:
    logger.info("o app fechou — encerrando o backend")
    for h in logging.getLogger().handlers:
        try:
            h.flush()
        except Exception:  # noqa: BLE001
            pass
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


def vigiar_o_app(ao_fechar=_encerrar) -> bool:
    """Liga o vigia se o Tauri passou o PID do app. Devolve se ligou."""
    valor = os.environ.get(APP_PID_ENV, "")
    if not valor.isdigit():
        return False
    pid = int(valor)

    def _rodar():
        esperar_o_app_fechar(pid)
        ao_fechar()

    threading.Thread(target=_rodar, name="vigia-do-app", daemon=True).start()
    return True
