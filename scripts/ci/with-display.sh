#!/usr/bin/env bash
set -euo pipefail
display_file="$(mktemp)"
Xvfb -displayfd 3 -screen 0 1280x800x24 -nolisten tcp 3>"$display_file" &
display_pid=$!
trap 'kill "$display_pid" 2>/dev/null || true; rm -f "$display_file"' EXIT
for attempt in {1..50}; do
  if [ -s "$display_file" ]; then break; fi
  kill -0 "$display_pid"
  sleep 0.1
done
test -s "$display_file"
export DISPLAY=":$(cat "$display_file")"
"$@"
