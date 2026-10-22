import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_platforms', ROOT/'scripts/ci/build_platforms.py')
platforms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(platforms)


class BuildPlatformTests(unittest.TestCase):
    def test_mac_only_and_full_profiles_and_historical_default(self):
        self.assertFalse(platforms.cross_platform_enabled(json.dumps({'platforms': ['macos']})))
        self.assertTrue(platforms.cross_platform_enabled(json.dumps(
            {'platforms': ['macos', 'windows', 'ubuntu', 'fedora']})))
        self.assertTrue(platforms.cross_platform_enabled())

    def test_invalid_profiles_cannot_silently_change_build_scope(self):
        for value in ([], {}, {'platforms': []}, {'platforms': ['windows']},
                      {'platforms': ['macos', 'windows']}, {'platforms': ['macos', 'macos']},
                      {'platforms': ['macos', {}]}, {'platforms': 'macos'},
                      {'platforms': ['macos'], 'extra': True}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                platforms.cross_platform_enabled(json.dumps(value))
        for value in ('', 'False', '0', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                platforms.publish_cross_platform(value)

    def test_recovery_uses_tagged_profile_and_preserves_old_full_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            git('-c', 'user.name=Build test', '-c', 'user.email=test@example.invalid',
                'commit', '--allow-empty', '-qm', 'legacy full build')
            legacy = git('rev-parse', 'HEAD')
            path = root / platforms.PROFILE_PATH
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'platforms': ['macos']}))
            git('add', platforms.PROFILE_PATH)
            git('-c', 'user.name=Build test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'mac only')
            mac = git('rev-parse', 'HEAD')
            path.write_text(json.dumps({'platforms': ['macos', 'windows', 'ubuntu', 'fedora']}))
            with patch.object(platforms, 'ROOT', root):
                self.assertTrue(platforms.cross_platform_for_checkout())
                self.assertFalse(platforms.cross_platform_for_revision(mac))
                self.assertTrue(platforms.cross_platform_for_revision(legacy))
