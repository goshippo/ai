#!/bin/bash
# check-clawhub-version-drift.sh
#
# Fail when the ClawHub bundle CONTENT changed in this PR but the bundle version
# would NOT publish, i.e. it still equals the ClawHub registry's current latest.
# publish-clawhub.yml is version-gated: it publishes ONLY when the bundle
# frontmatter version differs from the registry latest. So a content change that
# leaves the version equal to what is already published is a SILENT no-op, the
# regenerated content strands behind the published version on
# clawhub.ai/shippo/goshippo. This check mirrors the publish gate's own
# condition (version vs registry latest) and turns the silent strand into a
# loud, actionable error at PR time.
#
# Usage:
#   scripts/check-clawhub-version-drift.sh <base-ref>   # CI: the PR base SHA
#   scripts/check-clawhub-version-drift.sh              # local: vs origin/main
set -euo pipefail

BUNDLE_DIR="providers/clawhub/skills/goshippo"
BUNDLE_SKILL="$BUNDLE_DIR/SKILL.md"   # generated; carries the published version (matches the publish gate)
SLUG="shippo"   # canonical ClawHub registry slug (clawhub.ai/shippo/shippo); the bundle dir is named goshippo/ for legacy reasons

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

# The version that WOULD publish (publish gate reads the generated SKILL.md).
VER="$(grep -E '^version:' "$BUNDLE_SKILL" | head -1 | sed -E 's/^version:[[:space:]]*//')"
if [ -z "$VER" ]; then
  echo "::error::Could not read ClawHub bundle version from $BUNDLE_SKILL."
  exit 1
fi

# Registry latest (clawhub inspect is public, no auth). Fail OPEN on a registry
# /network error so a transient blip cannot block all PRs; publish-clawhub.yml
# is the backstop that ultimately gates the real publish.
LATEST="$(npx -y clawhub@0.19.0 inspect "$SLUG" --json 2>/dev/null \
  | python3 -c "import json,sys; print((json.load(sys.stdin).get('skill',{}).get('tags',{}) or {}).get('latest',''))" 2>/dev/null || true)"
if [ -z "$LATEST" ]; then
  echo "::warning::Could not read ClawHub registry latest for $SLUG (network/registry). Skipping version-drift check; publish-clawhub.yml remains the backstop."
  exit 0
fi

if [ "$VER" != "$LATEST" ]; then
  echo "  OK: ClawHub bundle content changed and the bundle version ($VER) differs from the registry latest ($LATEST); it will publish."
  exit 0
fi

echo "::error::ClawHub bundle content changed but the bundle version ($VER) equals the registry latest ($LATEST), so publish-clawhub.yml will NOT publish it."
echo ""
echo "Changed bundle files:"
echo "$CONTENT_CHANGED" | sed 's/^/  /'
echo ""
echo "These changes would silently strand behind shippo/$SLUG@$LATEST on clawhub.ai."
echo "Fix: bump 'version:' in $BUNDLE_DIR/SKILL.md.template to a new version, run"
echo "'npm test', and commit the regenerated bundle so the change actually ships."
exit 1
