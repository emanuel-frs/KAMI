"""
Criptografia local dos segredos que o Kami guarda: senha de app do IMAP,
token do GitHub e chave da busca (módulo Organização).

Usa Fernet (cryptography). O que importa é ONDE fica a chave (SEG-01):

- **No cofre do sistema** (padrão): Gerenciador de Credenciais no
  Windows, Secret Service (GNOME Keyring, KWallet, oo7) no Linux, via a
  biblioteca `keyring`. Quem copia a pasta de dados — backup em nuvem,
  pendrive, arquivo compartilhado — leva o banco mas não a chave, então
  os segredos ficam ilegíveis fora desta conta do sistema.
- **Num arquivo** `.secret_key` (0600) na pasta de dados, quando o
  sistema não tem cofre (alguns Linux sem ambiente gráfico completo).
  É o comportamento de antes da 1.11; configurações › segurança avisa.

Migração transparente: se existe `.secret_key` e o cofre responde, a
chave é copiada pro cofre, lida de volta e conferida, e só então o
arquivo é apagado. Fica no lugar dele o marcador `.secret_key_no_cofre`
(sem segredo nenhum), que diz "a chave deste banco está no cofre": se
um dia o cofre não tiver mais a chave (trocou de ambiente gráfico,
copiou a pasta pra outra máquina), o Kami NÃO gera uma chave nova por
cima — avisa, e a pessoa decide redefinir (os segredos salvos são
apagados e cadastrados de novo). Gerar outra em silêncio deixaria os
segredos antigos irrecuperáveis sem ninguém saber por quê.

Cada pasta de dados tem a própria entrada no cofre (o nome leva um
hash do caminho), então o modo demo / KAMI_DATA_DIR de teste nunca
mistura com os dados reais.

O que isto NÃO protege: outro programa rodando com o seu usuário pode
pedir a chave ao cofre como o Kami pede (fora do modelo de ameaça —
ver SECURITY.md).

A chave é carregada na primeira vez que alguém precisa dela (não ao
importar o módulo): o cofre pode demorar a responder (D-Bus) ou pedir
pra desbloquear, e isso não pode atrasar a subida do backend.
"""
import hashlib
import logging
import os
import threading

from cryptography.fernet import Fernet, InvalidToken

from app.paths import get_data_dir

logger = logging.getLogger(__name__)

KEY_PATH = get_data_dir() / ".secret_key"
MARKER_PATH = get_data_dir() / ".secret_key_no_cofre"
KEYRING_SERVICE = "kami"
# KAMI_COFRE=desligado força o arquivo (diagnóstico, ou sistema com cofre quebrado)
COFRE_ENV_VAR = "KAMI_COFRE"

LOCAL_COFRE = "cofre"
LOCAL_ARQUIVO = "arquivo"
LOCAL_INDISPONIVEL = "indisponivel"


class ChaveIndisponivel(Exception):
    """
    A chave dos segredos está no cofre, mas o cofre não a entregou.
    Não é ValueError de propósito: os routers tratam ValueError como
    "segredo corrompido, recadastre", e aqui o certo é apontar pra
    configurações › segurança (main.py transforma isto em 409).
    """


_lock = threading.Lock()
_fernet = None
_estado = None  # {"local", "cofre", "motivo"} depois de carregar


def _entry_user() -> str:
    pasta = str(KEY_PATH.parent.resolve())
    return "chave-dos-segredos-" + hashlib.sha256(pasta.encode("utf-8")).hexdigest()[:16]


def _abrir_cofre():
    """O backend do keyring se houver um cofre de verdade, senão None (com o motivo)."""
    if os.environ.get(COFRE_ENV_VAR, "").strip().lower() in {"0", "desligado", "off", "nao", "não"}:
        return None, f"cofre desligado por {COFRE_ENV_VAR}"
    try:
        import keyring
        from keyring.backends import fail

        backend = keyring.get_keyring()
        if isinstance(backend, fail.Keyring):
            return None, "o sistema não tem um cofre de senhas disponível"
        # sonda: o Secret Service pode existir no D-Bus e mesmo assim falhar
        backend.get_password(KEYRING_SERVICE, _entry_user())
        return backend, None
    except Exception as exc:  # noqa: BLE001 — qualquer falha do cofre = sem cofre
        return None, f"o cofre do sistema não respondeu ({type(exc).__name__})"


def _nome_do_cofre(backend) -> str:
    nome = type(backend).__module__.rsplit(".", 1)[-1]
    return {
        "Windows": "Gerenciador de Credenciais do Windows",
        "SecretService": "Secret Service",
        "kwallet": "KWallet",
        "macOS": "Keychain do macOS",
    }.get(nome, nome)


def _gravar_arquivo(key: bytes) -> None:
    # cria já com 0600 (só o dono lê) em vez do umask padrão (0644). No
    # Windows o modo é praticamente ignorado — lá quem protege é o ACL do
    # %APPDATA% do próprio usuário.
    fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(key)


def _ler_arquivo():
    if not KEY_PATH.exists():
        return None
    try:
        os.chmod(KEY_PATH, 0o600)  # corrige instalações antigas, criadas com 0644
    except OSError:
        pass
    return KEY_PATH.read_bytes().strip() or None


def _guardar_no_cofre(backend, key: bytes) -> bool:
    """Grava e lê de volta; só conta como guardado se voltou igual."""
    try:
        backend.set_password(KEYRING_SERVICE, _entry_user(), key.decode("ascii"))
        return backend.get_password(KEYRING_SERVICE, _entry_user()) == key.decode("ascii")
    except Exception:  # noqa: BLE001
        logger.exception("não deu pra gravar a chave dos segredos no cofre do sistema")
        return False


def _carregar():
    """(chave ou None, estado). Ver a docstring do módulo pra cada caso."""
    backend, motivo = _abrir_cofre()
    arquivo = _ler_arquivo()

    if backend is not None:
        cofre = _nome_do_cofre(backend)
        if arquivo:
            # migração (ou pasta restaurada de antes do cofre — aí o banco
            # também é de antes, e o arquivo é que decifra): o arquivo manda
            Fernet(arquivo)  # chave válida antes de mexer em qualquer coisa
            if _guardar_no_cofre(backend, arquivo):
                MARKER_PATH.write_text("a chave dos segredos deste banco está no cofre do sistema\n", encoding="utf-8")
                KEY_PATH.unlink()
                logger.info("chave dos segredos levada do arquivo pro cofre do sistema (%s)", cofre)
                return arquivo, {"local": LOCAL_COFRE, "cofre": cofre, "motivo": None}
            return arquivo, {"local": LOCAL_ARQUIVO, "cofre": None,
                             "motivo": "o cofre do sistema não guardou a chave"}
        guardada = backend.get_password(KEYRING_SERVICE, _entry_user())
        if guardada:
            return guardada.encode("ascii"), {"local": LOCAL_COFRE, "cofre": cofre, "motivo": None}
        if MARKER_PATH.exists():
            return None, {"local": LOCAL_INDISPONIVEL, "cofre": cofre,
                          "motivo": "a chave das senhas salvas não está no cofre deste sistema"}
        key = Fernet.generate_key()
        if _guardar_no_cofre(backend, key):
            MARKER_PATH.write_text("a chave dos segredos deste banco está no cofre do sistema\n", encoding="utf-8")
            return key, {"local": LOCAL_COFRE, "cofre": cofre, "motivo": None}
        motivo = "o cofre do sistema não guardou a chave"

    if arquivo:
        return arquivo, {"local": LOCAL_ARQUIVO, "cofre": None, "motivo": motivo}
    if MARKER_PATH.exists():
        return None, {"local": LOCAL_INDISPONIVEL, "cofre": None, "motivo": motivo}
    key = Fernet.generate_key()
    _gravar_arquivo(key)
    return key, {"local": LOCAL_ARQUIVO, "cofre": None, "motivo": motivo}


def _garantir_carregada():
    global _fernet, _estado
    if _estado is not None:
        return
    with _lock:
        if _estado is not None:
            return
        key, estado = _carregar()
        if estado["local"] != LOCAL_COFRE:
            logger.warning("chave dos segredos: %s (%s)", estado["local"], estado["motivo"])
        _fernet = Fernet(key) if key else None
        _estado = estado


def estado_da_chave() -> dict:
    """{"local": cofre|arquivo|indisponivel, "cofre": nome ou None, "motivo": texto ou None}."""
    _garantir_carregada()
    return dict(_estado)


def redefinir_chave() -> dict:
    """
    Gera uma chave nova (no cofre se houver, senão no arquivo). Os
    segredos cifrados com a antiga ficam ilegíveis — quem chama apaga
    esses campos do banco (routers/sistema.py).
    """
    global _fernet, _estado
    with _lock:
        key = Fernet.generate_key()
        backend, motivo = _abrir_cofre()
        if backend is not None and _guardar_no_cofre(backend, key):
            MARKER_PATH.write_text("a chave dos segredos deste banco está no cofre do sistema\n", encoding="utf-8")
            KEY_PATH.unlink(missing_ok=True)
            estado = {"local": LOCAL_COFRE, "cofre": _nome_do_cofre(backend), "motivo": None}
        else:
            _gravar_arquivo(key)
            MARKER_PATH.unlink(missing_ok=True)
            estado = {"local": LOCAL_ARQUIVO, "cofre": None, "motivo": motivo or "o cofre do sistema não guardou a chave"}
        _fernet = Fernet(key)
        _estado = estado
        logger.warning("chave dos segredos redefinida (%s) — segredos antigos apagados", estado["local"])
        return dict(estado)


def _resetar_para_testes(fernet=None, estado=None):
    global _fernet, _estado
    _fernet = fernet
    _estado = estado


def _chave():
    _garantir_carregada()
    if _fernet is None:
        raise ChaveIndisponivel(
            "a chave que protege suas senhas salvas não está disponível — "
            "veja configurações › segurança"
        )
    return _fernet


def encrypt_password(plain: str) -> str:
    return _chave().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_password(enc: str) -> str:
    fernet = _chave()
    try:
        return fernet.decrypt(enc.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # chave redefinida ou dado corrompido — trate como credencial inválida
        # na camada de cima (o router transforma isso em 422 pro usuário reconfigurar)
        raise ValueError("não foi possível decriptar app_password_enc")
