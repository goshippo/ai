#!/usr/bin/env bash
# retry.sh: run a command, retrying on failure with linear backoff.
# Usage: bash scripts/retry.sh <max_attempts> <command> [args...]
# No external dependencies. Used in CI to make network-dependent steps
# (npm / npx / pip downloads) resilient to transient registry blips.
set -u
max="$1"; shift
attempt=1
until "$@"; do
  status=$?
  if [ "$attempt" -ge "$max" ]; then
    echo "::error::command failed after ${attempt} attempt(s) (exit ${status}): $*" >&2
    exit "$status"
  fi
  delay=$((attempt * 5))
  echo "::warning::attempt ${attempt}/${max} failed (exit ${status}): $*. Retrying in ${delay}s." >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
