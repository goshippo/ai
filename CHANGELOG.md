# Changelog

## [Unreleased]

## 1.5.2

`package.json:version` 1.5.1 -> 1.5.2. Ships the parameter-casing and error-guidance corrections below to the Claude app-plugin release (`shippo-plugin.zip`).

### Fixed
- `shippo/references/tool-reference.md`: corrected every by-id operation's required parameter name to the exact case-sensitive spelling the hosted server validates (mostly PascalCase: `ShipmentId`, `OrderId`, `TransactionId`, `BatchId`, `CarrierAccountId`, `CarrierParcelTemplateToken`, `UserParcelTemplateObjectId`, `ServiceGroupId`, `ShippoAccountId`, `AddressId`, `Carrier`/`TrackingNumber` on `GetTrack`, `CurrencyCode`; exceptions `webhookId` and v2 `address_id`). The doc previously listed snake_case names that fail the server's case-sensitive validation ("Missing required field(s)"), one of the most common live error classes. Added a parameter-naming note; `UpdateServiceGroup` now correctly documents body `object_id` (no path parameter), and `InitiateOauth2Signin` documents `CarrierAccountObjectId`.
- `shippo/references/error-reference.md`: argument-validation section now documents the hosted server's actual failure shape (`isError: true` with `Parameter validation failed: ...`) with casing guidance, instead of only the legacy JSON-RPC `-32602` path; added explicit entries for 403 permission-denied and generic gateway relay errors with do-not-retry-identical-inputs recovery steps.
- `shippo-best-practices`: two new critical rules, exact case-sensitive by-id parameter names, and never retrying 403/404 tool errors with unchanged arguments.

### Changed
- ClawHub bundle 1.4.2 -> 1.4.3: republishes the digest with the corrections above.

### Added
- Knowledge pack channel for assistants that do not load SKILL.md folders (ChatGPT, Gemini, and similar): `scripts/build-knowledge-pack.js` composes `providers/knowledge-pack/shippo-knowledge-pack.md` from the canonical skills and references, runs in `npm run sync`, and is guarded by `check-no-generated-edits` rule (g). `release.yml` now builds the banner-stripped pack, attests it, and attaches it to every version-bump release alongside `shippo-plugin.zip`.
- `server.json` at the repo root: metadata for publishing the hosted Shippo MCP server (`mcp.shippo.com`) to the official MCP Registry as `com.shippo/shippo-mcp`. Remote streamable-http entry; source of truth for the registry listing. Publishing uses DNS auth on the shippo.com apex (verification TXT record live via shippo-tf-services #6996), so no repo-side credentials or auto-publish workflow are wired here.
- `glama.json` at the repo root: claims the Glama directory listing for the Shippo MCP server (maintainer `wyatt-shippo`), so we control the listing's name, description, and category once Glama syncs it from the official MCP Registry. Required for org-hosted repos (GitHub auth alone does not claim a listing).

## 1.5.1

`package.json:version` 1.5.0 -> 1.5.1. Re-cuts the Claude app-plugin release
(`shippo-plugin.zip`) so the published asset ships the content fixes below; the
prior content landed on `main` after v1.5.0 without a version bump, leaving the
published release stale.

### Fixed
- Skills: normalized shared-reference mentions to the canonical `shippo/references/<doc>.md` form (9 stragglers had dropped the `shippo/` prefix), so every reference points at the doc's real location.
- `shippo/references/tool-reference.md`: reframed as an operation reference invoked through the 4-tool meta-API (the names are operations passed to `shippo_read_execute_tool` / `shippo_write_execute_tool`, not standalone MCP tools), and corrected the `ValidateAddress` entry to document validation by address fields (matching the live server schema) rather than by object ID.
- Claude plugin README: replaced the placeholder install step with the community-marketplace install flow (`claude plugin install shippo@claude-community`) and moved `--plugin-dir` to a local-development note.
- `shippo-support-ticket`: reworded the routing-tag note from a "placeholder, update later" TODO into a permanent description of the configurable routing schema.

### Changed
- ClawHub bundle 1.4.0 -> 1.4.1: republishes the consolidated digest to ship the content fixes listed above under Fixed (the publish gate is version-based, so the bundle version is bumped to ship the corrected content to clawhub.ai/shippo/shippo).
- ClawHub bundle 1.4.1 -> 1.4.2: set the registry display name to "Shippo" (publish now passes `--name "Shippo"`; it had stayed "Goshippo" from the original slug) and dropped the "(Beta)" prefix from the bundle description.
- Renamed the ClawHub bundle directory `providers/clawhub/skills/goshippo/` -> `providers/clawhub/skills/shippo/` to match the canonical slug (the `goshippo` name was a leftover from the original slug). Internal path only; the published owner/slug stay `shippo`/`shippo` (set via `--owner`/`--slug`). Updated all path references (build/sync scripts, CI workflows, the no-generated-edits allowlist regexes, docs) and corrected stale `shippo/goshippo` registry URLs and the CONTRIBUTING slug note left from the slug rename.

## 1.5.0

### Added
- New `shippo-support-ticket` skill: turns a single shipment identifier (tracking # + carrier, transaction/label ID, shipment ID, or order #/email) into an auto-classified support package — a copy-paste human ticket plus a routing-tagged JSON block for the ticketing pipeline. Read-only (documents and recommends, never issues a write), classifies into one of eight canonical issue types, runs issue-type-specific Shippo MCP lookups, computes a triage timeline, and minimizes PII (object IDs + coarse geography only, no names/street lines). Audience is Shippo support agents. Brings the canonical skill count to 9 (1 Decide / 7 Do / 1 Maintain) and adds a "Support Ticket Builder" section to the ClawHub digest (bundle version 1.3.4 -> 1.4.0). `package.json:version` 1.4.0 -> 1.5.0.

### Changed
- ClawHub bundle: declare `license: MIT` in the bundle frontmatter (the repo is MIT, but ClawHub had defaulted the published skill to MIT-0). Bundle version 1.3.3 -> 1.3.4. This republish also refreshes the registry changelog text (the prior publish string had been corrected in CI).

## 1.4.0

### Removed
- All test-mode guidance across the skills. The hosted OAuth MCP (`mcp.shippo.com`) reaches live accounts only; test mode is the deprecated API-key path and is not available to this repo's users. Deleted `skills/shippo/references/test-mode.md` and the "Test vs Live Mode" sections; the live-purchase confirmation gate is kept and strengthened.

### Changed
- ClawHub bundle: richer registry summary, and reworded the Setup/Connecting/Data-Handling sections to drop the literal "API key" phrasing and the "Security"/"Authentication" headings (these were tripping ClawHub's auto-classifier into a "Security" category + "API key required" badge). Bundle version 1.3.1 -> 1.3.3 (decoupled from the repo/package version).

## 1.3.1

### Added
- `rate-shopping`: note that each rate carries an `object_id` to hand off to the label-purchase flow (no need to re-send address/parcel).

### Changed
- Renamed the ClawHub bundle directory `providers/clawhub/skills/shippo-official/` to `providers/clawhub/skills/shippo/` so the folder matches the published registry slug (`goshippo`) and the SKILL.md frontmatter `name`. Install command is `openclaw skills install goshippo`.

## 1.3.0

### Changed
- Skill operation references now use the live MCP server's operation names (PascalCase, e.g. `CreateShipment`, `ValidateAddress`, `GetTrack`; the Webhooks ops are camelCase). They were previously snake_case and did not match the deployed server. `tools/mcp-catalog.json` is rebuilt from the live tool list (73 operations) and `check-tool-references` validates against it.
- `shippo-best-practices` gains a "Using the Shippo MCP" section explaining the 4-tool meta-API (`shippo_list_tools` / `shippo_describe_tool` / `shippo_read_execute_tool` / `shippo_write_execute_tool`): operations are invoked through those wrappers (discover, describe, execute), not called directly.
- All channels, including the ClawHub digest, now describe the hosted OAuth MCP at `https://mcp.shippo.com` only. Removed every reference to the legacy hosted gateway, the `@shippo/shippo-mcp` self-host npm package, `mcp-remote`, and API-key/`SHIPPO_API_KEY` setup. `upgrade-shippo` is slimmed to a hosted-only skill (API-version awareness, webhook event versioning, OAuth re-auth troubleshooting).

## 1.2.0

### Changed
- All channels now use a single production remote MCP endpoint, `https://mcp.shippo.com`, with per-user Shippo OAuth. The Claude Code plugin's `.mcp.json` drops the `${SHIPPO_API_KEY}` header block and points at the OAuth endpoint; the client runs the Shippo sign-in on first use.
- The Claude Code plugin README and the canonical skills now describe the OAuth authorize flow (run `/mcp`, sign in) instead of setting `SHIPPO_API_KEY`.
- The top-level README's MCP section now lists the single OAuth endpoint.
- The OpenAI Codex plugin and the Responses / Agents SDK guide already targeted this endpoint, no change.
- The app-plugin ZIP (`shippo-plugin.zip`) for the Claude apps now bundles the OAuth `.mcp.json`, no API key.

### Breaking changes
- The Claude Code plugin no longer reads `SHIPPO_API_KEY` for the hosted MCP. v1.1.x users must remove that env-var and authorize via OAuth (`/mcp`) on first use.

### Migration
1. Update the plugin (`/plugin install shippo`, or `/reload-plugins` after pulling the new `.mcp.json`).
2. Remove `SHIPPO_API_KEY` from `~/.claude/settings.json` (no longer used by the hosted MCP).
3. Run `/mcp`, select the Shippo server, and complete the browser sign-in.

### Why
Consolidating every channel onto one production OAuth endpoint gives each user a per-user authorization with no API key to copy or store, and a consistent setup across Claude Code, Codex, and the OpenAI Responses API.

## 1.1.1

### Added
- The plugin is now packaged as a single upload-ready ZIP (`shippo-plugin.zip`) for the Claude apps (claude.ai / Desktop / Cowork) and published as an asset on each GitHub Release. An org admin uploads the one ZIP via Organization settings → Plugins to provision all skills at once. `scripts/build-app-plugin.js` builds it; `release.yml` attaches it automatically on a version bump. No skill content changed in this release.

## 1.1.0

### Changed
- Plugin MCP server switched from OAuth to API-key auth on the hosted MCP gateway. The plugin's `.mcp.json` used native `type: http` with a `headers` block interpolating `${SHIPPO_API_KEY}` from the user's environment, same pattern as the official `github`, `pagerduty`, and `datadog` Claude Code plugins.
- Plugin README's "MCP server" section replaced with a "Setup" section walking users through obtaining a Shippo API key, setting `SHIPPO_API_KEY` in `~/.claude/settings.json`, and reloading the plugin.
- Top-level README's MCP comparison table flipped: the key-auth server became the documented plugin default; OAuth was documented as the planned default.

### Breaking changes
- The plugin no longer points at the OAuth MCP server. Existing users who installed v1.0.x will get a 401 from the new key-auth server until they configure `SHIPPO_API_KEY` per the new Setup section.

### Migration
1. Reinstall the plugin (or `/reload-plugins` after pulling the new `.mcp.json`).
2. Grab a Shippo API key from [https://apps.goshippo.com/settings/api](https://apps.goshippo.com/settings/api): `shippo_test_*` for sandbox, `shippo_live_*` for production.
3. Add `SHIPPO_API_KEY` to the `env` block of `~/.claude/settings.json`.
4. Restart Claude Code (or run `/reload-plugins`).

### Why
API-key auth was adopted as the stable default while the production OAuth endpoint was being prepared. With `https://mcp.shippo.com` available, the plugin moves to per-user OAuth in 1.2.0.

### TODO
- Nightly E2E CI workflow (install plugin → invoke MCP tool against a real test-mode key → assert response shape) is planned but deferred to a follow-up release. Tracked separately so it doesn't block the auth-migration cut.

## 1.0.6

### Added
- `request_refund` MCP tool now backed by a live operation, upstream Shippo spec added `POST /refunds` (CreateRefund), and the MCP overlay already had the annotation queued. The `label-purchase` skill's refund/void guidance is now actionable end-to-end.
- Documented the skill organization model, 8 skills grouped by mode (Decide / Do / Maintain), with explicit guidance on where new content belongs. Added to top-level README's Capabilities section + skills/README.md's "How the 8 skills are organized" section.
- `tracking` skill: documented `eta` field availability, major carriers populate it; regional carriers and pre-routing shipments may have it null. Treat absence as informational, not as an error.

### Changed
- MCP server tool surface grew from 76 to 78 tools (added `request_refund` and `list_refunds`).
- Hosted MCP toolset selection mode flipped from Static to Dynamic, at 78 tools we're past Anthropic's recommended threshold for upfront-loaded tool definitions ("Advanced Tool Use", ~10 tools / 10k tokens). Dynamic uses on-demand discovery via `search_tools` + `describe_tools` + execute. Plugin URL unchanged.

## 1.0.0

### Added
- Initial repo scaffold (Stripe-pattern multi-channel skill distribution).
- 8 canonical skills (6 migrated from shippo-claude-plugin, 2 new: shippo-best-practices, upgrade-shippo).
- 11 shared reference docs migrated from shippo-claude-plugin.
- Claude Code plugin distribution at providers/claude/plugin/.
- ClawHub bundle distribution at providers/clawhub/skills/shippo-official/.
- sync.js: skills/ → providers/claude/plugin/skills/ (1:1 mirror).
- build-clawhub-bundle.js: skills/shippo/references/ → providers/clawhub/.../references/ (curated subset).

### Migrated from
- goshippo/shippo-claude-plugin (archived).
- goshippo/shippo-clawhub-skill (archived).
