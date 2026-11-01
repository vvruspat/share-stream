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
    writers, rounds = 8, 10
    for round_index in range(rounds):
        with concurrent.futures.ThreadPoolExecutor(max_workers=writers) as pool:
            replies = list(pool.map(lambda index: command(account(index)),
                                    range(round_index*writers+1, (round_index+1)*writers+1)))
        expected = {f'{index:032x}' for index in range(1, (round_index+1)*writers+1)}
        saved = json.loads(store.read_text())
        assert {entry['user']['id'] for entry in saved['accounts']} == expected, 'concurrent native writers lost an account'
        assert all('token' not in json.dumps(reply) for reply in replies), 'helper exposed bearer tokens'
    # Separate plug-in instances in one DAW also write from independent threads.
    subprocess.run([sys.argv[3]], env=env, check=True, timeout=15)
    assert json.loads(store.read_text())['counter'] == 200
    if os.name != 'nt':
        import fcntl
        assert store.stat().st_mode & 0o777 == 0o600
        assert store.parent.stat().st_mode & 0o777 == 0o700
        lock_file = store.with_name(store.name+'.lock')
        assert lock_file.stat().st_mode & 0o777 == 0o600
        with lock_file.open('r+b') as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            before = store.read_bytes()
            blocked = subprocess.Popen([sys.argv[2]], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env=env)
            try:
                try:
                    blocked.communicate(json.dumps(account(81)), timeout=0.25)
                except subprocess.TimeoutExpired:
                    pass
                else:
                    raise AssertionError('helper ignored the held account-store lock')
                assert store.read_bytes() == before, 'a blocked writer changed the store'
                fcntl.flock(held, fcntl.LOCK_UN)
                output, error = blocked.communicate(timeout=10)
                assert blocked.returncode == 0, output+error
            finally:
                if blocked.poll() is None:
                    blocked.kill();blocked.communicate()
            fcntl.flock(held, fcntl.LOCK_EX)
            before = store.read_bytes()
            result = command(account(82), okay=False)
            assert 'busy' in result['error'].lower(), 'lock timeout must report busy'
            assert store.read_bytes() == before, 'a timed-out writer changed the store'
            fcntl.flock(held, fcntl.LOCK_UN)
        # An unusable lock must fail closed, never silently allow a writer.
        lock_file.unlink();lock_file.mkdir()
        before = store.read_bytes()
        try:
            result = command(account(82), okay=False)
            assert 'lock' in result['error'].lower()
            assert store.read_bytes() == before, 'an invalid lock allowed a write'
        finally:
            lock_file.rmdir()
        # Restoring a lock after a failed attempt must permit the next writer.
        command(account(81))
    else:
        command(account(81))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(command, [dict(operation='remove', id=f'{1:032x}'), account(82)]))
    assert {entry['user']['id'] for entry in json.loads(store.read_text())['accounts']} == {f'{n:032x}' for n in range(2, 83)}
    assert json.loads(store.read_text())['counter'] == 200, 'account edits discarded unrelated shared state'
    store.write_text('damaged-json')
    command(account(8), okay=False)
    assert store.read_text() == 'damaged-json', 'a damaged store must not be overwritten'
    store.unlink()
    subprocess.run([sys.argv[1], '--resume-session'], env=env, check=True, timeout=45)
