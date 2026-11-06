"""
Conferência dos números da resposta (IA-07a, teste do Emanuel): o Kami
compara cada valor em dinheiro e cada data que o modelo escreveu com o
que as ferramentas entregaram na conversa, e o que não bate vira um aviso
"confira" embaixo da resposta.

Visto no qwen3.5:4b sem placa de vídeo: consultou as finanças e ainda
escreveu "R$ 1.259 no dia 02/11" (o dado era R$ 1.250 em 09/11); sem
consultar, inventou um saldo de R$ 49.031. Vale pra qualquer modelo — é o
Kami conferindo, não o modelo.

Não acusa arredondamento (R$ 30 pra 30,43), sinal trocado (gasto de
-R$ 10 escrito como R$ 10) nem o que a própria pessoa escreveu. Somas
de itens da mesma lista (o que falta em várias metas) também valem;
outras contas que o modelo fez (diferenças, médias) aparecem como
"confira" — de propósito: são as que ele erra.
"""
import json
import re
from datetime import date

MAX_AVISOS = 5

# símbolo antes (R$ 10, US$ 5, € 3) ou código/símbolo depois (10 €, 10 BRL)
# milhar também com espaço ("R$ 1 250", "1\u00a0250 €")
_NUM = r"\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d(?:[\d.,]*\d)?"
_DINHEIRO = re.compile(
    rf"(?:(?:R\$|US\$|\$|€|£|¥|₹)\s?-?\s?({_NUM}))|(?:({_NUM})\s?(?:€|£|BRL|USD|EUR|reais))", re.IGNORECASE)
_DATA = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?(?![\d/])")
_DATA_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})")
_DADOS = re.compile(r'<dados ferramenta="[^"]*">\n(.*?)\n</dados>', re.DOTALL)


def valor(texto: str) -> float | None:
    """'1.250,00', '1,250.00', '1250', '30,43', '1.259' → número. Com
    vírgula e ponto, o último é o decimal; só um deles seguido de
    exatamente 3 dígitos é milhar."""
    t = re.sub(r"[\s\u00a0\u202f]", "", texto)
    if "," in t and "." in t:
        dec = "," if t.rfind(",") > t.rfind(".") else "."
        t = t.replace("." if dec == "," else ",", "").replace(dec, ".")
    elif "," in t or "." in t:
        sep = "," if "," in t else "."
        partes = t.split(sep)
        if len(partes) > 2 or len(partes[-1]) == 3:
            t = t.replace(sep, "")
        else:
            t = t.replace(sep, ".")
    try:
        return float(t)
    except ValueError:
        return None


SOMA_MAX_ITENS = 10  # até aqui, toda combinação da lista; acima, só o total


def _somas(valores: list[float]) -> set:
    """Somas que o modelo pode tirar de uma lista (teste do Emanuel: "as
    outras três somam R$ 87,5" = 50 + 25 + 12,5 foi marcado como inventado)."""
    if len(valores) > SOMA_MAX_ITENS:
        return {round(sum(valores), 2)}
    somas = {0.0}
    for v in valores:
        somas |= {round(x + v, 2) for x in somas}
    return somas - {0.0}


def _numeros(dado, saida: set) -> None:
    if isinstance(dado, bool):
        return
    if isinstance(dado, (int, float)):
        saida.add(abs(float(dado)))
    elif isinstance(dado, dict):
        for v in dado.values():
            _numeros(v, saida)
    elif isinstance(dado, list):
        for v in dado:
            _numeros(v, saida)
        # o mesmo campo em vários itens da lista (remaining das metas, total das categorias…)
        campos: dict[str, list[float]] = {}
        for item in dado:
            if isinstance(item, dict):
                for k, v in item.items():
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        campos.setdefault(k, []).append(abs(float(v)))
        for valores in campos.values():
            if len(valores) > 1:
                saida |= _somas(valores)


def _do_texto(texto: str, numeros: set, datas: set) -> None:
    for m in _DINHEIRO.finditer(texto):
        v = valor(m.group(1) or m.group(2))
        if v is not None:
            numeros.add(abs(v))
    for m in _DATA_ISO.finditer(texto):
        datas.add((int(m.group(3)), int(m.group(2))))
    for m in _DATA.finditer(texto):
        datas.add((int(m.group(1)), int(m.group(2))))


def conhecidos(resultados: list[str], pergunta: str, hoje: date) -> tuple[set, set]:
    """(números, datas como (dia, mês)) que a resposta pode citar: os dos
    resultados das ferramentas, os da pergunta e hoje."""
    numeros, datas = set(), {(hoje.day, hoje.month)}
    for r in resultados:
        for corpo in _DADOS.findall(r):
            try:
                _numeros(json.loads(corpo), numeros)
            except ValueError:
                pass
            for m in _DATA_ISO.finditer(corpo):
                datas.add((int(m.group(3)), int(m.group(2))))
    _do_texto(pergunta, numeros, datas)
    return numeros, datas


def _bate(v: float, numeros: set) -> bool:
    return any(abs(v - n) < 0.005 or round(n) == v or round(n, 1) == v for n in numeros)


def soltos(resposta: str, resultados: list[str], pergunta: str, hoje: date) -> list[str]:
    """Os valores e datas da resposta (como foram escritos) que não estão
    nos dados — no máximo MAX_AVISOS, sem repetir."""
    numeros, datas = conhecidos(resultados, pergunta, hoje)
    achados = []
    for m in _DINHEIRO.finditer(resposta):
        v = valor(m.group(1) or m.group(2))
        if v is not None and not _bate(abs(v), numeros):
            achados.append((m.start(), m.group(0).strip()))
    for m in _DATA.finditer(resposta):
        dia, mes = int(m.group(1)), int(m.group(2))
        if 1 <= dia <= 31 and 1 <= mes <= 12 and (dia, mes) not in datas:
            achados.append((m.start(), m.group(0)))
    vistos, saida = set(), []
    for _, t in sorted(achados):
        chave = re.sub(r"\s", "", t)  # "R$ 0" e "R$0" são o mesmo aviso
        if chave not in vistos:
            vistos.add(chave)
            saida.append(t)
    return saida[:MAX_AVISOS]


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


def arrumar(resposta: str) -> str:
    """HTML vira Markdown simples, emojis saem e a moeda fica certa."""
    return arrumar_moeda(sem_emoji(sem_html(resposta)))

