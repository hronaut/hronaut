#!/usr/bin/env bash

set -u -o pipefail

container_name="hronaut-integration-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
artifact_directory="ci-artifacts"
local_artifacts=false

# Limit standalone CI runs to two workers. Matrix jobs select one shard and
# configure its concurrency separately through HRONAUT_INTEGRATION_SHARD_WORKERS.
if [[ "${1:-}" == '--local' && $# == 1 ]]; then
  export HRONAUT_INTEGRATION_SHARDS="${HRONAUT_INTEGRATION_SHARDS:-4}"
  export HRONAUT_INTEGRATION_SKIP_TYPECHECK="${HRONAUT_INTEGRATION_SKIP_TYPECHECK:-false}"
  local_artifacts=true
elif (($# == 0)); then
  export HRONAUT_INTEGRATION_SHARDS="${HRONAUT_INTEGRATION_SHARDS:-2}"
  # The parallel validate job already performs the full TypeScript build graph.
  # Keep the standalone Docker command authoritative by changing this only in CI.
  export HRONAUT_INTEGRATION_SKIP_TYPECHECK="true"
else
  echo 'Usage: run-integration-ci.sh [--local]' >&2
  exit 2
fi

compose_build_arguments=()
case "${HRONAUT_INTEGRATION_IMAGE_PREBUILT:-false}" in
  true) ;;
  false) compose_build_arguments+=(--build) ;;
  *)
    echo "HRONAUT_INTEGRATION_IMAGE_PREBUILT must be true or false." >&2
    exit 2
    ;;
esac

startup_log="$(mktemp)" || exit 1

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  rm -f "$startup_log"
}

extract_directory() {
  local source_directory="$1"
  if ! docker cp "$container_name:/workspace/$source_directory" - | tar -xf - -C "$artifact_directory"; then
    echo "Warning: could not extract $source_directory from $container_name." >&2
  fi
}

trap cleanup EXIT INT TERM

for attempt in 1 2 3; do
  status=0
  docker compose --file compose.test.ci.yaml run "${compose_build_arguments[@]}" --name "$container_name" integration 2>&1 | tee "$startup_log" || status=$?
  if (( status == 0 || attempt == 3 )); then
    break
  fi
  # Never retry a container/test failure. Only recover transient registry
  # metadata errors before Compose has created the named container.
  if docker inspect "$container_name" >/dev/null 2>&1 ||
    ! grep -Eq 'failed to resolve source metadata.*(502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)' "$startup_log"; then
    break
  fi
  echo "Registry metadata temporarily unavailable; retrying Docker startup ($attempt/2)." >&2
  sleep "$((attempt * 5))" || break
done

capture_diagnostics=false
if [[ "${HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS:-false}" == 'true' && "${HRONAUT_INTEGRATION_SHARD:-}" == '8/8' ]]; then
  capture_diagnostics=true
fi
if { (( status != 0 )) || [[ "$capture_diagnostics" == true ]]; } && docker inspect "$container_name" >/dev/null 2>&1; then
  if [[ "$local_artifacts" == true ]]; then
    mkdir -p test-results
    artifact_directory="$(mktemp -d test-results/local-docker-XXXXXX)" || exit "$status"
  fi
  mkdir -p "$artifact_directory"
  extract_directory test-results
  extract_directory playwright-report
  echo "Integration artifacts: $artifact_directory"
fi

exit "$status"
