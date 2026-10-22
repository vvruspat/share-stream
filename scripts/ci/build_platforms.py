#!/usr/bin/env python3
"""Shared native build scope; historical tags without a profile build all platforms."""
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROFILE_PATH = 'scripts/ci/build-platforms.json'
MACOS_ASSETS = ['ShareStream-Setup-macOS.zip', 'ShareStream-macOS.zip',
                'ShareStream-Receiver-macOS.zip']
EXTRA_ASSETS = ['ShareStream-Setup-Windows-x64.exe', 'ShareStream-Ubuntu-amd64.deb',
                'ShareStream-Fedora-x86_64.rpm']
EXTRA_JOBS = {
    'platforms / Windows x64 · VST3 + standalone + Setup',
    'platforms / Ubuntu 24.04 · VST3 + standalone',
    'platforms / Fedora 44 · VST3 + standalone',
}


def cross_platform_enabled(profile=None):
    if profile is None:
        return True
    data = json.loads(profile)
    platforms = data.get('platforms') if isinstance(data, dict) else None
    if (not isinstance(data, dict) or set(data) != {'platforms'}
            or not isinstance(platforms, list) or not all(isinstance(p, str) for p in platforms)
            or len(set(platforms)) != len(platforms)
            or set(platforms) not in ({'macos'}, {'macos', 'windows', 'ubuntu', 'fedora'})):
        raise ValueError('Expected macos only or macos, windows, ubuntu and fedora')
    return len(platforms) > 1


def cross_platform_for_checkout():
    path = ROOT / PROFILE_PATH
    return cross_platform_enabled(path.read_text() if path.exists() else None)


def cross_platform_for_revision(sha):
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Expected an immutable release commit')
    existing = subprocess.check_output(
        ['git', 'ls-tree', '--name-only', sha, '--', PROFILE_PATH], cwd=ROOT, text=True).strip()
    profile = subprocess.check_output(
        ['git', 'show', f'{sha}:{PROFILE_PATH}'], cwd=ROOT, text=True) if existing else None
    return cross_platform_enabled(profile)


def publish_cross_platform(value):
    if value not in ('true', 'false'):
        raise ValueError('Expected boolean CROSS_PLATFORM publication scope')
    return value == 'true'


if __name__ == '__main__':
    enabled = cross_platform_for_checkout()
    print(json.dumps({'cross_platform': enabled}))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'cross_platform={str(enabled).lower()}\n')
