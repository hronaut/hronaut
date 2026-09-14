#!/usr/bin/env bash

set -euo pipefail

cache_file="${HRONAUT_FOCUSED_BUILD_CACHE_FILE:-.cache/hronaut/focused-build-app.sha256}"

hash_files() {
  local path
  for path in "$@"; do
    if [[ -f "$path" ]]; then
      sha256sum -- "$path"
    elif [[ -d "$path" ]]; then
      find "$path" -type f -print0 | sort -z | xargs -0 --no-run-if-empty sha256sum --
    fi
  done | sha256sum | cut -d ' ' -f 1
}

input_hash="$(hash_files \
  src \
  build \
  electron.vite.config.ts \
  package.json \
  package-lock.json \
  tsconfig.json \
  tsconfig.node.json \
  tsconfig.web.json \
  scripts/build-app-if-needed.sh)"

cached_input=""
cached_output=""
if [[ -f "$cache_file" ]]; then
  read -r cached_input cached_output < "$cache_file" || true
fi

output_hash=""
if [[ -f out/main/index.js && -f out/preload/index.cjs && -f out/renderer/index.html ]]; then
  output_hash="$(hash_files out)"
fi

if [[ "$cached_input" == "$input_hash" && -n "$output_hash" && "$cached_output" == "$output_hash" ]]; then
  echo "Focused Electron build inputs and outputs are unchanged; reusing out/."
  exit 0
fi

npm run build:app
output_hash="$(hash_files out)"
mkdir -p "$(dirname "$cache_file")"
printf '%s %s\n' "$input_hash" "$output_hash" > "$cache_file"
