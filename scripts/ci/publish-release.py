#!/usr/bin/env python3
"""Publish atomically only after every selected platform and asset digest exists."""
import hashlib
import json
import os
import subprocess
from pathlib import Path
from build_platforms import MACOS_ASSETS, EXTRA_ASSETS, publish_cross_platform

ASSETS = MACOS_ASSETS + EXTRA_ASSETS
REPO = 'vvruspat/share-stream'


def get_release(tag):
    # /releases/tags/:tag intentionally excludes drafts. Resolve the numeric ID
    # through gh's authenticated draft-aware lookup, then use the ID endpoint.
    result = subprocess.run(['gh', 'release', 'view', tag, '--json', 'databaseId,tagName'],
                            capture_output=True, text=True)
    if result.returncode:
        if 'release not found' in result.stderr.lower():
            return None
        raise RuntimeError(result.stderr or 'Cannot query release')
    metadata = json.loads(result.stdout)
    if metadata['tagName'] != tag or not isinstance(metadata['databaseId'], int):
        raise RuntimeError('Unexpected release identity')
    release = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/releases/{metadata["databaseId"]}']))
    if release['tag_name'] != tag or release['id'] != metadata['databaseId']:
        raise RuntimeError('Release identity mismatch')
    return release


def verify_assets(release, hashes, dist, complete=True):
    uploaded = {a['name']: a for a in release['assets']}
    if len(uploaded) != len(release['assets']) or not set(uploaded).issubset(hashes):
        raise RuntimeError('Unexpected release assets; refusing to change release')
    if complete and set(uploaded) != set(hashes):
        raise RuntimeError('Release assets are incomplete')
    for name, asset in uploaded.items():
        if asset.get('digest') != f'sha256:{hashes[name]}' or asset['size'] != (dist/name).stat().st_size:
            raise RuntimeError(f'GitHub asset mismatch: {name}; existing assets will not be overwritten')
    return uploaded


def main():
    tag = os.environ['RELEASE_TAG']
    dist = Path('dist')
    assets = MACOS_ASSETS + (EXTRA_ASSETS if publish_cross_platform(os.environ.get('CROSS_PLATFORM', 'true')) else [])
    hashes = {name: hashlib.sha256((dist/name).read_bytes()).hexdigest() for name in assets}
    # Check the separately authenticated notarization job's macOS checksums too.
    for line in (dist/'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        assert hashes[name.lstrip('*')] == digest, f'Checksum mismatch: {name}'
    (dist/'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in hashes.items()))
    files = assets + ['SHA256SUMS.txt', 'NOTARIZATION.json']
    hashes.update({name: hashlib.sha256((dist/name).read_bytes()).hexdigest() for name in files if name not in hashes})
    release = get_release(tag)
    if release is None:
        subprocess.run(['gh', 'release', 'create', tag, '--draft', '--verify-tag', '--title', f'Share Stream {tag}',
                        '--notes-file', 'docs/release-notes.md', *[str(dist/name) for name in files]], check=True)
        release = get_release(tag)
    elif not release['draft']:
        verify_assets(release, hashes, dist)
        print('Release already published with identical assets; nothing changed.')
        return
    uploaded = verify_assets(release, hashes, dist, complete=False)
    missing = [name for name in files if name not in uploaded]
    if missing:
        subprocess.run(['gh', 'release', 'upload', tag, *[str(dist/name) for name in missing]], check=True)
        release = get_release(tag)
    verify_assets(release, hashes, dist)
    subprocess.run(['gh', 'release', 'edit', tag, '--draft=false', '--latest'], check=True)


if __name__ == '__main__':
    main()
