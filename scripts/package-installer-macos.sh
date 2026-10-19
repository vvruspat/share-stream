#!/usr/bin/env bash
# Run after package-macos + notarize-macos. Embed the already stapled payload,
# then sign/notarize the outer installer using the same owner identity.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SIGNING_IDENTITY:?Developer ID Application identity required}"
profile="${1:?notarytool profile required}"
artifact_root="${DIST_ROOT:-dist}"
payload_dir="$artifact_root/installer-payload"
mkdir -p "$payload_dir"
for bundle in 'Share Stream.vst3' 'Share Stream.component' 'Share Stream.app'; do
  if [ -e "$payload_dir/$bundle" ]; then rm -rf "$payload_dir/$bundle"; fi
  ditto "$artifact_root/ShareStream-macOS/$bundle" "$payload_dir/$bundle"
  codesign --verify --deep --strict -R '=anchor apple generic and certificate leaf[subject.OU] = "3WKK5AGY66"' "$payload_dir/$bundle"
  xcrun stapler validate "$payload_dir/$bundle"
done
ditto -c -k --sequesterRsrc "$payload_dir" build/payload.zip
cmake -S . -B build -DSHARE_STREAM_INSTALLER_PAYLOAD="$PWD/build/payload.zip"
cmake --build build --target ShareStreamInstaller --parallel "${BUILD_JOBS:-3}"
installer='build/ShareStreamInstaller_artefacts/Release/Share Stream Setup.app'
codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$installer"
codesign --verify --deep --strict "$installer"
ditto -c -k --sequesterRsrc --keepParent "$installer" "$artifact_root/ShareStream-Setup-macOS.zip"
notary() {
  if [ -n "${NOTARY_KEYCHAIN:-}" ]; then xcrun notarytool "$@" --keychain "$NOTARY_KEYCHAIN"; else xcrun notarytool "$@"; fi
}
notary submit "$artifact_root/ShareStream-Setup-macOS.zip" --keychain-profile "$profile" --wait --timeout 10m --output-format json > build/notary-installer.json
python3 -c 'import json; r=json.load(open("build/notary-installer.json")); print(r); assert r["status"]=="Accepted"'
xcrun stapler staple "$installer"
xcrun stapler validate "$installer"
spctl --assess --type execute --verbose=2 "$installer"
ditto -c -k --sequesterRsrc --keepParent "$installer" "$artifact_root/ShareStream-Setup-macOS.zip"
python3 - <<'PY'
import json, os
from pathlib import Path
path=Path(os.environ.get('DIST_ROOT','dist'))/'NOTARIZATION.json'
report=json.loads(path.read_text());report['installer']=json.loads(Path('build/notary-installer.json').read_text())
path.write_text(json.dumps(report,indent=2)+'\n')
PY
(cd "$artifact_root" && shasum -a 256 ShareStream-Setup-macOS.zip ShareStream-macOS.zip ShareStream-Receiver-macOS.zip > SHA256SUMS.txt)
