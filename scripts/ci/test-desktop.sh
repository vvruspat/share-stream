#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/web.sh ci
bash scripts/chat.sh ci
bash scripts/chat.sh test
# Transpile only the server test fixture. Vite serves renderer source directly.
(cd web && node node_modules/typescript/bin/tsc -p tsconfig.server.json)
SHARE_STREAM_TEST_BUILD_DIR="${SHARE_STREAM_TEST_BUILD_DIR:-build-tests}" node desktop/tests/run-smoke.cjs --development
