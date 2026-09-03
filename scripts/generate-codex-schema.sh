#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/contracts/codex-app-server"

command -v codex >/dev/null || {
  echo "generate-codex-schema: codex CLI is required" >&2
  exit 1
}

codex app-server generate-json-schema --out "$OUT"
codex --version

