# Contributing to `goshippo/ai`

This repo is the canonical source for Shippo's AI distribution surfaces. Edits flow from `skills/` (canonical) into `providers/<channel>/...` (derived) via scripts.

## Setup

No installation required. Node 18+ is the only prerequisite (`node --version` to check). The repo has no third-party dependencies, `package.json` only declares scripts, no `node_modules/`.

The single command you need to know:

```bash
npm test
```

This runs the sync scripts and verifies no drift between `skills/` (canonical) and `providers/` (derived). Run it before every push. CI runs the same command.

If you prefer running the scripts directly: `npm run sync` (sync only, no drift check) or `node scripts/sync.js` / `node scripts/build-clawhub-bundle.js`.

## Commit guardrails

This is a public repository. Enable the local commit guardrails once per clone:

```bash
bash scripts/setup-hooks.sh
```

This points `core.hooksPath` at `.githooks/`, adding a **pre-commit** hook that blocks secrets (API keys, tokens, private keys) in staged files, and a **commit-msg** hook that blocks AI-authorship trailers in the commit message. CI runs the same secret scan on every PR. If a hook flags something legitimate, override with `git commit --no-verify`.

## Editing a skill

1. Edit `skills/<skill-name>/SKILL.md` (or `skills/shippo/references/<name>.md`).
2. Run `npm test`: propagates changes into `providers/` and verifies the result is clean.
3. **Verify the change landed in the right places.** Quick `git diff --stat` after `npm test` should show your canonical edit PLUS the corresponding 1:1 mirrors under `providers/claude/plugin/skills/<name>/SKILL.md` (Claude Code) and `providers/codex/plugin/skills/<name>/SKILL.md` (OpenAI Codex) AND a regenerated `providers/clawhub/skills/goshippo/SKILL.md` (ClawHub digest, if your edit was inside one of the workflow sections it inlines). Spot-check the regenerated digest with `grep "<your new text>" providers/clawhub/skills/goshippo/SKILL.md` to confirm.
4. **Bump the plugin version if applicable.** If your edit affects Claude Code distribution (any change to `skills/<name>/SKILL.md`, `skills/shippo/references/`, `.mcp.json`, or the plugin manifest), bump `package.json:version`: `npm test` propagates it into both `marketplace.json` and `plugin.json`. See [Version discipline](#version-discipline) below for the full rule. Skip this step for ClawHub-only changes (the ClawHub bundle has an independent version in its template frontmatter).
5. (Optional) Preview your change locally:
   - Claude Code: `claude --plugin-dir ./providers/claude/plugin` then invoke `/shippo:<skill-name>`
   - ClawHub digest: read `providers/clawhub/skills/goshippo/SKILL.md` directly to see the regenerated output
6. Commit canonical edits AND synced output in the same commit so the repo stays internally consistent.

If `npm test` reports drift after a re-run, something's off, check `git status` for the unexpected diff.

### How the ClawHub bundle's SKILL.md is generated

The ClawHub bundle (`providers/clawhub/skills/goshippo/SKILL.md`) is auto-generated from a hand-curated template + canonical skill bodies. Specifically:

- `providers/clawhub/skills/goshippo/SKILL.md.template` is the **editable** source. It contains hand-curated framing sections (Setup, Error Handling, Security & Data Transparency) and `{{skill:<name>}}` placeholders for the 9 workflow/mode skills.
- `scripts/compose-clawhub-digest.js` (run by `npm run sync` and `npm test`) reads the template and substitutes each `{{skill:<name>}}` placeholder with the body of the corresponding canonical `skills/<name>/SKILL.md` (frontmatter stripped, leading H1 stripped, header levels demoted by one).
- The generated SKILL.md gets an AUTO-GENERATED banner; do NOT edit it directly.

**To change ClawHub-published content:**

| Change you want to make | Where to edit |
|---|---|
| A workflow body (steps, tables, examples for any of the 9 skills) | Canonical `skills/<name>/SKILL.md`. The change automatically lands in the digest on next `npm test`. |
| The Setup section, Error Handling, Security, or section ordering | The template at `providers/clawhub/skills/goshippo/SKILL.md.template` |
| A reference doc (carrier-guide, csv-format, customs-guide, tool-reference) | Canonical `skills/shippo/references/<name>.md`. `scripts/build-clawhub-bundle.js` (run by `npm run sync`) syncs the curated subset into the bundle. |

### Cross-reference phrasing rule

When canonical SKILL.md files reference other skills, use sentence-case section names (no "skill" suffix). This makes the same prose read correctly in BOTH the per-skill context AND the consolidated digest context.

✅ Do: `(see Address Validation)`, `(see Rate Shopping above)`
❌ Don't: `(see address-validation skill)`, `(see [rate-shopping](../rate-shopping/SKILL.md) skill)`

The consolidated digest uses `## Address Validation` etc. as section headers, so a reference like "see Address Validation" reads as either "see the Address Validation skill" (per-skill context) or "see the Address Validation section above/below" (digest context): same words, both work.

### Auth and transport in canonical content

Canonical content in `skills/` targets the production hosted MCP: `https://mcp.shippo.com`, per-user OAuth, reached through the 4-tool meta-API (`shippo_list_tools` / `shippo_describe_tool` / `shippo_read_execute_tool` / `shippo_write_execute_tool`). The Claude Code and Codex plugins both use this. So canonical prose should describe the hosted OAuth path: no API key, no `SHIPPO_API_KEY` env-var, no self-host or npm-package instructions.

Operation names in skills are the live server's names (PascalCase, e.g. `CreateShipment`, `ValidateAddress`; the Webhooks ops are camelCase). `scripts/check-tool-references.js` validates them against `tools/mcp-catalog.json`, which mirrors the live `shippo_list_tools` catalog. Regenerate the catalog from the live server, not from the OpenAPI spec, if operations change.

All channels, including the ClawHub digest, target the hosted OAuth MCP. Keep the auth/setup language consistent across canonical skills and the ClawHub `SKILL.md.template`: hosted OAuth at `https://mcp.shippo.com`, no API key, no env-var, no self-host. Do not re-introduce key-auth or self-host language.

## Version discipline

### Claude Code plugin version

**Single source of truth:** `package.json:version`. Edit it once; `npm test` propagates the value into both `.claude-plugin/marketplace.json` and `providers/claude/plugin/.claude-plugin/plugin.json` via `scripts/inject-version.js`. Don't edit the manifest version fields directly, they'll get overwritten on next sync.

Bump `package.json:version` when the change affects Claude Code distribution, i.e., changes to:

- A skill in `skills/<name>/SKILL.md`
- A reference in `skills/shippo/references/`
- The `.mcp.json` config
- The plugin manifest itself

Don't bump the plugin version for ClawHub-only changes (edits to the digest's framing template, ClawHub-bundled references that aren't in canonical, etc.). The ClawHub publish version is independent.

### ClawHub bundle version (decoupled)

The ClawHub bundle's version lives in `providers/clawhub/skills/goshippo/SKILL.md.template`'s frontmatter (`version: x.y.z`) and intentionally is NOT linked to `package.json:version`. ClawHub publish cadence may differ from the Claude Code plugin's release cadence.

Bump it manually when the ClawHub-published content changes (whether the change came from canonical workflow content or the digest's framing).

## Adding a new skill

1. Create `skills/<new-skill-name>/SKILL.md` with valid frontmatter (`name`, `description` at minimum).
2. Run `node scripts/sync.js` to propagate to Claude Code plugin.
3. Decide whether the ClawHub bundle should reflect the new skill's content; if yes, edit `providers/clawhub/skills/goshippo/SKILL.md.template` to add a `{{skill:<new-skill-name>}}` placeholder where the new skill's section should appear in the digest. `npm test` will substitute the canonical body during compose.
4. Bump `package.json:version` (the single source of truth, `npm test` propagates it into the manifests; don't edit the manifest versions directly). This bump is also what triggers the app-plugin GitHub Release on merge.
5. Update `CHANGELOG.md` under "Unreleased".
6. Open a PR.

## Adding a new provider channel

1. Create `providers/<channel-name>/...` with the channel's required structure.
2. Add the channel's target path to `scripts/sync.js`'s `TARGETS` array.
3. Run `node scripts/sync.js` to populate.
4. Document the install path in `README.md`.

## Skill-triggering eval (optional)

`scripts/eval-skill-triggering.js` invokes `claude -p` against curated should-trigger and should-NOT-trigger prompts (in `tests/skill-triggering.json`) to detect when a skill description change causes the wrong skill to fire. Mirrors Anthropic's `skill-creator` plugin.

Run locally:

```bash
node scripts/eval-skill-triggering.js --dry-run    # prints the plan, no API calls
node scripts/eval-skill-triggering.js --limit 4    # smoke test on 4 prompts
node scripts/eval-skill-triggering.js              # full 64-prompt run (costs tokens)
```

Or trigger the GitHub Action manually: Actions → "Skill triggering eval" → Run workflow. Requires `ANTHROPIC_API_KEY` secret. Not wired into PR CI by default, opt-in until stable.

Pass thresholds: ≥80% overall pass rate AND ≤20% false-positive rate.

## Division of labor: skills vs MCP tool descriptions

Workflow content lives **here** (skills). Per-tool semantics are maintained by Shippo and surfaced through the [MCP server docs](https://docs.goshippo.com/docs/Guides_general/MCPServer). The two surfaces are intentionally disjoint, raw MCP users (Cursor, Claude Desktop with no plugin) get terse but accurate per-tool truth; skill-installed users (ClawHub + Claude Code plugin) get the workflow narrative on skill activation.

Precedent: Stripe ships the same split. Tool descriptions on `mcp.stripe.com` are single verb phrases ("Create payment link"); workflow narrative lives in [`stripe/agents`](https://github.com/stripe/agents) skills.

### What lives in MCP tool descriptions

Per-tool semantics are maintained by Shippo and carry **per-tool semantics only**:

- Tool name and what it does (one verb phrase)
- Required and optional parameters
- Return shape
- Single-call constraints (idempotency, rate limits, mutually exclusive params)
- Response format quirks (pagination cursor shape, etc.)

Terse. One tool, one description.

### What lives in skills (here)

Cross-tool **workflow narrative** that spans more than one MCP call:

- UX gates ("ask the user before purchasing a live-mode label")
- Routing decisions (checkout flow vs single label vs batch)
- CSV ingestion and column mapping
- Sort/filter logic (e.g., MPS rate filtering)
- Reporting conventions, output formatting
- Test/live mode discipline
- Validation sequencing ("validate addresses before creating a shipment")
- Response-handling rules ("S3 label URLs must not be truncated")

Rich. Multiple tools, one workflow.

### What does NOT live in MCP overlays anymore

Workflow guidance previously embedded in `<context>` / `<prerequisites>` blocks, "validate before create", S3-URL truncation warnings, MPS rate filtering, etc., has been moved out. Don't re-add it.

### The maintenance rule

When adding a cross-tool prerequisite to a skill, do **NOT** also add it to an MCP overlay description. Keep them disjoint. If you find yourself writing a multi-step procedure in an overlay, that procedure belongs in a skill, open a PR here instead.

## Releasing to ClawHub

```bash
npx clawhub@latest skill publish providers/clawhub/skills/goshippo
```

The slug is `goshippo` (the SKILL.md frontmatter `name`, which now matches the directory). New versions are published as updates under the same slug.

## Releasing the app-plugin ZIP (Claude apps)

The Claude apps (claude.ai / Desktop / Cowork) load the plugin as a single ZIP, the same `.claude-plugin/plugin.json` + `skills/` format as the Claude Code plugin. `scripts/build-app-plugin.js` packages `providers/claude/plugin/` (manifest, `.mcp.json`, and all skills) into one `dist/app-plugin/shippo-plugin.zip`. An org admin uploads that single ZIP via Organization settings → Plugins and all skills deploy at once, so there is no per-skill upload.

```bash
npm run build:app-plugin    # build dist/app-plugin/shippo-plugin.zip
npm run check:app-plugin    # validate the plugin source only
```

`dist/` is gitignored, the ZIP is build output, never committed. The `check:app-plugin` validation also runs in the `Validate` workflow, so a malformed plugin source fails CI.

**Releases are automatic and tied to the version bump.** The `release.yml` workflow runs on every push to `main` that touches `skills/**`, `package.json`, `providers/claude/plugin/**`, or the builder. It reads `package.json:version`, and if no release exists for that version yet, it builds `shippo-plugin.zip` and publishes it as a GitHub Release `v<version>`. Because Version discipline already requires bumping `package.json:version` for any skill change, that bump is the release signal:

- Change a skill, bump `package.json:version`, merge to `main` → a new release `v<version>` is cut automatically with the updated plugin ZIP.
- A skill change merged WITHOUT a version bump produces no new release (the version's release already exists), this enforces the discipline. Bump and re-push to release.
- Manual dispatch with `force: true` re-publishes the current version's asset.

No manual tagging or asset upload is needed.

## Submitting to the Anthropic plugin directory

There are two Anthropic marketplaces, and only one accepts submissions:

- **Community directory** (`claude-plugins-community`) is open to third parties. Submit via the form at [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission) (also reachable from `claude.ai/settings/plugins/submit`). Submissions go through an automated security and safety review; do NOT open a PR against `anthropics/claude-plugins-community` (those are auto-closed). Approved plugins are pinned to a commit SHA and the public catalog syncs nightly, so listing lags approval by about a day.
- **Official marketplace** (`anthropics/claude-plugins-official`) is curated by Anthropic at its discretion. There is no application process and the submission form does not add plugins there, so we do not target it.

Before submitting: run `claude plugin validate ./providers/claude/plugin` (CI runs this in the validate workflow; add `--strict` with a current Claude Code CLI to also catch unrecognized-field warnings, which the older pinned CI version does not support), make sure the plugin is pushed public at the commit you intend to submit, and bump `package.json:version` for the release (users only get updates when the version bumps). Once OAuth is the chosen auth, that ships as a follow-up version that the catalog picks up on the next SHA bump.
