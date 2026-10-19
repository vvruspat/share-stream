#!/usr/bin/env bash
# Apple ticket lookup can lose its CloudKit connection after an Accepted result.
# Retry the operation, preserving its final exit status and all validation gates.
retry_apple() {
  local attempt=1 status=0
  local maximum="${APPLE_RETRY_ATTEMPTS:-5}" delay="${APPLE_RETRY_DELAY:-3}"
  while true; do
    if "$@"; then return 0; else status=$?; fi
    if [ "$attempt" -ge "$maximum" ]; then return "$status"; fi
    printf 'Apple ticket operation failed (exit %s); retry %s/%s in %ss.\n' "$status" "$attempt" "$maximum" "$delay" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}
