"""
EST-02: bancos de versões antigas (1.9.0, 1.11.0, 1.13.0 e 1.18.0, com os
dados de demonstração daquela versão — gerados por scripts/bancos_antigos.py)
abrem com o código atual: as migrações passam, nada some, o backup de
atualização é feito e todas as telas respondem.
"""
import gzip
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app

BANCOS = sorted((Path(__file__).parent / "fixtures" / "bancos").glob("kami-*.db.gz"))


def _contagens(caminho: Path) -> dict:
    conn = sqlite3.connect(caminho)
    try:
        tabelas = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")]
        return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tabelas}
    finally:
        conn.close()


def _esquema(caminho: Path) -> dict:
    conn = sqlite3.connect(caminho)
    try:
        tabelas = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        return {t: sorted(r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')) for t in tabelas}
    finally:
        conn.close()


@pytest.fixture(scope="module")
def esquema_novo(tmp_path_factory):
    """Tabelas e colunas de uma instalação nova da versão atual."""
    caminho = tmp_path_factory.mktemp("novo") / "kami.db"
    original = database.DB_PATH
    database.DB_PATH = caminho
    try:
        database.init_db()
    finally:
        database.DB_PATH = original
    return _esquema(caminho)


def _versao(caminho: Path):
    conn = sqlite3.connect(caminho)
    try:
        return conn.execute("SELECT valor FROM sistema_info WHERE chave = 'versao_banco'").fetchone()[0]
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def test_ha_um_banco_por_versao_antiga():
    assert [b.name for b in BANCOS] == ["kami-1.11.0.db.gz", "kami-1.13.0.db.gz", "kami-1.18.0.db.gz", "kami-1.9.0.db.gz"]


@pytest.mark.parametrize("banco", BANCOS, ids=lambda b: b.name.removesuffix(".db.gz"))
def test_banco_antigo_abre_na_versao_atual(banco, temp_db_path, esquema_novo):
    temp_db_path.write_bytes(gzip.decompress(banco.read_bytes()))
    antes = _contagens(temp_db_path)
    versao_antes = _versao(temp_db_path)

    database.init_db()

    assert _versao(temp_db_path) == database.KAMI_VERSION
    copias = list(database.backups_dir().glob(f"{database.MIGRATION_BACKUP_PREFIX}*.db"))
    assert len(copias) == (0 if versao_antes == database.KAMI_VERSION else 1)

    # toda migração que faltar aparece aqui: tabela ou coluna diferente da instalação nova
    assert _esquema(temp_db_path) == esquema_novo

    depois = _contagens(temp_db_path)
    perdas = {t: (n, depois.get(t)) for t, n in antes.items() if depois.get(t, 0) < n}
    assert perdas == {}

    def _get_db():
        conn = database.get_connection()
        try:
            yield conn
        finally:
            conn.close()

    app.dependency_overrides[database.get_db] = _get_db
    try:
        with TestClient(app) as client:
            rotas = sorted(
                caminho for caminho, metodos in app.openapi()["paths"].items()
                if "get" in metodos and "{" not in caminho
            )
            assert len(rotas) > 50
            erros = {p: c for p in rotas if (c := client.get(p).status_code) >= 500}
            assert erros == {}
    finally:
        app.dependency_overrides.clear()
