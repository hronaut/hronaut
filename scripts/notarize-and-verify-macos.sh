#!/usr/bin/env bash
# After electron-builder signed, notarized and stapled each Hronaut.app in dist/, notarizes and staples the signed disk
# images it made, then checks what Gatekeeper will check on a person's Mac: every app and disk image carries a valid
# Developer ID signature and a stapled notarization ticket, and Gatekeeper accepts it.
# Needs APPLE_API_KEY (the path of the App Store Connect key), APPLE_API_KEY_ID and APPLE_API_ISSUER.

set -euo pipefail
shopt -s nullglob

apps=(dist/mac*/Hronaut.app)
images=(dist/*.dmg)
if (( ${#apps[@]} != 2 )); then
  echo "::error::Expected the x64 and arm64 Hronaut.app in dist/, found ${#apps[@]}: ${apps[*]}"
  exit 1
fi

for image in "${images[@]}"; do
  xcrun notarytool submit "$image" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$image"
done

for app in "${apps[@]}"; do
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign --display --verbose=2 "$app" 2>&1 | grep -F 'Authority=Developer ID Application:'
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=4 "$app"
done

for image in "${images[@]}"; do
  codesign --verify --verbose=2 "$image"
  xcrun stapler validate "$image"
  spctl --assess --type open --context context:primary-signature --verbose=4 "$image"
done
