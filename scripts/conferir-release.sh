#!/usr/bin/env bash
# scripts/conferir-release.sh — confere se o repositório está pronto pra
# virar release (MAN-04). Não muda nada; só falha com a lista do que falta.
#
# Uso:
#   ./scripts/conferir-release.sh                # antes do PR pra main
#   ./scripts/conferir-release.sh --tag v1.14.0  # no release.yml, com a tag
#
# Confere:
#   1. as 5 fontes de versão iguais: VERSION, src-tauri/tauri.conf.json,
#      src-tauri/Cargo.toml, o bloco "kami" do src-tauri/Cargo.lock e o
#      pkgver de packaging/arch/.SRCINFO;
#   2. a primeira entrada do CHANGELOG.md é a desta versão e tem data
#      (não "em desenvolvimento" — o placeholder do início da sprint);
#   3. nenhum "PREENCHER" esquecido nos arquivos versionados;
#   4. com --tag: a tag é vVERSION e o commit "chore(release): vVERSION"
#      está no histórico dela (normalmente é o próprio commit da tag; na
#      1.10.0 uma correção entrou depois dele, por isso "no histórico").
#
# Na 1.13 a versão não subiu no início da sprint e só se percebeu na
# branch de release — é esse tipo de esquecimento que isto pega.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TAG=""
if [ "${1:-}" = "--tag" ]; then
  TAG="${2:?uso: conferir-release.sh --tag vX.Y.Z}"
elif [ -n "${1:-}" ]; then
  echo "uso: conferir-release.sh [--tag vX.Y.Z]" >&2
  exit 2
fi

ERROS=0
falha() {
  echo "  ✗ $*" >&2
  ERROS=$((ERROS + 1))
}
ok() {
  echo "  ✓ $*"
}

# --- 1. versão -----------------------------------------------------------
VERSAO="$(tr -d '[:space:]' < VERSION)"
echo "versão: $VERSAO"
if ! [[ "$VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  falha "VERSION não é uma versão semver: '$VERSAO'"
fi
TAURI="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' src-tauri/tauri.conf.json | head -1)"
CARGO="$(awk '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && /^version *=/ { gsub(/"/, "", $3); print $3; exit }' src-tauri/Cargo.toml)"
LOCK="$(awk '$0 == "name = \"kami\"" { getline; gsub(/"/, "", $3); print $3; exit }' src-tauri/Cargo.lock)"
SRCINFO="$(sed -n 's/^[[:space:]]*pkgver = //p' packaging/arch/.SRCINFO | head -1)"
for par in "src-tauri/tauri.conf.json:$TAURI" "src-tauri/Cargo.toml:$CARGO" \
  "src-tauri/Cargo.lock:$LOCK" "packaging/arch/.SRCINFO:$SRCINFO"; do
  arquivo="${par%%:*}"
  valor="${par#*:}"
  if [ "$valor" = "$VERSAO" ]; then
    ok "$arquivo = $valor"
  else
    falha "$arquivo tem '${valor:-?}' (VERSION tem '$VERSAO') — rode ./scripts/bump-version.sh $VERSAO --no-tag"
  fi
done

# --- 2. CHANGELOG ----------------------------------------------------------
PRIMEIRA="$(grep -m1 '^## \[' CHANGELOG.md || true)"
VERSAO_RE="${VERSAO//./\\.}"
if [[ "$PRIMEIRA" =~ ^##\ \[${VERSAO_RE}\]\ -\ [0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  ok "CHANGELOG: $PRIMEIRA"
elif [[ "$PRIMEIRA" == "## [$VERSAO]"* ]]; then
  falha "CHANGELOG: a entrada de $VERSAO está sem data ('$PRIMEIRA') — reescreva à mão com a data real"
else
  falha "CHANGELOG: a primeira entrada é '$PRIMEIRA', não a de $VERSAO"
fi

# --- 3. marcadores esquecidos ---------------------------------------------
# o padrão é montado em duas partes pra este próprio arquivo não aparecer
MARCA="PREEN""CHER"
if ACHADOS="$(git grep -n "$MARCA" -- . ':!scripts/conferir-release.sh')"; then
  falha "marcador $MARCA esquecido:"
  while IFS= read -r linha; do echo "      $linha" >&2; done <<< "$ACHADOS"
else
  ok "nenhum $MARCA no repositório"
fi

# --- 4. tag ---------------------------------------------------------------
if [ -n "$TAG" ]; then
  if [ "$TAG" != "v$VERSAO" ]; then
    falha "a tag é '$TAG', mas VERSION pede 'v$VERSAO'"
  elif ! git rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
    falha "a tag $TAG não existe neste clone (faltou git fetch --tags?)"
  else
    RELEASE_COMMIT="$(git log --format=%H --grep="^chore(release): v${VERSAO_RE}\$" -n1 "$TAG" || true)"
    if [ -n "$RELEASE_COMMIT" ]; then
      ok "tag $TAG: o commit 'chore(release): $TAG' (${RELEASE_COMMIT:0:7}) está no histórico"
    else
      falha "o histórico da tag $TAG não tem o commit 'chore(release): $TAG' — a tag fica no commit de release"
    fi
  fi
fi

if [ "$ERROS" -gt 0 ]; then
  echo "$ERROS problema(s) — corrija antes da release." >&2
  exit 1
fi
echo "pronto pra release."
