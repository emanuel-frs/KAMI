"""
Cópias automáticas do banco (CONF-08).

Antes daqui só existia a cópia de antes de migrar (CONF-05) e o lembrete
de exportar a cada 14 dias. Agora, em <pasta de dados>/backups/:

  - kami-semanal-AAAAMMDD-HHMMSS.db — ao abrir (e a cada poucas horas
    com o app aberto, pelo frontend) se a última tem mais de 7 dias;
    ficam as SEMANAL_MANTER mais recentes (decidido: 4, um mês);
  - kami-antes-de-<ação>-AAAAMMDD-HHMMSS.db — antes de importar um
    backup, apagar tudo, redefinir a chave dos segredos, restaurar uma
    cópia (e, na Sprint 9, aplicar um lote da IA); ficam ANTES_MANTER.

Pasta extra (decidido: qualquer pasta — pendrive, HD externo, pasta
sincronizada do Drive/Dropbox): a cópia semanal também vai pra lá. Assim
um disco perdido também fica coberto, sem o Kami ter servidor. Só
arquivos kami-semanal-*.db são escritos e apagados lá — nada mais da
pasta é lido nem tocado. Pasta fora (pendrive desconectado) → pula em
silêncio; o aviso só aparece se passar EXTRA_AVISO_DIAS sem cópia lá.

As cópias levam os segredos (senhas de e-mail, tokens) cifrados com a
chave do cofre DESTE computador: noutra máquina o resto abre, os segredos
não — igual a copiar a pasta de dados (P-18). Pra levar tudo, o backup
exportado com senha (SEG-03).

Tudo pela API de backup do sqlite (`conn.backup`): cópia consistente com
o banco aberto e com o WAL.
"""
import datetime
import logging
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Optional

from app import database
from app.mensagens import Texto

logger = logging.getLogger(__name__)

SEMANAL_PREFIXO = "kami-semanal-"
SEMANAL_MANTER = 4
SEMANAL_DIAS = 7
ANTES_PREFIXO = "kami-antes-de-"
ANTES_MANTER = 5
EXTRA_AVISO_DIAS = 30

# chaves em sistema_info (fica fora do export: o caminho é desta máquina)
CHAVE_PASTA = "backup_pasta_extra"
CHAVE_EXTRA_OK = "backup_extra_ok_em"
CHAVE_EXTRA_ERRO = "backup_extra_erro"

TIPOS = {
    SEMANAL_PREFIXO: "semanal",
    ANTES_PREFIXO: "antes",
    database.MIGRATION_BACKUP_PREFIX: "atualizacao",
}


class PastaInvalida(ValueError):
    """A pasta extra escolhida não existe ou não aceita escrita."""


class CopiaDesconhecida(ValueError):
    """O nome pedido não é uma cópia da pasta de backups."""


def _carimbo() -> str:
    return database.local_now().strftime("%Y%m%d-%H%M%S")


def _quando(path: Path) -> Optional[datetime.datetime]:
    """Data/hora do FIM do nome (…-AAAAMMDD-HHMMSS.db), no fuso local."""
    try:
        return datetime.datetime.strptime(path.stem[-15:], "%Y%m%d-%H%M%S").astimezone()
    except ValueError:
        return None


def _copiar(conn: sqlite3.Connection, destino: Path) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    dest = sqlite3.connect(destino)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return destino


def _podar(pasta: Path, prefixo: str, manter: int) -> None:
    arquivos = sorted((p for p in pasta.glob(f"{prefixo}*.db") if _quando(p)), key=lambda p: p.stem[-15:])
    for velho in arquivos[:-manter] if manter else arquivos:
        velho.unlink(missing_ok=True)


def _info(conn: sqlite3.Connection, chave: str) -> Optional[str]:
    row = conn.execute("SELECT valor FROM sistema_info WHERE chave = ?", (chave,)).fetchone()
    return row["valor"] if row and row["valor"] else None


def _gravar_info(conn: sqlite3.Connection, chave: str, valor: Optional[str]) -> None:
    if valor is None:
        conn.execute("DELETE FROM sistema_info WHERE chave = ?", (chave,))
    else:
        conn.execute(
            "INSERT INTO sistema_info (chave, valor) VALUES (?, ?) "
            "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
            (chave, valor),
        )
    conn.commit()


# ─── pasta extra ──────────────────────────────────────────────────────────


def _validar_pasta(texto: str) -> Path:
    pasta = Path(os.path.expanduser(texto.strip()))
    if not pasta.is_absolute():
        raise PastaInvalida(Texto("erro.copias.caminho_completo", "use o caminho completo da pasta (ex.: /media/pendrive/kami ou D:\\kami)"))
    if not pasta.is_dir():
        raise PastaInvalida(Texto("erro.copias.pasta_inexistente", "essa pasta não existe (pendrive ou disco conectado?)"))
    teste = pasta / f".kami-teste-{_carimbo()}"
    try:
        teste.write_bytes(b"kami")
        teste.unlink()
    except OSError:
        raise PastaInvalida(Texto("erro.copias.sem_escrita", "o Kami não consegue gravar nessa pasta"))
    return pasta.resolve()


def definir_pasta_extra(conn: sqlite3.Connection, texto: Optional[str]) -> None:
    """Liga (validando e já copiando a última semanal) ou desliga a pasta extra."""
    if not texto or not texto.strip():
        for chave in (CHAVE_PASTA, CHAVE_EXTRA_OK, CHAVE_EXTRA_ERRO):
            _gravar_info(conn, chave, None)
        return
    pasta = _validar_pasta(texto)
    _gravar_info(conn, CHAVE_PASTA, str(pasta))
    _gravar_info(conn, CHAVE_EXTRA_OK, None)
    _gravar_info(conn, CHAVE_EXTRA_ERRO, None)
    ultima = _ultima_semanal()
    if ultima is None:
        ultima = _copia_semanal(conn)
    _copiar_para_extra(conn, ultima)


def _copiar_para_extra(conn: sqlite3.Connection, arquivo: Path) -> None:
    pasta_txt = _info(conn, CHAVE_PASTA)
    if not pasta_txt:
        return
    pasta = Path(pasta_txt)
    try:
        if not pasta.is_dir():
            raise FileNotFoundError(pasta_txt)
        shutil.copyfile(arquivo, pasta / arquivo.name)
        _podar(pasta, SEMANAL_PREFIXO, SEMANAL_MANTER)
    except OSError as exc:
        # pendrive fora, pasta apagada, sem espaço: não é erro do app —
        # fica registrado, e o aviso só vem depois de EXTRA_AVISO_DIAS
        logger.info("cópia pra pasta extra não foi feita (%s): %s", pasta_txt, exc.__class__.__name__)
        _gravar_info(conn, CHAVE_EXTRA_ERRO, "pasta indisponível")
        return
    _gravar_info(conn, CHAVE_EXTRA_OK, database.now_iso())
    _gravar_info(conn, CHAVE_EXTRA_ERRO, None)


# ─── cópias ───────────────────────────────────────────────────────────────


def _ultima_semanal() -> Optional[Path]:
    arquivos = sorted((p for p in database.backups_dir().glob(f"{SEMANAL_PREFIXO}*.db") if _quando(p)), key=lambda p: p.stem[-15:])
    return arquivos[-1] if arquivos else None


def _copia_semanal(conn: sqlite3.Connection) -> Path:
    destino = _copiar(conn, database.backups_dir() / f"{SEMANAL_PREFIXO}{_carimbo()}.db")
    _podar(database.backups_dir(), SEMANAL_PREFIXO, SEMANAL_MANTER)
    logger.info("cópia semanal do banco: %s", destino.name)
    return destino


def copia_semanal_se_precisar(conn: sqlite3.Connection, forcar: bool = False) -> Optional[Path]:
    """
    Faz a cópia semanal se a última tem mais de SEMANAL_DIAS (ou não
    existe). Devolve o arquivo novo, ou None se não precisou. Também tenta
    de novo a pasta extra se ela ficou pra trás (pendrive voltou).
    """
    ultima = _ultima_semanal()
    vencida = ultima is None or (database.local_now() - _quando(ultima)) >= datetime.timedelta(days=SEMANAL_DIAS)
    if forcar or vencida:
        nova = _copia_semanal(conn)
        _copiar_para_extra(conn, nova)
        return nova
    if _info(conn, CHAVE_EXTRA_ERRO) or (_info(conn, CHAVE_PASTA) and not _info(conn, CHAVE_EXTRA_OK)):
        _copiar_para_extra(conn, ultima)
    return None


def copia_antes_de(conn: sqlite3.Connection, acao: str) -> Path:
    """Cópia antes de uma ação grande (importar, apagar tudo, redefinir a chave...)."""
    destino = _copiar(conn, database.backups_dir() / f"{ANTES_PREFIXO}{acao}-{_carimbo()}.db")
    _podar(database.backups_dir(), ANTES_PREFIXO, ANTES_MANTER)
    logger.info("cópia antes de %s: %s", acao, destino.name)
    return destino


def listar() -> list[dict]:
    """As cópias da pasta de backups, da mais nova pra mais velha."""
    copias = []
    pasta = database.backups_dir()
    if not pasta.is_dir():
        return copias
    for p in pasta.glob("kami-*.db"):
        quando = _quando(p)
        tipo = next((t for prefixo, t in TIPOS.items() if p.name.startswith(prefixo)), None)
        if not quando or not tipo:
            continue
        acao = None
        if tipo == "antes":
            acao = p.stem[len(ANTES_PREFIXO):-16] or None
        elif tipo == "atualizacao":
            acao = p.stem[len(database.MIGRATION_BACKUP_PREFIX):-16] or None  # a versão
        copias.append({"nome": p.name, "tipo": tipo, "acao": acao, "quando": quando.isoformat(timespec="seconds"), "tamanho": p.stat().st_size})
    copias.sort(key=lambda c: c["quando"], reverse=True)
    return copias


def status(conn: sqlite3.Connection) -> dict:
    ok_em = _info(conn, CHAVE_EXTRA_OK)
    pasta = _info(conn, CHAVE_PASTA)
    atrasada = False
    if pasta:
        if ok_em:
            atrasada = database.local_now() - datetime.datetime.fromisoformat(ok_em) > datetime.timedelta(days=EXTRA_AVISO_DIAS)
        else:
            atrasada = bool(_info(conn, CHAVE_EXTRA_ERRO))
    return {
        "copias": listar(),
        "semanal_manter": SEMANAL_MANTER,
        "semanal_dias": SEMANAL_DIAS,
        "pasta_extra": pasta,
        "extra_ok_em": ok_em,
        "extra_erro": _info(conn, CHAVE_EXTRA_ERRO),
        "extra_atrasada": atrasada,
    }


def restaurar(nome: str) -> Path:
    """
    Volta o banco pra uma cópia da pasta de backups. Antes, guarda o estado
    atual (kami-antes-de-restaurar-…, decidido) pra dar pra voltar atrás.
    Depois roda o init_db: uma cópia de versão anterior passa pelas
    migrações (com o backup de migração do CONF-05, como qualquer
    atualização).
    """
    if Path(nome).name != nome or not any(nome.startswith(p) for p in TIPOS) or not nome.endswith(".db"):
        raise CopiaDesconhecida(nome)
    origem = database.backups_dir() / nome
    if not origem.is_file():
        raise CopiaDesconhecida(nome)

    atual = database.get_connection()
    try:
        # a pasta extra é desta máquina, não da cópia: volta como estava
        manter = {c: _info(atual, c) for c in (CHAVE_PASTA, CHAVE_EXTRA_OK, CHAVE_EXTRA_ERRO)}
        guardada = copia_antes_de(atual, "restaurar")
        src = sqlite3.connect(origem)
        try:
            src.backup(atual)  # sobrescreve o banco aberto pela API de backup (consistente com o WAL)
        finally:
            src.close()
    finally:
        atual.close()
    database.init_db()
    conn = database.get_connection()
    try:
        for chave, valor in manter.items():
            _gravar_info(conn, chave, valor)
    finally:
        conn.close()
    logger.info("banco restaurado de %s (o estado anterior ficou em %s)", nome, guardada.name)
    return guardada
