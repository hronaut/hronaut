#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: npm run test:integration:docker:focused -- <playwright-file-or-options>" >&2
  echo "Example: npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts --grep 'keeps Home interactive'" >&2
  exit 2
fi

npm run build:app
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm run test:integration:run -- "$@"
