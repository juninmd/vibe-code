#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PID=""
WEB_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cleanup_port() {
  local port="$1"
  local pids
  pids="$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)"
  if [[ -z "${pids}" ]]; then
    return
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    local cwd
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    local cmd
    cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"

    if [[ "$cwd" == "$ROOT_DIR"* ]] || [[ "$cmd" == *"vibe-code"* ]]; then
      echo "[dev-safe] encerrando processo stale pid=${pid} porta=${port}"
      kill "$pid" 2>/dev/null || true
    fi
  done <<< "$pids"
}

cleanup_port 3000
cleanup_port 5173

cd "$ROOT_DIR"

echo "[dev-safe] iniciando backend..."
(cd "$ROOT_DIR/packages/server" && bun run dev) &
SERVER_PID=$!

echo "[dev-safe] iniciando frontend..."
(cd "$ROOT_DIR/packages/web" && bun run dev) &
WEB_PID=$!

set +e
wait -n "$SERVER_PID" "$WEB_PID"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "[dev-safe] um processo encerrou com erro (code=$EXIT_CODE), finalizando os demais..."
fi

cleanup
exit "$EXIT_CODE"
