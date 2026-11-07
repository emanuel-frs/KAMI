"""
Limpeza do fim da resposta do assistente (IA-07a): HTML vira Markdown
simples, emojis e ícones inventados saem e a moeda fica certa.

Até a 2.0 este módulo também comparava cada valor e data da resposta com
os dados e mostrava "! confira" embaixo. Saiu no teste do Emanuel: com os
números já calculados pelo Kami e mostrados no quadro, o aviso acusava
mais coisa certa escrita de outro jeito ("R$ 5k", "5/10", o valor no nome
de uma meta) do que erro de verdade.
"""
import re

from app.assistente.instrucoes import ICONES

_REAL_MINUSCULO = re.compile(r"(?<![A-Za-z])r\$")
_CIFRAO_ESCAPADO = re.compile(r"(R|US)?\\\$")


def arrumar_moeda(resposta: str) -> str:
    """'r$ 0,00' → 'R$ 0,00' e 'R\\$' (cifrão escapado à toa) → 'R$'."""
    resposta = _REAL_MINUSCULO.sub("R$", resposta)
    return _CIFRAO_ESCAPADO.sub(lambda m: f"{m.group(1) or ''}$", resposta)


# ── limpeza no fim da resposta (IA-07a, teste do Emanuel) ────────────────
# O qwen3.5:4b respondeu em HTML (<details>, <div class="bento-card">…),
# que a tela mostra como texto (nunca executa), e com emojis, que as
# instruções já proíbem. O Kami limpa o que sobrar.

_CODIGO = "```"
_TAG = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?/?>")
_QUEBRA = re.compile(r"<br\s*/?>|</(?:p|div|details|summary|section|article|li|ul|ol|tr|table|h[1-6])>", re.I)
_NEGRITO = re.compile(r"</?(?:b|strong)>", re.I)
_ITEM = re.compile(r"<li[^>]*>", re.I)
# emojis e pictogramas; ✓ ✔ ✗ ficam (são texto comum no visual do Kami)
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u2712\u2715\u2716\u2718-\u27BF\u2B50\u2B55"
                    "\u231A\u231B\u23E9-\u23FA\uFE0F\u200D]")


def sem_html(resposta: str) -> str:
    if _CODIGO in resposta or not _TAG.search(resposta):
        return resposta
    t = _ITEM.sub("\n- ", resposta)
    t = _NEGRITO.sub("**", t)
    t = _QUEBRA.sub("\n", t)
    t = _TAG.sub("", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def sem_emoji(resposta: str) -> str:
    """'📂 Finanças' → 'Finanças' (o espaço depois do emoji sai junto)."""
    return re.sub(f"(?:{_EMOJI.pattern})+ ?", "", resposta)


# ":nome:" que não é ícone do Kami (teste do Emanuel: ":todinho: 1 hábito
# ativo") — a tela só troca os da lista; o resto aparecia como texto
_CODIGO_ICONE = re.compile(r"(?<![\w:/]):([a-z][a-z0-9_-]{1,30}):(?![\w:/]) ?")


def sem_icone_inventado(resposta: str) -> str:
    partes = resposta.split(_CODIGO)  # dentro de ``` fica como está
    for i in range(0, len(partes), 2):
        partes[i] = _CODIGO_ICONE.sub(lambda m: m.group(0) if m.group(1) in ICONES else "", partes[i])
    return _CODIGO.join(partes)


def arrumar(resposta: str) -> str:
    """HTML vira Markdown simples, emojis e ícones inventados saem e a moeda fica certa."""
    return arrumar_moeda(sem_icone_inventado(sem_emoji(sem_html(resposta))))

