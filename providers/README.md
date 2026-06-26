# Provider distributions

This directory contains the per-channel distributions of Shippo's skills.

## Skills

**Do not edit skill files in provider directories manually.**

Files under `providers/` are auto-generated from canonical sources by `scripts/sync.js`, `scripts/compose-clawhub-digest.js`, and `scripts/build-clawhub-bundle.js`: all run by `npm test`. Edits made directly to derived files will be overwritten on the next sync.

**The one editable exception:** `providers/clawhub/skills/shippo/SKILL.md.template` is hand-curated. It holds the digest's framing sections (Setup, Error Handling, Security & Data Transparency) and `{{skill:<name>}}` placeholders that get auto-replaced with canonical workflow bodies during compose. Edit the template to change framing or section ordering; edit canonical `skills/<name>/SKILL.md` to change workflow body content.

## Channels

- **`claude/plugin/`**: Claude Code plugin distribution. 9 skills under `skills/` are 1:1 mirrors of canonical, produced by `scripts/sync.js`.
- **`codex/plugin/`**: OpenAI Codex plugin. `skills/` is a 1:1 mirror of canonical, produced by the same `scripts/sync.js` target list. `.codex-plugin/plugin.json` + `.mcp.json` + `README.md` (hand-written, editable) carry the manifest, the OAuth MCP wiring, and install instructions. The Codex marketplace catalog is `.agents/plugins/marketplace.json` at the repo root.
- **`clawhub/skills/shippo/`**: ClawHub bundle distribution. Single consolidated skill:
  - `SKILL.md.template` (editable) → hand-curated framing + workflow placeholders.
  - `SKILL.md` (auto-generated) → composed by `scripts/compose-clawhub-digest.js` from template + canonical bodies.
  - `references/` (auto-synced) → curated subset of canonical references, copied by `scripts/build-clawhub-bundle.js`.

## Editing flow

```bash
# Workflow body changes → edit canonical
vim ../skills/rate-shopping/SKILL.md

# Digest framing changes → edit the template
vim clawhub/skills/shippo/SKILL.md.template

# Either way, propagate + verify
cd ..; npm test
```

`npm test` runs all three sync steps and fails if anything's out of sync. CI runs the same command on every PR.
