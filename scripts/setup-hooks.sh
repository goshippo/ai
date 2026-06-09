#!/usr/bin/env bash
# Enable this repo's commit guardrails (run once per clone).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "Commit guardrails enabled (core.hooksPath=.githooks)."
