#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p dist/backend
if [[ "${GITHUB_REF:-}" = refs/tags/* ]]; then
  python3 scripts/ci/release_info.py --tag "$GITHUB_REF_NAME"
else
  python3 scripts/ci/release_info.py
fi > dist/backend/manifest.json
image="$(python3 -c 'import json; print(json.load(open("dist/backend/manifest.json"))["image"])')"
docker build --platform linux/amd64 --build-arg "SHARE_STREAM_REVISION=$GITHUB_SHA" -t "$image" web
docker save "$image" | gzip -1 > dist/backend/image.tar.gz
cp server/relay.py dist/backend/relay.py
python3 - "$image" <<'PY'
import hashlib, json, subprocess, sys
from pathlib import Path
root = Path('dist/backend')
manifest = json.loads((root / 'manifest.json').read_text())
manifest['image_id'] = subprocess.check_output(['docker', 'image', 'inspect', '--format={{.Id}}', sys.argv[1]], text=True).strip()
for name in ['image.tar.gz', 'relay.py']:
    with (root / name).open('rb') as source:
        manifest[name + '_sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
