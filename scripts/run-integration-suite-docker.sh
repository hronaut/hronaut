#!/usr/bin/env bash

set -euo pipefail

shard_count="${HRONAUT_INTEGRATION_SHARDS:-2}"
case "$shard_count" in
  1|2|3|4) ;;
  *)
    echo "HRONAUT_INTEGRATION_SHARDS must be an integer from 1 through 4." >&2
    exit 2
    ;;
esac

node scripts/verify-dependency-manifest.ts
case "${HRONAUT_INTEGRATION_SKIP_TYPECHECK:-false}" in
  true) npm run build:app ;;
  false) npm run build ;;
  *)
    echo "HRONAUT_INTEGRATION_SKIP_TYPECHECK must be true or false." >&2
    exit 2
    ;;
esac

declare -a shard_pids=()
for ((shard = 1; shard <= shard_count; shard += 1)); do
  (
    export HRONAUT_TEST_SHARD="shard-${shard}"
    export HRONAUT_TEST_SHARD_INDEX="$shard"
    started_at="$SECONDS"
    set +e
    xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' \
      npm run test:integration:run -- "--shard=${shard}/${shard_count}"
    shard_status="$?"
    set -e
    echo "Electron shard ${shard}/${shard_count} finished in $((SECONDS - started_at))s with status ${shard_status}."
    exit "$shard_status"
  ) &
  shard_pids+=("$!")
done

terminate_shards() {
  for pid in "${shard_pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap terminate_shards INT TERM

status=0
for pid in "${shard_pids[@]}"; do
  if ! wait "$pid"; then
    status=1
  fi
done
trap - INT TERM

if ((status != 0)); then
  exit "$status"
fi

npm run test:integration:dialogs:headless
