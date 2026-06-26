# Shippo AI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Validate](https://github.com/goshippo/ai/actions/workflows/validate.yml/badge.svg)](https://github.com/goshippo/ai/actions/workflows/validate.yml) [![Latest release](https://img.shields.io/github/v/release/goshippo/ai)](https://github.com/goshippo/ai/releases)

This repo is the one-stop shop for building AI-powered shipping integrations with Shippo.

It contains:

* **9 Agent Skills**: Workflow knowledge for AI assistants covering rate shopping, address validation, label purchase (with customs), package tracking, batch shipping, shipping cost analysis, support-ticket drafting, integration best practices, and SDK/API upgrades. Authored once and distributed across multiple AI surfaces.
* **Claude Code Plugin** ([`providers/claude/plugin/`](/providers/claude/plugin)): Install via `--plugin-dir` or the plugin marketplace (`/plugin marketplace add goshippo/ai`).
* **OpenAI Codex Plugin** ([`providers/codex/plugin/`](/providers/codex/plugin)): Install via the Codex plugin marketplace; bundles the skills plus the OAuth MCP server.
* **ClawHub Skill** ([`providers/clawhub/skills/shippo/`](/providers/clawhub/skills/shippo)): Install via `openclaw skills install @shippo/shippo`.
* **Claude apps (claude.ai / Desktop / Cowork)**: The whole plugin is packaged as a single upload-ready ZIP (`shippo-plugin.zip`), attached to every GitHub Release. One upload provisions all the skills.

## What is a skill?

A skill is a folder containing a [`SKILL.md`](https://agentskills.io/specification) file, YAML frontmatter (at minimum: `name` and `description`) plus markdown instructions that tell an AI assistant how to perform a specific task. Skills can also bundle reference docs, scripts, and templates.

```
rate-shopping/
├── SKILL.md           # required: metadata + instructions
└── README.md          # optional: human-facing orientation
```

Agents load skills by **progressive disclosure** in three stages:

1. **Discovery**: at startup, the agent loads only each skill's `name` and `description`, just enough to know when it might be relevant.
2. **Activation**: when a user prompt matches a skill's description, the agent loads the full `SKILL.md` body into context.
3. **Execution**: the agent follows the instructions, optionally loading referenced files (`shippo/references/*.md`) as it works.

[Agent Skills](https://agentskills.io) is an open standard originally developed by Anthropic. The same `SKILL.md` works in Claude Code, Cursor, OpenAI Codex, GitHub Copilot, VS Code, and 30+ other agents.

In this repo, the 9 skills under `skills/` are the **canonical source**. They're propagated into `providers/claude/plugin/skills/` and `providers/codex/plugin/skills/` (1:1 mirrors) and `providers/clawhub/skills/shippo/` (consolidated digest) automatically by the sync scripts.

## Model Context Protocol (MCP)

Shippo hosts a remote MCP server with per-user OAuth. Each user authorizes once through Shippo, there is no API key to copy. The Claude Code and OpenAI Codex plugins point at this endpoint and trigger the sign-in on first use.

| URL | Transport | Auth |
|---|---|---|
| `https://mcp.shippo.com` | Streamable HTTP | Per-user Shippo OAuth |

For per-tool semantics and usage, see the [Shippo MCP server docs](https://docs.goshippo.com/docs/Guides_general/MCPServer).

Building on OpenAI? See [Using the Shippo MCP from the OpenAI Responses API / Agents SDK](docs/openai-responses-mcp.md) for the developer config (no submission required).

## Capabilities

The 9 skills in this repo are organized by **mode of engagement**: what the user is doing, not by product surface. The AI assistant matches the user's intent to one of three modes, then loads the right skill.

### Decide, "where do I start?"

| Skill | What it does |
|---|---|
| `shippo-best-practices` | Decision-router for Shippo integrations, which API to use, test vs. live mode discipline, response handling, critical rules |

### Do, "execute this workflow"

| Skill | What it does |
|---|---|
| `address-validation` | Validate, parse, and standardize US and international addresses |
| `rate-shopping` | Compare rates across USPS, UPS, FedEx, DHL, and 30+ carriers |
| `label-purchase` | Purchase domestic and international shipping labels with customs handling |
| `tracking` | Track packages across carriers with status history, substatus codes, and webhooks |
| `batch-shipping` | Process CSV files of shipments and generate labels in bulk |
| `shipping-analysis` | Analyze costs, optimize package dimensions, compare carriers, review historical spend |
| `shippo-support-ticket` | Build an auto-classified, routing-tagged support ticket (human + JSON) for a single shipment or label; read-only, for Shippo support agents |

### Maintain, "upgrade or migrate"

| Skill | What it does |
|---|---|
| `upgrade-shippo` | Guide for upgrading SDK versions, MCP server updates, breaking-change migration |

A user who already knows the workflow they need ("buy a label", "track this package") jumps straight to a Do skill. A user starting fresh ("I'm building a checkout flow with shipping, where do I start?") hits the Decide skill, which routes them to the right Do skill. Maintenance gets its own skill so production-readiness questions don't compete with workflow content.

The 9 skills lean on **11 shared reference docs** under `skills/shippo/references/` (carriers, customs, CSV format, error reference, etc.). Skills load references on demand, the AI doesn't pull all 11 into context, just the ones a given workflow needs.

## Install

### Claude Code

```bash
git clone https://github.com/goshippo/ai.git
claude --plugin-dir ./ai/providers/claude/plugin
```

Or install from the plugin marketplace:

```bash
/plugin marketplace add goshippo/ai
/plugin install shippo
```

On first use, run `/mcp`, select the Shippo server, and sign in to authorize the MCP over OAuth (no API key to copy).

Skills are namespaced under `/shippo:`: invoke directly with `/shippo:rate-shopping`, `/shippo:label-purchase`, `/shippo:tracking`, etc., or just describe what you're doing in natural language.

### OpenAI Codex

Codex installs the Shippo plugin (skills + OAuth MCP) from this repo's plugin marketplace:

```bash
codex plugin marketplace add goshippo/ai
codex plugin add shippo@shippo   # install the "shippo" plugin
codex mcp login shippo           # authorize the remote MCP over OAuth
```

See [`providers/codex/plugin/`](/providers/codex/plugin) for details. (To pull just the skill content without the plugin, Codex's `skill-installer` can also install a single `providers/codex/plugin/skills/<name>` directory.)

### ClawHub

```bash
openclaw skills install @shippo/shippo
```

(Published as `@shippo/shippo` on the [ClawHub registry](https://clawhub.ai/shippo/shippo).)

### Claude apps (claude.ai / Desktop / Cowork)

The Claude apps load the plugin as a single ZIP. `shippo-plugin.zip` (the whole plugin: manifest, OAuth MCP config, and all skills) is attached to every [GitHub Release](https://github.com/goshippo/ai/releases). Download it and add it via the app's Plugins UI. A Team/Enterprise admin can provision it org-wide in one step: Organization settings → Plugins → upload `shippo-plugin.zip` → set "Installed by default" (or assign to a group), and all skills become available to members. (Code execution must be enabled in Organization settings.)

To build the ZIP locally: `npm run build:app-plugin` (output in `dist/app-plugin/`).

### Shippo account

You'll need a [Shippo account][api-keys]. Getting rates and validating addresses incur no charge; purchasing a label uses Shippo's discounted carrier rates and charges your account. The Claude Code and Codex plugins authorize per-user via OAuth on first use, so there's no API key to copy.

## How it works

This plugin bundles two things, with a deliberate division of labor between them:

- **Skills** (this repo): Cross-tool **workflow narrative**: routing decisions (checkout vs single label vs batch), UX gates ("ask before purchasing a live-mode label"), CSV ingestion, validation sequencing, test/live mode discipline, response-handling rules. Loaded on activation when the user's request matches a skill's description.
- **MCP server** ([docs](https://docs.goshippo.com/docs/Guides_general/MCPServer)): Per-tool **semantics**: tool name, parameters, return shape, single-call constraints. Each tool description is terse, one verb phrase, one tool. Workflow guidance is intentionally NOT duplicated here.

The skills teach the assistant *how* to ship across multiple API calls. The MCP server gives the assistant the *per-call* truth about each tool. The two surfaces are disjoint by design, same precedent Stripe uses (terse `mcp.stripe.com` tool descriptions, rich [`stripe/agents`](https://github.com/stripe/agents) skills): so raw MCP users get accurate per-tool semantics and skill-installed users additionally get the workflow narrative, without contradiction.

## Repo layout

- `skills/`: canonical skill content (9 skills + 11 shared references). **Edit here; everything else flows from here.**
- `providers/claude/plugin/`: Claude Code plugin distribution. 1:1 mirror of canonical via `scripts/sync.js`.
- `providers/codex/plugin/`: OpenAI Codex plugin. `skills/` is a 1:1 mirror of canonical via `scripts/sync.js`; `.codex-plugin/plugin.json` + `.mcp.json` (hand-authored) carry the manifest and the OAuth MCP wiring. Cataloged from `.agents/plugins/marketplace.json` at the repo root.
- `providers/clawhub/skills/shippo/`: ClawHub bundle distribution. The `SKILL.md` is auto-generated from `SKILL.md.template` (hand-curated framing) + canonical skill bodies via `scripts/compose-clawhub-digest.js`. References are auto-synced via `scripts/build-clawhub-bundle.js`.
- `dist/app-plugin/`: the single `shippo-plugin.zip` for the Claude apps, built from `providers/claude/plugin/` by `scripts/build-app-plugin.js` (not committed; produced on demand and on release).
- `scripts/`: sync, compose, and build helpers.

## Authoring

```bash
# 1. Edit canonical content
vim skills/<skill-name>/SKILL.md
# (or skills/shippo/references/<name>.md, or providers/clawhub/skills/shippo/SKILL.md.template
#  if you're changing ClawHub-only framing)

# 2. Sync + verify (one command)
npm test

# 3. Commit canonical edits AND synced output together
git add -A && git commit -m "..."
```

`npm test` runs all the sync steps (Claude Code + Codex mirrors, ClawHub digest compose, ClawHub references sync) and verifies the result is internally consistent. CI runs the same command. No `npm install` needed, the repo has no third-party dependencies, just scripts.

### Preview your edit

- **Claude Code:** run `claude --plugin-dir ./providers/claude/plugin` from the repo root to launch Claude Code with the local plugin loaded. Edits to `skills/<name>/SKILL.md` are reflected immediately. Skills are namespaced under `/shippo:` (e.g., `/shippo:rate-shopping`).
- **ClawHub digest:** after `npm test` runs, the rendered output lives at `providers/clawhub/skills/shippo/SKILL.md`: read it directly to see what ClawHub-installed users will get. There's no local-server preview today.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full authoring discipline, including the version-bump rules and the cross-reference phrasing rule for skill content.

## License

[MIT](LICENSE)

[api-keys]: https://apps.goshippo.com/settings/api
