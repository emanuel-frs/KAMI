#!/usr/bin/env python3
"""
EST-02: gera os bancos de versões antigas que o teste de atualização
(backend/tests/test_bancos_antigos.py) abre com o código atual.

Pra cada tag: `git worktree` da tag, o backend DAQUELA versão num banco
vazio, o `scripts/seed_demo.py` DAQUELA versão (dados 100% fictícios) e
o `kami.db` resultante comprimido em backend/tests/fixtures/bancos/.
Nada da pessoa entra: pasta de dados nova, cofre desligado.

    backend/.venv/bin/python scripts/bancos_antigos.py            # todas
    backend/.venv/bin/python scripts/bancos_antigos.py v1.13.0    # uma

Roda com o Python do venv atual — as versões antigas pedem as mesmas
bibliotecas, em faixas que o venv de hoje cobre.
"""
import gzip
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "backend" / "tests" / "fixtures" / "bancos"
TAGS = ("v1.9.0", "v1.11.0", "v1.13.0", "v1.18.0")


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _esperar(url: str, segundos: int = 60) -> None:
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except OSError:
            time.sleep(0.3)
    raise RuntimeError(f"o backend não subiu em {url}")


def gerar(tag: str, tmp: Path) -> Path:
    arvore = tmp / tag
    subprocess.run(["git", "worktree", "add", "-q", "--detach", str(arvore), tag], cwd=RAIZ, check=True)
    dados = tmp / f"dados-{tag}"
    dados.mkdir()
    env = {**os.environ, "KAMI_DATA_DIR": str(dados), "KAMI_COFRE": "desligado"}
    env.pop("KAMI_SESSION_TOKEN", None)
    porta = _porta_livre()
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(porta)],
        cwd=arvore / "backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    try:
        _esperar(f"http://127.0.0.1:{porta}/health")
        subprocess.run([sys.executable, str(arvore / "scripts" / "seed_demo.py"), "--base-url", f"http://127.0.0.1:{porta}"],
                       cwd=arvore, env=env, check=True, stdout=subprocess.DEVNULL)
    finally:
        backend.terminate()
        backend.wait(timeout=30)
        subprocess.run(["git", "worktree", "remove", "--force", str(arvore)], cwd=RAIZ, check=True)
    banco = dados / "kami.db"
    # junta o WAL no arquivo principal antes de copiar
    conn = sqlite3.connect(banco)
    # as versões antigas semeavam "parte 1"/"parte 2" com valores reais do
    # autor (EST-00) — não vão pra fixture; a migração que as remove tem
    # teste próprio (test_financas.py)
    semeadas = "SELECT id FROM income_sources WHERE nome IN ('parte 1', 'parte 2')"
    conn.execute(f"DELETE FROM income_entries WHERE income_source_id IN ({semeadas})")
    conn.execute(f"DELETE FROM income_sources WHERE id IN ({semeadas})")
    conn.commit()
    conn.execute("VACUUM")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.close()
    DESTINO.mkdir(parents=True, exist_ok=True)
    saida = DESTINO / f"kami-{tag.lstrip('v')}.db.gz"
    with open(banco, "rb") as ent, gzip.GzipFile(saida, "wb", mtime=0) as sai:
        shutil.copyfileobj(ent, sai)
    return saida


def main() -> int:
    tags = sys.argv[1:] or TAGS
    with tempfile.TemporaryDirectory(prefix="kami-bancos-") as tmp:
        for tag in tags:
            saida = gerar(tag, Path(tmp))
            print(f"{tag}: {saida.relative_to(RAIZ)} ({saida.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
