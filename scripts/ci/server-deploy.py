#!/usr/bin/env python3
"""Restricted SSH entry point. Administrator installs this file outside Git checkout."""
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path('/opt/share-stream/ci')
RELAY = Path('/opt/share-stream/relay.py')
WEB = 'web-fdigjscz43ygrrmgnxiie5n7'
HEALTH = 'https://stream.whitesquirrel.digital/api/health'
FILES = {'manifest.json': 8192, 'relay.py': 1024 * 1024, 'image.tar.gz': 512 * 1024 * 1024}


def unpack(source, target):
    """No extractall: accept three bounded regular files, never links or paths."""
    seen = set()
    with tarfile.open(fileobj=source, mode='r|gz') as archive:
        for entry in archive:
            if entry.name not in FILES or entry.name in seen or not entry.isfile():
                raise ValueError('Unexpected deployment archive member')
            if entry.size < 0 or entry.size > FILES[entry.name]:
                raise ValueError('Deployment archive member too large')
            seen.add(entry.name)
            with archive.extractfile(entry) as incoming, (target / entry.name).open('xb') as output:
                shutil.copyfileobj(incoming, output, length=1024 * 1024)
            (target / entry.name).chmod(0o600)
    if seen != FILES.keys():
        raise ValueError('Incomplete deployment archive')


def manifest_at(target, sha):
    manifest = json.loads((target / 'manifest.json').read_text())
    version = manifest['version']
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    if manifest['sha'] != sha or manifest['tag'] != f'v{version}':
        raise ValueError('Revision or tag mismatch')
    if manifest['image'] != f'share-stream-call:{version}-{sha[:12]}':
        raise ValueError('Invalid image tag')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', manifest['image_id']):
        raise ValueError('Invalid image digest')
    for name in ['image.tar.gz', 'relay.py']:
        with (target / name).open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != manifest[name + '_sha256']:
            raise ValueError(f'Checksum mismatch: {name}')
    compile((target / 'relay.py').read_bytes(), 'relay.py', 'exec')
    return manifest


def image_digests(path, manifest):
    """Docker's classic and containerd stores expose different inspect IDs."""
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        if len(members) > 1024 or sum(member.size for member in members) > 2 * 1024 ** 3:
            raise ValueError('Docker archive exceeds deployment limits')
        seen = set()
        for member in members:
            parts = member.name.split('/')
            if (member.name.startswith('/') or '..' in parts or member.name in seen
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Unexpected Docker archive member')
            seen.add(member.name)

        def read_json(name):
            member = archive.getmember(name)
            if not member.isfile() or member.size > 1024 * 1024:
                raise ValueError('Invalid Docker metadata')
            data = archive.extractfile(member).read()
            return data, json.loads(data)

        _, images = read_json('manifest.json')
        if len(images) != 1 or images[0]['RepoTags'] != [manifest['image']]:
            raise ValueError('Docker archive must contain only the selected Share Stream image')
        config_bytes, config = read_json(images[0]['Config'])
        config_digest = 'sha256:' + hashlib.sha256(config_bytes).hexdigest()
        if config_digest != manifest['image_id']:
            raise ValueError('Docker image configuration digest mismatch')
        if config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != manifest['sha']:
            raise ValueError('Docker image configuration revision mismatch')
        if config.get('os') != 'linux' or config.get('architecture') != 'amd64':
            raise ValueError('Deployment requires a Linux amd64 image')
        accepted = {config_digest}
        if 'index.json' in seen:
            _, index = read_json('index.json')
            if len(index['manifests']) != 1:
                raise ValueError('Expected one OCI image manifest')
            entry = index['manifests'][0]
            digest = entry['digest']
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
                raise ValueError('Invalid OCI image digest')
            raw, image = read_json('blobs/sha256/' + digest.split(':')[1])
            if 'sha256:' + hashlib.sha256(raw).hexdigest() != digest or image['config']['digest'] != config_digest:
                raise ValueError('OCI manifest does not match selected image configuration')
            annotations = entry.get('annotations', {})
            if annotations.get('io.containerd.image.name', 'docker.io/library/' + manifest['image']) != 'docker.io/library/' + manifest['image']:
                raise ValueError('Unexpected OCI image name')
            if annotations.get('org.opencontainers.image.ref.name', manifest['image'].split(':')[1]) != manifest['image'].split(':')[1]:
                raise ValueError('Unexpected OCI image tag')
            accepted.add(digest)
        return accepted


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def health_matches(sha, version):
    try:
        with urllib.request.urlopen(HEALTH, timeout=5) as response:
            data = json.load(response)
        return data.get('ok') is True and data.get('revision') == sha and data.get('version') == version
    except (OSError, ValueError):
        return False


def queue_image(image):
    run('docker', 'cp', '/usr/local/libexec/share-stream-coolify-image.php',
        'coolify:/tmp/share-stream-ci-image.php')
    run('docker', 'exec', '-e', f'SHARE_STREAM_IMAGE={image}', 'coolify', 'php', 'artisan',
        'tinker', '--execute=require "/tmp/share-stream-ci-image.php";')


def deploy(target, manifest):
    sha, version = manifest['sha'], manifest['version']
    if health_matches(sha, version) and RELAY.read_bytes() == (target / 'relay.py').read_bytes():
        print(f'Already deployed {sha}', flush=True)
        return
    previous = subprocess.check_output(['docker', 'inspect', '--format={{.Config.Image}}', WEB], text=True).strip()
    accepted_digests = image_digests(target / 'image.tar.gz', manifest)
    with gzip.open(target / 'image.tar.gz', 'rb') as source:
        # Docker is the image loader, not a shell. The tag is fixed by the manifest.
        loader = subprocess.Popen(['docker', 'load'], stdin=subprocess.PIPE)
        try:
            shutil.copyfileobj(source, loader.stdin, length=1024 * 1024)
        finally:
            loader.stdin.close()
        if loader.wait() != 0:
            raise RuntimeError('Docker image import failed')
    image = manifest['image']
    actual = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image], text=True))[0]
    if actual['Id'] not in accepted_digests or actual['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError('Loaded image revision/digest mismatch')
    old_relay = RELAY.read_bytes()
    relay_changed = old_relay != (target / 'relay.py').read_bytes()
    try:
        queue_image(image)
        deadline = time.monotonic() + 180
        while not health_matches(sha, version):
            if time.monotonic() >= deadline:
                raise RuntimeError('New web revision failed HTTPS health verification')
            time.sleep(3)
        if relay_changed:
            staged = RELAY.with_suffix('.py.next')
            staged.write_bytes((target / 'relay.py').read_bytes())
            staged.chmod(0o644)
            staged.replace(RELAY)
            run('systemctl', 'restart', 'share-stream-relay.service')
        run('systemctl', 'is-active', '--quiet', 'share-stream-relay.service')
    except Exception:
        print('Deployment failed; restoring previous web image and relay', flush=True)
        if relay_changed:
            RELAY.write_bytes(old_relay)
            run('systemctl', 'restart', 'share-stream-relay.service')
        queue_image(previous)
        raise
    (ROOT / 'deployed.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Deployed {version} ({sha}) through Coolify; HTTPS health verified', flush=True)


def main():
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    if not re.fullmatch(r'deploy [a-f0-9]{40}', command):
        raise ValueError('Only deploy <commit SHA> is allowed')
    sha = command.split()[1]
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='incoming-', dir=ROOT) as directory:
            target = Path(directory)
            unpack(sys.stdin.buffer, target)
            deploy(target, manifest_at(target, sha))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Share Stream deployment rejected: {error}', file=sys.stderr)
        sys.exit(1)
