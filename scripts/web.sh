#!/bin/bash
# Use the project Node version without replacing the user's global installation.
set -euo pipefail
cd "$(dirname "$0")/../web"
if node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 24 && minor >= 11) || major >= 26 ? 0 : 1)' 2>/dev/null; then
  exec npm "$@"
else
  exec npx --yes --package=node@24.22.0 -- npm "$@"
fi
