#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Backend and web"
(
  cd "$ROOT_DIR/frontend"
  npm run check:api
  npm test
  npm run build
)

echo "==> Mobile"
(
  cd "$ROOT_DIR/mobile"
  npm run typecheck
  npm test
)

echo "==> Vocivo quality gates passed"
