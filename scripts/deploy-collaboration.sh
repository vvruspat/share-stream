#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-13.140.153.191}"
(cd collaboration && npm ci && npm test)
ssh -o BatchMode=yes "$target" 'install -d -m 700 /opt/share-stream/collaboration'
COPYFILE_DISABLE=1 tar --no-xattrs -C collaboration -czf - server.mjs package.json package-lock.json public Dockerfile compose.yaml .dockerignore | ssh -o BatchMode=yes "$target" 'tar -xzf - -C /opt/share-stream/collaboration'
scp scripts/coolify-collaboration.php "$target:/opt/share-stream/collaboration/coolify-register.php"
ssh -o BatchMode=yes "$target" 'python3 -' <<'PY'
import pathlib, secrets, os
root = pathlib.Path('/opt/share-stream/collaboration')
env = root / '.env'
if not env.exists():
    env.write_text('PUBLIC_ORIGIN=https://stream.whitesquirrel.digital\nTURN_HOST=stream.whitesquirrel.digital\nTURN_SECRET=' + secrets.token_hex(32) + '\n')
    env.chmod(0o600)
settings = dict(line.split('=', 1) for line in env.read_text().splitlines() if '=' in line)
(root / 'turn-secret').write_text(settings['TURN_SECRET'])
(root / 'turn-secret').chmod(0o644)
config = '''listening-port=3478
listening-ip=13.140.153.191
relay-ip=13.140.153.191
min-port=49160
max-port=49319
realm=stream.whitesquirrel.digital
server-name=stream.whitesquirrel.digital
fingerprint
use-auth-secret
stale-nonce=600
no-tls
no-dtls
no-tcp-relay
no-cli
no-multicast-peers
user-quota=8
total-quota=64
max-bps=250000
bps-capacity=16000000
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
log-file=stdout
simple-log
no-software-attribute
'''
(root / 'turnserver.conf').write_text(config + 'static-auth-secret=' + settings['TURN_SECRET'] + '\n')
(root / 'turnserver.conf').chmod(0o644)
PY
ssh -o BatchMode=yes "$target" 'docker cp /opt/share-stream/collaboration/coolify-register.php coolify:/tmp/share-stream-register.php && docker cp /opt/share-stream/collaboration/compose.yaml coolify:/tmp/share-stream-compose.yaml && docker exec coolify php artisan tinker --execute='\''require "/tmp/share-stream-register.php";'\'''
printf '\nDeployment queued in Coolify. Check the Share Stream project, then HTTPS /api/health.\n'
