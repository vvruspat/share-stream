#!/usr/bin/env python3
"""Version-bound backend rollout policy and explicit Release dispatch modes."""
import json
import os
import argparse
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PLAN_PATH = 'scripts/ci/release-plan.json'


def deployment_enabled(version, plan_text=None):
    if plan_text is None:
        return True
    plan = json.loads(plan_text)
    if (not isinstance(plan, dict) or set(plan) != {'version', 'deploy_backend'}
            or not isinstance(plan['version'], str)
            or not re.fullmatch(r'\d+\.\d+\.\d+', plan['version'])
            or not isinstance(plan['deploy_backend'], bool)):
        raise ValueError('Expected a version-bound release plan with boolean deploy_backend')
    # A deferred release must never silently disable deployment for a later version.
    return plan['deploy_backend'] if plan['version'] == version else True


def deployment_for_checkout(version):
    path = ROOT / PLAN_PATH
    return deployment_enabled(version, path.read_text() if path.exists() else None)


def deployment_for_revision(version, sha):
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Expected an immutable release commit')
    existing = subprocess.check_output(
        ['git', 'ls-tree', '--name-only', sha, '--', PLAN_PATH], cwd=ROOT, text=True).strip()
    plan = subprocess.check_output(
        ['git', 'show', f'{sha}:{PLAN_PATH}'], cwd=ROOT, text=True) if existing else None
    return deployment_enabled(version, plan)


def validate_mode(event, backend_only=False, source_run_id='', recovery_tag=''):
    if backend_only and (source_run_id or recovery_tag):
        raise ValueError('Backend-only deployment cannot be combined with publication recovery')
    if source_run_id or recovery_tag:
        if (event != 'workflow_dispatch' or not re.fullmatch(r'\d{1,20}', source_run_id)
                or not re.fullmatch(r'v\d+\.\d+\.\d+', recovery_tag)):
            raise ValueError('Publication recovery needs an existing tag and source run ID')
        return 'recovery'
    if backend_only:
        if event != 'workflow_dispatch':
            raise ValueError('Backend-only deployment requires an explicit manual dispatch')
        return 'backend-only'
    return 'release'


def validate_published_release(tag, release):
    if (not re.fullmatch(r'v\d+\.\d+\.\d+', tag)
            or release.get('tagName') != tag or release.get('isDraft') is not False):
        raise ValueError('Backend-only deployment requires the matching published application release')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-published')
    args = parser.parse_args()
    if args.verify_published:
        release = json.loads(subprocess.check_output([
            'gh', 'release', 'view', args.verify_published, '--repo', 'vvruspat/share-stream',
            '--json', 'tagName,isDraft']))
        validate_published_release(args.verify_published, release)
        print(f'Published application release verified: {args.verify_published}')
        raise SystemExit(0)
    value = os.environ.get('BACKEND_ONLY', '')
    if value not in ('', 'false', 'true'):
        raise SystemExit('Invalid backend_only input')
    print(validate_mode(os.environ.get('RELEASE_EVENT', ''), value == 'true',
                        os.environ.get('SOURCE_RUN_ID', ''), os.environ.get('RECOVERY_TAG', '')))
