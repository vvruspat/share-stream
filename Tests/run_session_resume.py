"""Exercise the real cross-process store and processor with isolated preferences."""
import concurrent.futures
import json
import os
import pathlib
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix='share-stream-session-') as temporary:
    store = pathlib.Path(temporary) / 'private' / 'accounts.json'
    env = dict(os.environ, SHARE_STREAM_ACCOUNT_FILE=str(store), SHARE_STREAM_PRESENCE_URL='disabled')
    def command(body, okay=True):
        result = subprocess.run([sys.argv[2]], input=json.dumps(body), text=True,
                                capture_output=True, env=env, timeout=15)
        assert (result.returncode == 0) == okay, result.stdout + result.stderr
        return json.loads(result.stdout)
    def account(index):
        return dict(operation='put', user=dict(id=f'{index:032x}', username=f'user_{index}', name='Test'), token=f'{index:064x}')
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        replies = list(pool.map(lambda index: command(account(index)), range(1, 7)))
    saved = json.loads(store.read_text())
    assert len(saved['accounts']) == 6, 'concurrent native writers lost an account'
    assert all('token' not in json.dumps(reply) for reply in replies), 'helper exposed bearer tokens'
    if os.name != 'nt':
        assert store.stat().st_mode & 0o777 == 0o600
        assert store.parent.stat().st_mode & 0o777 == 0o700
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(command, [dict(operation='remove', id=f'{1:032x}'), account(7)]))
    assert {entry['user']['id'] for entry in json.loads(store.read_text())['accounts']} == {f'{n:032x}' for n in range(2, 8)}
    store.write_text('damaged-json')
    command(account(8), okay=False)
    assert store.read_text() == 'damaged-json', 'a damaged store must not be overwritten'
    store.unlink()
    subprocess.run([sys.argv[1], '--resume-session'], env=env, check=True, timeout=45)
