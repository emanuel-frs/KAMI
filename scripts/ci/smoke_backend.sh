#!/usr/bin/env bash
# Smoke test do sidecar do Kami (usado pelo CI em Linux e nos containers).
#
# Uso: smoke_backend.sh <sidecar> <data_home> <versao_esperada> [--sem-stdio]
#
# Sobe o sidecar, espera ele publicar backend_port.txt e confere que
# GET /health devolve exatamente {"status":"ok","version":"<versao>"}.
# Não usa python de propósito: as imagens debian/fedora/arch dos
# containers de teste não trazem o comando `python`.
#
# --sem-stdio fecha stdin/stdout/stderr antes de iniciar o processo.
# É o equivalente Linux do sidecar do Windows compilado com
# console=False (sys.stdout/sys.stderr = None) — o cenário que
# derrubava o backend em silêncio.
set -euo pipefail

binary=${1:?uso: smoke_backend.sh <sidecar> <data_home> <versao> [--sem-stdio]}
data_home=${2:?informe o data_home}
expected_version=${3:?informe a versão esperada}
mode=${4:-}

export XDG_DATA_HOME="$data_home"
mkdir -p "$data_home/kami"
port_file="$data_home/kami/backend_port.txt"
app_log="$data_home/kami/kami-backend.log"
stdout_log="$data_home/kami-stdout.log"
rm -f "$port_file"

if [[ "$mode" == "--sem-stdio" ]]; then
  "$binary" <&- >&- 2>&- &
else
  "$binary" > "$stdout_log" 2>&1 &
fi
backend_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT

dump_logs() {
  echo "----- $stdout_log" >&2
  cat "$stdout_log" >&2 2>/dev/null || true
  echo "----- $app_log" >&2
  cat "$app_log" >&2 2>/dev/null || true
}

for _ in $(seq 1 90); do
  if [[ -s "$port_file" ]]; then
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    echo "O sidecar terminou antes de publicar backend_port.txt." >&2
    dump_logs
    exit 1
  fi
  sleep 1
done

if [[ ! -s "$port_file" ]]; then
  echo "O sidecar não publicou backend_port.txt em 90 segundos." >&2
  dump_logs
  exit 1
fi

port="$(tr -d '[:space:]' < "$port_file")"
health="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/health")" || {
  echo "GET /health falhou na porta ${port}." >&2
  dump_logs
  exit 1
}

expected="{\"status\":\"ok\",\"version\":\"${expected_version}\"}"
if [[ "$health" != "$expected" ]]; then
  echo "Resposta /health inesperada: $health (esperado: $expected)" >&2
  dump_logs
  exit 1
fi

# o log em arquivo (kami-backend.log) precisa existir: é ele que diz
# o que aconteceu quando o app falha numa máquina de usuário
if [[ ! -s "$app_log" ]]; then
  echo "kami-backend.log não foi criado em $app_log." >&2
  dump_logs
  exit 1
fi

echo "OK: /health respondeu ${health} (${mode:-com stdio})."
