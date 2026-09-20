#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-public-export.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

node "$ROOT/scripts/export-public-release.mjs" \
  --destination "$WORK/public" \
  --ref HEAD \
  --version 0.1.3 \
  --verify
