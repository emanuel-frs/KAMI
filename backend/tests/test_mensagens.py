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


def _chamadas(classe, posicao):
    """(arquivo, linha, chave, texto) de cada `classe(...)` do backend — chave e texto a partir de `posicao`."""
    achados = []
    for arquivo in (RAIZ / "backend" / "app").rglob("*.py"):
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        for no in ast.walk(arvore):
            if isinstance(no, ast.Call) and getattr(no.func, "id", None) == classe:
                chave, texto = no.args[posicao], no.args[posicao + 1]
                assert isinstance(chave, ast.Constant) and isinstance(texto, ast.Constant), (
                    f"{arquivo.name}:{no.lineno}: chave e texto da {classe} têm que ser literais"
                )
                achados.append((arquivo.name, no.lineno, chave.value, texto.value))
    return achados


def _erros_kami():
    return _chamadas("ErroKami", 1)


def test_toda_erro_kami_tem_a_chave_no_pt_json_com_o_mesmo_texto():
    achados = _erros_kami()
    assert achados, "nenhuma ErroKami encontrada — o teste não está olhando o lugar certo"
    for arquivo, linha, chave, texto in achados:
        assert chave in PT, f"{arquivo}:{linha}: {chave} não está no frontend/i18n/pt.json"
        assert PT[chave] == texto, f"{arquivo}:{linha}: {chave} difere do pt.json:\n  {texto!r}\n  {PT[chave]!r}"


def test_todo_texto_gravado_tem_a_chave_no_pt_json_com_o_mesmo_texto():
    """Texto (registro de atividade, lançamento automático): mesma regra da ErroKami."""
    achados = _chamadas("Texto", 0)
    assert len(achados) > 30, "poucos Texto encontrados — o teste não está olhando o lugar certo"
    for arquivo, linha, chave, texto in achados:
        assert chave in PT, f"{arquivo}:{linha}: {chave} não está no frontend/i18n/pt.json"
        assert PT[chave] == texto, f"{arquivo}:{linha}: {chave} difere do pt.json:\n  {texto!r}\n  {PT[chave]!r}"


def test_texto_grava_chave_e_variaveis(client):
    """O Texto continua sendo o português; o log guarda a chave e o nome, e a API devolve os dois."""
    from app.mensagens import Texto, colunas_do_texto

    t = Texto("log.conta_fixa.paga", "pagou conta fixa: {nome}", nome="aluguel {x}")
    assert t == "pagou conta fixa: aluguel {x}"  # continua sendo o texto em português
    assert colunas_do_texto(t) == ("log.conta_fixa.paga", '{"nome": "aluguel {x}"}')
    assert colunas_do_texto("texto da pessoa") == (None, None)
    assert colunas_do_texto(Texto("log.bonus.primeira", "bônus · primeira ação do dia")) == ("log.bonus.primeira", None)

    client.post("/api/nucleo/actions", json={"description": "li um capítulo", "categories": ["aprendizado"], "xp": 5})
    client.post("/api/organizacao/links", json={"title": "docs {kami}", "url": "https://a.com", "category": "c"})
    por_texto = {e["description"]: e for e in client.get("/api/nucleo/log").json()}
    da_pessoa, do_sistema = por_texto["li um capítulo"], por_texto["adicionou link: docs {kami}"]
    assert (da_pessoa["description_key"], da_pessoa["description_vars"]) == (None, {})
    assert (do_sistema["description_key"], do_sistema["description_vars"]) == ("log.link.adicionou", {"titulo": "docs {kami}"})


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
