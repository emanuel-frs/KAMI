"""
DIST-01: scripts/gerar_latest_json.py, o latest.json que o app consulta pra
avisar de versão nova (rodado pelo release.yml).
"""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "gerar_latest_json.py"


def _script():
    spec = importlib.util.spec_from_file_location("gerar_latest_json", SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


CHANGELOG = """# Changelog

## [1.15.0] - 2026-11-01

### Adicionado
- idioma: 10 línguas.

## [1.14.0] - 2026-10-25

- aviso de versão nova.

[1.15.0]: https://github.com/emanuel-frs/KAMI/releases/tag/v1.15.0
"""


def test_notas_sao_so_a_secao_da_versao():
    g = _script()
    assert g.notas_da_versao(CHANGELOG, "1.15.0") == "### Adicionado\n- idioma: 10 línguas."
    assert g.notas_da_versao(CHANGELOG, "1.14.0") == "- aviso de versão nova."
    assert g.notas_da_versao(CHANGELOG, "9.9.9") == ""


def test_latest_json_no_formato_do_updater(tmp_path, capsys):
    g = _script()
    (tmp_path / "a.sig").write_text("assinatura-appimage\n", encoding="utf-8")
    (tmp_path / "w.sig").write_text("assinatura-windows", encoding="utf-8")
    (tmp_path / "CHANGELOG.md").write_text(CHANGELOG, encoding="utf-8")
    g.main([
        "--versao", "1.15.0",
        "--base-url", "https://github.com/emanuel-frs/KAMI/releases/download/v1.15.0/",
        "--appimage", "kami-1.15.0-linux-x86_64.AppImage", str(tmp_path / "a.sig"),
        "--windows", "kami-1.15.0-windows-x64-setup.exe", str(tmp_path / "w.sig"),
        "--changelog", str(tmp_path / "CHANGELOG.md"),
        "--data", "2026-11-01T12:00:00Z",
    ])
    doc = json.loads(capsys.readouterr().out)
    assert doc == {
        "version": "1.15.0",
        "notes": "### Adicionado\n- idioma: 10 línguas.",
        "pub_date": "2026-11-01T12:00:00Z",
        "platforms": {
            "linux-x86_64": {
                "signature": "assinatura-appimage",
                "url": "https://github.com/emanuel-frs/KAMI/releases/download/v1.15.0/kami-1.15.0-linux-x86_64.AppImage",
            },
            "windows-x86_64": {
                "signature": "assinatura-windows",
                "url": "https://github.com/emanuel-frs/KAMI/releases/download/v1.15.0/kami-1.15.0-windows-x64-setup.exe",
            },
        },
    }


def test_assinatura_vazia_para_a_release(tmp_path):
    g = _script()
    (tmp_path / "vazia.sig").write_text("  \n", encoding="utf-8")
    (tmp_path / "w.sig").write_text("ok", encoding="utf-8")
    with pytest.raises(ValueError, match="assinatura vazia"):
        g.gerar("1.15.0", "https://x", ("a", tmp_path / "vazia.sig"), ("w", tmp_path / "w.sig"))
