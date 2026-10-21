"""
Superfície do app Tauri (SEG-04 — regra SEG-23): o que a janela pode
fazer fica fixado aqui. Liberar uma permissão nova, um comando Rust novo
ou afrouxar a CSP passa a ser uma mudança consciente — quebra este teste
e pede pra atualizar a lista (e o SECURITY.md).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TAURI = ROOT / "src-tauri"


def test_seg_23_window_permissions_are_the_minimum_the_app_uses():
    cap = json.loads((TAURI / "capabilities" / "default.json").read_text(encoding="utf-8"))
    nomes = sorted(p if isinstance(p, str) else p["identifier"] for p in cap["permissions"])
    assert nomes == [
        "core:default",
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-start-dragging",
        "core:window:allow-toggle-maximize",
        "notification:default",
        "opener:allow-open-url",
    ]
    assert not [n for n in nomes if n.startswith(("shell:", "fs:", "process:", "http:"))]
    opener = next(p for p in cap["permissions"] if isinstance(p, dict) and p["identifier"] == "opener:allow-open-url")
    assert sorted(u["url"] for u in opener["allow"]) == ["http://*", "https://*"]  # nada de file:// ou esquemas do sistema


def test_seg_23_csp_runs_only_the_apps_own_code_and_talks_only_to_the_local_backend():
    conf = json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf-8"))
    csp = dict(
        (partes[0], partes[1:])
        for partes in (d.split() for d in conf["app"]["security"]["csp"].split(";") if d.strip())
    )
    assert csp["default-src"] == ["'self'"]
    assert "script-src" not in csp  # cai no default-src 'self': sem inline, sem eval
    assert csp["connect-src"] == ["'self'", "http://127.0.0.1:*"]
    assert not any("unsafe-eval" in v for vals in csp.values() for v in vals)


def test_seg_23_rust_commands_exposed_to_the_window_are_known():
    main_rs = (TAURI / "src" / "main.rs").read_text(encoding="utf-8")
    bloco = re.search(r"generate_handler!\[(.*?)\]", main_rs, re.S).group(1)
    comandos = sorted(c.strip() for c in bloco.split(",") if c.strip())
    # ORG-05: janela_* = bandeja/iniciar com o sistema (só ligam/desligam as
    # duas opções da máquina e saem do app — src-tauri/src/janela.rs)
    assert comandos == [
        "get_backend_port", "get_backend_token", "icone_tema::aplicar_icone_tema",
        "janela::janela_definir", "janela::janela_preferencias", "janela::janela_sair",
        "open_log_folder", "restart_backend",
    ]
