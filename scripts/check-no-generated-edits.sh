#!/bin/bash
# check-no-generated-edits.sh, Fail if providers/ files changed in a way that
# doesn't correspond to a canonical change. Catches: contributor edited a
# generated file directly (without a matching canonical edit), which sync
# would silently overwrite.
#
# Strategy:
#   1. Collect changed files in the PR diff.
#   2. For each providers/ file changed, check if the change is "explained" by
#      one of:
#        (a) the file is on the editable-providers allowlist (LICENSE, README,
#            .mcp.json, plugin.json, SKILL.md.template, .clawhubignore)
#        (b) a corresponding canonical source under skills/ also changed
#            (e.g., providers/claude/plugin/skills/<name>/SKILL.md is
#            explained by skills/<name>/SKILL.md changing)
#        (c) package.json:version changed (explains version-field updates in
#            marketplace.json + plugin.json)
#        (d) the ClawHub bundle's references/ subset changed because canonical
#            references under skills/shippo/references/ changed
#        (e) the ClawHub digest SKILL.md changed because either canonical
#            skills changed (contents flow into the digest) OR the template
#            (SKILL.md.template) changed
#   3. If a providers/ change has no explanation, it's a direct edit, fail.
#
# Usage:
#   scripts/check-no-generated-edits.sh                  # check staged + unstaged
#   scripts/check-no-generated-edits.sh <base-ref>       # check vs a base ref (CI)

set -e

# === Allowlist: files under providers/ that ARE editable directly ===
ALLOWED_PATTERNS=(
  '^providers/README\.md$'
  '^providers/claude/plugin/README\.md$'
  '^providers/claude/plugin/LICENSE$'
  '^providers/codex/plugin/README\.md$'
  '^providers/codex/plugin/LICENSE$'
  '^providers/codex/plugin/\.mcp\.json$'
  '^providers/codex/plugin/\.codex-plugin/plugin\.json$'
  '^providers/claude/plugin/\.mcp\.json$'
  '^providers/claude/plugin/\.claude-plugin/plugin\.json$'
  '^providers/clawhub/skills/shippo/SKILL\.md\.template$'
  '^providers/clawhub/skills/shippo/\.clawhubignore$'
)

# === Get list of changed files (mode-dependent) ===
# CHANGED_ALL = every changed path; ADDED_ALL = paths NEWLY added (not modified).
# The added set lets a net-new mirror (a new provider channel, or a new skill's
# mirror files) be explained without a paired canonical *edit*, content
# integrity of generated files is independently enforced by check-drift.
if [ -n "$1" ]; then
  CHANGED_ALL=$(git diff --name-only "$1"...HEAD)
  # --no-renames so a moved generated file (e.g. a bundle directory rename)
  # registers as an Add at its new path, lettable through via is_added below.
  ADDED_ALL=$(git diff --no-renames --name-only --diff-filter=A "$1"...HEAD || true)
  CHANGED_PROVIDERS=$(echo "$CHANGED_ALL" | grep '^providers/' || true)
else
  STAGED=$(git diff --cached --name-only)
  UNSTAGED=$(git diff --name-only)
  UNTRACKED=$(git ls-files --others --exclude-standard)
  CHANGED_ALL=$(printf '%s\n%s\n%s\n' "$STAGED" "$UNSTAGED" "$UNTRACKED" | sort -u | grep -v '^$' || true)
  ADDED_ALL=$(printf '%s\n%s\n' "$(git diff --cached --no-renames --name-only --diff-filter=A)" "$UNTRACKED" | sort -u | grep -v '^$' || true)
  CHANGED_PROVIDERS=$(echo "$CHANGED_ALL" | grep '^providers/' || true)
fi

if [ -z "$CHANGED_PROVIDERS" ]; then
  echo "  No changes under providers/, nothing to check."
  exit 0
fi

# === Helpers for "is this providers/ change explained by an upstream change?" ===

# canonical_changed: returns 0 if any file under skills/ changed
canonical_changed() {
  echo "$CHANGED_ALL" | grep -q '^skills/' && return 0 || return 1
}

# package_version_changed: returns 0 if package.json was changed
# (we can't easily diff just the version field in bash; treat any package.json
# edit as potentially version-affecting)
package_version_changed() {
  echo "$CHANGED_ALL" | grep -q '^package\.json$' && return 0 || return 1
}

# template_changed: returns 0 if the ClawHub template was edited
template_changed() {
  echo "$CHANGED_ALL" | grep -q '^providers/clawhub/skills/shippo/SKILL\.md\.template$' && return 0 || return 1
}

# canonical_reference_changed: returns 0 if any shippo/references/ file changed
knowledge_pack_generator_changed() {
  echo "$CHANGED_ALL" | grep -q '^scripts/build-knowledge-pack\.js$' && return 0 || return 1
}

canonical_reference_changed() {
  echo "$CHANGED_ALL" | grep -q '^skills/shippo/references/' && return 0 || return 1
}

# canonical_skill_changed_for: returns 0 if skills/<name>/SKILL.md or
# skills/<name>/README.md changed (matching the file's basename and parent)
canonical_skill_changed_for() {
  local pf="$1"
  # extract <name> from providers/claude/plugin/skills/<name>/<basename>
  local name=$(echo "$pf" | sed -E 's|^providers/claude/plugin/skills/([^/]+)/.*$|\1|')
  [ -z "$name" ] && return 1
  echo "$CHANGED_ALL" | grep -qE "^skills/${name}/(SKILL|README)\.md$" && return 0
  return 1
}

# is_added: returns 0 if the given path is newly added (not a modification)
is_added() {
  echo "$ADDED_ALL" | grep -qxF "$1" && return 0 || return 1
}

# === Walk each changed providers/ file and check for an explanation ===
VIOLATIONS=()

for file in $CHANGED_PROVIDERS; do
  explained=0
  reason=""

  # (a) Editable allowlist
  for pattern in "${ALLOWED_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      explained=1
      reason="editable allowlist"
      break
    fi
  done
  [ $explained -eq 1 ] && continue

  # (b) Claude Code plugin mirror, explained by matching canonical skill change
  if echo "$file" | grep -qE '^providers/claude/plugin/skills/[^/]+/(SKILL|README)\.md$'; then
    if canonical_skill_changed_for "$file"; then
      continue
    fi
  fi

  # (c) Claude Code plugin shared references, explained by canonical references
  if echo "$file" | grep -qE '^providers/claude/plugin/skills/shippo/references/'; then
    if canonical_reference_changed; then
      continue
    fi
  fi

  # (b-codex) Codex skills mirror, explained by a matching canonical skill
  # change, or by being a newly-added mirror file (initial channel creation /
  # a new skill). Hand-edits to an EXISTING mirror file (modified, no canonical
  # change) still fall through to a violation here, and are caught by check-drift.
  if echo "$file" | grep -qE '^providers/codex/plugin/skills/[^/]+/(SKILL|README)\.md$'; then
    name=$(echo "$file" | sed -E 's|^providers/codex/plugin/skills/([^/]+)/.*$|\1|')
    if [ -n "$name" ] && echo "$CHANGED_ALL" | grep -qE "^skills/${name}/(SKILL|README)\.md$"; then
      continue
    fi
    if is_added "$file"; then
      continue
    fi
  fi

  # (c-codex) Codex shared references, explained by canonical references or a new-file add
  if echo "$file" | grep -qE '^providers/codex/plugin/skills/shippo/references/'; then
    if canonical_reference_changed || is_added "$file"; then
      continue
    fi
  fi

  # (d) Marketplace/plugin manifest version fields, explained by package.json change
  if echo "$file" | grep -qE '^(\.claude-plugin/marketplace\.json|providers/claude/plugin/\.claude-plugin/plugin\.json)$'; then
    if package_version_changed; then
      continue
    fi
  fi

  # (e) ClawHub bundle SKILL.md, explained by canonical skill OR template change
  if [ "$file" = 'providers/clawhub/skills/shippo/SKILL.md' ]; then
    if canonical_changed || template_changed || is_added "$file"; then
      continue
    fi
  fi

  # (f) ClawHub bundle references/, explained by canonical references or a
  # new-file add (e.g. a bundle directory rename; check-drift enforces content)
  if echo "$file" | grep -qE '^providers/clawhub/skills/shippo/references/'; then
    if canonical_reference_changed || is_added "$file"; then
      continue
    fi
  fi

  # (g) Knowledge-pack channel, a consolidated digest of canonical skills +
  # references for non-skill-loading assistants (ChatGPT and similar). Explained
  # by any canonical skill/reference/template change, a generator-script
  # (build-knowledge-pack.js) change, or a new-file add; content
  # integrity is enforced by check-drift.
  if echo "$file" | grep -qE '^providers/knowledge-pack/'; then
    if canonical_changed || canonical_reference_changed || template_changed || knowledge_pack_generator_changed || is_added "$file"; then
      continue
    fi
  fi

  # No explanation found, this is a direct edit
  VIOLATIONS+=("$file")
done

if [ ${#VIOLATIONS[@]} -eq 0 ]; then
  echo "  ✓ All changes under providers/ are explained by upstream changes (canonical, template, or version)."
  exit 0
fi

echo "::error::Direct edits to auto-generated files detected, no upstream change explains the providers/ modification."
echo ""
echo "These files were modified, but no corresponding canonical / template / version change was found:"
for file in "${VIOLATIONS[@]}"; do
  echo "  ✗ $file"
done
echo ""
echo "Direct edits to auto-generated files will be silently overwritten by sync."
echo ""
echo "What to do:"
echo "  1. Revert the direct edit:  git checkout -- <file>"
echo "  2. Find the canonical source:"
echo "       - Skill content       → skills/<name>/SKILL.md  or  skills/<name>/README.md"
echo "       - Shared reference     → skills/shippo/references/<name>.md"
echo "       - ClawHub digest       → providers/clawhub/skills/shippo/SKILL.md.template"
echo "       - Plugin version       → package.json (single source of truth)"
echo "  3. Edit the canonical source, run 'npm test', commit canonical + synced output together."
echo ""
exit 1
