#!/usr/bin/env bash
# Draft investigation only. Never use this as a main/release admission gate.
set -u -o pipefail
case "${HRONAUT_OOPIF_DIAGNOSTIC_ARM:-}" in baseline|native-route-ready) ;; *) exit 2 ;; esac
container_name="hronaut-oopif-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
private_directory="$(mktemp -d)" || exit 2
mkdir -p oopif-safe-artifacts
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  rm -rf "$private_directory"
}
trap cleanup EXIT
export HRONAUT_INTEGRATION_SHARDS=2
export HRONAUT_INTEGRATION_SHARD=3/8
export HRONAUT_INTEGRATION_SHARD_WORKERS=1
export HRONAUT_INTEGRATION_RUN_DIALOGS=false
export HRONAUT_INTEGRATION_SKIP_TYPECHECK=true
status=0
# Retain all original shard test flags/retry policy. Do not print or upload raw test logs.
docker compose --file compose.test.ci.yaml run --build --name "$container_name" \
  -e "HRONAUT_OOPIF_DIAGNOSTIC_ARM=$HRONAUT_OOPIF_DIAGNOSTIC_ARM" integration \
  >"$private_directory/docker.log" 2>&1 || status=$?
docker cp "$container_name:/workspace/oopif-safe-artifacts/." "$private_directory/" >/dev/null 2>&1 || true
docker cp "$container_name:/workspace/playwright-report/shard-3/index.html" "$private_directory/report.html" >/dev/null 2>&1 || true
python3 scripts/export-oopif-outcomes.py "$private_directory/report.html" "oopif-safe-artifacts/$HRONAUT_OOPIF_DIAGNOSTIC_ARM-tests.json"
# A second allowlist boundary ensures the upload contains only the known report names.
for retry in 0 1; do
  report="$private_directory/$HRONAUT_OOPIF_DIAGNOSTIC_ARM-$retry.json"
  if [[ -f "$report" ]] && (( $(wc -c < "$report") <= 65536 )); then
    cp "$report" "oopif-safe-artifacts/$HRONAUT_OOPIF_DIAGNOSTIC_ARM-$retry.json"
  fi
done
printf '{"version":1,"arm":"%s","exitCode":%d}\n' "$HRONAUT_OOPIF_DIAGNOSTIC_ARM" "$status" > "oopif-safe-artifacts/$HRONAUT_OOPIF_DIAGNOSTIC_ARM-outcome.json"
exit "$status"
