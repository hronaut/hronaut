#!/usr/bin/env bash

set -euo pipefail

shard_count="${HRONAUT_INTEGRATION_SHARDS:-6}"
case "$shard_count" in
  1|2|3|4|5|6|7|8) ;;
  *)
    echo "HRONAUT_INTEGRATION_SHARDS must be an integer from 1 through 8." >&2
    exit 2
    ;;
esac

single_shard="${HRONAUT_INTEGRATION_SHARD:-}"
single_shard_index=""
if [[ -n "$single_shard" ]]; then
  if [[ ! "$single_shard" =~ ^([1-8])/([1-8])$ ]]; then
    echo "HRONAUT_INTEGRATION_SHARD must be empty or use index/total with values from 1 through 8." >&2
    exit 2
  fi
  single_shard_index="${BASH_REMATCH[1]}"
  single_shard_total="${BASH_REMATCH[2]}"
  if ((single_shard_index > single_shard_total)); then
    echo "HRONAUT_INTEGRATION_SHARD index cannot exceed its total." >&2
    exit 2
  fi
fi

run_dialogs="${HRONAUT_INTEGRATION_RUN_DIALOGS:-true}"
case "$run_dialogs" in
  true|false) ;;
  *)
    echo "HRONAUT_INTEGRATION_RUN_DIALOGS must be true or false." >&2
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

run_shard() {
  local shard_spec="$1"
  local shard_label="$2"
  local shard_index="$3"
  (
    export HRONAUT_TEST_SHARD="shard-${shard_label}"
    export HRONAUT_TEST_SHARD_INDEX="$shard_index"
    started_at="$SECONDS"
    set +e
    xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' \
      npm run test:integration:run -- "--shard=${shard_spec}"
    shard_status="$?"
    set -e
    echo "Electron shard ${shard_spec} finished in $((SECONDS - started_at))s with status ${shard_status}."
    exit "$shard_status"
  )
}

status=0
if [[ -n "$single_shard" ]]; then
  if ! run_shard "$single_shard" "$single_shard_index" "$single_shard_index"; then
    status=1
  fi
else
  declare -a shard_pids=()
  for ((shard = 1; shard <= shard_count; shard += 1)); do
    run_shard "${shard}/${shard_count}" "$shard" "$shard" &
    shard_pids+=("$!")
  done

  terminate_shards() {
    for pid in "${shard_pids[@]}"; do
      kill "$pid" >/dev/null 2>&1 || true
    done
  }
  trap terminate_shards INT TERM

  for pid in "${shard_pids[@]}"; do
    if ! wait "$pid"; then
      status=1
    fi
  done
  trap - INT TERM
fi

if ((status != 0)); then
  exit "$status"
fi

if [[ "$run_dialogs" == 'true' ]]; then
  npm run test:integration:dialogs:headless
fi
