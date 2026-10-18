#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-13.140.153.191}"
python3 -m unittest discover -s Tests -p 'test_*.py'
ssh -o BatchMode=yes "$target" 'install -d -m 755 /opt/share-stream'
scp server/relay.py "$target:/opt/share-stream/relay.py"
scp server/share-stream-relay.service "$target:/etc/systemd/system/share-stream-relay.service"
ssh -o BatchMode=yes "$target" 'chmod 644 /opt/share-stream/relay.py /etc/systemd/system/share-stream-relay.service && systemctl daemon-reload && systemctl enable share-stream-relay.service && systemctl restart share-stream-relay.service && systemctl --no-pager --full status share-stream-relay.service'
