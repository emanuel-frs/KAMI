#!/usr/bin/env python3
"""
Notas da página de download de cada Release (DIST-02) — rodado pelo
release.yml no lugar do antigo "Ver CHANGELOG.md".

A página da Release é por onde quase todo mundo baixa o Kami, então ela
precisa dizer, sem a pessoa ter que abrir outro documento:
  - o que mudou (a seção desta versão no CHANGELOG.md);
  - qual arquivo baixar em cada sistema;
  - ao lado do instalador do Windows: que o SmartScreen VAI mostrar
    "editor desconhecido" (o Kami não é assinado — decisão P-76/P-76b) e
    como seguir, com o SHA256 do .exe já impresso pra conferir.

Uso:
  gerar_notas_release.py --versao 1.15.0 --changelog CHANGELOG.md --sums release-assets/SHA256SUMS
"""
import argparse
import importlib.util
import sys
from pathlib import Path

REPO = "emanuel-frs/KAMI"
INSTALACAO = f"https://github.com/{REPO}/blob/main/docs/INSTALACAO.md"


def _notas_da_versao(changelog: str, versao: str) -> str:
    # mesma leitura do latest.json (DIST-01): uma regra só pras duas
    spec = importlib.util.spec_from_file_location("gerar_latest_json", Path(__file__).with_name("gerar_latest_json.py"))
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo.notas_da_versao(changelog, versao)


def hash_do(sums: str, arquivo: str) -> str:
    for linha in sums.splitlines():
        partes = linha.split()
        if len(partes) == 2 and partes[1].lstrip("*") == arquivo:
            return partes[0]
    raise ValueError(f"{arquivo} não está no SHA256SUMS")


def gerar(versao: str, changelog: str, sums: str) -> str:
    exe = f"kami-{versao}-windows-x64-setup.exe"
    hash_exe = hash_do(sums, exe)
    novidades = _notas_da_versao(changelog, versao) or "Veja o CHANGELOG.md."
    return f"""## Novidades

{novidades}

## Qual arquivo baixar

| Sistema | Arquivo |
|---|---|
| Windows 10/11 | `{exe}` (veja o aviso abaixo) |
| Ubuntu, Debian, Mint | `kami-{versao}-linux-amd64.deb` |
| Fedora, openSUSE | `kami-{versao}-linux-x86_64.rpm` |
| Arch (AUR) | `kami-{versao}-PKGBUILD` |
| qualquer Linux | `kami-{versao}-linux-x86_64.AppImage` |

Já usa o Kami 1.14 ou mais novo? O próprio app avisa no sino quando sai
uma versão — no Windows e no AppImage ele também instala, se você pedir.

## Windows: o aviso "editor desconhecido" é esperado

O Kami **não é assinado** (assinatura de código para Windows é paga e o
Kami é um projeto pessoal), então ao abrir o instalador o Windows mostra
a tela azul do SmartScreen: **"O Windows protegeu o computador"**, com
"editor desconhecido". Isso acontece com todo programa novo sem
assinatura e não quer dizer que o arquivo é perigoso — nem que é seguro.
Antes de seguir, confira que o arquivo é este mesmo:

1. Baixe o instalador **só desta página**.
2. No PowerShell, na pasta do download:
   `Get-FileHash .\\{exe} -Algorithm SHA256`
3. O resultado tem que ser exatamente:
   `{hash_exe.upper()}`
   (é a linha do `.exe` no `SHA256SUMS` desta Release).
4. Conferiu? Na tela do SmartScreen, clique em **Mais informações** e
   depois em **Executar assim mesmo**.

Se o Defender bloquear ou o Smart App Control impedir a instalação, o
passo a passo está em [Windows sem assinatura]({INSTALACAO}#windows-sem-assinatura).
Não desative as proteções do Windows para instalar o Kami.

## Conferir os outros arquivos

O `SHA256SUMS` tem o hash de todos os arquivos desta Release. No Linux:
`sha256sum --check --ignore-missing SHA256SUMS` na pasta dos downloads.
"""


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Gera as notas da Release do Kami.")
    p.add_argument("--versao", required=True)
    p.add_argument("--changelog", type=Path, required=True)
    p.add_argument("--sums", type=Path, required=True)
    args = p.parse_args(argv)
    sys.stdout.write(gerar(args.versao, args.changelog.read_text(encoding="utf-8"), args.sums.read_text(encoding="utf-8")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
