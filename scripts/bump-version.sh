#!/usr/bin/env bash
# scripts/bump-version.sh — automatiza o passo que hoje é manual no
# fluxo de entrega do Kami: subir a versão em VERSION, gerar a
# entrada do CHANGELOG a partir dos commits, e criar a tag git —
# pensado pra rodar dentro de uma release/* ou hotfix/* do git flow,
# antes do merge pra main.
#
# Não mexe em tauri.conf.json/Cargo.toml — isso já é feito por
# build.sh (sync_version), que lê o mesmo VERSION como fonte única.
# Este script só cuida do "qual é a próxima versão" e do registro
# dela; quem empacota o instalador continua sendo build.sh.
#
# Uso:
#   ./scripts/bump-version.sh patch            # 1.1.0 -> 1.1.1
#   ./scripts/bump-version.sh minor            # 1.1.0 -> 1.2.0
#   ./scripts/bump-version.sh major            # 1.1.0 -> 2.0.0
#   ./scripts/bump-version.sh 1.4.0-beta.1     # versão explícita
#   ./scripts/bump-version.sh patch --dry-run  # mostra o que faria, sem tocar em nada
#   ./scripts/bump-version.sh patch --no-tag   # bump + changelog, sem criar tag git
#
# O que faz, em ordem:
#   1. valida que a working tree está limpa (senão o commit de
#      release ia misturar mudanças não relacionadas)
#   2. calcula a nova versão (semver: major.minor.patch[-prerelease])
#   3. coleta `git log` desde a última tag vX.Y.Z, agrupando por
#      prefixo de Conventional Commits (feat/fix/docs/refactor/perf/
#      chore/test) quando o commit segue esse padrão — senão cai numa
#      seção "outros" com a mensagem crua, pra não perder nada
#   4. escreve VERSION e insere a nova seção no topo do CHANGELOG.md
#      (cria o arquivo com cabeçalho Keep a Changelog na 1ª execução)
#   5. commita as duas mudanças juntas ("chore(release): vX.Y.Z") e
#      cria uma tag anotada vX.Y.Z apontando pra esse commit
#   6. imprime os próximos passos manuais do git flow (git flow
#      release finish / push --tags / gh release create), sem
#      executá-los — merge pra main e push continuam decisão sua

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"
README_FILE="$ROOT_DIR/README.md"

DRY_RUN=false
NO_TAG=false
BUMP_ARG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-tag)  NO_TAG=true ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) BUMP_ARG="$arg" ;;
  esac
done

if [ -z "$BUMP_ARG" ]; then
  echo "erro: informe major, minor, patch ou uma versão explícita (ex: 1.4.0-beta.1)" >&2
  exit 1
fi

if [ ! -f "$VERSION_FILE" ]; then
  echo "erro: $VERSION_FILE não encontrado" >&2
  exit 1
fi

CURRENT_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"

# separa a parte semver (X.Y.Z) de um eventual sufixo -prerelease
CURRENT_CORE="${CURRENT_VERSION%%-*}"
IFS='.' read -r CUR_MAJOR CUR_MINOR CUR_PATCH <<< "$CURRENT_CORE"

case "$BUMP_ARG" in
  major) NEW_VERSION="$((CUR_MAJOR + 1)).0.0" ;;
  minor) NEW_VERSION="${CUR_MAJOR}.$((CUR_MINOR + 1)).0" ;;
  patch) NEW_VERSION="${CUR_MAJOR}.${CUR_MINOR}.$((CUR_PATCH + 1))" ;;
  *)
    # versão explícita — validação mínima de formato semver (com prerelease opcional)
    if ! [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
      echo "erro: '$BUMP_ARG' não é major/minor/patch nem um semver válido (X.Y.Z ou X.Y.Z-prerelease)" >&2
      exit 1
    fi
    NEW_VERSION="$BUMP_ARG"
    ;;
esac

echo "versão atual: $CURRENT_VERSION"
echo "nova versão:  $NEW_VERSION"

if ! $DRY_RUN && [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
  echo "erro: working tree suja — commite ou stash antes de rodar o bump" >&2
  exit 1
fi

# --- coleta de commits desde a última tag ---------------------------------
LAST_TAG="$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$LAST_TAG" ]; then
  RANGE="${LAST_TAG}..HEAD"
  echo "commits considerados: desde $LAST_TAG"
else
  RANGE="HEAD"
  echo "commits considerados: nenhuma tag anterior encontrada, usando todo o histórico"
fi

LOG="$(git -C "$ROOT_DIR" log "$RANGE" --pretty=format:'%s' 2>/dev/null || true)"

declare -A CC_GROUPS=(
  [feat]="Adicionado" [fix]="Corrigido" [refactor]="Modificado"
  [perf]="Modificado" [docs]="Documentação" [test]="Testes" [chore]="Manutenção"
)
declare -A SECTION_LINES=()
OTHER_LINES=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  prefix="$(echo "$line" | sed -E -n 's/^([a-z]+)(\([a-zA-Z0-9_-]+\))?!?:.*/\1/p')"
  msg="$(echo "$line" | sed -E 's/^[a-z]+(\([a-zA-Z0-9_-]+\))?!?: *//')"
  if [ -n "$prefix" ] && [ -n "${CC_GROUPS[$prefix]:-}" ]; then
    section="${CC_GROUPS[$prefix]}"
    SECTION_LINES["$section"]+="- ${msg}"$'\n'
  else
    OTHER_LINES+="- ${line}"$'\n'
  fi
done <<< "$LOG"

# --- monta a entrada do changelog ------------------------------------------
TODAY="$(date +%Y-%m-%d)"
ENTRY="## [${NEW_VERSION}] - ${TODAY}"$'\n\n'

for section in "Adicionado" "Corrigido" "Modificado" "Documentação" "Testes" "Manutenção"; do
  if [ -n "${SECTION_LINES[$section]:-}" ]; then
    ENTRY+="### ${section}"$'\n'"${SECTION_LINES[$section]}"$'\n'
  fi
done
if [ -n "$OTHER_LINES" ]; then
  ENTRY+="### Outros"$'\n'"${OTHER_LINES}"$'\n'
fi
if [ -z "$LOG" ]; then
  ENTRY+="_sem commits desde a última tag — bump manual._"$'\n\n'
fi

if $DRY_RUN; then
  echo
  echo "--- preview do CHANGELOG (nada foi escrito, --dry-run) ---"
  echo "$ENTRY"
  exit 0
fi

# --- escreve VERSION ---------------------------------------------------
echo "$NEW_VERSION" > "$VERSION_FILE"

# --- sincroniza o badge de versão no README.md -----------------------------
# só troca o padrão exato `vX.Y.Z` (o badge no topo do arquivo) — não mexe
# em outras versões citadas no README (ex: `cargo install tauri-cli
# --version "^2"`), já que essas não são a versão do Kami.
if [ -f "$README_FILE" ]; then
  if grep -qE '`v[0-9]+\.[0-9]+\.[0-9]+`' "$README_FILE"; then
    sed -i -E "s/\`v[0-9]+\.[0-9]+\.[0-9]+\`/\`v${NEW_VERSION}\`/" "$README_FILE"
    echo "README.md -> badge atualizado pra v${NEW_VERSION}"
  else
    echo "aviso: não achei o badge \`vX.Y.Z\` no README.md — confira manualmente" >&2
  fi
fi

# --- escreve/atualiza CHANGELOG.md -----------------------------------------
if [ ! -f "$CHANGELOG_FILE" ]; then
  cat > "$CHANGELOG_FILE" <<EOF
# Changelog

Todas as mudanças notáveis do Kami são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [Semantic Versioning](https://semver.org/lang/pt-BR/).

EOF
fi

TMP_FILE="$(mktemp)"
{
  head -n 6 "$CHANGELOG_FILE"
  echo "$ENTRY"
  tail -n +7 "$CHANGELOG_FILE"
} > "$TMP_FILE"
mv "$TMP_FILE" "$CHANGELOG_FILE"

echo "VERSION -> $NEW_VERSION"
echo "CHANGELOG.md atualizado"

# --- commit + tag ------------------------------------------------------
git -C "$ROOT_DIR" add "$VERSION_FILE" "$CHANGELOG_FILE" "$README_FILE"
git -C "$ROOT_DIR" commit -m "chore(release): v${NEW_VERSION}"

if ! $NO_TAG; then
  git -C "$ROOT_DIR" tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"
  echo "tag v${NEW_VERSION} criada"
fi

cat <<EOF

próximos passos (git flow):
  1. revise o CHANGELOG.md gerado (as mensagens vêm cruas dos commits)
  2. se estiver numa release/* ou hotfix/*, finalize normalmente:
       git flow release finish ${NEW_VERSION}    (ou git flow hotfix finish ...)
  3. suba tudo, incluindo a tag:
       git push origin main develop --tags
  4. gere o instalador com a versão já sincronizada:
       ./build.sh
  5. (opcional) publique a release no GitHub a partir da tag e anexe
     os instaladores de dist/, usando o texto da seção do CHANGELOG
     como corpo da release:
       gh release create v${NEW_VERSION} dist/kami-${NEW_VERSION}.* \\
         --title "v${NEW_VERSION}" --notes-file <(sed -n '/^## \\[${NEW_VERSION}\\]/,/^## \\[/p' CHANGELOG.md | sed '\$d')
EOF
