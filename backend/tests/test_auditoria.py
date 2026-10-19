"""
Decisão da auditoria de dependências (scripts/auditoria.py, SEG-04 — regra SEG-22).
"""
import datetime as dt
import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "auditoria.py"
_spec = importlib.util.spec_from_file_location("auditoria", _SCRIPT)
auditoria = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(auditoria)


@pytest.mark.parametrize("vetor,nota", [
    ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8),
    ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:N", 7.2),
    ("CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N", 5.5),
    ("CVSS:3.0/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N", 3.1),
])
def test_seg_22_cvss3_score_matches_the_official_calculator(vetor, nota):
    assert auditoria.cvss3_nota(vetor) == nota


def _pip(vid, aliases=()):
    return {"dependencies": [{"name": "pacote", "version": "1.0", "vulns": [{"id": vid, "aliases": list(aliases), "fix_versions": ["1.1"]}]}]}


def test_seg_22_only_high_and_critical_fail():
    osv = {"GHSA-alta": {"database_specific": {"severity": "HIGH"}},
           "GHSA-media": {"database_specific": {"severity": "MODERATE"}}}
    alta = auditoria.achados_pip(_pip("PYSEC-1", ["GHSA-alta"]), consultar=osv.get)
    media = auditoria.achados_pip(_pip("PYSEC-2", ["GHSA-media"]), consultar=osv.get)
    assert alta[0]["severidade"] == "HIGH" and media[0]["severidade"] == "MODERATE"
    assert auditoria.decidir(alta + media, {}) == alta


def test_seg_22_unknown_severity_counts_as_high():
    achados = auditoria.achados_pip(_pip("PYSEC-9"), consultar=lambda _id: None)
    assert achados[0]["severidade"] == "DESCONHECIDA"
    assert auditoria.decidir(achados, {}) == achados


def test_seg_22_cargo_uses_the_cvss_vector_and_warnings_never_fail():
    rel = {
        "vulnerabilities": {"list": [{"advisory": {"id": "RUSTSEC-2026-0001", "aliases": [], "cvss": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"},
                                      "package": {"name": "crate", "version": "0.1.0"}, "versions": {"patched": [">=0.1.1"]}}]},
        "warnings": {"unmaintained": [{"advisory": {"id": "RUSTSEC-2025-0081"}, "package": {"name": "unic-common", "version": "0.9.0"}}]},
    }
    vulns, avisos = auditoria.achados_cargo(rel, consultar=lambda _id: None)
    assert vulns[0]["severidade"] == "CRITICAL"
    assert len(avisos) == 1
    assert auditoria.decidir(vulns, {}) == vulns


def test_seg_22_exceptions_need_a_date_and_stop_counting_after_it(tmp_path):
    arq = tmp_path / "excecoes.toml"
    arq.write_text(
        '[[excecao]]\nid = "GHSA-x"\nmotivo = "não usamos a função afetada"\nrevisar_ate = "2026-12-31"\n'
        '[[excecao]]\nid = "GHSA-velha"\nmotivo = "x"\nrevisar_ate = "2026-01-01"\n'
    )
    validas, vencidas = auditoria.carregar_excecoes(str(arq), dt.date(2026, 10, 19))
    assert set(validas) == {"GHSA-x"} and vencidas == ["GHSA-velha (venceu em 2026-01-01)"]
    achados = [{"origem": "npm", "pacote": "p", "id": "GHSA-x", "severidade": "CRITICAL", "correcao": "—"},
               {"origem": "npm", "pacote": "q", "id": "GHSA-velha", "severidade": "HIGH", "correcao": "—"}]
    assert [a["id"] for a in auditoria.decidir(achados, validas)] == ["GHSA-velha"]


def test_seg_22_npm_report_is_read_with_its_own_severity():
    rel = {"vulnerabilities": {"lodash": {"severity": "high", "via": [{"url": "https://github.com/advisories/GHSA-abcd"}], "fixAvailable": True}}}
    achados = auditoria.achados_npm(rel)
    assert achados == [{"origem": "npm", "pacote": "lodash", "id": "GHSA-abcd", "severidade": "HIGH", "correcao": "sim"}]
