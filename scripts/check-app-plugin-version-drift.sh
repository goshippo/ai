#!/bin/bash
# check-app-plugin-version-drift.sh
#
# Fail when the Claude app-plugin zip CONTENT changed in this PR but the version
# would NOT cut a new release, i.e. a release for the current package.json:version
# already exists. release.yml is version-gated: it cuts a v<version> GitHub
# Release ONLY when one does not already exist (it reads package.json:version and
# does `gh release view "v$VERSION"`). So a content change that leaves
# package.json:version equal to an already-published release is a SILENT no-op:
# the regenerated shippo-plugin.zip strands behind the published release asset.
# This check mirrors release.yml's own gate (version vs existing release) and
# turns the silent strand into a loud, actionable error at PR time. It is the
# sibling of check-clawhub-version-drift.sh, same pattern for the GitHub Release
# channel instead of the ClawHub registry.
#
# Usage:
#   scripts/check-app-plugin-version-drift.sh <base-ref>   # CI: the PR base SHA
#   scripts/check-app-plugin-version-drift.sh              # local: vs origin/main
set -euo pipefail

# Footprint = everything build-app-plugin.js packages into shippo-plugin.zip: the
# assembled plugin dir (its .claude-plugin/plugin.json, .mcp.json, LICENSE,
# README, skills/) plus the build script itself, whose output the zip is.
FOOTPRINT=(providers/claude/plugin scripts/build-app-plugin.js)

BASE="${1:-}"
if [ -z "$BASE" ]; then
  BASE="$(git rev-parse --verify --quiet origin/main || git rev-parse --verify --quiet main || true)"
  if [ -z "$BASE" ]; then
    echo "  No base ref (origin/main or main) available; skipping app-plugin version-drift check."
    exit 0
  fi
fi

# Any change under the footprint changes what would publish.
CONTENT_CHANGED="$(git diff --name-only "$BASE"...HEAD -- "${FOOTPRINT[@]}" || true)"
if [ -z "$CONTENT_CHANGED" ]; then
  echo "  App-plugin content unchanged since base; nothing to check."
  exit 0
fi

# The version that WOULD publish (release.yml reads package.json:version).
VER="$(jq -r .version package.json)"
if [ -z "$VER" ] || [ "$VER" = "null" ]; then
  echo "::error::Could not read package.json:version."
  exit 1
fi
TAG="v${VER}"

# gh CLI drives the same check release.yml's gate uses. If gh is unavailable
# (e.g. a local run without it), skip rather than block; CI always has it.
if ! command -v gh >/dev/null 2>&1; then
  echo "::warning::gh CLI not available; skipping app-plugin version-drift check (CI is the backstop)."
  exit 0
fi

# Mirror release.yml's gate exactly: a zero exit from `gh release view` means the
# release for this version already exists (so release.yml would skip), a non-zero
# exit means it does not yet exist (so release.yml would create it). Same
# interpretation release.yml itself uses, so this check can never disagree with
# the workflow it guards.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "::error::App-plugin content changed but a release for $TAG already exists, so release.yml will NOT cut a new release and the published shippo-plugin.zip will strand behind main."
  echo ""
  echo "Changed app-plugin files:"
  echo "$CONTENT_CHANGED" | sed 's/^/  /'
  echo ""
  echo "Fix: bump package.json:version, run 'npm run sync' (propagates the version into"
  echo "marketplace.json + the claude/codex plugin.json), and commit the regenerated"
  echo "files so release.yml re-cuts shippo-plugin.zip."
  echo "See CONTRIBUTING.md -> Version discipline."
  exit 1
fi

echo "  OK: app-plugin content changed and no release for $TAG exists yet; release.yml will cut it."
exit 0
