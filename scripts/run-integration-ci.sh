#!/usr/bin/env bash

set -u -o pipefail

container_name="hronaut-integration-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
artifact_directory="ci-artifacts"

# Hosted runners have fewer sustained CPU resources than typical developer
# workstations. Keep their Electron processes at the proven two-shard profile;
# callers can still opt into another value explicitly.
export HRONAUT_INTEGRATION_SHARDS="${HRONAUT_INTEGRATION_SHARDS:-2}"
# The parallel validate job already performs the full TypeScript build graph.
# Keep the standalone Docker command authoritative by changing this only in CI.
export HRONAUT_INTEGRATION_SKIP_TYPECHECK="true"

compose_build_arguments=()
case "${HRONAUT_INTEGRATION_IMAGE_PREBUILT:-false}" in
  true) ;;
  false) compose_build_arguments+=(--build) ;;
  *)
    echo "HRONAUT_INTEGRATION_IMAGE_PREBUILT must be true or false." >&2
    exit 2
    ;;
esac

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}

extract_directory() {
  local source_directory="$1"
  if ! docker cp "$container_name:/workspace/$source_directory" - | tar -xf - -C "$artifact_directory"; then
    echo "Warning: could not extract $source_directory from $container_name." >&2
  fi
}

trap cleanup EXIT INT TERM

status=0
docker compose --file compose.test.ci.yaml run "${compose_build_arguments[@]}" --name "$container_name" integration || status=$?

if (( status != 0 )) && docker inspect "$container_name" >/dev/null 2>&1; then
  mkdir -p "$artifact_directory"
  extract_directory test-results
  extract_directory playwright-report
fi

exit "$status"
