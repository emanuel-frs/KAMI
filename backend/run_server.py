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

Porta: por padrão, deixa o SO escolher uma porta
livre em vez de fixar 8000 — o app roda 100% local (nada externo
depende de uma porta previsível), então isso elimina o risco de a
porta 8000 já estar ocupada por outro processo na máquina do usuário.
A porta escolhida é gravada em `<data_dir>/backend_port.txt` (mesma
pasta de dados de app/paths.py, então funciona tanto em dev quanto
congelado) — o lado Rust do Tauri lê esse arquivo depois de subir o
sidecar e expõe a porta pro frontend via um comando Tauri (ver
`get_backend_port` em src-tauri/src/main.rs).

Uso direto (sem empacotar, só pra testar este entrypoint específico):

    python run_server.py          # porta livre escolhida pelo SO
    python run_server.py 8000     # força uma porta específica (debug)
"""
import socket
import sys

import uvicorn

from app.main import app
from app.paths import get_data_dir

PORT_FILE_NAME = "backend_port.txt"


def _bind_socket(port: int | None) -> socket.socket:
    """
    Cria e faz bind do socket de escuta antes de entregar pro uvicorn —
    é a única forma de saber qual porta o SO escolheu (port=0) antes do
    servidor efetivamente subir, pra gravar no port file logo em
    seguida (o frontend/Tauri não pode esperar o servidor "terminar de
    subir" pra descobrir a porta).
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port or 0))
    sock.listen(100)
    return sock


def _write_port_file(port: int) -> None:
    port_file = get_data_dir() / PORT_FILE_NAME
    port_file.write_text(str(port), encoding="utf-8")


def main() -> None:
    requested_port = None
    if len(sys.argv) > 1:
        try:
            requested_port = int(sys.argv[1])
        except ValueError:
            print(
                f"Porta inválida: {sys.argv[1]!r}, deixando o SO escolher uma livre",
                file=sys.stderr,
            )

    sock = _bind_socket(requested_port)
    actual_port = sock.getsockname()[1]
    _write_port_file(actual_port)
    print(
        f"Kami backend ouvindo em 127.0.0.1:{actual_port} "
        f"(porta salva em {get_data_dir() / PORT_FILE_NAME})"
    )

    config = uvicorn.Config(app, log_level="info")
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()