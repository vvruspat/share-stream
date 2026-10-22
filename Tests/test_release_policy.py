import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_policy', ROOT/'scripts/ci/release_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ReleasePolicyTests(unittest.TestCase):
    def test_deployment_defaults_to_enabled_and_deferral_is_version_bound(self):
        self.assertTrue(policy.deployment_enabled('0.5.0'))
        plan = json.dumps(dict(version='0.5.0', deploy_backend=False))
        self.assertFalse(policy.deployment_enabled('0.5.0', plan))
        self.assertTrue(policy.deployment_enabled('0.5.1', plan))
        self.assertTrue(policy.deployment_enabled('0.5.0', json.dumps(dict(version='0.5.0', deploy_backend=True))))

    def test_invalid_plans_are_rejected_instead_of_disabling_deployment(self):
        for plan in ({'deploy_backend': False}, {'version': '*', 'deploy_backend': False},
                     {'version': '0.5.0', 'deploy_backend': 'false'},
                     {'version': '0.5.0', 'deploy_backend': 0},
                     {'version': '0.5.0', 'deploy_backend': False, 'extra': True}, []):
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                policy.deployment_enabled('0.5.0', json.dumps(plan))

    def test_recovery_policy_comes_from_immutable_commit_not_current_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            path = root / policy.PLAN_PATH
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(dict(version='0.5.0', deploy_backend=False)))
            git('add', policy.PLAN_PATH)
            git('-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'deferred release')
            sha = git('rev-parse', 'HEAD')
            path.write_text(json.dumps(dict(version='0.5.0', deploy_backend=True)))
            with patch.object(policy, 'ROOT', root):
                self.assertTrue(policy.deployment_for_checkout('0.5.0'))
                self.assertFalse(policy.deployment_for_revision('0.5.0', sha))
                self.assertTrue(policy.deployment_for_revision('0.5.1', sha))

    def test_explicit_dispatch_modes_cannot_be_combined(self):
        self.assertEqual(policy.validate_mode('push'), 'release')
        self.assertEqual(policy.validate_mode('workflow_dispatch', True), 'backend-only')
        self.assertEqual(policy.validate_mode('workflow_dispatch', False, '123', 'v0.5.0'), 'recovery')
        for args in [('push', True), ('push', False, '123', 'v0.5.0'),
                     ('workflow_dispatch', True, '123', 'v0.5.0'),
                     ('workflow_dispatch', False, '', 'v0.5.0'),
                     ('workflow_dispatch', False, '123', ''),
                     ('workflow_dispatch', False, '123', 'main')]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                policy.validate_mode(*args)

    def test_backend_only_requires_matching_published_application_release(self):
        policy.validate_published_release('v0.5.0', dict(tagName='v0.5.0', isDraft=False))
        for release in (dict(tagName='v0.5.0', isDraft=True), dict(tagName='v0.5.1', isDraft=False),
                        dict(tagName='v0.5.0'), dict(tagName='v0.5.0', isDraft='false')):
            with self.subTest(release=release), self.assertRaises(ValueError):
                policy.validate_published_release('v0.5.0', release)
