"""
Filtro de dados sensíveis (IA-03, P-112): roda sobre TUDO que uma
ferramenta de leitura devolve, antes de ir pro provedor — e o registro do
que foi enviado guarda a versão já filtrada.

O que vira `[removido]`:
- e-mails;
- números de cartão (13 a 19 dígitos que passam no Luhn — não pega valor
  de dinheiro nem data);
- CPF e CNPJ (com ou sem pontuação);
- IBAN, e agência + conta escritas juntas ("ag 1234 cc 56789-0");
- chaves e tokens com prefixo conhecido (sk-, sk-ant-, gsk_, ghp_,
  github_pat_, AKIA…, xox…, AIza…, tvly-) e sequências longas que parecem
  segredo (32+ caracteres misturando letras e dígitos);
- "senha: …", "password: …", "token = …" (o valor depois do rótulo);
- URL com usuário/senha (`https://u:s@…`) ou com token/chave na consulta;
- telefones (com DDI/DDD, separadores ou 10+ dígitos seguidos).

Não é a ÚNICA barreira (as ferramentas já não leem e-mail, senha, chave
nem nota trancada — princípio 3); é a rede pra texto livre da pessoa
(descrição de lançamento, trecho de nota, título de evento) que tenha um
desses dentro. Preferimos remover demais a vazar: um número de telefone
"engolido" num título é um custo pequeno.
"""
import re

REMOVIDO = "[removido]"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.UNICODE)
_URL_CREDENCIAL = re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@\S+", re.I)
_URL_TOKEN = re.compile(
    r"\b(https?://\S*?[?&](?:token|key|api_key|apikey|access_token|auth|sig|signature|secret|password|senha)=)[^\s&#]+",
    re.I,
)
_PREFIXOS = re.compile(
    r"\b(?:sk-ant-[\w-]{10,}|sk-[\w-]{16,}|gsk_[\w]{16,}|ghp_[\w]{20,}|gho_[\w]{20,}|github_pat_[\w]{20,}"
    r"|AKIA[0-9A-Z]{16}|xox[abposr]-[\w-]{10,}|AIza[\w-]{30,}|tvly-[\w-]{16,}|hf_[\w]{20,}|glpat-[\w-]{16,})"
)
_ROTULO_SEGREDO = re.compile(
    # (?<![?&]): token=… DENTRO de uma URL já foi tratado por _URL_TOKEN
    r"(?<![?&\w])(senha|password|passwd|pwd|token|api[ _-]?key|chave(?: da api)?|secret|segredo|pin)\s*[:=]\s*\S+",
    re.I,
)
# (UUID — id interno, não segredo — fica de fora)
_SEGREDO_LONGO = re.compile(
    r"\b(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)"
    r"(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}\b"
)
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b")
_AGENCIA_CONTA = re.compile(r"\b(ag(?:[eê]ncia)?\.?\s*\d{3,5}(?:-\d)?)\s*[,/;]?\s*(c/?c|conta(?: corrente)?)\.?\s*\d{4,12}(?:-[\dxX])?", re.I)
_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
_CARTAO = re.compile(r"\b(?:\d[ -]?){12,18}\d\b")
_TELEFONE = re.compile(
    r"(?<![\w/.-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,3}\)\s?|\d{2,3}[\s.-])?(?:9\s?)?\d{4,5}[\s.-]\d{4}(?![\w/-])"
    r"|(?<![\w/.,-])\+\d{10,14}(?![\w-])"
)


def _luhn(digitos: str) -> bool:
    total, dobrar = 0, False
    for d in reversed(digitos):
        n = int(d)
        if dobrar:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
        dobrar = not dobrar
    return total % 10 == 0


def _cartao(m: re.Match) -> str:
    digitos = re.sub(r"\D", "", m.group(0))
    return REMOVIDO if 13 <= len(digitos) <= 19 and _luhn(digitos) else m.group(0)


def limpar(texto: str) -> str:
    """O texto com os dados sensíveis trocados por [removido]."""
    if not texto:
        return texto
    t = _URL_CREDENCIAL.sub(REMOVIDO, texto)
    t = _URL_TOKEN.sub(lambda m: m.group(1) + REMOVIDO, t)
    t = _EMAIL.sub(REMOVIDO, t)
    t = _PREFIXOS.sub(REMOVIDO, t)
    t = _ROTULO_SEGREDO.sub(lambda m: f"{m.group(1)}: {REMOVIDO}", t)
    t = _IBAN.sub(REMOVIDO, t)
    t = _AGENCIA_CONTA.sub(REMOVIDO, t)
    t = _CNPJ.sub(REMOVIDO, t)
    t = _CPF.sub(REMOVIDO, t)
    t = _CARTAO.sub(_cartao, t)
    t = _TELEFONE.sub(REMOVIDO, t)
    t = _SEGREDO_LONGO.sub(REMOVIDO, t)
    return t


def limpar_dado(valor):
    """Aplica `limpar` em todo texto de uma estrutura (dict/list/str)."""
    if isinstance(valor, str):
        return limpar(valor)
    if isinstance(valor, dict):
        return {k: limpar_dado(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [limpar_dado(v) for v in valor]
    return valor
