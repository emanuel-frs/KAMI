"""
Banco cifrado em disco (SEG-08) — opcional e desligado por padrão.

Com a opção ligada, o kami.db (e as cópias automáticas) são arquivos
SQLCipher: AES-256 página por página, ilegíveis sem a chave. Desligada,
nada muda: o SQLite da stdlib de sempre (P-170).

Onde fica a chave (P-167): 32 bytes aleatórios no cofre do sistema, numa
entrada própria por pasta de dados (`chave-do-banco-<hash>`), separada
da chave dos segredos (app/crypto.py). Não depende do PIN. Sem cofre, a
opção não liga — a chave num arquivo ao lado do banco não protegeria
nada.

Código de recuperação (P-168): a própria chave em base32 Crockford,
mostrada uma vez ao ligar. Se o cofre perder a chave (sistema
reinstalado, cofre redefinido), o backend sobe trancado e a tela de
abertura pede o código; sem ele, o banco não abre.

Como se sabe se o banco está cifrado: pelo cabeçalho do arquivo
("SQLite format 3\\0" = sem cifra). Sem arquivo-marcador de propósito:
desligar o computador no meio da troca não deixa marcador e arquivo
discordando.

Desligar a cifra não apaga a chave do cofre: as cópias cifradas antigas
continuam restauráveis. Só o "remover tudo do computador" apaga.

A conversão (ligar/desligar) usa `sqlcipher_export` pra um arquivo novo,
confere a contagem de linhas de cada tabela e só então troca os
arquivos — com todas as conexões fechadas (database.exclusivo).
"""
import base64
import hashlib
import logging
import os
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from app.mensagens import Texto

logger = logging.getLogger(__name__)

CABECALHO_SQLITE = b"SQLite format 3\x00"
TAMANHO_CHAVE = 32
# mesmo alfabeto do código de recuperação do PIN (app/pin.py): sem I, L, O, U
ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

_lock = threading.Lock()
_chaves: dict[str, str] = {}  # pasta de dados -> chave em hex (cache)
_modos: dict[str, bool] = {}  # caminho do banco -> cifrado?


class SemChave(Exception):
    """O banco está cifrado e a chave não está no cofre (nem na memória)."""


class Indisponivel(ValueError):
    """A cifra não pode ser ligada aqui (sem biblioteca ou sem cofre)."""


class CodigoErrado(ValueError):
    pass


# ── biblioteca ─────────────────────────────────────────────────────────

def _sqlcipher():
    try:
        from sqlcipher3 import dbapi2
    except ImportError:
        return None
    return dbapi2


def biblioteca_ok() -> bool:
    return _sqlcipher() is not None


def classes(nome: str) -> tuple:
    """A exceção `nome` do sqlite3 e do sqlcipher3 (pra `except`/`isinstance`)."""
    mod = _sqlcipher()
    return (getattr(sqlite3, nome),) + ((getattr(mod, nome),) if mod else ())


# ── modo do arquivo ────────────────────────────────────────────────────

def arquivo_cifrado(caminho: Path) -> bool:
    """Arquivo que existe, tem conteúdo e não começa com o cabeçalho do SQLite."""
    try:
        with open(caminho, "rb") as fh:
            inicio = fh.read(len(CABECALHO_SQLITE))
    except FileNotFoundError:
        return False
    return bool(inicio) and inicio != CABECALHO_SQLITE


def ligada(db_path: Path) -> bool:
    chave = str(db_path)
    if chave not in _modos:
        _modos[chave] = arquivo_cifrado(db_path)
    return _modos[chave]


def esquecer_modo(db_path: Path) -> None:
    _modos.pop(str(db_path), None)


# ── chave ──────────────────────────────────────────────────────────────

def _entrada(db_path: Path) -> str:
    pasta = str(db_path.parent.resolve())
    return "chave-do-banco-" + hashlib.sha256(pasta.encode("utf-8")).hexdigest()[:16]


def _cofre():
    from app import crypto

    return crypto._abrir_cofre()


def chave(db_path: Path) -> Optional[str]:
    """A chave em hex: memória, depois cofre. None se não houver."""
    pasta = str(db_path.parent)
    if pasta in _chaves:
        return _chaves[pasta]
    backend, _motivo = _cofre()
    if backend is None:
        return None
    try:
        guardada = backend.get_password("kami", _entrada(db_path))
    except Exception:  # noqa: BLE001 — cofre que falha = sem chave
        logger.exception("o cofre não entregou a chave do banco")
        return None
    if guardada:
        _chaves[pasta] = guardada
    return guardada


def _guardar(db_path: Path, hexa: str) -> bool:
    backend, _motivo = _cofre()
    if backend is None:
        return False
    try:
        backend.set_password("kami", _entrada(db_path), hexa)
        return backend.get_password("kami", _entrada(db_path)) == hexa
    except Exception:  # noqa: BLE001
        logger.exception("não deu pra gravar a chave do banco no cofre")
        return False


def chave_para_ligar(db_path: Path) -> str:
    """A chave que já existe no cofre, ou uma nova guardada e conferida."""
    with _lock:
        existente = chave(db_path)
        if existente:
            return existente
        nova = os.urandom(TAMANHO_CHAVE).hex()
        if not _guardar(db_path, nova):
            raise Indisponivel(Texto("erro.cifra.cofre", "o cofre do sistema não guardou a chave do banco"))
        _chaves[str(db_path.parent)] = nova
        return nova


def apagar_do_cofre(db_path: Path) -> bool:
    """DIST-03 ("remover tudo"): tira a chave do banco do cofre."""
    _chaves.pop(str(db_path.parent), None)
    backend, _motivo = _cofre()
    if backend is None:
        return False
    try:
        if backend.get_password("kami", _entrada(db_path)) is None:
            return False
        backend.delete_password("kami", _entrada(db_path))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("não deu pra apagar a chave do banco do cofre (%s)", type(exc).__name__)
        return False


def codigo_da_chave(hexa: str) -> str:
    """32 bytes → 52 caracteres base32 Crockford, em grupos de 4."""
    b32 = base64.b32encode(bytes.fromhex(hexa)).decode("ascii").rstrip("=")
    texto = b32.translate(str.maketrans(_B32, ALFABETO))
    return "-".join(texto[i:i + 4] for i in range(0, len(texto), 4))


def chave_do_codigo(codigo: str) -> str:
    """O caminho de volta, tolerante a espaço, hífen, minúscula e I/L/O."""
    limpo = "".join(c for c in codigo.upper() if c.isalnum())
    limpo = limpo.replace("I", "1").replace("L", "1").replace("O", "0")
    if len(limpo) != 52 or any(c not in ALFABETO for c in limpo):
        raise CodigoErrado(Texto("erro.cifra.codigo_formato", "o código tem 52 letras e números — confira o que foi digitado"))
    b32 = limpo.translate(str.maketrans(ALFABETO, _B32)) + "===="
    return base64.b32decode(b32).hex()


# ── conexões ───────────────────────────────────────────────────────────

def _pragma_chave(conn, hexa: str) -> None:
    conn.execute(f"PRAGMA key = \"x'{hexa}'\"")


def conectar(caminho: Path, cifrado: bool, hexa: Optional[str], **kwargs):
    """Conexão no modo pedido; `factory` (kwargs) recebe a classe base certa."""
    fabrica = kwargs.pop("fabrica", None)
    if not cifrado:
        if fabrica:
            kwargs["factory"] = fabrica(sqlite3.Connection)
        conn = sqlite3.connect(caminho, **kwargs)
        conn.row_factory = sqlite3.Row
        return conn
    mod = _sqlcipher()
    if mod is None:
        raise Indisponivel(Texto("erro.cifra.biblioteca", "esta instalação do Kami não tem suporte a banco cifrado"))
    if hexa is None:
        raise SemChave("a chave do banco não está no cofre")
    if fabrica:
        kwargs["factory"] = fabrica(mod.Connection)
    conn = mod.connect(str(caminho), **kwargs)
    _pragma_chave(conn, hexa)
    conn.row_factory = mod.Row
    return conn


def conectar_banco(db_path: Path, **kwargs):
    """O banco principal, no modo em que o arquivo está."""
    if not ligada(db_path):
        return conectar(db_path, False, None, **kwargs)
    return conectar(db_path, True, chave(db_path), **kwargs)


def conectar_copia(destino: Path, db_path: Path):
    """Destino de uma cópia (API de backup): no mesmo modo e chave do banco."""
    cifrado = ligada(db_path)
    return conectar(destino, cifrado, chave(db_path) if cifrado else None)


def abrir_arquivo(caminho: Path, db_path: Path):
    """Uma cópia qualquer (cifrada ou não), pra ler."""
    cifrado = arquivo_cifrado(caminho)
    return conectar(caminho, cifrado, chave(db_path) if cifrado else None)


def chave_abre(caminho: Path, hexa: str) -> bool:
    try:
        conn = conectar(caminho, True, hexa)
        try:
            conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        finally:
            conn.close()
        return True
    except Exception:  # noqa: BLE001 — chave errada = "file is not a database"
        return False


def exportar(origem: Path, chave_origem: Optional[str], destino: Path, chave_destino: Optional[str]) -> None:
    """Copia o banco inteiro mudando a cifra (sqlcipher_export). Destino não pode existir."""
    mod = _sqlcipher()
    if mod is None:
        raise Indisponivel(Texto("erro.cifra.biblioteca", "esta instalação do Kami não tem suporte a banco cifrado"))
    conn = mod.connect(str(origem))
    try:
        if chave_origem:
            _pragma_chave(conn, chave_origem)
        alvo = f"\"x'{chave_destino}'\"" if chave_destino else "''"
        conn.execute(f"ATTACH DATABASE ? AS destino KEY {alvo}", (str(destino),))
        conn.execute("SELECT sqlcipher_export('destino')")
        conn.execute("DETACH DATABASE destino")
    finally:
        conn.close()


def contagens(conn) -> dict[str, int]:
    tabelas = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]
    return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tabelas}


def _resetar_para_testes() -> None:
    _chaves.clear()
    _modos.clear()
