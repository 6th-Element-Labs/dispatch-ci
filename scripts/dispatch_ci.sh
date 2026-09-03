#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node "${ROOT}/scripts/check-boundaries.mjs"

for service in mail agent web; do
  echo "verify: services/${service}"
  npm --prefix "${ROOT}/services/${service}" ci --prefer-offline --no-audit --no-fund
  npm --prefix "${ROOT}/services/${service}" run typecheck
  npm --prefix "${ROOT}/services/${service}" test
done

npm --prefix "${ROOT}/services/web" run build
npm --prefix "${ROOT}/services/web" run test:ui
