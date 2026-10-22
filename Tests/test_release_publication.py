import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    result = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'path', [str((ROOT/path).parent), *sys.path]):
        spec.loader.exec_module(result)
    return result


publisher = module('release_publisher', 'scripts/ci/publish-release.py')
recovery = module('release_recovery', 'scripts/ci/verify-release-recovery.py')


class PublicationTests(unittest.TestCase):
    def test_draft_is_queried_by_id(self):
        metadata = dict(databaseId=417, tagName='v0.4.1')
        release = dict(id=417, tag_name='v0.4.1', draft=True, assets=[])
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(metadata), '')):
            with patch.object(subprocess, 'check_output', return_value=json.dumps(release).encode()) as query:
                self.assertTrue(publisher.get_release('v0.4.1')['draft'])
                self.assertEqual(query.call_args.args[0][-1], 'repos/vvruspat/share-stream/releases/417')

    def fixture(self, root, draft):
        dist = root/'dist'
        dist.mkdir()
        for name in publisher.ASSETS + ['NOTARIZATION.json']:
            (dist/name).write_bytes(name.encode())
        hashes = {name: hashlib.sha256((dist/name).read_bytes()).hexdigest() for name in publisher.ASSETS}
        (dist/'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in hashes.items()))
        assets = []
        for file in dist.iterdir():
            assets.append(dict(name=file.name, digest='sha256:'+hashlib.sha256(file.read_bytes()).hexdigest(), size=file.stat().st_size))
        return dict(id=417, tag_name='v0.4.1', draft=draft, assets=assets)

    def run_existing(self, draft, bad=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = self.fixture(root, draft)
            if bad:
                release['assets'][0]['digest'] = 'sha256:'+'0'*64
            previous = Path.cwd()
            os.chdir(root)
            try:
                with patch.dict(os.environ, RELEASE_TAG='v0.4.1'), patch.object(publisher, 'get_release', return_value=release):
                    with patch.object(subprocess, 'run') as mutate:
                        if bad:
                            with self.assertRaisesRegex(RuntimeError, 'will not be overwritten'):
                                publisher.main()
                            mutate.assert_not_called()
                        else:
                            publisher.main()
                            calls = [call.args[0] for call in mutate.call_args_list]
                            self.assertEqual(calls, [['gh', 'release', 'edit', 'v0.4.1', '--draft=false', '--latest']] if draft else [])
            finally:
                os.chdir(previous)

    def test_complete_draft_is_promoted_without_reupload(self):
        self.run_existing(True)

    def test_identical_published_release_is_idempotent(self):
        self.run_existing(False)

    def test_changed_published_asset_is_never_overwritten(self):
        self.run_existing(False, bad=True)


class RecoveryTests(unittest.TestCase):
    def fixture(self):
        sha = 'a'*40
        run = dict(repository=dict(full_name='vvruspat/share-stream'), path='.github/workflows/release.yml',
                   head_sha=sha, head_branch='v0.4.1', status='completed')
        jobs = [dict(name=name, conclusion='success') for name in recovery.REQUIRED]
        jobs.append(dict(name=recovery.DEPLOY_JOB, conclusion='success'))
        jobs.append(dict(name='Publish signed release', conclusion='failure'))
        health = dict(ok=True, version='0.4.1', revision=sha)
        return run, jobs, sha, health

    def test_only_publication_may_be_recovered(self):
        run, jobs, sha, health = self.fixture()
        recovery.validate('v0.4.1', run, jobs, sha, health)
        jobs[0]['conclusion'] = 'failure'
        with self.assertRaises(RuntimeError):
            recovery.validate('v0.4.1', run, jobs, sha, health)

    def test_foreign_revision_or_deployment_is_rejected(self):
        run, jobs, sha, health = self.fixture()
        for changed, live in [(dict(run, head_sha='b'*40), health), (run, dict(health, revision='b'*40))]:
            with self.assertRaises(RuntimeError):
                recovery.validate('v0.4.1', changed, jobs, sha, live)

    def test_deferred_release_recovery_requires_skipped_deploy_and_all_other_gates(self):
        run, jobs, sha, _ = self.fixture()
        deploy = next(job for job in jobs if job['name'] == recovery.DEPLOY_JOB)
        deploy['conclusion'] = 'skipped'
        recovery.validate('v0.4.1', run, jobs, sha, {}, deploy_backend=False)
        with self.assertRaisesRegex(RuntimeError, 'immutable release plan'):
            recovery.validate('v0.4.1', run, jobs, sha, {})
        for conclusion in ('failure', 'cancelled', 'success'):
            deploy['conclusion'] = conclusion
            with self.subTest(conclusion=conclusion), self.assertRaises(RuntimeError):
                recovery.validate('v0.4.1', run, jobs, sha, {}, deploy_backend=False)
        deploy['conclusion'] = 'skipped'
        jobs[0]['conclusion'] = 'skipped'
        with self.assertRaisesRegex(RuntimeError, 'signing'):
            recovery.validate('v0.4.1', run, jobs, sha, {}, deploy_backend=False)

    def test_deferred_recovery_rejects_wrong_revision_and_missing_deployment_gate(self):
        run, jobs, sha, _ = self.fixture()
        for changed in (dict(run, head_sha='b'*40), run):
            with self.assertRaises(RuntimeError):
                recovery.validate('v0.4.1', changed,
                                  [job for job in jobs if job['name'] != recovery.DEPLOY_JOB],
                                  sha, {}, deploy_backend=False)
