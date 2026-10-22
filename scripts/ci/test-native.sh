#!/usr/bin/env bash
# Compile test executables only. Product targets do not exist in this configuration.
set -euo pipefail
cd "$(dirname "$0")/../.."
test_build="${SHARE_STREAM_TEST_BUILD_DIR:-build-tests}"
configure=(-DCMAKE_BUILD_TYPE=Release -DSHARE_STREAM_BUILD_PRODUCTS=OFF)
case "$(uname -s)" in
  MINGW*|MSYS*) configure+=(-G 'Visual Studio 17 2022' -A x64) ;;
  Darwin) configure+=(-G Ninja "-DCMAKE_OSX_ARCHITECTURES=$(uname -m)") ;;
  *) configure+=(-G Ninja) ;;
esac
cmake -S . -B "$test_build" "${configure[@]}" "$@"
cmake --build "$test_build" --config Release --parallel "${BUILD_JOBS:-3}" \
  --target stream_tests codec_tests stream_probe group_probe processor_tests update_tests
if [[ "$(uname -s)" = Linux ]]; then
  bash scripts/ci/with-display.sh ctest --test-dir "$test_build" -C Release --output-on-failure
else
  ctest --test-dir "$test_build" -C Release --output-on-failure
fi
