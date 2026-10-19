"""
docs/REGRAS-DE-NEGOCIO.md não pode ficar desatualizado em silêncio (CONF-04).

Cada regra do documento cita os testes que a garantem como
`arquivo::teste`. Este teste confere que cada teste citado existe de
verdade — renomear ou apagar um teste sem atualizar o documento quebra
aqui —, que os códigos das regras não se repetem e que toda regra cita ao
menos um teste.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "REGRAS-DE-NEGOCIO.md"
TESTS = ROOT / "backend" / "tests"

ROW = re.compile(r"^\| ([A-Z]+-\d+) \| (.+?) \| (.+?) \|$", re.M)
REF = re.compile(r"`(test_[a-z0-9_]+\.py)::(test_[A-Za-z0-9_]+)`")


def _rows():
    return ROW.findall(DOC.read_text(encoding="utf-8"))


def test_documento_tem_regras():
    assert len(_rows()) >= 50


def test_codigos_das_regras_nao_se_repetem():
    ids = [r[0] for r in _rows()]
    assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})


def test_toda_regra_cita_teste_que_existe():
    faltando = []
    for rule_id, _desc, tests in _rows():
        refs = REF.findall(tests)
        if not refs:
            faltando.append(f"{rule_id}: nenhum teste citado")
        for arquivo, nome in refs:
            path = TESTS / arquivo
            if not path.exists() or not re.search(rf"^def {nome}\(", path.read_text(encoding="utf-8"), re.M):
                faltando.append(f"{rule_id}: {arquivo}::{nome} não existe")
    assert not faltando, "\n".join(faltando)
