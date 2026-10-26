"""
PIN opcional pra abrir o app (SEG-02).

O que o PIN protege: a ABERTURA do app. Com PIN ligado, o backend nasce
bloqueado e só responde /health, o estado do PIN, o desbloqueio e a
recuperação — toda outra rota devolve 423 até o PIN certo (não é só a
tela que esconde os dados: a API também não entrega). O que o PIN NÃO
faz: cifrar o banco, nem proteger contra um programa rodando no seu
usuário (que lê o kami.db direto). Isso é dito na tela.

Onde fica: `pin.json` na pasta de dados (0600), FORA do banco, de
propósito:
- é o último recurso documentado de "esqueci o PIN e o código": fechar
  o app e apagar o arquivo — os dados continuam intactos;
- não vai junto no backup (restaurar noutra máquina não traz o PIN).

Conteúdo: hash scrypt do PIN e do código de recuperação (nunca o
texto), o bloqueio por inatividade e o contador de erros. O contador é
gravado no arquivo pra que fechar e abrir o app não zere a espera.

Espera depois de errar: 5 erros seguidos → 30 s; cada erro a mais
dobra (60, 120…), até 15 min. Vale pro PIN e pro código de recuperação
(mesmo contador). Acertar zera.

Bloqueio por inatividade (P-06): opcional, desligado; quem conta o
tempo é a tela (components/lock-screen.js), que chama /bloquear.
"""
import base64
import hmac
import json
import os
import re
import secrets
import threading
import time

from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from app.mensagens import Texto
from app.paths import get_data_dir

PIN_PATH = get_data_dir() / "pin.json"

PIN_RE = re.compile(r"^[0-9]{4,8}$")  # \d aceitaria dígitos de outras escritas
INATIVIDADE_OPCOES = (5, 15, 30)
ERROS_ANTES_DE_ESPERAR = 5
ESPERA_INICIAL_S = 30
ESPERA_MAX_S = 15 * 60
SCRYPT_PADRAO = {"n": 2**17, "r": 8, "p": 1}  # ~0,3 s por tentativa
SCRYPT = dict(SCRYPT_PADRAO)
# Crockford base32 sem I, L, O, U: dá pra ditar e digitar sem confusão
ALFABETO_RECUPERACAO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

# (método, caminho) — por método: o GET do estado é livre, mas ligar/trocar
# o PIN no mesmo caminho não
ROTAS_LIVRES = {
    ("GET", "/health"),
    ("GET", "/api/seguranca/pin"),
    ("POST", "/api/seguranca/pin/desbloquear"),
    ("POST", "/api/seguranca/pin/recuperar"),
    # erro de JavaScript da tela de bloqueio também tem que chegar no log
    ("POST", "/api/sistema/erro-frontend"),
}

_lock = threading.Lock()
_desbloqueado = False


class PinErrado(ValueError):
    pass


class Esperando(Exception):
    def __init__(self, segundos: int):
        super().__init__(Texto("erro.pin.esperando", "muitas tentativas erradas — espere {segundos} s", segundos=segundos))
        self.segundos = segundos


# ── arquivo ────────────────────────────────────────────────────────────

def _ler() -> dict | None:
    try:
        return json.loads(PIN_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        # arquivo estragado: tratar como PIN ligado e impossível de acertar
        # seria trancar a pessoa pra fora; o PIN não protege dado nenhum
        # cifrado, então o seguro aqui é o mesmo do "apagar o arquivo"
        return None


def _gravar(dados: dict) -> None:
    tmp = PIN_PATH.with_name(PIN_PATH.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(dados, fh)
    os.replace(tmp, PIN_PATH)


def _hash(segredo: str, sal: bytes | None = None) -> dict:
    sal = sal or os.urandom(16)
    h = Scrypt(salt=sal, length=32, **SCRYPT).derive(segredo.encode("utf-8"))
    return {"kdf": "scrypt", **SCRYPT, "sal": base64.b64encode(sal).decode(), "hash": base64.b64encode(h).decode()}


def _confere(segredo: str, guardado: dict) -> bool:
    sal = base64.b64decode(guardado["sal"])
    h = Scrypt(salt=sal, length=32, n=guardado["n"], r=guardado["r"], p=guardado["p"]).derive(segredo.encode("utf-8"))
    return hmac.compare_digest(h, base64.b64decode(guardado["hash"]))


# ── estado ─────────────────────────────────────────────────────────────

def ativo() -> bool:
    return _ler() is not None


def bloqueado() -> bool:
    # desbloqueado nem lê o arquivo (o middleware chama isto a cada requisição)
    return not _desbloqueado and ativo()


def _espera_restante(dados: dict) -> int:
    return max(0, int(dados.get("espera_ate", 0) - time.time() + 0.999))


def estado() -> dict:
    dados = _ler()
    if dados is None:
        return {"ativo": False, "bloqueado": False, "inatividade_min": None, "espera_s": 0, "pasta": str(PIN_PATH.parent)}
    return {
        "ativo": True,
        "bloqueado": not _desbloqueado,
        "inatividade_min": dados.get("inatividade_min"),
        "espera_s": _espera_restante(dados),
        "pasta": str(PIN_PATH.parent),
    }


def validar_pin(pin: str) -> None:
    if not isinstance(pin, str) or not PIN_RE.match(pin):
        raise ValueError(Texto("erro.pin.tamanho_numeros", "o PIN tem de 4 a 8 dígitos (só números)"))


def novo_codigo_recuperacao() -> str:
    corpo = "".join(secrets.choice(ALFABETO_RECUPERACAO) for _ in range(12))
    return f"KAMI-{corpo[0:4]}-{corpo[4:8]}-{corpo[8:12]}"


def normalizar_codigo(codigo: str) -> str:
    texto = re.sub(r"[\s\-]", "", (codigo or "").upper())
    texto = texto.translate(str.maketrans({"O": "0", "I": "1", "L": "1", "U": "V"}))
    return texto[4:] if texto.startswith("KAM1") or texto.startswith("KAMI") else texto


def _tentativa(dados: dict, conferir) -> None:
    """Aplica a espera, confere, e conta o erro (gravado) ou zera o contador."""
    espera = _espera_restante(dados)
    if espera:
        raise Esperando(espera)
    if conferir():
        dados["erros"] = 0
        dados.pop("espera_ate", None)
        _gravar(dados)
        return
    dados["erros"] = dados.get("erros", 0) + 1
    excesso = dados["erros"] - ERROS_ANTES_DE_ESPERAR
    if excesso >= 0:
        dados["espera_ate"] = time.time() + min(ESPERA_INICIAL_S * 2**excesso, ESPERA_MAX_S)
    _gravar(dados)
    raise PinErrado(Texto("erro.pin.errado", "PIN errado"))


# ── ações ──────────────────────────────────────────────────────────────

def ativar(pin: str) -> str:
    """Liga o PIN. Devolve o código de recuperação — mostrado UMA vez."""
    global _desbloqueado
    validar_pin(pin)
    codigo = novo_codigo_recuperacao()
    with _lock:
        if ativo():
            raise ValueError(Texto("erro.pin.ja_ligado", "o PIN já está ligado"))
        _gravar({"versao": 1, "pin": _hash(pin), "recuperacao": _hash(normalizar_codigo(codigo)),
                 "inatividade_min": None, "erros": 0})
        _desbloqueado = True  # quem ligou está usando o app agora
    return codigo


def desbloquear(pin: str) -> None:
    global _desbloqueado
    with _lock:
        dados = _ler()
        if dados is None:
            _desbloqueado = True
            return
        _tentativa(dados, lambda: isinstance(pin, str) and _confere(pin, dados["pin"]))
        _desbloqueado = True


def conferir(pin: str) -> None:
    """Confere o PIN sem mexer no bloqueio do app (ORG-01: abrir uma nota
    trancada). Mesma espera crescente do desbloqueio — o erro conta igual,
    senão a nota viraria um jeito de adivinhar o PIN sem espera.
    Levanta PinErrado/Esperando; ValueError se o PIN não está ligado."""
    with _lock:
        dados = _ler()
        if dados is None:
            raise ValueError(Texto("erro.pin.desligado", "o PIN não está ligado"))
        _tentativa(dados, lambda: isinstance(pin, str) and _confere(pin, dados["pin"]))


def bloquear() -> None:
    global _desbloqueado
    with _lock:
        if ativo():
            _desbloqueado = False


def _exigir_pin_atual(dados: dict, pin_atual: str) -> None:
    _tentativa(dados, lambda: isinstance(pin_atual, str) and _confere(pin_atual, dados["pin"]))


def trocar(pin_atual: str, pin_novo: str) -> None:
    validar_pin(pin_novo)
    with _lock:
        dados = _ler()
        if dados is None:
            raise ValueError(Texto("erro.pin.desligado", "o PIN não está ligado"))
        _exigir_pin_atual(dados, pin_atual)
        dados["pin"] = _hash(pin_novo)
        _gravar(dados)


def desativar(pin_atual: str) -> None:
    global _desbloqueado
    with _lock:
        dados = _ler()
        if dados is None:
            return
        _exigir_pin_atual(dados, pin_atual)
        PIN_PATH.unlink(missing_ok=True)
        _desbloqueado = False


def recuperar(codigo: str, pin_novo: str) -> str:
    """Código certo → PIN novo e código NOVO (o antigo deixa de valer)."""
    global _desbloqueado
    validar_pin(pin_novo)
    with _lock:
        dados = _ler()
        if dados is None:
            raise ValueError(Texto("erro.pin.desligado", "o PIN não está ligado"))
        _tentativa(dados, lambda: _confere(normalizar_codigo(codigo), dados["recuperacao"]))
        novo = novo_codigo_recuperacao()
        dados["pin"] = _hash(pin_novo)
        dados["recuperacao"] = _hash(normalizar_codigo(novo))
        _gravar(dados)
        _desbloqueado = True
    return novo


def definir_inatividade(minutos: int | None) -> None:
    if minutos is not None and minutos not in INATIVIDADE_OPCOES:
        raise ValueError(Texto("erro.pin.inatividade", "tempo de inatividade inválido (use {opcoes} ou desligado)", opcoes=", ".join(map(str, INATIVIDADE_OPCOES))))
    with _lock:
        dados = _ler()
        if dados is None:
            raise ValueError(Texto("erro.pin.desligado", "o PIN não está ligado"))
        dados["inatividade_min"] = minutos
        _gravar(dados)


def _resetar_para_testes(desbloqueado: bool = False) -> None:
    global _desbloqueado
    _desbloqueado = desbloqueado


# ── middleware ─────────────────────────────────────────────────────────

class BloqueioMiddleware:
    """
    ASGI puro. Com o PIN ligado e o app bloqueado, só ROTAS_LIVRES (e o
    preflight OPTIONS) passam; o resto recebe 423. Fica por dentro do
    token de sessão: quem não tem o token nem descobre se há PIN.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] == "http"
            and scope["method"] != "OPTIONS"
            and (scope["method"], scope["path"]) not in ROTAS_LIVRES
            and bloqueado()
        ):
            from starlette.responses import JSONResponse

            resp = JSONResponse(
                status_code=423,
                content={"detail": "o kami está bloqueado — digite o PIN", "codigo": "bloqueado"},
            )
            await resp(scope, receive, send)
            return
        await self.app(scope, receive, send)
