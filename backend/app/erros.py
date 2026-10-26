"""
Nenhum erro do backend sem aviso (CONF-01).

O problema que isto resolve: uma exceção não tratada numa rota virava a
resposta padrão do Starlette — `500 Internal Server Error` em texto puro,
montada pelo ServerErrorMiddleware, que fica POR FORA do CORSMiddleware.
Resultado: a resposta saía sem os headers CORS, o webview (o frontend é
outra origem: tauri://… → http://127.0.0.1:<porta>) a bloqueava, e o
fetch falhava como erro de REDE. O usuário via "não foi possível conectar
ao backend do Kami" com o backend vivo, e o log só tinha o traceback, sem
nada que ligasse aquilo ao que apareceu na tela.

Agora:
- `ErrosInesperadosMiddleware` (ASGI puro, registrado POR DENTRO do CORS
  em main.py) pega qualquer exceção, grava no log com o traceback e um
  código curto (`#k7f2a9`) e devolve JSON — e como passa pelo CORS na
  volta, o frontend recebe o erro de verdade;
- formato único de erro em toda a API:
      {"detail": "<mensagem em português>", "codigo": "<tipo>", "id": "<código>"}
  `detail` continua sendo a mensagem (o frontend já lia esse campo);
  `codigo` diz o tipo (erro_interno, banco_ocupado, sem_espaco,
  banco_corrompido, validacao, nao_encontrado, ...); `id` só existe em
  erro inesperado — é o que liga o aviso da tela à linha do log;
- erros do SQLite que o usuário consegue resolver ganham mensagem própria.

Erros ESPERADOS (HTTPException das rotas, validação) continuam com o
status e a mensagem de cada rota; só ganham o campo `codigo`.
"""
import logging
import secrets
import sqlite3

from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger("app.erros")

# status HTTP → código do tipo de erro (erros esperados, lançados pelas rotas)
_CODIGO_POR_STATUS = {
    400: "invalido",
    401: "nao_autorizado",
    403: "proibido",
    404: "nao_encontrado",
    409: "conflito",
    413: "grande_demais",
    422: "validacao",
    429: "muitas_requisicoes",
}


def codigo_por_status(status: int) -> str:
    if status >= 500:
        return "erro_interno"
    return _CODIGO_POR_STATUS.get(status, "erro")


def novo_id_erro() -> str:
    """6 caracteres hexadecimais — curto pra ditar/copiar, único o bastante pra achar no log."""
    return secrets.token_hex(3)


def classificar(exc: BaseException) -> tuple[int, str, str]:
    """
    (status, codigo, mensagem) pra uma exceção inesperada. Os casos do
    SQLite que a pessoa consegue resolver sozinha ganham mensagem própria;
    o resto é "erro interno" genérico.
    """
    if isinstance(exc, sqlite3.OperationalError):
        texto = str(exc).lower()
        if "locked" in texto or "busy" in texto:
            return 503, "banco_ocupado", (
                "o banco de dados está ocupado por outro processo — tente de novo em instantes"
            )
        if "disk is full" in texto or "database or disk is full" in texto:
            return 507, "sem_espaco", "sem espaço em disco para salvar — libere espaço e tente de novo"
        if "disk i/o error" in texto or "unable to open" in texto:
            return 500, "banco_inacessivel", (
                "não foi possível ler ou gravar o banco de dados — confira se a pasta de dados do Kami "
                "está acessível (disco desconectado, permissão ou antivírus)"
            )
    if isinstance(exc, sqlite3.DatabaseError) and "malformed" in str(exc).lower():
        return 500, "banco_corrompido", (
            "o banco de dados parece corrompido — restaure um backup em configurações › backup e dados"
        )
    return 500, "erro_interno", "algo deu errado no Kami ao processar esta ação"


def corpo_erro(detail: str, codigo: str, error_id: str | None = None) -> dict:
    body = {"detail": detail, "codigo": codigo}
    if error_id:
        body["id"] = error_id
    return body


def http_exception_handler(request, exc: HTTPException):
    """
    HTTPException das rotas (e o 404 de rota inexistente, que o Starlette
    lança com a classe base): mesma resposta de antes + `codigo`.
    """
    content = {"detail": exc.detail, "codigo": codigo_por_status(exc.status_code)}
    # I18N-01: mensagem traduzível (app/mensagens.py) — o frontend mostra
    # t(chave, vars) no idioma da pessoa; `detail` segue em português
    if getattr(exc, "chave", None):
        content["chave"] = exc.chave
        content["vars"] = exc.vars
    return JSONResponse(status_code=exc.status_code, content=content, headers=getattr(exc, "headers", None))


class ErrosInesperadosMiddleware:
    """
    Rede de segurança pra exceções que escapam das rotas. Escrito como
    ASGI puro (igual SessionTokenMiddleware) pra não interferir em
    streaming e pra ficar dentro do CORS. Se a resposta já tinha começado
    a ser enviada quando a exceção aconteceu, não dá pra trocar por JSON:
    só registra e deixa a conexão cair (o cliente vê erro de rede).
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def send_tracking(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception as exc:  # noqa: BLE001 — é exatamente o ponto: pegar tudo
            error_id = novo_id_erro()
            status, codigo, detail = classificar(exc)
            # só o caminho, sem query string (mesma regra do access log, app/logs.py)
            logger.error(
                "#%s %s %s → %d %s", error_id, scope.get("method"), scope.get("path"), status, codigo,
                exc_info=exc,
            )
            if started:
                raise
            response = JSONResponse(
                status_code=status,
                content=corpo_erro(f"{detail} (código #{error_id})", codigo, error_id),
            )
            await response(scope, receive, send)
