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

Porta: por padrão, deixa o SO escolher uma porta livre em vez de fixar
8000 — o app roda 100% local, então isso elimina o risco de a porta
8000 já estar ocupada por outro processo na máquina do usuário. A
porta escolhida é gravada em `<data_dir>/backend_port.txt` (mesma
pasta de dados de app/paths.py) — o lado Rust do Tauri lê esse
arquivo e expõe a porta pro frontend via `get_backend_port` (ver
src-tauri/src/main.rs).

IMPORTANTE — o port file só é gravado DEPOIS que o servidor terminou de
subir de verdade (init_db incluso). Antes, ele era gravado logo após o
bind do socket: se qualquer coisa quebrasse na sequência (ex.: o
uvicorn não conseguir configurar o log), o Tauri lia uma porta válida e
o frontend conectava num processo que já tinha morrido — o app abria,
mas nenhum widget carregava. Agora, se o backend não sobe, o arquivo
simplesmente não aparece e o Tauri consegue reportar o erro.

Log em arquivo (só quando congelado): em Windows, o sidecar é compilado
sem console (`console=False`), e nesse modo `sys.stdout`/`sys.stderr`
são `None` — o uvicorn quebra ao configurar o logging
("Unable to configure formatter 'default'") e ninguém vê o erro. Aqui
stdout/stderr passam a ser espelhados em `<data_dir>/kami-backend.log`
(com o stream original também, quando existe), então qualquer falha
deixa rastro.

Uso direto (sem empacotar, só pra testar este entrypoint específico):

    python run_server.py          # porta livre escolhida pelo SO
    python run_server.py 8000     # força uma porta específica (debug)
"""
import os
import socket
import sys
import threading
import time
import traceback

PORT_FILE_NAME = "backend_port.txt"
LOG_FILE_NAME = "kami-backend.log"
TOKEN_FILE_NAME = "backend_token.txt"  # igual a app.security.TOKEN_FILE_NAME e ao main.rs
LOG_MAX_BYTES = 1_000_000  # acima disso, o log atual vira kami-backend.log.old
PORT_PUBLISH_TIMEOUT_S = 120


class _Tee:
    """
    Espelha escritas em vários streams, ignorando os que forem None e
    engolindo erros de escrita (log nunca pode derrubar o backend).
    Expõe o mínimo que o logging/uvicorn esperam de um stream de texto
    (`isatty()` em especial — é o que quebra quando sys.stderr é None).
    """

    encoding = "utf-8"
    errors = "replace"

    def __init__(self, *streams):
        self._streams = [s for s in streams if s is not None]

    def write(self, data):
        for stream in self._streams:
            try:
                stream.write(data)
            except Exception:
                pass
        return len(data)

    def flush(self):
        for stream in self._streams:
            try:
                stream.flush()
            except Exception:
                pass

    def isatty(self):
        return False

    def writable(self):
        return True


def _setup_file_logging():
    """
    Espelha stdout/stderr em <data_dir>/kami-backend.log quando rodando
    congelado. Em dev (uvicorn/python direto) não faz nada. Devolve o
    caminho do log, ou None se não foi possível.
    """
    if not getattr(sys, "frozen", False):
        return None
    try:
        from app.paths import get_data_dir

        log_path = get_data_dir() / LOG_FILE_NAME
        try:
            if log_path.exists() and log_path.stat().st_size > LOG_MAX_BYTES:
                os.replace(log_path, log_path.with_name(LOG_FILE_NAME + ".old"))
        except OSError:
            pass

        log_file = open(log_path, "a", encoding="utf-8", errors="replace", buffering=1)
        log_file.write(
            f"\n===== Kami backend iniciando em {time.strftime('%Y-%m-%d %H:%M:%S')} "
            f"(pid {os.getpid()}, python {sys.version.split()[0]}, {sys.platform}) =====\n"
        )
        sys.stdout = _Tee(sys.stdout, log_file)
        sys.stderr = _Tee(sys.stderr, log_file)
        return log_path
    except Exception:
        return None


def _bind_socket(port: int | None) -> socket.socket:
    """
    Cria e faz bind do socket de escuta antes de entregar pro uvicorn —
    é a única forma de saber qual porta o SO escolheu (port=0) antes do
    servidor efetivamente subir.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port or 0))
    sock.listen(100)
    return sock


def _port_file_path():
    from app.paths import get_data_dir

    return get_data_dir() / PORT_FILE_NAME


def _token_file_path():
    from app.paths import get_data_dir

    return get_data_dir() / TOKEN_FILE_NAME


def _write_port_file(port: int) -> None:
    # escrita atômica: o Rust nunca lê um arquivo pela metade
    port_file = _port_file_path()
    tmp = port_file.with_name(PORT_FILE_NAME + ".tmp")
    tmp.write_text(str(port), encoding="utf-8")
    os.replace(tmp, port_file)


def _publish_port_when_ready(server, port: int) -> None:
    """
    Espera o uvicorn terminar o startup (bind + lifespan, ou seja,
    init_db já rodou sem erro) e só então publica a porta.
    """
    deadline = time.monotonic() + PORT_PUBLISH_TIMEOUT_S
    while time.monotonic() < deadline:
        if server.started:
            _write_port_file(port)
            print(f"Kami backend pronto em 127.0.0.1:{port} (porta salva em {_port_file_path()})", flush=True)
            return
        if server.should_exit:
            return
        time.sleep(0.1)
    print("timeout esperando o backend terminar de subir — porta NÃO publicada", file=sys.stderr, flush=True)


def _run() -> None:
    # imports pesados ficam aqui dentro (e não no topo do módulo) pra que
    # uma falha de import também caia no try/except de main() e seja logada
    import uvicorn

    from app.main import app
    from app.security import TOKEN_ENV_VAR, generate_token, write_token_file
    from app.version import KAMI_VERSION

    print(f"Kami backend v{KAMI_VERSION} — carregando…", flush=True)

    requested_port = None
    if len(sys.argv) > 1:
        try:
            requested_port = int(sys.argv[1])
        except ValueError:
            print(
                f"Porta inválida: {sys.argv[1]!r}, deixando o SO escolher uma livre",
                file=sys.stderr,
            )

    # apaga um port file de uma execução anterior — sem isso o Tauri
    # poderia ler uma porta velha enquanto este processo ainda sobe
    try:
        _port_file_path().unlink()
    except FileNotFoundError:
        pass

    # token de sessão (ver app/security.py): gerado a cada execução,
    # exposto ao middleware via variável de ambiente e gravado num arquivo
    # 0600 pro Tauri repassar ao frontend. Gravado ANTES da porta ser
    # publicada, então quem já leu a porta sempre encontra o token.
    try:
        _token_file_path().unlink()
    except FileNotFoundError:
        pass
    session_token = generate_token()
    os.environ[TOKEN_ENV_VAR] = session_token
    write_token_file(_token_file_path(), session_token)

    sock = _bind_socket(requested_port)
    actual_port = sock.getsockname()[1]

    config = uvicorn.Config(app, log_level="info", use_colors=False)
    server = uvicorn.Server(config)

    threading.Thread(
        target=_publish_port_when_ready,
        args=(server, actual_port),
        daemon=True,
    ).start()

    server.run(sockets=[sock])


def main() -> None:
    _setup_file_logging()
    try:
        _run()
    except SystemExit:
        raise
    except BaseException:
        traceback.print_exc()
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
