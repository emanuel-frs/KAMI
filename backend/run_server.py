"""
Ponto de entrada do backend empacotado (PyInstaller + sidecar do
Tauri, decisão 19).

Em dev, o backend continua rodando exatamente como sempre:

    uvicorn app.main:app --reload --port 8000

Isso NÃO funciona dentro de um binário congelado — `--reload` depende
de observar o arquivo-fonte em disco do jeito que o watcher do uvicorn
espera, o que não existe mais depois que o código foi empacotado.
Este script chama uvicorn.run() programaticamente, sem reload, e é o
alvo que o PyInstaller compila (ver kami-backend.spec).

Uso direto (sem empacotar, só pra testar este entrypoint específico):

    python run_server.py [porta]
"""
import sys

import uvicorn

from app.main import app

DEFAULT_PORT = 8000


def main() -> None:
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Porta inválida: {sys.argv[1]!r}, usando {DEFAULT_PORT}", file=sys.stderr)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
