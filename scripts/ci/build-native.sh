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
bash scripts/web.sh ci
bash scripts/web.sh run build
bash scripts/chat.sh ci
bash scripts/chat.sh test
node desktop/tests/run-smoke.cjs
bash scripts/chat.sh run package
for binary in \
  'build/ShareStreamChat/Share Stream Chat.app/Contents/MacOS/Share Stream Chat' \
  'build/ShareStreamChat/Share Stream Chat.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework' \
  'build/ShareStreamChat/Share Stream Chat.app/Contents/Resources/bin/session_helper'; do
  lipo -archs "$binary" | python3 -c 'import sys; assert {"arm64", "x86_64"}.issubset(sys.stdin.read().split()), "Expected universal Chat and session helper"'
done
# Compile Setup in ordinary CI without exposing signing credentials. Release
# signing replaces this test payload with the notarized/stapled bundles.
mkdir -p build/installer-ci-payload
ditto 'build/ShareStream_artefacts/Release/VST3/Share Stream.vst3' 'build/installer-ci-payload/Share Stream.vst3'
ditto 'build/ShareStream_artefacts/Release/AU/Share Stream.component' 'build/installer-ci-payload/Share Stream.component'
ditto 'build/ShareStreamReceiver_artefacts/Release/Share Stream.app' 'build/installer-ci-payload/Share Stream.app'
ditto 'build/ShareStreamChat/Share Stream Chat.app' 'build/installer-ci-payload/Share Stream Chat.app'
ditto -c -k build/installer-ci-payload build/installer-ci-payload.zip
cmake -S . -B build -DSHARE_STREAM_INSTALLER_PAYLOAD="$PWD/build/installer-ci-payload.zip"
cmake --build build --target ShareStreamInstaller --parallel "${BUILD_JOBS:-3}"
lipo -archs 'build/ShareStreamInstaller_artefacts/Release/Share Stream Setup.app/Contents/MacOS/Share Stream Setup' | python3 -c 'import sys; assert {"arm64", "x86_64"}.issubset(sys.stdin.read().split()), "Expected universal Setup"'
