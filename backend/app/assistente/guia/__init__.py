"""
Guia do Kami pro assistente (IA-03, P-114): guia.md, uma seção `## tópico`
por assunto. A ferramenta `kami_guide` devolve a seção pedida — o modelo
explica o app a partir daqui em vez de adivinhar (na F2, um modelo bom
inventou como as missões funcionam).

Em português; o modelo responde no idioma da pessoa.
"""
from functools import lru_cache
from pathlib import Path

ARQUIVO = Path(__file__).parent / "guia.md"


@lru_cache(maxsize=1)
def _secoes() -> dict[str, str]:
    secoes, atual, linhas = {}, None, []
    for linha in ARQUIVO.read_text(encoding="utf-8").splitlines():
        if linha.startswith("## "):
            if atual:
                secoes[atual] = "\n".join(linhas).strip()
            atual, linhas = linha[3:].strip(), []
        elif atual:
            linhas.append(linha)
    if atual:
        secoes[atual] = "\n".join(linhas).strip()
    return secoes


TOPICOS: tuple[str, ...] = tuple(_secoes())


def texto(topico: str) -> str:
    return _secoes()[topico]
