"""
Exceção de cuidado (princípio 2, IA-03, P-111).

Quando a mensagem mostra risco (falar em se matar, se machucar, não
querer viver), quem responde é o PRÓPRIO Kami, sem modelo nenhum:
- funciona igual com qualquer provedor, até um modelo local pequeno que
  ignoraria a instrução;
- a mensagem NÃO vai pro provedor (é o dado mais sensível que existe) e
  sai do histórico das próximas chamadas;
- o texto (acolhimento curto + ajuda real + volta ao escopo) mora no
  frontend, traduzido; daqui sai só o serviço do país escolhido em
  configurações › aparência (ajuda.json), ou findahelpline.com.

Regras locais, nos 10 idiomas do app (a pessoa pode escrever em qualquer
um, então todas valem sempre). Feitas pra PRECISÃO: pedem intenção em
primeira pessoa ("quero me matar", "vou me matar") em vez da palavra
solta, pra hipérbole do dia a dia ("esse prazo vai me matar", "morrendo
de rir") não virar alarme. Sofrimento sem risco ("estou triste",
"ansioso com as contas") fica com o modelo, pela instrução de sistema.
Limitação honesta: regra não pega tudo — por isso a instrução de sistema
repete o princípio 2 pro modelo.
"""
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

ARQUIVO_AJUDA = Path(__file__).parent / "ajuda.json"

_PADROES = [
    # pt
    r"suicid", r"automutila", r"\bme mutilar",
    r"\b(quero|vou|vontade de|pensando em|penso em|pensei em|deveria|devia|tentar|tentei|queria)\s+me\s+matar\b(?!\s+de\s)",
    r"\b(tirar|acabar com)\s+(a\s+)?(minha\s+)?(propria\s+)?vida\b",
    r"\bquero\s+morrer\b(?!\s+de\s)", r"\b(vontade|desejo)\s+de\s+morrer\b(?!\s+de\s)",
    r"\bnao\s+(quero|aguento)\s+mais\s+viver\b", r"\bnao\s+quero\s+viver\b",
    r"\bsem\s+(vontade|motivo|razao)\s+(de|pra|para)\s+viver\b",
    r"\b(quero|vou|vontade de)\s+me\s+(machucar|ferir|cortar)\b",
    # en
    r"\bkill(ing)?\s+myself\b", r"\bend(ing)?\s+my\s+(own\s+)?life\b", r"\btake\s+my\s+(own\s+)?life\b",
    r"\bi\s+want\s+to\s+die\b", r"\b(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+alive)\b",
    r"\bwish\s+i\s+(was|were)\s+dead\b", r"\b(hurt|harm|cut)(ing)?\s+myself\b", r"\bself[- ]harm",
    r"\bno\s+reason\s+to\s+live\b",
    # es
    r"\b(quiero|voy\s+a|ganas\s+de|pienso\s+en)\s+matarme\b", r"\bquitarme\s+la\s+vida\b", r"\bacabar\s+con\s+mi\s+vida\b",
    r"\bquiero\s+morir(me)?\b(?!\s+de\s)", r"\bno\s+quiero\s+(seguir\s+)?vivir\b", r"\b(hacerme\s+dano|lastimarme|autolesion)",
    # fr
    r"\b(veux|vais|envie\s+de)\s+me\s+tuer\b", r"\bmettre\s+fin\s+a\s+mes\s+jours\b", r"\ben\s+finir\s+avec\s+la\s+vie\b",
    r"\bje\s+veux\s+mourir\b", r"\benvie\s+de\s+mourir\b", r"\bme\s+faire\s+du\s+mal\b", r"\bautomutil",
    # it
    r"\b(voglio|vorrei|penso\s+di)\s+uccidermi\b", r"\btogliermi\s+la\s+vita\b", r"\bvoglio\s+morire\b(?!\s+dal)",
    r"\bnon\s+voglio\s+piu\s+vivere\b", r"\bfarmi\s+del\s+male\b", r"\bautolesion",
    # de
    r"\bsuizid", r"\bselbstmord", r"\bmich\s+umbringen\b", r"\bmir\s+das\s+leben\s+nehmen\b",
    r"\bich\s+will\s+sterben\b", r"\bwill\s+nicht\s+mehr\s+leben\b", r"\bmir\s+etwas\s+antun\b", r"\bselbstverletz",
    r"\bmich\s+ritzen\b",
    # zh
    r"自杀", r"想死", r"不想活", r"结束(自己的)?生命", r"轻生", r"伤害自己", r"自残",
    # ja
    r"自殺", r"死にたい", r"消えたい", r"生きていたくない", r"自傷", r"リスカ", r"自分を傷つけ",
    # ko
    r"자살", r"죽고\s?싶", r"살고\s?싶지\s?않", r"자해", r"극단적\s?선택",
    # hi
    r"आत्महत्या", r"खुदकुशी", r"ख़ुदकुशी", r"मरना\s+चाहत", r"जीना\s+नहीं\s+चाहत", r"ख़?ुद\s+को\s+(नुकसान|चोट)",
]
_RISCO = re.compile("|".join(f"(?:{p})" for p in _PADROES), re.IGNORECASE)


def _sem_acento_latino(texto: str) -> str:
    """Tira acento só de letra latina — decompor hangul ou devanágari
    quebraria as regras de coreano e hindi."""
    saida = []
    for ch in texto:
        if ch.isascii() or "LATIN" not in unicodedata.name(ch, ""):
            saida.append(ch)
        else:
            saida.append("".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c)))
    return "".join(saida)


def ha_risco(texto: str) -> bool:
    t = _sem_acento_latino(" ".join(texto.lower().replace("’", "'").split()))
    return bool(_RISCO.search(t))


@lru_cache(maxsize=1)
def _tabela() -> dict:
    return json.loads(ARQUIVO_AJUDA.read_text(encoding="utf-8"))


def servico(pais: str | None) -> dict:
    """{"nome", "telefone", "site", "pais", "reserva": bool} do país (ou findahelpline)."""
    tabela = _tabela()
    s = tabela["paises"].get((pais or "").upper())
    if s:
        return {**s, "pais": pais.upper(), "reserva": False}
    return {**tabela["reserva"], "pais": (pais or "").upper() or None, "reserva": True}
