"""A host probe must ignore saved user sessions and leave them unchanged."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix='share-stream-probe-') as temporary:
    account = '1'*32
    store = Path(temporary)/'accounts.json'
    session = dict(code='2'*32, host='127.0.0.1', port=9, role=2,
                   connected=False, jitter=40, quality=0, participant='3'*32,
                   sendMonitorDb=-6, listenMonitorDb=-12, accountId=account)
    store.write_text(json.dumps(dict(
        accounts=[dict(user=dict(id=account, username='probe_test', name='Probe test'), token='4'*64)],
        active=account, room=session, transports={account: dict(plugin=session)})))
    before = store.read_bytes()
    env = dict(os.environ, SHARE_STREAM_ACCOUNT_FILE=str(store),
               SHARE_STREAM_PRESENCE_URL='disabled',
               SHARE_STREAM_DIRECTORY_URL='http://127.0.0.1:9')
    for attempt in range(2):
        subprocess.run([sys.argv[1], sys.argv[2]], env=env, check=True, timeout=45)
        assert store.read_bytes() == before, 'factory probe changed a saved user session'
        assert not store.with_name('accounts.json.lock').exists(), 'factory probe accessed account storage'
    print('PASS: repeated host probes ignore saved Listen/gain settings without modifying accounts')
