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
python3 - <<'PY'
import hashlib, json, tarfile
from pathlib import Path
root = Path('dist/backend')
manifest = json.loads((root / 'manifest.json').read_text())
# Config digest is portable: Docker inspect may expose either the config digest
# or the OCI manifest digest depending on the server's image store.
with tarfile.open(root / 'image.tar.gz', 'r:gz') as archive:
    images = json.load(archive.extractfile('manifest.json'))
    assert len(images) == 1 and images[0]['RepoTags'] == [manifest['image']]
    config = archive.extractfile(images[0]['Config']).read()
manifest['image_id'] = 'sha256:' + hashlib.sha256(config).hexdigest()
for name in ['image.tar.gz', 'relay.py']:
    with (root / name).open('rb') as source:
        manifest[name + '_sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
