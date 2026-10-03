#!/bin/sh
set -eu

KAMI_REPO="emanuel-frs/KAMI"
KAMI_RELEASE_BASE="${KAMI_RELEASE_BASE:-}"
APPIMAGE_PATH="${HOME}/.local/bin/kami"
DESKTOP_FILE="${HOME}/.local/share/applications/kami.desktop"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
SCRIPT_DIR=$(CDPATH='' cd "$(dirname "$0")" && pwd)

say() {
  printf '%s\n' "Kami: $*"
}

fail() {
  say "ERRO: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Uso: install.sh [--version X.Y.Z] [--dry-run] [--uninstall] [--help]

Instala o Kami pela release oficial e verifica o SHA-256 antes de
instalar ou executar qualquer asset baixado. Sem --version, usa a
última release estável.

  --version X.Y.Z  instala uma versão específica
  --dry-run        mostra as ações sem baixar, instalar ou remover arquivos
  --uninstall      remove o pacote/AppImage, preservando os dados do usuário
  --help           mostra esta ajuda
EOF
}

DRY_RUN=0
UNINSTALL=0
REQUESTED_VERSION=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "informe a versão após --version."
      REQUESTED_VERSION=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "opção desconhecida: $1 (use --help)."
      ;;
  esac
done

ID=""
ID_LIKE=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi

DISTRO_INFO=$(printf '%s %s' "${ID:-}" "${ID_LIKE:-}" | tr '[:upper:]' '[:lower:]')
case "$DISTRO_INFO" in
  *debian*|*ubuntu*)
    INSTALL_KIND="deb"
    ;;
  *fedora*|*rhel*|*centos*|*rocky*|*almalinux*)
    INSTALL_KIND="rpm"
    ;;
  *arch*|*manjaro*|*endeavour*)
    if command -v makepkg >/dev/null 2>&1; then
      INSTALL_KIND="arch"
    else
      INSTALL_KIND="appimage"
    fi
    ;;
  *)
    INSTALL_KIND="appimage"
    ;;
esac

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    say "Esta operação precisa de privilégios administrativos; o sudo será solicitado agora."
    sudo "$@"
  else
    fail "a operação requer privilégios administrativos, mas sudo não está instalado."
  fi
}

remove_appimage() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "Removeria $APPIMAGE_PATH e $DESKTOP_FILE."
    return
  fi
  rm -f "$APPIMAGE_PATH" "$DESKTOP_FILE"
  say "AppImage e atalho removidos, se existiam."
}

if [ "$UNINSTALL" -eq 1 ]; then
  case "$INSTALL_KIND" in
    deb)
      if command -v apt-get >/dev/null 2>&1; then
        if [ "$DRY_RUN" -eq 1 ]; then
          say "Removeria o pacote kami com apt-get."
        else
          run_privileged apt-get remove -y kami
        fi
      else
        say "apt-get não está disponível; nenhum pacote foi removido."
      fi
      ;;
    rpm)
      if command -v dnf >/dev/null 2>&1; then
        if [ "$DRY_RUN" -eq 1 ]; then
          say "Removeria o pacote kami com dnf."
        else
          run_privileged dnf remove -y kami
        fi
      else
        say "dnf não está disponível; nenhum pacote foi removido."
      fi
      ;;
    arch)
      if [ "$DRY_RUN" -eq 1 ]; then
        say "Removeria o pacote kami-bin com pacman."
      else
        run_privileged pacman -Rns --noconfirm kami-bin
      fi
      ;;
    appimage)
      remove_appimage
      ;;
  esac
  say "Os dados do usuário foram preservados em ${DATA_HOME}/kami."
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64)
    ;;
  *)
    fail "esta release oferece binários Linux x86_64; arquitetura detectada: $(uname -m)."
    ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  case "$INSTALL_KIND" in
    deb) say "Instalaria o pacote .deb da release oficial com apt-get." ;;
    rpm) say "Instalaria o pacote .rpm da release oficial com dnf." ;;
    arch) say "Baixaria e verificaria o PKGBUILD e instalaria kami-bin com makepkg." ;;
    appimage) say "Baixaria e verificaria o AppImage, instalando-o em $APPIMAGE_PATH." ;;
  esac
  if [ -n "$REQUESTED_VERSION" ]; then
    say "Versão solicitada: $REQUESTED_VERSION."
  else
    say "Resolveria a última release estável pela API pública do GitHub."
  fi
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl é necessário para baixar a release."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum é necessário para verificar os downloads."

if [ -n "$REQUESTED_VERSION" ]; then
  case "$REQUESTED_VERSION" in
    v*) RELEASE_TAG=$REQUESTED_VERSION ;;
    *) RELEASE_TAG="v${REQUESTED_VERSION}" ;;
  esac
else
  RELEASE_JSON=$(curl -fsSL --retry 3 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${KAMI_REPO}/releases/latest") ||
    fail "não foi possível consultar a última release do Kami."
  # Extrai "tag_name" mesmo que o JSON venha em uma linha só ou com
  # espaçamento diferente (não depende de uma chave por linha).
  RELEASE_TAG=$(printf '%s' "$RELEASE_JSON" |
    tr ',' '\n' |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
    sed -n '1p')
  [ -n "$RELEASE_TAG" ] || fail "a API do GitHub não informou a tag da última release."
fi

VERSION=${RELEASE_TAG#v}
case "$VERSION" in
  ""|*[!0-9A-Za-z.-]*)
    fail "versão inválida: $VERSION."
    ;;
esac

if [ -n "$KAMI_RELEASE_BASE" ]; then
  export KAMI_RELEASE_BASE
else
  KAMI_RELEASE_BASE="https://github.com/${KAMI_REPO}/releases/download/${RELEASE_TAG}"
  export KAMI_RELEASE_BASE
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/kami-install.XXXXXX") ||
  fail "não foi possível criar uma pasta temporária."
trap 'rm -rf "$TEMP_DIR"' 0
trap 'exit 1' HUP INT TERM

download() {
  asset=$1
  destination=$2
  curl -fL --retry 3 --output "$destination" "${KAMI_RELEASE_BASE}/${asset}" ||
    fail "não foi possível baixar o asset $asset."
}

download SHA256SUMS "$TEMP_DIR/SHA256SUMS"

verify_asset() {
  asset=$1
  destination=$2
  expected_sha=$(awk -v name="$asset" '$2 == name { print $1; exit }' "$TEMP_DIR/SHA256SUMS")
  [ -n "$expected_sha" ] || fail "$asset não está listado em SHA256SUMS."
  download "$asset" "$destination"
  actual_sha=$(sha256sum "$destination" | awk '{ print $1 }')
  [ "$actual_sha" = "$expected_sha" ] ||
    fail "SHA-256 divergente para $asset; o arquivo baixado foi descartado."
  say "SHA-256 verificado para $asset."
}

case "$INSTALL_KIND" in
  deb)
    command -v apt-get >/dev/null 2>&1 || fail "apt-get não está disponível nesta distribuição."
    asset="kami-${VERSION}-linux-amd64.deb"
    verify_asset "$asset" "$TEMP_DIR/$asset"
    run_privileged apt-get install -y "$TEMP_DIR/$asset"
    ;;
  rpm)
    command -v dnf >/dev/null 2>&1 || fail "dnf não está disponível nesta distribuição."
    asset="kami-${VERSION}-linux-x86_64.rpm"
    verify_asset "$asset" "$TEMP_DIR/$asset"
    run_privileged dnf install -y "$TEMP_DIR/$asset"
    ;;
  arch)
    [ "$(id -u)" -ne 0 ] || fail "makepkg não pode ser executado como root; rode o instalador como usuário normal."
    asset="kami-${VERSION}-PKGBUILD"
    mkdir "$TEMP_DIR/arch-build"
    local_version_file="${SCRIPT_DIR}/../VERSION"
    local_pkgbuild="${SCRIPT_DIR}/../packaging/arch/PKGBUILD"
    local_version=""
    if [ -r "$local_version_file" ]; then
      local_version=$(tr -d '[:space:]' < "$local_version_file")
    fi
    if [ -r "$local_pkgbuild" ] && [ "$local_version" = "$VERSION" ]; then
      sed "s/^pkgver=.*/pkgver=${VERSION}/" "$local_pkgbuild" \
        > "$TEMP_DIR/arch-build/PKGBUILD"
    else
      verify_asset "$asset" "$TEMP_DIR/PKGBUILD"
      cp "$TEMP_DIR/PKGBUILD" "$TEMP_DIR/arch-build/PKGBUILD"
    fi
    say "makepkg pode solicitar sudo para instalar dependências e o pacote."
    (
      cd "$TEMP_DIR/arch-build" || exit 1
      makepkg --syncdeps --noconfirm
    )
    arch_package=$(find "$TEMP_DIR/arch-build" -maxdepth 1 -type f \
      -name 'kami-bin-[0-9]*.pkg.tar.*' -print -quit)
    [ -n "$arch_package" ] || fail "makepkg não gerou o pacote kami-bin."
    run_privileged pacman -U --noconfirm "$arch_package"
    ;;
  appimage)
    asset="kami-${VERSION}-linux-x86_64.AppImage"
    verify_asset "$asset" "$TEMP_DIR/$asset"
    mkdir -p "${HOME}/.local/bin" "${HOME}/.local/share/applications"
    install -m 755 "$TEMP_DIR/$asset" "$APPIMAGE_PATH"
    escaped_exec=$(printf '%s' "$APPIMAGE_PATH" | sed 's/\\/\\\\/g; s/ /\\ /g')
    printf '%s\n' \
      '[Desktop Entry]' \
      'Name=Kami' \
      'Type=Application' \
      "Exec=$escaped_exec" \
      'Icon=utilities-terminal' \
      'Terminal=false' \
      'Categories=Office;Productivity;' > "$DESKTOP_FILE"
    ;;
esac

say "Kami $VERSION foi instalado."
say "Se o app não abrir ou os widgets não carregarem, anexe o log ao report: ${DATA_HOME}/kami/kami-backend.log."
