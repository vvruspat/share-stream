#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES='arm64;x86_64'
cmake --build build --parallel "${BUILD_JOBS:-3}"
ctest --test-dir build --output-on-failure
python3 -m unittest discover -s Tests -p 'test_*.py' -v
build/plugin_probe_artefacts/Release/plugin_probe 'build/ShareStream_artefacts/Release/VST3/Share Stream.vst3'
for binary in \
  'build/ShareStream_artefacts/Release/VST3/Share Stream.vst3/Contents/MacOS/Share Stream' \
  'build/ShareStream_artefacts/Release/AU/Share Stream.component/Contents/MacOS/Share Stream' \
  'build/ShareStreamReceiver_artefacts/Release/Share Stream.app/Contents/MacOS/Share Stream'; do
  lipo -archs "$binary" | python3 -c 'import sys; arches = sys.stdin.read().split(); print("Verified architectures:", *arches); assert {"arm64", "x86_64"}.issubset(arches), "Expected a universal macOS binary"'
done
