#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

npm --prefix "${ROOT}/services/mail" run dev &
pids+=("$!")
npm --prefix "${ROOT}/services/agent" run dev &
pids+=("$!")
npm --prefix "${ROOT}/services/web" run dev &
pids+=("$!")

wait

