#!/usr/bin/env bash
# Checks that a macOS release build can be signed and notarized, before anything is built: every secret is set.
# A macOS package is never published unsigned, so a missing secret stops the job.

set -euo pipefail

missing=()
for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY_P8 APPLE_API_KEY_ID APPLE_API_ISSUER; do
  if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "::error::macOS packages are signed and notarized, but these values are empty: ${missing[*]} (repository secrets MAC_CSC_LINK, MAC_CSC_KEY_PASSWORD, APPLE_API_KEY_P8, APPLE_API_KEY_ID, APPLE_API_ISSUER)"
  exit 1
fi
