"""
Token de sessão entre o app (Tauri/frontend) e o backend local.

Por que existe: o backend escuta em 127.0.0.1, mas o CORS está aberto
(ver main.py) e qualquer página aberta no navegador consegue chamar
`http://127.0.0.1:<porta>` — inclusive GET /api/sistema/export, que
despeja todos os dados. Restringir por Origin já foi tentado e quebrou o
app (a Origin real do Tauri não bateu com a documentada), então a defesa
aqui NÃO depende de Origin: cada execução do sidecar gera um segredo
aleatório e só quem o conhece (o app, que o lê de um arquivo na pasta de
dados do usuário) consegue usar a API. Uma página web qualquer não lê
arquivos da máquina, então não tem como obter o token.

Comportamento:
- Sem `KAMI_SESSION_TOKEN` no ambiente (dev com uvicorn, testes), o
  middleware não faz nada — o fluxo de desenvolvimento continua igual.
- Com o token definido (o run_server.py sempre define), toda requisição
  precisa do header `X-Kami-Token` correto, exceto:
    * OPTIONS  — preflight de CORS não carrega headers customizados;
    * /health  — só devolve status e versão, usado pra checar se subiu.

Escrito como middleware ASGI puro (e não BaseHTTPMiddleware) pra não
interferir em streaming/exceções e continuar barato por requisição.
"""
import hmac
import json
import os
import secrets
from pathlib import Path

TOKEN_ENV_VAR = "KAMI_SESSION_TOKEN"
TOKEN_HEADER = b"x-kami-token"
TOKEN_FILE_NAME = "backend_token.txt"

_OPEN_PATHS = {"/health"}


def generate_token() -> str:
    """256 bits de entropia, seguro pra usar em header HTTP."""
    return secrets.token_urlsafe(32)


def write_token_file(path: Path, token: str) -> None:
    """
    Grava o token de forma atômica e com permissão restrita ao dono
    (0600 em Linux/macOS; no Windows, %APPDATA% já é privado do usuário
    e o os.chmod é praticamente inócuo — best effort).
    """
    tmp = path.with_name(path.name + ".tmp")
    # cria já com 0600 pra não haver janela em que o arquivo fica legível
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(token)
    os.replace(tmp, path)


class SessionTokenMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        expected = os.environ.get(TOKEN_ENV_VAR)
        if scope["type"] != "http" or not expected:
            await self.app(scope, receive, send)
            return

        if scope["method"] == "OPTIONS" or scope["path"] in _OPEN_PATHS:
            await self.app(scope, receive, send)
            return

        provided = b""
        for name, value in scope["headers"]:
            if name == TOKEN_HEADER:
                provided = value
                break

        if hmac.compare_digest(provided, expected.encode("utf-8")):
            await self.app(scope, receive, send)
            return

        body = json.dumps({"detail": "token de sessão ausente ou inválido"}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
