"""
Formato do log do backend: toda linha começa com a data e a hora (AJU-05).

Por que existe: o `kami-backend.log` saía no formato padrão do uvicorn
(`INFO:     127.0.0.1:5123 - "GET /api/... HTTP/1.1" 200`), sem hora —
só o cabeçalho de cada sessão (`===== Kami backend iniciando em ...`,
run_server.py) dizia QUANDO o processo subiu. Com o app aberto o dia
inteiro, era impossível saber em que momento um erro aconteceu, ou
cruzar o log com o que o usuário estava fazendo.

Formato de cada linha:

    2026-10-16 14:03:22.481-03:00 INFO    [uvicorn.access] GET /api/financas/resumo 200

- hora LOCAL com offset (mesma convenção do `now_iso()` do banco, ver
  database.py) e milissegundos, pra ordenar rajadas de requisições;
- nível alinhado e o nome do logger entre colchetes (uvicorn.error,
  uvicorn.access, app.routers.sistema...).

Onde é aplicado:
- `LOG_CONFIG` vai no `uvicorn.Config(log_config=...)` do run_server.py
  (app empacotado) e `configure_logging()` é chamado no import de
  app/main.py — este segundo cobre o modo dev (`uvicorn app.main:app`),
  em que o uvicorn configura o log dele ANTES de importar o app;
- linhas que não passam pelo logging (print, traceback.print_exc) ganham
  o mesmo carimbo no `_Tee` do run_server.py via `stamp_lines`.

Privacidade: o access log NÃO grava a query string (`?q=...`). Busca,
filtros e qualquer parâmetro que um dia carregue algo pessoal ou secreto
ficariam gravados em texto puro no disco — o caminho já basta pra
diagnosticar. O header X-Kami-Token nunca é impresso por ninguém (o
uvicorn não loga headers).
"""
import logging
import logging.config
import re
from datetime import datetime

# começo de linha que já tem carimbo — evita carimbar duas vezes quando
# uma linha formatada pelo logging passa de novo pelo _Tee
_STAMPED = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def timestamp(now: datetime | None = None) -> str:
    """`2026-10-16 14:03:22.481-03:00` — local, com milissegundos e offset."""
    now = (now or datetime.now()).astimezone()
    offset = now.strftime("%z")  # -0300
    offset = f"{offset[:3]}:{offset[3:]}" if offset else ""
    return f"{now.strftime('%Y-%m-%d %H:%M:%S')}.{now.microsecond // 1000:03d}{offset}"


class KamiFormatter(logging.Formatter):
    """Carimbo de data/hora + nível + logger em toda linha do log."""

    def __init__(self, *args, use_colors=None, **kwargs):
        # o uvicorn injeta `use_colors` nos formatters "default"/"access"
        # do log_config (uvicorn/config.py) — o log é texto puro, ignora
        super().__init__(*args, **kwargs)

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            message = f"{message}\n{record.exc_text}"
        if record.stack_info:
            message = f"{message}\n{self.formatStack(record.stack_info)}"
        stamp = timestamp(datetime.fromtimestamp(record.created))
        return f"{stamp} {record.levelname:<7} [{record.name}] {message}"


class AccessFormatter(KamiFormatter):
    """
    Linha do uvicorn.access sem a query string e sem o "HTTP/1.1":
    `127.0.0.1:5123 GET /api/x 200`. Os argumentos do record do uvicorn
    são (client_addr, method, full_path, http_version, status_code).
    """

    def format(self, record: logging.LogRecord) -> str:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5:
            client, method, path, _version, status = args
            path = str(path).split("?", 1)[0]
            record = logging.makeLogRecord(
                {**record.__dict__, "msg": "%s %s %s %s", "args": (client, method, path, status)}
            )
        return super().format(record)


LOG_CONFIG: dict = {
    "version": 1,
    # não desligar os loggers que já existem (ex.: app.routers.sistema,
    # criado no import antes desta config ser aplicada)
    "disable_existing_loggers": False,
    # os nomes "default" e "access" são obrigatórios: o uvicorn.Config
    # escreve `use_colors` exatamente nessas duas chaves do dict
    "formatters": {
        "default": {"()": "app.logs.KamiFormatter"},
        "access": {"()": "app.logs.AccessFormatter"},
    },
    "handlers": {
        # ext:// resolve o stream NA HORA de aplicar a config — no app
        # empacotado, sys.stderr/stdout já são o _Tee que espelha no arquivo
        "default": {"class": "logging.StreamHandler", "formatter": "default", "stream": "ext://sys.stderr"},
        "access": {"class": "logging.StreamHandler", "formatter": "access", "stream": "ext://sys.stdout"},
    },
    "loggers": {
        "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"level": "INFO"},
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
        "app": {"handlers": ["default"], "level": "INFO", "propagate": False},
    },
}


def configure_logging() -> None:
    """Aplica LOG_CONFIG. Idempotente — pode rodar mais de uma vez."""
    logging.config.dictConfig(LOG_CONFIG)


def stamp_lines(text: str, at_line_start: bool) -> tuple[str, bool]:
    """
    Põe o carimbo no começo de cada linha de `text` que ainda não tiver
    um. `at_line_start` diz se a escrita anterior terminou em "\\n" (um
    print pode chegar em pedaços: "abc" e depois "def\\n" são uma linha
    só). Devolve o texto carimbado e se ele termina no fim de uma linha.
    """
    if not text:
        return text, at_line_start
    out = []
    for piece in text.splitlines(keepends=True):
        if at_line_start and piece.strip() and not _STAMPED.match(piece):
            piece = f"{timestamp()} {piece}"
        out.append(piece)
        at_line_start = piece.endswith("\n")
    return "".join(out), at_line_start
