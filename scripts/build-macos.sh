#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release "$@"
cmake --build build --parallel 8
ctest --test-dir build --output-on-failure
python3 -m unittest discover -s Tests -p 'test_*.py'
build/plugin_probe_artefacts/Release/plugin_probe "build/ShareStream_artefacts/Release/VST3/Share Stream.vst3"
bash scripts/package-macos.sh
