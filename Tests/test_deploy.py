import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'scripts/ci/server-deploy.py')
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)


class DeploymentPayloadTests(unittest.TestCase):
    def archive(self, entries):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            for name, content, kind in entries:
                member = tarfile.TarInfo(name)
                member.size = len(content)
                member.type = kind
                archive.addfile(member, io.BytesIO(content))
        data.seek(0)
        return data

    def test_rejects_paths_links_duplicates_and_missing_members(self):
        for entries in [
            [('../relay.py', b'', tarfile.REGTYPE)],
            [('relay.py', b'', tarfile.SYMTYPE)],
            [('relay.py', b'', tarfile.REGTYPE)] * 2,
            [('relay.py', b'', tarfile.REGTYPE)],
        ]:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    deploy.unpack(self.archive(entries), Path(directory))

    def test_valid_payload_and_tamper_detection(self):
        sha = 'a' * 40
        files = {'image.tar.gz': b'example', 'relay.py': b'print("relay")\n'}
        manifest = dict(version='0.3.1', tag='v0.3.1', sha=sha,
                        image='share-stream-call:0.3.1-' + sha[:12], image_id='sha256:' + 'b' * 64)
        for name, data in files.items():
            manifest[name + '_sha256'] = hashlib.sha256(data).hexdigest()
        files['manifest.json'] = json.dumps(manifest).encode()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            deploy.unpack(self.archive([(name, data, tarfile.REGTYPE) for name, data in files.items()]), target)
            self.assertEqual(deploy.manifest_at(target, sha), manifest)
            with self.assertRaises(ValueError):
                deploy.manifest_at(target, 'c' * 40)
            (target / 'relay.py').write_bytes(b'tampered')
            with self.assertRaises(ValueError):
                deploy.manifest_at(target, sha)
