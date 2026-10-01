"""
Criptografia local para senhas de app (ex: senha de app do IMAP) —
usada pelo módulo Organização.

Usa Fernet (cryptography) com uma chave simétrica gerada uma única vez
e guardada em backend/.secret_key — fora do kami.db, fora do schema.sql.
Isso evita guardar a senha em texto puro no banco; NÃO é hardening
contra alguém com acesso total à máquina (fora do threat model do
projeto: app single-user, local, sem exposição externa). A chave mora
na mesma pasta do banco, então isso protege contra "abrir o kami.db por
acaso" (backup em nuvem, arquivo compartilhado), não contra outro
processo rodando como o mesmo usuário. Guardar no cofre do SO
(Credential Manager / Secret Service) está no roadmap.

.secret_key deve entrar no .gitignore junto com kami.db.
"""
from cryptography.fernet import Fernet, InvalidToken
import os

from app.paths import get_data_dir

# .secret_key mora na pasta de dados do usuário (get_data_dir), não
# mais fixo em "ao lado do código" — mesmo motivo do DB_PATH em
# database.py (fase 15.8, sidecar/PyInstaller): o diretório do
# executável --onefile é temporário e é apagado a cada saída. Se a
# chave "resetasse" a cada abertura do app, toda senha de e-mail já
# criptografada ficaria irrecuperável (InvalidToken pra sempre).
KEY_PATH = get_data_dir() / ".secret_key"


def _load_or_create_key() -> bytes:
    if KEY_PATH.exists():
        # corrige instalações antigas, que criaram a chave com 0644
        try:
            os.chmod(KEY_PATH, 0o600)
        except OSError:
            pass
        return KEY_PATH.read_bytes()
    key = Fernet.generate_key()
    # cria o arquivo já com permissão 0600 (só o dono lê) em vez de
    # gravar com o umask padrão (tipicamente 0644, legível por qualquer
    # usuário da máquina). No Windows o modo é praticamente ignorado —
    # lá quem protege é o ACL do %APPDATA% do próprio usuário.
    fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(key)
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