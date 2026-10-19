"""
Regras gerais da API (CONF-04, docs/REGRAS-DE-NEGOCIO.md seção API).

Testes que varrem TODAS as rotas pelo esquema OpenAPI em vez de uma rota
por vez — uma rota nova que esqueça a regra quebra aqui sem ninguém
precisar lembrar de escrever o teste dela.
"""
import re

import pytest

from app.main import app

# DELETE com id que não dependem de existir algo pra responder 404 por
# outro motivo (ex.: o id é um mês, não uma entidade) — vazio por enquanto
_DELETE_SEM_ENTIDADE: set[str] = set()


def _delete_routes():
    for path, ops in app.openapi()["paths"].items():
        if "delete" in ops and "{" in path and path not in _DELETE_SEM_ENTIDADE:
            yield path


@pytest.mark.parametrize("path", sorted(_delete_routes()))
def test_api_01_apagar_o_que_nao_existe_responde_404(client, path):
    url = re.sub(r"\{[^}]+\}", "id-que-nao-existe", path)
    r = client.delete(url)
    assert r.status_code == 404, f"DELETE {path} respondeu {r.status_code}: {r.text[:120]}"
    assert r.json()["codigo"] == "nao_encontrado"
