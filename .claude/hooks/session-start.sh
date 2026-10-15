#!/bin/bash
# Prepares Claude Code cloud sessions (claude.ai/code) for Hronaut development.
# Local machines are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Node's built-in fetch, which Electron's installer uses, only honors
# HTTPS_PROXY with this flag; without it `node node_modules/electron/install.js`
# fails behind the cloud egress proxy.
export NODE_USE_ENV_PROXY=1
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export NODE_USE_ENV_PROXY=1' >> "$CLAUDE_ENV_FILE"
fi

# Reinstall only when the lockfile changed. `npm ci` keeps package-lock.json
# untouched even when the container's npm differs from the one that wrote it.
lock_hash="$(sha256sum package-lock.json | cut -d' ' -f1)"
marker=node_modules/.cloud-session-lock.sha256
if [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$lock_hash" ] || [ ! -x node_modules/electron/dist/electron ]; then
  npm ci --no-audit --no-fund
  echo "$lock_hash" > "$marker"
fi

# The Docker gates need a daemon and a Playwright base image that trusts the
# egress proxy's CA. Prepare both in the background so the session starts now.
nohup bash .claude/hooks/cloud-docker.sh > /tmp/hronaut-cloud-docker.log 2>&1 &

cat <<'NOTE'
Cloud session ready: dependencies installed; lint, typecheck, `npm test`, and
`npm run build:app` work directly. Electron Playwright tests run headless with
`xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npx playwright test <file>`
after `npm run build:app`. Docker gates (`npm run test:*:docker*`) are being
prepared in the background; run `bash .claude/hooks/cloud-docker.sh` to wait for
them (log: /tmp/hronaut-cloud-docker.log).
NOTE
