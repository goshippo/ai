#!/bin/bash
# check-clawhub-version-drift.sh
#
# Fail when the ClawHub bundle CONTENT changed in this PR but the bundle VERSION
# was NOT bumped. The ClawHub publish workflow (publish-clawhub.yml) is
# version-gated: it publishes only when the bundle frontmatter version differs
# from the registry's latest. So a content change without a version bump is a
# SILENT no-op, the improved content never reaches clawhub.ai/shippo/goshippo
# and strands behind the current published version. This check turns that
# silent strand into a loud, actionable error (the same spirit as check-drift,
# which forces regenerated mirrors to be committed).
#
# Usage:
#   scripts/check-clawhub-version-drift.sh <base-ref>   # CI: the PR base SHA
#   scripts/check-clawhub-version-drift.sh              # local: vs origin/main
set -euo pipefail

BUNDLE_DIR="providers/clawhub/skills/goshippo"
TEMPLATE="$BUNDLE_DIR/SKILL.md.template"

BASE="${1:-}"
if [ -z "$BASE" ]; then
  BASE="$(git rev-parse --verify --quiet origin/main || git rev-parse --verify --quiet main || true)"
  if [ -z "$BASE" ]; then
    echo "  No base ref (origin/main or main) available; skipping ClawHub version-drift check."
    exit 0
  fi
fi

# Any change under the bundle dir changes what would publish.
CONTENT_CHANGED="$(git diff --name-only "$BASE"...HEAD -- "$BUNDLE_DIR/" || true)"
if [ -z "$CONTENT_CHANGED" ]; then
  echo "  ClawHub bundle unchanged since base; nothing to check."
  exit 0
fi

# Did the bundle version line change in the template (the source of the version)?
VERSION_DIFF="$(git diff "$BASE"...HEAD -- "$TEMPLATE" | grep -E '^[+-]version:' || true)"
if [ -n "$VERSION_DIFF" ]; then
  echo "  OK: ClawHub bundle content changed AND the bundle version was bumped:"
  echo "$VERSION_DIFF" | sed 's/^/      /'
  exit 0
fi

echo "::error::ClawHub bundle content changed but the bundle version was NOT bumped."
echo ""
echo "Changed bundle files:"
echo "$CONTENT_CHANGED" | sed 's/^/  /'
echo ""
echo "publish-clawhub.yml is version-gated: a content change without a version bump"
echo "does NOT publish, so these changes would silently strand behind the current"
echo "published version on clawhub.ai/shippo/goshippo."
echo ""
echo "Fix: bump 'version:' in $TEMPLATE, run 'npm test', and commit the regenerated"
echo "bundle so the change actually ships."
exit 1
