#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SIGNING_IDENTITY:?Set SIGNING_IDENTITY to your Developer ID Application certificate identity or SHA-1}"
package_dir="dist/ShareStream-macOS"
mkdir -p "$package_dir"
for format in VST3 AU Standalone; do
  case "$format" in
    VST3) bundle="Share Stream.vst3";;
    AU) bundle="Share Stream.component";;
    Standalone) bundle="Share Stream.app";;
  esac
  if [ "$format" = Standalone ]; then
    source_bundle="build/ShareStreamReceiver_artefacts/Release/$bundle"
  else
    source_bundle="build/ShareStream_artefacts/Release/$format/$bundle"
  fi
  # Remove only the previously generated bundle, so obsolete bundle resources disappear.
  if [ -d "$package_dir/$bundle" ]; then rm -rf "$package_dir/$bundle"; fi
  ditto "$source_bundle" "$package_dir/$bundle"
  codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$package_dir/$bundle"
  codesign --verify --deep --strict "$package_dir/$bundle"
  signature_info="$(codesign -dv --verbose=4 "$package_dir/$bundle" 2>&1)"
  if [[ "$signature_info" != *"Authority=Developer ID Application:"* ]]; then
    printf 'Expected a Developer ID Application signature for %s\n' "$bundle" >&2
    exit 1
  fi
done
cp scripts/install-macos.sh "$package_dir/Install.command"
chmod +x "$package_dir/Install.command"
cp README.md "$package_dir/README.md"
cp THIRD_PARTY.md "$package_dir/THIRD_PARTY.md"
cp VALIDATION.md "$package_dir/VALIDATION.md"
cp vendor/monocypher/LICENCE.md "$package_dir/Monocypher-LICENCE.md"
ditto -c -k --sequesterRsrc --keepParent "$package_dir" dist/ShareStream-macOS.zip
receiver_dir="dist/ShareStream-Receiver"
mkdir -p "$receiver_dir"
if [ -d "$receiver_dir/Share Stream.app" ]; then rm -rf "$receiver_dir/Share Stream.app"; fi
ditto "$package_dir/Share Stream.app" "$receiver_dir/Share Stream.app"
cp README-receiver.md "$receiver_dir/README.md"
cp THIRD_PARTY.md "$receiver_dir/THIRD_PARTY.md"
cp VALIDATION.md "$receiver_dir/VALIDATION.md"
cp vendor/monocypher/LICENCE.md "$receiver_dir/Monocypher-LICENCE.md"
ditto -c -k --sequesterRsrc --keepParent "$receiver_dir" dist/ShareStream-Receiver-macOS.zip
shasum -a 256 dist/ShareStream-macOS.zip dist/ShareStream-Receiver-macOS.zip > dist/SHA256SUMS.txt
