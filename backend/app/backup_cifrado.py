"""
Backup exportado com senha (SEG-03).

O arquivo continua sendo um .json, mas com o conteúdo cifrado:

    {
      "kami_backup_cifrado": 1,
      "kami_version": "1.11.0",
      "exported_at": "2026-10-19T...",
      "kdf": {"nome": "scrypt", "n": 131072, "r": 8, "p": 1, "sal": "<base64>"},
      "cifra": "AES-256-GCM",
      "nonce": "<base64>",
      "dados": "<base64>"
    }

- A chave sai da senha por scrypt (N=2¹⁷, r=8, p=1 — o recomendado pela
  OWASP; ~0,3 s e 128 MB por tentativa, o que torna adivinhar a senha
  caro). Sal e nonce aleatórios a cada exportação.
- AES-256-GCM autentica, além dos dados, o cabeçalho inteiro (versão,
  parâmetros do scrypt, data): mexer em qualquer byte do arquivo faz a
  abertura falhar. Senha errada e arquivo alterado dão o mesmo erro — o
  GCM não distingue, e não tem por que distinguir.
- O conteúdo (o mesmo do backup sem senha + as senhas salvas
  decifradas, ver routers/sistema.py) vai comprimido com zlib antes de
  cifrar: o JSON encolhe ~10×.

Sem a senha, ninguém abre — nem o Kami. Não existe recuperação.
"""
import base64
import json
import os
import zlib

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from app.mensagens import Texto

FORMATO = 1
SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
SENHA_MIN = 8
# teto dos parâmetros aceitos na hora de ABRIR: um arquivo adulterado com
# N gigante não pode fazer o backend alocar gigabytes
SCRYPT_N_MAX = 2**20


class SenhaErrada(ValueError):
    pass


class ArquivoInvalido(ValueError):
    pass


def eh_cifrado(conteudo) -> bool:
    return isinstance(conteudo, dict) and conteudo.get("kami_backup_cifrado") is not None


def _b64(dados: bytes) -> str:
    return base64.b64encode(dados).decode("ascii")


def _de_b64(texto) -> bytes:
    try:
        return base64.b64decode(texto, validate=True)
    except (TypeError, ValueError) as exc:
        raise ArquivoInvalido(Texto("erro.backup.corrompido", "arquivo de backup corrompido")) from exc


def _chave(senha: str, sal: bytes, n: int, r: int, p: int) -> bytes:
    return Scrypt(salt=sal, length=32, n=n, r=r, p=p).derive(senha.encode("utf-8"))


def _cabecalho_autenticado(env: dict) -> bytes:
    cabecalho = {k: v for k, v in env.items() if k != "dados"}
    return json.dumps(cabecalho, sort_keys=True, separators=(",", ":")).encode("utf-8")


def cifrar(conteudo: dict, senha: str, *, kami_version: str, exported_at: str) -> dict:
    if len(senha) < SENHA_MIN:
        raise ValueError(Texto("erro.backup.senha_curta", "a senha precisa de pelo menos {n} caracteres", n=SENHA_MIN))
    sal = os.urandom(16)
    nonce = os.urandom(12)
    env = {
        "kami_backup_cifrado": FORMATO,
        "kami_version": kami_version,
        "exported_at": exported_at,
        "kdf": {"nome": "scrypt", "n": SCRYPT_N, "r": SCRYPT_R, "p": SCRYPT_P, "sal": _b64(sal)},
        "cifra": "AES-256-GCM",
        "nonce": _b64(nonce),
    }
    claro = zlib.compress(json.dumps(conteudo, ensure_ascii=False).encode("utf-8"), 6)
    chave = _chave(senha, sal, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    env["dados"] = _b64(AESGCM(chave).encrypt(nonce, claro, _cabecalho_autenticado(env)))
    return env


def decifrar(env: dict, senha: str) -> dict:
    if env.get("kami_backup_cifrado") != FORMATO:
        raise ArquivoInvalido(Texto("erro.backup.formato_desconhecido", "formato de backup protegido desconhecido — exportado por uma versão mais nova do Kami?"))
    kdf = env.get("kdf") or {}
    try:
        n, r, p = int(kdf["n"]), int(kdf["r"]), int(kdf["p"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ArquivoInvalido(Texto("erro.backup.corrompido", "arquivo de backup corrompido")) from exc
    if kdf.get("nome") != "scrypt" or env.get("cifra") != "AES-256-GCM" or not (2 <= n <= SCRYPT_N_MAX) or not (1 <= r <= 32) or not (1 <= p <= 16):
        raise ArquivoInvalido(Texto("erro.backup.corrompido", "arquivo de backup corrompido"))
    sal, nonce, dados = _de_b64(kdf.get("sal")), _de_b64(env.get("nonce")), _de_b64(env.get("dados"))
    if len(nonce) != 12:
        raise ArquivoInvalido(Texto("erro.backup.corrompido", "arquivo de backup corrompido"))
    try:
        claro = AESGCM(_chave(senha, sal, n, r, p)).decrypt(nonce, dados, _cabecalho_autenticado(env))
    except InvalidTag as exc:
        raise SenhaErrada(Texto("erro.backup.senha_errada", "senha errada — ou o arquivo foi alterado depois de exportado")) from exc
    try:
        return json.loads(zlib.decompress(claro).decode("utf-8"))
    except (zlib.error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArquivoInvalido(Texto("erro.backup.corrompido", "arquivo de backup corrompido")) from exc
