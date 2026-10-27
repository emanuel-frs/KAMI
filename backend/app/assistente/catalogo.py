"""
Provedores conhecidos (IA-01): lidos de provedores.json, que só
PRÉ-PREENCHE o formulário (nome, formato da API, URL, se precisa de
chave, links da chave e da política de dados, selo "testado"). Princípio
8: nenhum modelo listado aqui — a lista vem do /models do provedor.

Ficar num arquivo de dados é de propósito: quando um provedor mudar de
endereço depois da pausa da 2.0, a correção é trocar uma linha de JSON.
"""
import json
from functools import lru_cache
from pathlib import Path

ARQUIVO = Path(__file__).parent / "provedores.json"
OUTRO = "outro"


@lru_cache(maxsize=1)
def _carregar() -> tuple:
    dado = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    return tuple(dado["provedores"])


def listar() -> list[dict]:
    return [dict(p) for p in _carregar()]


def obter(catalogo_id: str) -> dict | None:
    return next((dict(p) for p in _carregar() if p["id"] == catalogo_id), None)
