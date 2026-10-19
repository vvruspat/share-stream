#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel "${BUILD_JOBS:-2}"
bash scripts/ci/with-display.sh ctest --test-dir build --output-on-failure
python3 scripts/package-linux.py "${1:?deb or rpm}"
