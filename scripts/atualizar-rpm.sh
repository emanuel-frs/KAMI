#!/usr/bin/env bash
# Atualização automática do Kami instalado por .rpm (Fedora e afins).
#
#   sudo bash scripts/atualizar-rpm.sh instalar   # uma vez: serviço + timer
#   sudo bash scripts/atualizar-rpm.sh remover    # desfaz
#   sudo systemctl start kami-atualizar.service   # conferir agora
#
# O timer roda logo depois de ligar o computador (antes do login, então o
# Kami que abre com o sistema já é o novo) e uma vez por dia. Ele olha a
# última versão publicada no GitHub; se for mais nova que a instalada,
# baixa o .rpm, confere o sha256 que o GitHub publica para o arquivo e
# instala com dnf. Sem versão nova, sem Kami instalado ou sem internet,
# não faz nada.
#
# O banco não é tocado aqui: na primeira abertura da versão nova o próprio
# Kami guarda uma cópia antes de migrar (backups/kami-antes-da-<versão>-…).
# Roda como root só pelo systemd; nenhuma permissão nova fica pro usuário.
set -euo pipefail

REPO="emanuel-frs/KAMI"
PACOTE="kami"
DESTINO="/usr/local/libexec/kami-atualizar-rpm"
UNIDADE="kami-atualizar"
DIR_UNIDADES="/etc/systemd/system"

log() { echo "kami-atualizar: $*"; }

precisa_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "rode com sudo: sudo bash $0 $1" >&2
    exit 1
  fi
}

instalar() {
  precisa_root instalar
  command -v dnf >/dev/null || { echo "dnf não encontrado — este atualizador é só pro .rpm" >&2; exit 1; }
  install -D -m 0755 "$(readlink -f "$0")" "$DESTINO"
  cat > "$DIR_UNIDADES/$UNIDADE.service" <<EOF
[Unit]
Description=Atualiza o Kami (.rpm) para a última versão publicada
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$DESTINO rodar
PrivateTmp=yes
EOF
  cat > "$DIR_UNIDADES/$UNIDADE.timer" <<EOF
[Unit]
Description=Confere atualização do Kami ao ligar e uma vez por dia

[Timer]
OnBootSec=1min
OnUnitActiveSec=1d
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$UNIDADE.timer"
  log "instalado. Conferindo agora…"
  systemctl start "$UNIDADE.service" || true
  journalctl -u "$UNIDADE.service" -n 8 --no-pager -o cat || true
}

remover() {
  precisa_root remover
  systemctl disable --now "$UNIDADE.timer" 2>/dev/null || true
  rm -f "$DIR_UNIDADES/$UNIDADE.service" "$DIR_UNIDADES/$UNIDADE.timer" "$DESTINO"
  systemctl daemon-reload
  log "removido (o Kami instalado continua como está)."
}

# "1.15.0" > "1.14.0"?
mais_nova() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]
}

rodar() {
  precisa_root rodar
  local instalada
  if ! instalada="$(rpm -q --qf '%{VERSION}' "$PACOTE" 2>/dev/null)"; then
    log "o Kami não está instalado por .rpm — nada a fazer."
    return 0
  fi

  local info
  if ! info="$(curl -fsSL --max-time 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest")"; then
    log "sem acesso ao GitHub agora — tenta na próxima."
    return 0
  fi

  # versão, URL e sha256 do .rpm x86_64 da última versão (pré-lançamentos
  # não aparecem em /releases/latest)
  local linha versao url sha
  linha="$(printf '%s' "$info" | python3 -c '
import json, sys
d = json.load(sys.stdin)
versao = d["tag_name"].lstrip("v")
for a in d.get("assets", []):
    if a["name"] == f"kami-{versao}-linux-x86_64.rpm":
        print(versao, a["browser_download_url"], (a.get("digest") or "").removeprefix("sha256:"))
        break
')"
  read -r versao url sha <<< "$linha"
  if [ -z "${versao:-}" ] || [ -z "${url:-}" ]; then
    log "a última versão não tem .rpm x86_64 — nada a fazer."
    return 0
  fi
  if ! mais_nova "$versao" "$instalada"; then
    log "instalada $instalada, última $versao — já está em dia."
    return 0
  fi
  if [ -z "${sha:-}" ]; then
    log "o GitHub não informou o sha256 do .rpm $versao — não instalo sem conferir."
    return 1
  fi

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  local arquivo="$tmp/kami-$versao.rpm"
  log "baixando a $versao (instalada: $instalada)…"
  curl -fsSL --max-time 600 -o "$arquivo" "$url"
  if [ "$(sha256sum "$arquivo" | cut -d' ' -f1)" != "$sha" ]; then
    log "sha256 não confere — arquivo descartado, nada instalado."
    return 1
  fi
  if [ "$(rpm -qp --qf '%{NAME} %{VERSION}' "$arquivo" 2>/dev/null)" != "$PACOTE $versao" ]; then
    log "o .rpm baixado não é o kami $versao — nada instalado."
    return 1
  fi
  dnf install -y "$arquivo"
  log "Kami atualizado: $instalada → $versao. Vale na próxima abertura do app."
}

case "${1:-}" in
  instalar) instalar ;;
  remover) remover ;;
  rodar) rodar ;;
  *)
    echo "uso: sudo bash $0 instalar | remover | rodar" >&2
    exit 2
    ;;
esac
