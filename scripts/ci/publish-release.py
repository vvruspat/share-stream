#!/usr/bin/env python3
"""Publish atomically only after every platform and GitHub asset digest exists."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

ASSETS = ['ShareStream-Setup-macOS.zip', 'ShareStream-macOS.zip',
          'ShareStream-Receiver-macOS.zip', 'ShareStream-Setup-Windows-x64.exe',
          'ShareStream-Ubuntu-amd64.deb', 'ShareStream-Fedora-x86_64.rpm']


def main():
    tag = os.environ['RELEASE_TAG']
    dist = Path('dist')
    hashes = {name: hashlib.sha256((dist/name).read_bytes()).hexdigest() for name in ASSETS}
    # Check the separately authenticated notarization job's macOS checksums too.
    for line in (dist/'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        assert hashes[name.lstrip('*')] == digest, f'Checksum mismatch: {name}'
    (dist/'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in hashes.items()))
    if subprocess.run(['gh', 'release', 'view', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise SystemExit('Release exists; refusing to overwrite published binaries.')
    files = ASSETS + ['SHA256SUMS.txt', 'NOTARIZATION.json']
    subprocess.run(['gh', 'release', 'create', tag, '--draft', '--verify-tag', '--title', f'Share Stream {tag}',
                    '--notes-file', 'docs/release-notes.md', *[str(dist/name) for name in files]], check=True)
    release = json.loads(subprocess.check_output(['gh', 'api', f'repos/vvruspat/share-stream/releases/tags/{tag}']))
    uploaded = {a['name']: a for a in release['assets']}
    assert set(uploaded) == set(files)
    for name, digest in hashes.items():
        assert uploaded[name].get('digest') == f'sha256:{digest}', f'GitHub digest mismatch: {name}'
    subprocess.run(['gh', 'release', 'edit', tag, '--draft=false', '--latest'], check=True)


if __name__ == '__main__':
    main()
