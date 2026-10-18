#!/usr/bin/env bash
# Secrets are exposed only to this step, after compilation and tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${APPLE_CERTIFICATE_P12:?}" "${APPLE_CERTIFICATE_PASSWORD:?}" "${APPLE_NOTARY_CREDENTIALS:?}"
private_dir="$(mktemp -d)"
chmod 700 "$private_dir"
keychain="$private_dir/release.keychain-db"
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$private_dir"
}
trap cleanup EXIT
export PRIVATE_SIGNING_DIR="$private_dir"
python3 - <<'PY'
import base64, json, os, pathlib, secrets
root = pathlib.Path(os.environ['PRIVATE_SIGNING_DIR'])
(root/'certificate.p12').write_bytes(base64.b64decode(os.environ['APPLE_CERTIFICATE_P12'], validate=True))
(root/'keychain-password').write_text(secrets.token_urlsafe(36))
creds = json.loads(os.environ['APPLE_NOTARY_CREDENTIALS'])
for value in creds.values():
    if isinstance(value, str):
        print('::add-mask::' + value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A'))
if 'private_key' in creds:
    (root/'notary.p8').write_text(creds['private_key'])
(root/'notary.json').write_text(json.dumps(creds))
for path in root.iterdir(): path.chmod(0o600)
PY
keychain_password="$(cat "$private_dir/keychain-password")"
printf '::add-mask::%s\n' "$keychain_password"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$private_dir/certificate.p12" -P "$APPLE_CERTIFICATE_PASSWORD" -k "$keychain" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain" | \
  python3 -c 'import sys; assert "A0797824C682FB19E5DDED9D42BF267DEF20491D" in sys.stdin.read(), "Expected owner Developer ID identity missing"'
python3 - "$keychain" <<'PY'
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ['PRIVATE_SIGNING_DIR'])
c = json.loads((root/'notary.json').read_text())
args = ['xcrun','notarytool','store-credentials','share-stream-ci','--keychain',sys.argv[1]]
if 'private_key' in c:
    args += ['--key',str(root/'notary.p8'),'--key-id',c['key_id']]
    if c.get('issuer'): args += ['--issuer',c['issuer']]
else:
    assert c['team_id'] == '3WKK5AGY66', 'Notarization must use the owner account'
    args += ['--apple-id',c['apple_id'],'--team-id',c['team_id'],'--password',c['password']]
subprocess.run(args,check=True)
PY
export SIGNING_IDENTITY=A0797824C682FB19E5DDED9D42BF267DEF20491D
export NOTARY_KEYCHAIN="$keychain"
bash scripts/package-macos.sh
bash scripts/notarize-macos.sh share-stream-ci
