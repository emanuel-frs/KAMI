#!/usr/bin/env python3
"""
Gera o latest.json do updater (DIST-01) — rodado pelo release.yml.

O app consulta https://github.com/<repo>/releases/latest/download/latest.json
(tauri.conf.json › plugins.updater) pra AVISAR de versão nova. O arquivo diz
a versão, as novidades (a seção desta versão no CHANGELOG.md), a data e, por
sistema, de onde baixar e a assinatura do pacote (o .sig que o
`cargo tauri build` gera com a chave do updater).

Só o AppImage (linux-x86_64) e o instalador do Windows (windows-x86_64) se
atualizam pelo app; .deb/.rpm/AUR recebem só o aviso (a tela não oferece
"atualizar agora" — src-tauri/src/atualizacao.rs).

"releases/latest" do GitHub ignora pré-release: quem tem a versão publicada
não é avisado de um 2.0.0-rc.N.

Uso:
  gerar_latest_json.py --versao 1.15.0 --base-url https://.../download/v1.15.0 \\
      --appimage <nome publicado> <arquivo .sig> \\
      --windows <nome publicado> <arquivo .sig> \\
      [--changelog CHANGELOG.md] [--data 2026-11-01T12:00:00Z]
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path


def notas_da_versao(changelog: str, versao: str) -> str:
    """O texto da seção `## [versao]` do CHANGELOG, sem o título."""
    m = re.search(rf"^## \[{re.escape(versao)}\][^\n]*\n(.*?)(?=^## \[|\Z)", changelog, re.S | re.M)
    if not m:
        return ""
    # links de referência do fim do arquivo ([1.15.0]: https://...) não são novidade
    texto = "\n".join(l for l in m.group(1).splitlines() if not re.match(r"^\[[^\]]+\]:\s", l))
    return texto.strip()


def gerar(versao, base_url, appimage, windows, notas="", data=None) -> dict:
    base = base_url.rstrip("/")
    plataformas = {}
    for chave, (nome, sig) in (("linux-x86_64", appimage), ("windows-x86_64", windows)):
        assinatura = Path(sig).read_text(encoding="utf-8").strip()
        if not assinatura:
            raise ValueError(f"assinatura vazia em {sig}")
        plataformas[chave] = {"signature": assinatura, "url": f"{base}/{nome}"}
    data = data or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"version": versao, "notes": notas, "pub_date": data, "platforms": plataformas}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Gera o latest.json do updater do Kami.")
    p.add_argument("--versao", required=True)
    p.add_argument("--base-url", required=True)
    p.add_argument("--appimage", nargs=2, metavar=("NOME", "SIG"), required=True)
    p.add_argument("--windows", nargs=2, metavar=("NOME", "SIG"), required=True)
    p.add_argument("--changelog", type=Path)
    p.add_argument("--data", help="ISO 8601 em UTC (padrão: agora)")
    args = p.parse_args(argv)
    notas = notas_da_versao(args.changelog.read_text(encoding="utf-8"), args.versao) if args.changelog else ""
    json.dump(gerar(args.versao, args.base_url, args.appimage, args.windows, notas, args.data), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
