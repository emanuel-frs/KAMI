"""
Ligar, desligar e recuperar o banco cifrado (SEG-08) — a parte que mexe
nos arquivos. A camada de baixo (modo, chave, conexões) é app/cifra.py.

Ligar (P-168, P-169):
  1. chave do cofre (a que já existe, ou uma nova conferida);
  2. cópia de antes (kami-antes-de-cifra-…, ainda sem cifra);
  3. com todas as conexões fechadas: checkpoint do WAL, sqlcipher_export
     pra kami.db.convertendo, contagem de linhas igual tabela a tabela,
     e só então a troca dos arquivos;
  4. se a pessoa marcou: apaga as cópias automáticas sem cifra (na pasta
     de backups e as semanais da pasta extra) e faz uma semanal nova, já
     cifrada — nunca fica sem cópia nenhuma;
  5. devolve o código de recuperação (mostrado uma vez).

Desligar é o caminho de volta (a chave fica no cofre: as cópias cifradas
continuam restauráveis).

Subida sem a chave: o backend sobe trancado (423 com o código
"cifra_sem_chave") e só aceita o código de recuperação.
"""
import logging
import os
import time
from pathlib import Path

from app import backup_auto, cifra, database
from app.mensagens import Texto

logger = logging.getLogger(__name__)

_sem_chave = False


def trancado() -> bool:
    return _sem_chave


def marcar_sem_chave(valor: bool) -> None:
    global _sem_chave
    _sem_chave = valor


def _motivo_indisponivel() -> str | None:
    if not cifra.biblioteca_ok():
        return "biblioteca"
    backend, _motivo = cifra._cofre()
    return None if backend is not None else "cofre"


def _copias_sem_cifra(conn) -> list[Path]:
    arquivos = list(database.backups_dir().glob("*.db")) if database.backups_dir().is_dir() else []
    extra = backup_auto._info(conn, backup_auto.CHAVE_PASTA) if conn is not None else None
    if extra and Path(extra).is_dir():
        arquivos += list(Path(extra).glob(f"{backup_auto.SEMANAL_PREFIXO}*.db"))
    return [p for p in arquivos if p.is_file() and not cifra.arquivo_cifrado(p)]


def estado(conn=None) -> dict:
    db_path = database.DB_PATH
    ligada = cifra.ligada(db_path)
    return {
        "ligada": ligada,
        "sem_chave": _sem_chave,
        "disponivel": _motivo_indisponivel() is None,
        "motivo": _motivo_indisponivel(),
        "copias_sem_cifra": len(_copias_sem_cifra(conn)) if conn is not None else 0,
    }


def _substituir(origem: Path, destino: Path, tentativas: int = 20) -> None:
    """os.replace com novas tentativas: no Windows, antivírus e indexador
    seguram o arquivo recém-fechado por um instante (WinError 32)."""
    for i in range(tentativas):
        try:
            os.replace(origem, destino)
            return
        except PermissionError:
            if i == tentativas - 1:
                raise
            time.sleep(0.25)


def _trocar(chave_origem, chave_destino) -> None:
    """Converte o kami.db pro outro modo e troca os arquivos (sem conexões abertas)."""
    db_path = database.DB_PATH
    novo = db_path.with_name(db_path.name + ".convertendo")
    velho = db_path.with_name(db_path.name + ".anterior")
    novo.unlink(missing_ok=True)
    with database.exclusivo():
        origem = cifra.conectar(db_path, chave_origem is not None, chave_origem)
        try:
            origem.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            antes = cifra.contagens(origem)
        finally:
            origem.close()
        cifra.exportar(db_path, chave_origem, novo, chave_destino)
        conferir = cifra.conectar(novo, chave_destino is not None, chave_destino)
        try:
            depois = cifra.contagens(conferir)
            # o sqlcipher_export cria o arquivo no modo de diário comum: o WAL
            # entra aqui, com uma conexão só — senão as requisições que chegam
            # juntas depois da troca brigam pra mudar o modo ("locked")
            conferir.execute("PRAGMA journal_mode = WAL").fetchone()
        finally:
            conferir.close()
        if antes != depois:
            novo.unlink(missing_ok=True)
            raise RuntimeError("a conversão do banco não conferiu (contagem de linhas diferente)")
        for sufixo in ("-wal", "-shm"):
            Path(str(db_path) + sufixo).unlink(missing_ok=True)
        _substituir(db_path, velho)
        try:
            _substituir(novo, db_path)
        except OSError:
            _substituir(velho, db_path)
            raise
        cifra.esquecer_modo(db_path)
        velho.unlink(missing_ok=True)


def ligar(apagar_copias: bool) -> dict:
    motivo = _motivo_indisponivel()
    if motivo == "biblioteca":
        raise cifra.Indisponivel(Texto("erro.cifra.biblioteca", "esta instalação do Kami não tem suporte a banco cifrado"))
    if motivo == "cofre":
        raise cifra.Indisponivel(Texto("erro.cifra.sem_cofre", "sem o cofre do sistema não dá pra guardar a chave do banco"))
    db_path = database.DB_PATH
    if cifra.ligada(db_path):
        raise cifra.Indisponivel(Texto("erro.cifra.ja_ligada", "o banco já está cifrado"))
    chave = cifra.chave_para_ligar(db_path)
    conn = database.get_connection()
    try:
        backup_auto.copia_antes_de(conn, "cifra")
    finally:
        conn.close()
    _trocar(None, chave)
    logger.warning("banco cifrado ligado (SEG-08)")

    apagadas = 0
    conn = database.get_connection()
    try:
        if apagar_copias:
            for copia in _copias_sem_cifra(conn):
                try:
                    copia.unlink()
                    apagadas += 1
                except OSError:
                    logger.warning("não deu pra apagar a cópia sem cifra %s", copia.name)
            backup_auto.copia_semanal_se_precisar(conn, forcar=True)
        restantes = len(_copias_sem_cifra(conn))
    finally:
        conn.close()
    return {"codigo": cifra.codigo_da_chave(chave), "copias_apagadas": apagadas, "copias_sem_cifra": restantes}


def desligar() -> dict:
    db_path = database.DB_PATH
    if not cifra.ligada(db_path):
        raise cifra.Indisponivel(Texto("erro.cifra.ja_desligada", "o banco não está cifrado"))
    chave = cifra.chave(db_path)
    conn = database.get_connection()
    try:
        backup_auto.copia_antes_de(conn, "decifrar")
    finally:
        conn.close()
    _trocar(chave, None)
    logger.warning("banco cifrado desligado (SEG-08)")
    return {"ligada": False}


def mostrar_codigo() -> str:
    db_path = database.DB_PATH
    chave = cifra.chave(db_path) if cifra.ligada(db_path) else None
    if not chave:
        raise cifra.Indisponivel(Texto("erro.cifra.ja_desligada", "o banco não está cifrado"))
    return cifra.codigo_da_chave(chave)


def recuperar(codigo: str) -> dict:
    """Código certo → abre o banco, guarda a chave no cofre (se houver) e sobe o resto."""
    db_path = database.DB_PATH
    chave = cifra.chave_do_codigo(codigo)
    if not cifra.chave_abre(db_path, chave):
        raise cifra.CodigoErrado(Texto("erro.cifra.codigo_errado", "esse código não abre o banco deste computador"))
    cifra._chaves[str(db_path.parent)] = chave
    no_cofre = cifra._guardar(db_path, chave)
    marcar_sem_chave(False)
    database.init_db()
    logger.warning("banco cifrado aberto com o código de recuperação (chave %s)",
                   "de volta no cofre" if no_cofre else "só na memória — sem cofre")
    return {"no_cofre": no_cofre}
