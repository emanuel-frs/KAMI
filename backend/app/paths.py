"""
Diretório de dados persistentes do usuário (decisão 19 — sidecar).

Por que este módulo existe: `kami.db` e `.secret_key` sempre foram
resolvidos como `Path(__file__).parent.parent` (ver database.py e
crypto.py originais) — o que funciona em dev (`uvicorn` rodado de
dentro de `backend/`), mas quebra quando o backend vira um binário
empacotado via PyInstaller (fase 15.8):

- Em modo --onefile, o executável se extrai pra uma pasta temporária
  (`sys._MEIPASS`) a cada execução e apaga essa pasta ao sair. Se
  kami.db e .secret_key morarem "do lado" desse diretório temporário,
  o app perderia TODOS os dados (e a chave de criptografia das senhas
  de e-mail) a cada vez que fosse fechado e reaberto.

A partir desta fase, os dois passam a morar numa pasta de dados de
usuário de verdade, fora do bundle — só quando `sys.frozen` (ou seja,
só quando rodando como sidecar; em dev continua tudo dentro de
backend/, sem mudança de comportamento nenhuma).

NOTA: caminho do Windows/macOS escrito por inferência das convenções
usuais de cada SO (%APPDATA% / ~/Library/Application Support) — a
fase 15.8 prioriza Linux primeiro (decisão 26), então só o ramo Linux
foi de fato validado até agora. Vale testar os outros dois ramos
quando o empacotamento pra Windows entrar de verdade.
"""
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).parent
BACKEND_DIR = APP_DIR.parent  # dev: pasta backend/, ao lado do código


def get_data_dir() -> Path:
    """
    Retorna a pasta onde kami.db e .secret_key devem morar.

    Dev (uvicorn direto): backend/, como sempre foi.
    Frozen (sidecar do Tauri): pasta de dados do usuário, persistente
    entre execuções, fora do diretório temporário do PyInstaller.
    """
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            base = Path(os.environ.get("APPDATA", Path.home()))
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(
                os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")
            )
        data_dir = base / "kami"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    return BACKEND_DIR
