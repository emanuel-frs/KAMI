"""
Fonte de verdade da versão do Kami, do lado do backend (decisão de
versionamento).

Como não existe package.json no projeto, a versão vive num único
arquivo de texto simples, `VERSION`, na raiz do repositório — e tudo
mais (backend, frontend, instalador do Tauri) lê a partir dali.
Mudar de versão = editar esse arquivo em um lugar só.

Resolução do caminho segue o mesmo padrão de paths.py:
- Dev (uvicorn rodado de dentro de backend/): sobe 3 níveis a partir
  deste arquivo (app/version.py -> app/ -> backend/ -> raiz do repo)
  até achar VERSION.
- Frozen (sidecar do Tauri, empacotado via PyInstaller): o arquivo é
  embutido como recurso pelo kami-backend.spec (ver `datas=`) e mora
  em sys._MEIPASS, na raiz do bundle extraído.
"""
import sys
from pathlib import Path

_FALLBACK_VERSION = "0.0.0-dev"


def _read_version() -> str:
    if getattr(sys, "frozen", False):
        version_file = Path(sys._MEIPASS) / "VERSION"
    else:
        version_file = Path(__file__).resolve().parent.parent.parent / "VERSION"

    try:
        return version_file.read_text(encoding="utf-8").strip()
    except OSError:
        # não deixa o backend inteiro cair só por causa da versão —
        # loga via fallback óbvio, fácil de notar num bug report
        return _FALLBACK_VERSION


KAMI_VERSION = _read_version()
