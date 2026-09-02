#!/usr/bin/env bash

set -euo pipefail

node scripts/verify-dependency-manifest.ts

marker_path="node_modules/.hronaut-package-lock.sha256"
if [[ ! -f "$marker_path" ]]; then
  echo "Focused Docker dependency cache is incomplete. Run npm run test:docker:cache:prune, then retry." >&2
  exit 1
fi

expected_hash="$(node scripts/docker-dependency-cache-key.ts package-lock.json)"
actual_hash="$(tr -d '[:space:]' < "$marker_path")"
if [[ "$actual_hash" != "$expected_hash" ]]; then
  echo "Focused Docker dependency cache does not match package-lock.json. Run npm run test:docker:cache:prune, then retry." >&2
  exit 1
fi

exec "$@"
