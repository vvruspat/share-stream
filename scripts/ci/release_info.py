#!/usr/bin/env python3
"""One release version across native, browser and deployment artifacts."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def release_info(tag=None):
    version = re.search(r'project\(ShareStream VERSION (\d+\.\d+\.\d+)',
                        (ROOT / 'CMakeLists.txt').read_text())[1]
    assert json.loads((ROOT / 'web/package.json').read_text())['version'] == version
    assert json.loads((ROOT / 'web/package-lock.json').read_text())['version'] == version
    assert f'WEB_VERSION = "{version}"' in (ROOT / 'web/shared/protocol.ts').read_text()
    assert f'image: share-stream-call:{version}' in (ROOT / 'web/compose.yaml').read_text()
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if tag:
        assert tag == f'v{version}', f'Tag {tag} does not match version {version}'
        tagged = subprocess.check_output(['git', 'rev-parse', f'{tag}^{{commit}}'], cwd=ROOT, text=True).strip()
        assert tagged == sha, 'Release must run from the tagged commit'
        subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], cwd=ROOT, check=True)
    return dict(version=version, tag=f'v{version}', sha=sha,
                image=f'share-stream-call:{version}-{sha[:12]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag')
    args = parser.parse_args()
    info = release_info(args.tag)
    print(json.dumps(info, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.writelines(f'{key}={value}\n' for key, value in info.items())
