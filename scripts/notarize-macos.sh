#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:?Usage: bash scripts/notarize-macos.sh KEYCHAIN_PROFILE [SUBMISSION_ID]}"
submission="${2:-}"
keychain_args=()
if [ -n "${NOTARY_KEYCHAIN:-}" ]; then keychain_args=(--keychain "$NOTARY_KEYCHAIN"); fi
artifact_root="${DIST_ROOT:-dist}"
mkdir -p build
if [ -z "$submission" ]; then
  xcrun notarytool submit "$artifact_root/ShareStream-macOS.zip" --keychain-profile "$profile" "${keychain_args[@]}" --output-format json > build/notary-submission.json
  submission="$(python3 -c 'import json; print(json.load(open("build/notary-submission.json"))["id"])')"
fi
printf 'Notarization submission: %s\n' "$submission"
xcrun notarytool wait "$submission" --keychain-profile "$profile" "${keychain_args[@]}" --timeout 10m --output-format json > build/notary-result.json
python3 -c 'import json; r=json.load(open("build/notary-result.json")); print(r); assert r.get("status")=="Accepted", "Apple has not accepted this submission"'
xcrun notarytool log "$submission" --keychain-profile "$profile" "${keychain_args[@]}" build/notary-log.json
package_dir="$artifact_root/ShareStream-macOS"
receiver_dir="$artifact_root/ShareStream-Receiver"
for bundle in 'Share Stream.vst3' 'Share Stream.component' 'Share Stream.app'; do
  if ! xcrun stapler validate "$package_dir/$bundle" > /dev/null 2>&1; then
    xcrun stapler staple "$package_dir/$bundle"
  fi
  xcrun stapler validate "$package_dir/$bundle"
  codesign --verify --deep --strict "$package_dir/$bundle"
done
spctl --assess --type execute --verbose=2 "$package_dir/Share Stream.app"
python3 - <<'PY'
import json, os
from pathlib import Path
result=json.loads(Path('build/notary-result.json').read_text())
log=json.loads(Path('build/notary-log.json').read_text())
report={
    'submissionId':result['id'], 'status':result['status'],
    'uploadDate':log.get('uploadDate'), 'issues':log.get('issues'),
    'stapledBundles':['Share Stream.vst3','Share Stream.component','Share Stream.app'],
    'gatekeeper':'Notarized Developer ID',
}
(Path(os.environ.get('DIST_ROOT', 'dist')) / 'NOTARIZATION.json').write_text(json.dumps(report,indent=2)+'\n')
PY
# Re-running after documentation changes must not overwrite an identical app
# that LaunchServices may now protect as a launched application.
if ! diff -qr "$package_dir/Share Stream.app" "$receiver_dir/Share Stream.app" > /dev/null; then
  ditto "$package_dir/Share Stream.app" "$receiver_dir/Share Stream.app"
fi
for folder in "$package_dir" "$receiver_dir"; do
  cp VALIDATION.md "$folder/VALIDATION.md"
  cp THIRD_PARTY.md "$folder/THIRD_PARTY.md"
  cp "$artifact_root/NOTARIZATION.json" "$folder/NOTARIZATION.json"
done
cp README.md "$package_dir/README.md"
cp README-receiver.md "$receiver_dir/README.md"
# Rearchive the stapled bundles without rebuilding or re-signing them.
ditto -c -k --sequesterRsrc --keepParent "$package_dir" "$artifact_root/ShareStream-macOS.zip"
ditto -c -k --sequesterRsrc --keepParent "$receiver_dir" "$artifact_root/ShareStream-Receiver-macOS.zip"
(cd "$artifact_root" && shasum -a 256 ShareStream-macOS.zip ShareStream-Receiver-macOS.zip > SHA256SUMS.txt)
