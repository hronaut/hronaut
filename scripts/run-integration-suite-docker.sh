#!/usr/bin/env bash

set -euo pipefail

shard_count="${HRONAUT_INTEGRATION_SHARDS:-4}"
case "$shard_count" in
  1|2|3|4|5|6|7|8) ;;
  *)
    echo "HRONAUT_INTEGRATION_SHARDS must be an integer from 1 through 8." >&2
    exit 2
    ;;
esac

shard_workers="${HRONAUT_INTEGRATION_SHARD_WORKERS:-1}"
case "$shard_workers" in
  1|2|3|4|5|6|7|8) ;;
  *)
    echo "HRONAUT_INTEGRATION_SHARD_WORKERS must be an integer from 1 through 8." >&2
    exit 2
    ;;
esac

single_shard="${HRONAUT_INTEGRATION_SHARD:-}"
single_shard_index=""
if [[ -n "$single_shard" ]]; then
  if [[ ! "$single_shard" =~ ^([1-9]|1[0-2])/([1-9]|1[0-2])$ ]]; then
    echo "HRONAUT_INTEGRATION_SHARD must be empty or use index/total with values from 1 through 12." >&2
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

# Playwright's --shard gives each shard the same number of tests, and their run times differed by up to six minutes.
# Each shard instead lists the suite and takes its part of a split by the durations in tests/integration/durations.json.
# Every shard computes the same split from the same tree. Without a usable list it keeps Playwright's split.
shard_selection() {
  local shard_spec="$1"
  local shard_label="$2"
  local list_report="test-results/json/shard-${shard_label}-list.json"
  local test_list="test-results/json/shard-${shard_label}-plan.txt"
  mkdir -p test-results/json
  local list_status=0
  local plan_status=0
  PLAYWRIGHT_JSON_OUTPUT_NAME="$list_report" npm run test:integration:run -- --list --reporter=json >/dev/null ||
    list_status="$?"
  node scripts/plan-integration-shard.ts "$list_report" tests/integration/durations.json "$shard_spec" "$test_list" ||
    plan_status="$?"
  if ((list_status == 0 && plan_status == 0)); then
    selected_tests=(--test-list "$test_list")
  elif ((list_status == 0 && plan_status == 3)); then
    # Titles a test list cannot name: every shard lists the same tests, so every one keeps Playwright's split alike.
    selected_tests=("--shard=${shard_spec}")
  else
    # The other shards may have split the tests by durations, so a split of this shard's own would skip or repeat tests.
    echo "::error title=Electron shard plan::Shard ${shard_spec} could not plan its tests (listing exited with ${list_status}, planning with ${plan_status})."
    return 1
  fi
}

run_shard() {
  local shard_spec="$1"
  local shard_label="$2"
  local shard_index="$3"
  local selected_tests=()
  shard_selection "$shard_spec" "$shard_label" || return 1
  (
    export HRONAUT_TEST_SHARD="shard-${shard_label}"
    export HRONAUT_TEST_SHARD_INDEX="$shard_index"
    started_at="$SECONDS"
    set +e
    HRONAUT_TEST_ISOLATED_DISPLAYS=1 \
      npm run test:integration:run -- "${selected_tests[@]}" "--workers=${shard_workers}"
    shard_status="$?"
    set -e
    echo "Electron shard ${shard_spec} finished in $((SECONDS - started_at))s with status ${shard_status}."
    # How long each test took, without the report's output and errors; CI uploads it to refresh the recorded durations.
    mkdir -p test-results/durations
    node scripts/update-integration-durations.ts --replace "test-results/durations/shard-${shard_label}.json" \
      "test-results/json/shard-${shard_label}.json" || echo "Could not record the shard's test durations."
    exit "$shard_status"
  )
}

# A shard that failed because of a few tests reruns each of them three times without retries. When every rerun
# passes, the failure was a flake: the shard passes with a warning naming the tests, which still need a fix.
recheck_flaky_tests() {
  local shard_label="$1"
  local report="test-results/json/shard-${shard_label}.json"
  local test_list="test-results/json/shard-${shard_label}-recheck.txt"
  node scripts/recheck-flaky-tests.ts list "$report" "$test_list" || return 1
  local recheck_status=0
  (
    export HRONAUT_TEST_SHARD="shard-${shard_label}-recheck"
    export HRONAUT_TEST_SHARD_INDEX="$shard_label"
    HRONAUT_TEST_ISOLATED_DISPLAYS=1 \
      npm run test:integration:run -- --test-list "$test_list" --repeat-each=3 --retries=0 --workers=1
  ) || recheck_status="$?"
  if ((recheck_status != 0)); then
    echo "The recheck exited with status ${recheck_status}, so the shard fails."
    return 1
  fi
  node scripts/recheck-flaky-tests.ts verify "$report" "test-results/json/shard-${shard_label}-recheck.json"
}

status=0
if [[ -n "$single_shard" ]]; then
  if ! run_shard "$single_shard" "$single_shard_index" "$single_shard_index" &&
    ! recheck_flaky_tests "$single_shard_index"; then
    status=1
  fi
else
  # A shared queue keeps every worker busy even when test durations differ.
  # Each worker fixture owns an Xvfb server so native focus and input stay isolated.
  started_at="$SECONDS"
  HRONAUT_TEST_ISOLATED_DISPLAYS=1 \
    npm run test:integration:run -- "--workers=${shard_count}" &
  suite_pid="$!"
  trap 'kill "$suite_pid" >/dev/null 2>&1 || true' INT TERM
  if ! wait "$suite_pid"; then
    status=1
  fi
  trap - INT TERM
  echo "Electron suite (${shard_count} isolated workers) finished in $((SECONDS - started_at))s with status ${status}."
fi

if ((status != 0)); then
  exit "$status"
fi

if [[ "$run_dialogs" == 'true' ]]; then
  npm run test:integration:dialogs:headless
fi
