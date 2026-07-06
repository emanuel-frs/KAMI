"""
Criptografia local para senhas de app (ex: senha de app do IMAP) —
usada pelo módulo Organização.

Usa Fernet (cryptography) com uma chave simétrica gerada uma única vez
e guardada em backend/.secret_key — fora do kami.db, fora do schema.sql.
Isso evita guardar a senha em texto puro no banco; NÃO é hardening
contra alguém com acesso total à máquina (fora do threat model do
projeto: app single-user, 100% local, sem exposição externa).

.secret_key deve entrar no .gitignore junto com kami.db.
"""
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

APP_DIR = Path(__file__).parent
BACKEND_DIR = APP_DIR.parent
KEY_PATH = BACKEND_DIR / ".secret_key"


def _load_or_create_key() -> bytes:
    if KEY_PATH.exists():
        return KEY_PATH.read_bytes()
    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    return key


_fernet = Fernet(_load_or_create_key())


def encrypt_password(plain: str) -> str:
    return _fernet.encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_password(enc: str) -> str:
    try:
        return _fernet.decrypt(enc.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # chave rotacionada ou dado corrompido — trate como credencial inválida
        # na camada de cima (o router transforma isso em 422 pro usuário reconfigurar)
        raise ValueError("não foi possível decriptar app_password_enc")