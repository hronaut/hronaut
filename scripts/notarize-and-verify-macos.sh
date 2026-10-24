#!/usr/bin/env bash
# After electron-builder signed, notarized and stapled each Hronaut.app in dist/, notarizes and staples the signed disk
# images it made, then checks what Gatekeeper will check on a person's Mac: every app and disk image carries a valid
# Developer ID signature of one team and a stapled notarization ticket, and Gatekeeper accepts it as notarized.
# Needs APPLE_API_KEY (the path of the App Store Connect key), APPLE_API_KEY_ID and APPLE_API_ISSUER.

set -euo pipefail
shopt -s nullglob

apps=(dist/mac*/Hronaut.app)
images=(dist/*.dmg)
if (( ${#apps[@]} != 2 )); then
  echo "::error::Expected the x64 and arm64 Hronaut.app in dist/, found ${#apps[@]}: ${apps[*]}"
  exit 1
fi

# The team that signed it, from its Developer ID signature; fails for any other signature.
signing_team() {
  local details
  details=$(codesign --display --verbose=2 "$1" 2>&1) || true
  if ! grep -qF 'Authority=Developer ID Application:' <<< "$details"; then
    echo "::error::$1 is not signed with a Developer ID Application certificate" >&2
    return 1
  fi
  sed -n 's/^TeamIdentifier=//p' <<< "$details"
}

# One field of notarytool's JSON answer.
json_field() {
  node -e 'let text = ""; process.stdin.on("data", (chunk) => { text += chunk }).on("end", () => { const value = JSON.parse(text)[process.argv[1]]; process.stdout.write(value === undefined ? "" : String(value)) })' "$1"
}

# Gatekeeper's verdict must name the notarization, not just an accepted signature: on a Mac where assessments are
# turned off, spctl accepts everything.
assess_notarized() {
  local verdict
  verdict=$(spctl --assess --verbose=4 "$@" 2>&1) || true
  echo "$verdict"
  if ! grep -qF 'source=Notarized Developer ID' <<< "$verdict"; then
    echo "::error::Gatekeeper did not accept ${*: -1} as notarized Developer ID software"
    return 1
  fi
}

for image in "${images[@]}"; do
  if ! result=$(xcrun notarytool submit "$image" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --output-format json); then
    echo "::error::notarytool could not submit $image: $result"
    exit 1
  fi
  status=$(json_field status <<< "$result")
  if [[ "$status" != Accepted ]]; then
    echo "::error::Apple did not notarize $image: $status"
    xcrun notarytool log "$(json_field id <<< "$result")" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" || true
    exit 1
  fi
  xcrun stapler staple "$image"
done

teams=()
for app in "${apps[@]}"; do
  codesign --verify --deep --strict --verbose=2 "$app"
  team=$(signing_team "$app")
  teams+=("$team")
  xcrun stapler validate "$app"
  assess_notarized --type execute "$app"
done

for image in "${images[@]}"; do
  codesign --verify --verbose=2 "$image"
  team=$(signing_team "$image")
  teams+=("$team")
  xcrun stapler validate "$image"
  assess_notarized --type open --context context:primary-signature "$image"
done

distinct=$(printf '%s\n' "${teams[@]}" | sort -u)
if [[ -z "$distinct" || "$distinct" == *$'\n'* ]]; then
  echo "::error::Expected every app and disk image signed by one team, found: $(tr '\n' ' ' <<< "$distinct")"
  exit 1
fi
echo "Signed by team $distinct and notarized: ${apps[*]} ${images[*]}"
