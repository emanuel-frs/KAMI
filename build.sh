#!/usr/bin/env bash
# build.sh — fluxo único pra regerar o app Kami do zero com as
# atualizações mais recentes de backend/frontend/Tauri.
#
# O que ele faz, em ordem:
#   1. (re)empacota o backend em binário standalone via PyInstaller
#      (chama scripts/build_sidecar.sh) e copia pro nome que o Tauri
#      sidecar espera em src-tauri/binaries/
#   2. sincroniza a versão do app (arquivo VERSION na raiz — ver "Nota
#      sobre versionamento" abaixo) em tauri.conf.json e Cargo.toml, e
#      roda `cargo tauri build`, que lê o frontend direto de
#      frontend/ (sem bundler, decisão do projeto) e empacota tudo
#      junto com o sidecar num .deb/.rpm/.AppImage (Linux)
#   3. valida quais instaladores foram realmente gerados, copia cada
#      um pra dist/kami-<versão>.<ext> na raiz do repo (nome
#      padronizado pra distribuir) e imprime um resumo. Ver "Nota
#      sobre o AppImage" mais abaixo.
#
# Por padrão a tela só mostra 3 passos com uma barra de progresso
# (estimada a partir da duração dos builds anteriores — ver
# build/.build_times) em vez do log inteiro do PyInstaller/cargo. O
# log completo sempre fica salvo em build/logs/, mesmo assim.
#
# Uso:
#   ./build.sh                 build de produção completo (padrão,
#                              com barra de progresso)
#   ./build.sh --verbose      mostra o log completo do PyInstaller e
#                              do cargo ao vivo, sem barra (útil pra
#                              depurar um build quebrado)
#   ./build.sh --quiet        só cabeçalho de cada passo + resumo
#                              final, sem barra de progresso nem log
#                              ao vivo (bom pra CI/logs em arquivo)
#   ./build.sh --skip-sidecar  pula o passo 1 (reusa o binário já
#                              existente em src-tauri/binaries/ — útil
#                              se só o frontend/Rust mudou)
#   ./build.sh --clean         apaga src-tauri/target e
#                              backend/{build,dist} antes de buildar
#                              (build limpo, mais lento)
#   ./build.sh --dev           não empacota nada — só roda
#                              `cargo tauri dev` (janela com o app
#                              live-reload, sidecar real incluso).
#                              Pra iterar no backend sem PyInstaller a
#                              cada mudança, exporte
#                              KAMI_DEV_NO_SIDECAR=1 antes de chamar
#                              este script com --dev (ver main.rs).
#   ./build.sh --help          mostra esta mensagem
#
# Nota sobre versionamento:
#   Não existe package.json no projeto, então a versão do Kami mora
#   num único arquivo de texto simples, VERSION, na raiz do repo. Toda
#   funcionalidade nova = editar esse arquivo (bump manual) em um
#   lugar só. O backend lê o mesmo arquivo em runtime
#   (backend/app/version.py, também embutido no binário do
#   PyInstaller) e o frontend mostra o valor ao lado do avatar via
#   /health. Este script sincroniza esse mesmo valor em
#   tauri.conf.json e Cargo.toml antes de empacotar (função
#   sync_version abaixo), e nomeia os instaladores finais com ele.
#
# Pré-requisitos (uma vez só por máquina):
#   - backend/.venv criado, com as deps de requirements.txt E com
#     `pyinstaller` instalado dentro do venv (não está no
#     requirements.txt de runtime de propósito — só quem empacota
#     precisa: `source backend/.venv/bin/activate && pip install
#     pyinstaller`)
#   - Rust + Cargo instalados
#   - Tauri CLI instalada: `cargo install tauri-cli --version "^2" --locked`
#   - Linux: libwebkit2gtk, libgtk-3-dev e as demais deps de sistema
#     do Tauri (ver https://tauri.app/start/prerequisites/)
#
# Saída (build de produção): os instaladores originais do Tauri ficam em
#   src-tauri/target/release/bundle/deb/*.deb
#   src-tauri/target/release/bundle/rpm/*.rpm
#   src-tauri/target/release/bundle/appimage/*.AppImage  (quando possível, ver nota abaixo)
# e uma cópia de cada, já renomeada, fica em
#   dist/kami-<versão>.<ext>
#
# Nota sobre o AppImage em distros Fedora-like:
#   O bundler de AppImage do Tauri usa o `linuxdeploy`, que por sua vez
#   depende de FUSE pra montar o próprio AppImage do linuxdeploy em
#   tempo de build. Em muitas instalações Fedora o FUSE não está
#   disponível/configurado, e isso quebra com "failed to run
#   linuxdeploy" mesmo com o resto do build 100% correto. Este script
#   já exporta APPIMAGE_EXTRACT_AND_RUN=1 (workaround oficial pra
#   ambientes sem FUSE) antes de chamar o Tauri; se ainda assim
#   falhar, o .deb e o .rpm (que não dependem de FUSE) já terão sido
#   gerados com sucesso, e o script trata isso como sucesso do build —
#   só avisa que o AppImage não saiu, em vez de abortar tudo.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
TAURI_DIR="$REPO_ROOT/src-tauri"
SCRIPTS_DIR="$REPO_ROOT/scripts"
LOG_DIR="$REPO_ROOT/build/logs"
TIMES_FILE="$REPO_ROOT/build/.build_times"
VERSION_FILE="$REPO_ROOT/VERSION"
DIST_DIR="$REPO_ROOT/dist"

SKIP_SIDECAR=0
CLEAN=0
DEV=0
QUIET=0
VERBOSE=0

for arg in "$@"; do
  case "$arg" in
    --skip-sidecar) SKIP_SIDECAR=1 ;;
    --clean) CLEAN=1 ;;
    --dev) DEV=1 ;;
    --quiet) QUIET=1 ;;
    --verbose) VERBOSE=1 ;;
    --help|-h)
      sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "argumento desconhecido: $arg (use --help)" >&2
      exit 1
      ;;
  esac
done

# ── visual helpers ───────────────────────────────────────────────────
IS_TTY=0
[ -t 1 ] && IS_TTY=1

if [ "$IS_TTY" -eq 1 ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'; C_MAGENTA=$'\033[35m'
else
  C_RESET=""; C_DIM=""; C_BOLD=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_MAGENTA=""
fi

TOTAL_STEPS=3
STEP_START_TS=0

hr() { printf '%s\n' "${C_DIM}────────────────────────────────────────────────────────────${C_RESET}"; }

banner() {
  printf '\n%s\n' "${C_MAGENTA}${C_BOLD}"
  cat <<'EOF'
  ██╗  ██╗ █████╗ ███╗   ███╗ ██╗
  ██║ ██╔╝██╔══██╗████╗ ████║ ██║
  █████╔╝ ███████║██╔████╔██║ ██║
  ██╔═██╗ ██╔══██║██║╚██╔╝██║ ██║
  ██║  ██╗██║  ██║██║ ╚═╝ ██║ ██║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═╝
EOF
  printf '%s\n' "${C_RESET}${C_DIM}  build de produção — Kami v${KAMI_VERSION} — $(date '+%Y-%m-%d %H:%M:%S')${C_RESET}"
}

step() {
  local n="$1" title="$2"
  STEP_START_TS=$(date +%s)
  hr
  printf '%s\n' "${C_CYAN}${C_BOLD} passo ${n}/${TOTAL_STEPS} · ${title}${C_RESET}"
  hr
}

step_done() {
  local elapsed=$(( $(date +%s) - STEP_START_TS ))
  printf '%s\n' "${C_GREEN} ✔ concluído em $(fmt_time "$elapsed")${C_RESET}"
}

log()  { printf '%s\n' "${C_DIM}[build.sh]${C_RESET} $*"; }
ok()   { printf '%s\n' "${C_GREEN} ✔${C_RESET} $*"; }
warn() { printf '%s\n' "${C_YELLOW} ⚠${C_RESET} $*"; }
err()  { printf '%s\n' "${C_RED} ✘${C_RESET} $*" >&2; }

fmt_time() {
  local s="$1"
  if [ "$s" -ge 60 ]; then
    printf '%dm%02ds' "$((s / 60))" "$((s % 60))"
  else
    printf '%ds' "$s"
  fi
}

# ── barra de progresso ───────────────────────────────────────────────
# Lê/grava estimativas de duração de cada passo (build/.build_times,
# formato "chave=segundos" por linha) pra desenhar uma barra com
# percentual estimado nos builds seguintes. No primeiro build (sem
# histórico ainda), cai pra um indicador indeterminado com o tempo
# decorrido, sem inventar percentual.
get_estimate() {
  local key="$1"
  [ -f "$TIMES_FILE" ] || { echo 0; return; }
  awk -F= -v k="$key" '$1==k {print $2}' "$TIMES_FILE" | tail -n1
}

save_estimate() {
  local key="$1" seconds="$2" prev
  mkdir -p "$(dirname "$TIMES_FILE")"
  prev=$(get_estimate "$key")
  if [ -n "$prev" ] && [ "$prev" -gt 0 ] 2>/dev/null; then
    seconds=$(( (prev + seconds) / 2 ))  # média móvel simples com a última medição
  fi
  { [ -f "$TIMES_FILE" ] && grep -v "^${key}=" "$TIMES_FILE"; echo "${key}=${seconds}"; } > "${TIMES_FILE}.tmp"
  mv "${TIMES_FILE}.tmp" "$TIMES_FILE"
}

draw_bar() {
  local pct="$1" width=28 filled empty
  if [ "$pct" -lt 0 ]; then
    # indeterminado: sem % confiável ainda (primeiro build deste passo)
    printf '[%s] estimando…' "$(printf '·%.0s' $(seq 1 $width))"
    return
  fi
  [ "$pct" -gt 100 ] && pct=100
  filled=$(( pct * width / 100 ))
  empty=$(( width - filled ))
  printf '[%s%s] %3d%%' "$(printf '█%.0s' $(seq 1 $filled 2>/dev/null))" "$(printf '░%.0s' $(seq 1 $empty 2>/dev/null))" "$pct"
}

# roda um comando em background mostrando uma barra de progresso
# (estimada por histórico) que atualiza na mesma linha, salva o log
# completo em disco e devolve o exit code real do comando.
#   run_with_progress <chave_estimativa> <logfile> <comando...>
run_with_progress() {
  local key="$1" logfile="$2"; shift 2
  local estimate start elapsed pct rc

  mkdir -p "$LOG_DIR"
  estimate=$(get_estimate "$key")
  [ -z "$estimate" ] && estimate=0

  if [ "$VERBOSE" -eq 1 ]; then
    "$@" 2>&1 | tee "$logfile"
    rc="${PIPESTATUS[0]}"
  elif [ "$QUIET" -eq 1 ] || [ "$IS_TTY" -eq 0 ]; then
    # sem terminal interativo (CI, redirecionado pra arquivo) — sem
    # barra ao vivo, só um sinal de vida periódico
    "$@" >"$logfile" 2>&1 &
    local pid=$!
    start=$(date +%s)
    while kill -0 "$pid" 2>/dev/null; do
      sleep 5
      [ "$QUIET" -eq 0 ] && log "ainda rodando… ($(fmt_time $(( $(date +%s) - start ))))"
    done
    wait "$pid"; rc=$?
  else
    "$@" >"$logfile" 2>&1 &
    local pid=$!
    start=$(date +%s)
    while kill -0 "$pid" 2>/dev/null; do
      elapsed=$(( $(date +%s) - start ))
      if [ "$estimate" -gt 0 ] 2>/dev/null; then
        pct=$(( elapsed * 100 / estimate ))
        [ "$pct" -gt 95 ] && pct=95   # nunca mostra 100% antes de terminar de verdade
      else
        pct=-1
      fi
      printf '\r\033[K %s  %s' "$(draw_bar "$pct")" "$(fmt_time "$elapsed")"
      sleep 0.5
    done
    wait "$pid"; rc=$?
    elapsed=$(( $(date +%s) - start ))
    printf '\r\033[K %s  %s\n' "$(draw_bar 100)" "$(fmt_time "$elapsed")"
    save_estimate "$key" "$elapsed"
  fi
  return "$rc"
}

# ── versão (fonte de verdade única: arquivo VERSION na raiz) ────────
# Ver "Nota sobre versionamento" no cabeçalho deste arquivo.
if [ ! -f "$VERSION_FILE" ]; then
  err "Arquivo VERSION não encontrado na raiz do repositório."
  exit 1
fi
KAMI_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"

# sincroniza KAMI_VERSION em tauri.conf.json (campo "version" no topo
# do JSON) e Cargo.toml (primeira linha `version = "..."`, a do
# [package]) — chamada antes de qualquer `cargo tauri build`/`dev`.
sync_version() {
  log "sincronizando versão (v${KAMI_VERSION}) em tauri.conf.json e Cargo.toml"

  if [ -f "$TAURI_DIR/tauri.conf.json" ]; then
    python3 - "$TAURI_DIR/tauri.conf.json" "$KAMI_VERSION" <<'PYEOF'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data["version"] = version
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF
  else
    warn "$TAURI_DIR/tauri.conf.json não encontrado, pulando sync"
  fi

  if [ -f "$TAURI_DIR/Cargo.toml" ]; then
    # substitui só a PRIMEIRA ocorrência de `version = "..."` no arquivo
    # (a do [package] — sempre a primeira no template padrão do Tauri v2;
    # dependências com version = "..." inline depois disso não são
    # tocadas)
    sed -i "0,/^version = \".*\"/s//version = \"$KAMI_VERSION\"/" "$TAURI_DIR/Cargo.toml"
  else
    warn "$TAURI_DIR/Cargo.toml não encontrado, pulando sync"
  fi
}

banner

# ── checagens de pré-requisito ──────────────────────────────────────
if ! command -v cargo >/dev/null 2>&1; then
  err "Rust/Cargo não encontrado no PATH. Instale antes de continuar (https://rustup.rs)."
  exit 1
fi

if ! cargo tauri --version >/dev/null 2>&1; then
  err "Tauri CLI não encontrada (cargo tauri). Instale com:"
  echo '     cargo install tauri-cli --version "^2" --locked' >&2
  exit 1
fi

# ── modo dev: atalho, sem empacotar nada ────────────────────────────
if [ "$DEV" -eq 1 ]; then
  sync_version
  log "modo --dev: subindo 'cargo tauri dev' (Kami v${KAMI_VERSION}, Ctrl+C pra sair)"
  cd "$TAURI_DIR"
  exec cargo tauri dev
fi

# ── build limpo opcional ─────────────────────────────────────────────
if [ "$CLEAN" -eq 1 ]; then
  log "--clean: removendo builds anteriores (src-tauri/target, backend/build, backend/dist)"
  rm -rf "$TAURI_DIR/target" "$BACKEND_DIR/build" "$BACKEND_DIR/dist"
fi

BUILD_START_TS=$(date +%s)

# ── passo 1: sidecar do backend (PyInstaller) ───────────────────────
step 1 "empacotando o backend (PyInstaller)"
if [ "$SKIP_SIDECAR" -eq 1 ]; then
  log "--skip-sidecar: pulando rebuild do backend, reusando binário existente"
  if ! ls "$TAURI_DIR/binaries"/kami-backend-* >/dev/null 2>&1; then
    err "Nenhum binário encontrado em src-tauri/binaries/ — rode sem --skip-sidecar pelo menos uma vez."
    exit 1
  fi
  ok "binário existente reaproveitado"
else
  if [ ! -d "$BACKEND_DIR/.venv" ]; then
    err "backend/.venv não existe. Crie primeiro:"
    echo "     cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt pyinstaller" >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.venv/bin/activate"

  if ! command -v pyinstaller >/dev/null 2>&1; then
    log "pyinstaller não encontrado dentro do venv — instalando agora"
    pip install pyinstaller
  fi

  if run_with_progress "sidecar" "$LOG_DIR/01-sidecar.log" "$SCRIPTS_DIR/build_sidecar.sh"; then
    ok "sidecar gerado em src-tauri/binaries/"
  else
    deactivate 2>/dev/null || true
    err "falha ao empacotar o backend — veja o log completo em build/logs/01-sidecar.log"
    exit 1
  fi

  deactivate 2>/dev/null || true
fi
step_done

# ── passo 2: build do app Tauri (empacota frontend + sidecar) ──────
step 2 "cargo tauri build (frontend + sidecar → instaladores)"
sync_version
cd "$TAURI_DIR"

# limpa só os instaladores empacotados de builds anteriores (não o
# target/ inteiro — isso preserva o cache incremental do Rust, então
# é barato e roda sempre, sem precisar de --clean). Sem isso, o
# check_target do passo 3 (find ... | head -n1, sem ordenação) pode
# pegar um .deb/.rpm de uma versão antiga que ficou pra trás na mesma
# pasta em vez do que acabou de ser gerado — foi exatamente isso que
# aconteceu na build de v1.2.0 (o find devolveu o Kami_1.1.0_amd64.deb
# de uma tentativa anterior em vez do 1.2.0 recém-gerado, porque os
# dois coexistiam e a ordem do find não é garantida).
log "limpando instaladores de builds anteriores (bundle/deb, bundle/rpm, bundle/appimage, bundle/msi, bundle/nsis)"
rm -rf "$TAURI_DIR/target/release/bundle/deb" \
       "$TAURI_DIR/target/release/bundle/rpm" \
       "$TAURI_DIR/target/release/bundle/appimage" \
       "$TAURI_DIR/target/release/bundle/msi" \
       "$TAURI_DIR/target/release/bundle/nsis"

# workaround oficial pra ambientes sem FUSE configurado (comum em
# Fedora) — evita boa parte dos "failed to run linuxdeploy". Ver nota
# no cabeçalho deste arquivo.
export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"
export NO_STRIP="${NO_STRIP:-1}"

TAURI_RC=0
run_with_progress "tauri" "$LOG_DIR/02-tauri-build.log" cargo tauri build || TAURI_RC=$?

if [ "$TAURI_RC" -eq 0 ]; then
  ok "cargo tauri build terminou sem erros"
else
  warn "cargo tauri build saiu com código ${TAURI_RC} — verificando se os instaladores essenciais saíram mesmo assim"
fi
step_done

# ── passo 3: validar artefatos gerados ───────────────────────────────
step 3 "validando instaladores gerados"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

declare -a FOUND=()
declare -a MISSING=()

check_target() {
  local label="$1" pattern="$2" required="$3"
  local hit
  # segunda camada de proteção além da limpeza no passo 2: se por
  # algum motivo mais de um arquivo bater o padrão na mesma pasta
  # (ex.: alguém rodou com --skip-sidecar ou pulou a limpeza manual),
  # pega o modificado mais recentemente em vez do primeiro que o find
  # devolver (find não garante nenhuma ordem específica).
  hit=$(find "$BUNDLE_DIR" -maxdepth 2 -iname "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)
  if [ -n "$hit" ]; then
    local size
    size=$(du -h "$hit" 2>/dev/null | cut -f1)
    FOUND+=("$label|$hit|$size")
  elif [ "$required" -eq 1 ]; then
    MISSING+=("$label (obrigatório)")
  else
    MISSING+=("$label (opcional — falha conhecida do linuxdeploy/FUSE nesta máquina, não impede o uso do app)")
  fi
}

# no Linux, .deb e .rpm são os alvos "obrigatórios" pra considerar o
# build um sucesso; AppImage é tratado como opcional por causa da
# dependência de FUSE (ver nota no topo do arquivo).
if [[ "$(uname -s)" == "Linux" ]]; then
  check_target "Debian (.deb)"   "*.deb"      1
  check_target "RPM (.rpm)"      "*.rpm"      1
  check_target "AppImage"        "*.AppImage" 0
else
  check_target "instalador" "*.msi" 0
  check_target "instalador" "*.exe" 0
fi

hr
if [ "${#FOUND[@]}" -gt 0 ]; then
  printf '%s\n' "${C_BOLD} gerados:${C_RESET}"
  for entry in "${FOUND[@]}"; do
    IFS='|' read -r label path size <<<"$entry"
    printf '   %s%s%s  %s (%s)\n' "$C_GREEN" "✔" "$C_RESET" "$path" "$size"
  done

  # cópia padronizada pra dist/kami-<versão>.<ext> (ver "Nota sobre
  # versionamento" no cabeçalho) — -p preserva o bit de execução,
  # importante pro AppImage.
  mkdir -p "$DIST_DIR"
  printf '%s\n' "${C_BOLD} copiados pra dist/ (nome padronizado):${C_RESET}"
  for entry in "${FOUND[@]}"; do
    IFS='|' read -r label path size <<<"$entry"
    ext="${path##*.}"
    dest="$DIST_DIR/kami-${KAMI_VERSION}.${ext}"
    cp -p "$path" "$dest"
    printf '   %s→%s  %s\n' "$C_CYAN" "$C_RESET" "$dest"
  done
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
  printf '%s\n' "${C_BOLD} não gerados:${C_RESET}"
  for m in "${MISSING[@]}"; do
    printf '   %s%s%s  %s\n' "$C_YELLOW" "⚠" "$C_RESET" "$m"
  done
fi
step_done
hr

TOTAL_ELAPSED=$(( $(date +%s) - BUILD_START_TS ))

# sucesso = pelo menos os alvos obrigatórios (deb+rpm no Linux, ou
# msi/exe no Windows) existem no disco — independente do exit code
# do cargo tauri build, que pode ter falhado só no AppImage opcional.
REQUIRED_MISSING=0
for m in "${MISSING[@]}"; do
  [[ "$m" == *"(obrigatório)"* ]] && REQUIRED_MISSING=1
done

if [ "$REQUIRED_MISSING" -eq 0 ] && [ "${#FOUND[@]}" -gt 0 ]; then
  printf '\n%s\n' "${C_GREEN}${C_BOLD} ✔ build concluído com sucesso em $(fmt_time "$TOTAL_ELAPSED") — Kami v${KAMI_VERSION}${C_RESET}"
  if [ "$TAURI_RC" -ne 0 ]; then
    warn "cargo tauri build reportou erro (código ${TAURI_RC}), mas foi só o AppImage opcional — log completo em build/logs/02-tauri-build.log"
  fi
  exit 0
else
  printf '\n%s\n' "${C_RED}${C_BOLD} ✘ build falhou — nenhum instalador obrigatório foi gerado${C_RESET}"
  log "veja os logs completos em ${LOG_DIR}/"
  exit 1
fi