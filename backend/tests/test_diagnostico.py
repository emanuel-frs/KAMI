"""
"Copiar diagnóstico" (CONF-06, docs/REGRAS-DE-NEGOCIO.md SIS-08): texto pra
relato de problema, sem dado pessoal. A pasta de dados é sempre a
temporária do teste — nunca o log real de quem roda os testes.
"""
from pathlib import Path

import pytest

from app.routers import sistema


@pytest.fixture()
def pasta(tmp_path, monkeypatch):
    monkeypatch.setattr("app.paths.get_data_dir", lambda: tmp_path)
    return tmp_path


def test_sis_08_diagnostico_tira_dados_pessoais_do_log(client, pasta):
    (pasta / "kami-backend.log").write_text(
        "2026-10-17 10:00:00.000-03:00 INFO    [app.frontend] erro na tela financas: ana@exemplo.com\n"
        "2026-10-17 10:00:01.000-03:00 ERROR   [app.erros] #a1b2c3 POST /api/financas/transactions → 500 erro_interno\n"
        "token=ghp_abcdefghijklmnopqrstuvwxyz123456 senha: hunter2 pagou R$ 1.234,56\n"
        f"arquivo em {Path.home()}/Documentos/x.json\n",
        encoding="utf-8",
    )
    corpo = client.get("/api/sistema/diagnostico").json()
    texto = corpo["texto"]
    assert corpo["linhas_de_log"] == 4
    for vazamento in ("ana@exemplo.com", "ghp_", "hunter2", "1.234,56", str(Path.home())):
        assert vazamento not in texto, vazamento
    # o que ajuda a investigar continua
    assert "#a1b2c3 POST /api/financas/transactions" in texto
    assert texto.startswith("Kami v")
    assert "~/Documentos/x.json" in texto


def test_sis_08_diagnostico_so_traz_o_fim_do_log(client, pasta):
    linhas = [f"linha {i}" for i in range(250)]
    (pasta / "kami-backend.log").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    corpo = client.get("/api/sistema/diagnostico").json()
    assert corpo["linhas_de_log"] == sistema.DIAGNOSTICO_LINHAS_LOG
    assert "linha 249" in corpo["texto"] and "linha 149\n" not in corpo["texto"]


def test_sis_08_diagnostico_sem_log_explica(client, pasta):
    corpo = client.get("/api/sistema/diagnostico").json()
    assert corpo["linhas_de_log"] == 0
    assert "sem kami-backend.log" in corpo["texto"]
