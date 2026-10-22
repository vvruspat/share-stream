#!/usr/bin/env python3
"""Recover publication only after all gates required by the tagged release plan."""
import json
import os
import re
import subprocess
import urllib.request
from release_policy import deployment_for_revision

REPO = 'vvruspat/share-stream'
REQUIRED = {
    'Validate release tag', 'Test and build backend', 'Build, sign and notarize macOS',
    'platforms / Windows x64 · VST3 + standalone + Setup',
    'platforms / Ubuntu 24.04 · VST3 + standalone',
    'platforms / Fedora 44 · VST3 + standalone',
}
DEPLOY_JOB = 'Deploy backend through Coolify'


def validate(tag, run, jobs, sha, health, deploy_backend=True):
    if (run['repository']['full_name'] != REPO or run['path'] != '.github/workflows/release.yml'
            or run['head_sha'] != sha or run['head_branch'] != tag or run['status'] != 'completed'):
        raise RuntimeError('Recovery run does not match the immutable release tag')
    successful = {job['name'] for job in jobs if job['conclusion'] == 'success'}
    if not REQUIRED.issubset(successful):
        raise RuntimeError('Compilation, tests, or signing have not succeeded')
    deployments = [job for job in jobs if job['name'] == DEPLOY_JOB]
    if len(deployments) != 1 or deployments[0]['conclusion'] != ('success' if deploy_backend else 'skipped'):
        raise RuntimeError('Deployment does not match the immutable release plan')
    if any(job['conclusion'] in ('failure', 'cancelled', 'timed_out', 'action_required')
           and job['name'] != 'Publish signed release' for job in jobs):
        raise RuntimeError('Only a publication failure can be recovered')
    if deploy_backend and (health.get('version') != tag[1:] or health.get('revision') != sha or not health.get('ok')):
        raise RuntimeError('Production does not match the tested release')


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/{path}']))


if __name__ == '__main__':
    tag, run_id = os.environ['RELEASE_TAG'], os.environ['SOURCE_RUN_ID']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag) or not re.fullmatch(r'\d{1,20}', run_id):
        raise SystemExit('Expected vX.Y.Z and a numeric Actions run ID')
    sha = subprocess.check_output(['git', 'rev-parse', f'{tag}^{{commit}}'], text=True).strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], check=True)
    deploy_backend = deployment_for_revision(tag[1:], sha)
    health = {}
    if deploy_backend:
        with urllib.request.urlopen('https://stream.whitesquirrel.digital/api/health', timeout=15) as response:
            health = json.load(response)
    validate(tag, api(f'actions/runs/{run_id}'), api(f'actions/runs/{run_id}/jobs?filter=latest&per_page=100')['jobs'], sha, health, deploy_backend)
    rollout = 'deployment verified' if deploy_backend else 'backend deferred by tagged release plan'
    print(f'Validated tested and signed artifacts ({rollout}): {tag} / {sha} / run {run_id}')
