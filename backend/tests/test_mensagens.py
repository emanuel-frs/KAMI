"""
I18N-01: as mensagens de erro do backend e o dicionário do frontend andam
juntos (app/mensagens.py). As traduções moram só em frontend/i18n/; aqui
fica garantido que toda ErroKami tem a chave no pt.json com o MESMO texto
em português, e que os erros de ambiente (app/erros.py) têm a sua.
"""
import ast
import json
from pathlib import Path

import pytest

from app import erros

RAIZ = Path(__file__).resolve().parents[2]
PT = json.loads((RAIZ / "frontend" / "i18n" / "pt.json").read_text(encoding="utf-8"))


def _erros_kami():
    """(arquivo, linha, chave, texto) de cada `ErroKami(status, "chave", "texto", ...)` do backend."""
    achados = []
    for arquivo in (RAIZ / "backend" / "app").rglob("*.py"):
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        for no in ast.walk(arvore):
            if isinstance(no, ast.Call) and getattr(no.func, "id", None) == "ErroKami":
                chave, texto = no.args[1], no.args[2]
                assert isinstance(chave, ast.Constant) and isinstance(texto, ast.Constant), (
                    f"{arquivo.name}:{no.lineno}: chave e texto da ErroKami têm que ser literais"
                )
                achados.append((arquivo.name, no.lineno, chave.value, texto.value))
    return achados


def test_toda_erro_kami_tem_a_chave_no_pt_json_com_o_mesmo_texto():
    achados = _erros_kami()
    assert achados, "nenhuma ErroKami encontrada — o teste não está olhando o lugar certo"
    for arquivo, linha, chave, texto in achados:
        assert chave in PT, f"{arquivo}:{linha}: {chave} não está no frontend/i18n/pt.json"
        assert PT[chave] == texto, f"{arquivo}:{linha}: {chave} difere do pt.json:\n  {texto!r}\n  {PT[chave]!r}"


@pytest.mark.parametrize("codigo", ["erro_interno", "banco_ocupado", "sem_espaco", "banco_inacessivel", "banco_corrompido"])
def test_erros_de_ambiente_tem_traducao(codigo):
    assert f"erro.{codigo}" in PT


def test_erro_de_ambiente_no_pt_json_igual_ao_do_backend():
    import sqlite3

    for exc in (sqlite3.OperationalError("database is locked"), RuntimeError("x")):
        _status, codigo, texto = erros.classificar(exc)
        assert PT[f"erro.{codigo}"] == texto


def test_resposta_leva_chave_e_variaveis(client):
    resp = client.post("/api/backups/restaurar", json={"nome": "x.db", "confirmation": "errado"})
    assert resp.status_code == 422
    corpo = resp.json()
    assert corpo["chave"] == "erro.confirmacao_invalida"
    assert corpo["vars"] == {"palavra": "restaurar"}
    assert corpo["detail"] == "confirmação inválida; envie confirmation='restaurar' pra prosseguir"
    # HTTPException comum (ainda não convertida) segue sem chave
    assert "chave" not in client.get("/api/perfil/rota-que-nao-existe").json()
