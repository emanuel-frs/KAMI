"""Formato do log do backend (AJU-05, app/logs.py)."""
import logging
import re
from datetime import datetime, timedelta, timezone

from app.logs import AccessFormatter, KamiFormatter, stamp_lines, timestamp


def test_timestamp_tem_milissegundos_e_offset_local():
    fuso = timezone(timedelta(hours=-3))
    assert timestamp(datetime(2026, 10, 16, 14, 3, 22, 481999, tzinfo=fuso)) == "2026-10-16 14:03:22.481-03:00"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}", timestamp())


def _record(name, msg, args=(), exc_info=None):
    return logging.LogRecord(name, logging.ERROR if exc_info else logging.INFO, __file__, 1, msg, args, exc_info)


def test_formatter_poe_hora_nivel_e_logger():
    line = KamiFormatter().format(_record("app.routers.sistema", "importou %d linhas", (3,)))
    assert re.fullmatch(r"\S+ \S+ INFO    \[app\.routers\.sistema\] importou 3 linhas", line)


def test_formatter_inclui_traceback():
    try:
        raise ValueError("quebrou")
    except ValueError:
        import sys

        line = KamiFormatter().format(_record("app", "falha ao importar backup", exc_info=sys.exc_info()))
    assert "falha ao importar backup\nTraceback" in line
    assert "ValueError: quebrou" in line


def test_access_log_sem_query_string():
    rec = _record("uvicorn.access", '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:5000", "GET", "/api/busca?q=segredo", "1.1", 200))
    line = AccessFormatter().format(rec)
    assert line.endswith("[uvicorn.access] 127.0.0.1:5000 GET /api/busca 200")
    assert "segredo" not in line


def test_access_log_com_formato_inesperado_nao_quebra():
    # se o uvicorn mudar os argumentos, cai no formato comum em vez de explodir
    line = AccessFormatter().format(_record("uvicorn.access", "algo %s", ("x",)))
    assert line.endswith("[uvicorn.access] algo x")


def test_stamp_lines_ignora_linha_vazia_e_respeita_meio_de_linha():
    text, at_start = stamp_lines("\n", True)
    assert text == "\n" and at_start is True
    text, at_start = stamp_lines("continuação\n", False)
    assert text == "continuação\n" and at_start is True
