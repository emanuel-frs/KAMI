#!/usr/bin/env bash
# Empacota o backend (PyInstaller) e renomeia o binário resultante pro
# nome que o Tauri sidecar espera: <nome>-<target-triple>(.exe), dentro
# de src-tauri/binaries/ (ver bundle.externalBin em tauri.conf.json).
#
# Rodar por SO — decisão 19/26 não faz cross-compile: rode este script
# no Linux pra gerar o binário Linux, e no Windows (git-bash/WSL) pra
# gerar o .exe do Windows.
#
# Requisitos: .venv do backend já criado e com `pyinstaller` instalado
# (não está no requirements.txt de runtime de propósito — só quem vai
# empacotar precisa dele: `pip install pyinstaller` dentro do venv).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"
DEST_DIR="$REPO_ROOT/src-tauri/binaries"

cd "$BACKEND_DIR"
pyinstaller kami-backend.spec --clean --noconfirm

# Descobre o target triple via rustc, já que é o mesmo valor que o
# Tauri usa internamente pra resolver o nome do sidecar. Pode ser
# sobrescrito manualmente (ex: rodando de uma máquina sem Rust
# instalado, só pra gerar o binário e copiar depois pra outro lugar).
if [ -z "${TARGET_TRIPLE:-}" ]; then
  if command -v rustc >/dev/null 2>&1; then
    TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
  else
    echo "Não achei o Rust (rustc) pra descobrir o target triple." >&2
    echo "Rode de novo definindo manualmente, ex:" >&2
    echo "  TARGET_TRIPLE=x86_64-unknown-linux-gnu $0" >&2
    exit 1
  fi
fi

mkdir -p "$DEST_DIR"

if [ -f "dist/kami-backend.exe" ]; then
  SRC="dist/kami-backend.exe"
  EXT=".exe"
else
  SRC="dist/kami-backend"
  EXT=""
fi

DEST="$DEST_DIR/kami-backend-${TARGET_TRIPLE}${EXT}"
cp "$SRC" "$DEST"
chmod +x "$DEST" 2>/dev/null || true

echo "Sidecar pronto em: $DEST"
