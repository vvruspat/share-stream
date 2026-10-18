#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DEPLOY_HOST:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}" "${GITHUB_SHA:?}"
private_dir="$(mktemp -d)"
chmod 700 "$private_dir"
trap 'rm -rf "$private_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$private_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$private_dir/known_hosts"
chmod 600 "$private_dir/key" "$private_dir/known_hosts"
tar -C dist/backend -czf - manifest.json image.tar.gz relay.py | \
  ssh -T -i "$private_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$private_dir/known_hosts" \
    -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    "root@$DEPLOY_HOST" "deploy $GITHUB_SHA"
