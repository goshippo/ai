# Skills

Canonical authoring source for all Shippo agent skills. **Edit here.**

## Where to edit what

| If you want to change... | Edit this file | Then run |
|---|---|---|
| A skill's human-facing orientation (what it does, when to use, example prompts) | `skills/<name>/README.md` | `npm test` (the README is mirrored to `providers/claude/plugin/skills/<name>/` for GitHub discoverability of the installed plugin) |
| A workflow skill (rate-shopping, label-purchase, etc.) | `skills/<name>/SKILL.md` | `npm test` |
| A shared reference (carrier-guide, customs-guide, etc.) | `skills/shippo/references/<name>.md` | `npm test` |
| The ClawHub digest's framing, Setup section, Error Handling, Security, or section ordering | `providers/clawhub/skills/goshippo/SKILL.md.template` | `npm test` |
| The ClawHub digest's workflow body content | Edit the canonical `skills/<name>/SKILL.md` (changes auto-flow into the digest on next `npm test`) | `npm test` |
| The Claude Code plugin manifest (version, name, description) | `providers/claude/plugin/.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` (keep them in sync, CI checks) | nothing |
| The MCP server connection (`.mcp.json`) | `providers/claude/plugin/.mcp.json` | nothing, Claude Code reads it directly |

`npm test` runs every sync step (Claude Code mirror, ClawHub digest compose, ClawHub references sync) and verifies internal consistency. CI runs the same command on PR.

## Cross-reference phrasing rule

When a canonical skill references another skill, use sentence-case section names, NOT "X skill", so the same prose reads correctly in both per-skill context AND the consolidated ClawHub digest:

- ✅ `(see Address Validation)`, `(see Rate Shopping above)`
- ❌ `(see address-validation skill)`, `(see [rate-shopping](...) skill)`

## What's NOT in the table above

Auto-generated files have inline "DO NOT EDIT" banners that explain themselves:

- `providers/claude/plugin/skills/<name>/SKILL.md`: 1:1 mirror of canonical
- `providers/clawhub/skills/goshippo/SKILL.md`: composed from `SKILL.md.template` + canonical bodies
- `providers/clawhub/skills/goshippo/references/*.md`: curated subset of canonical references

See [providers/README.md](../providers/README.md) for the full distribution model.

## How the 8 skills are organized

Skills are grouped by **mode of engagement** (what stage of work the user is at), not by product surface. There are three modes:

```
DECIDE, "where do I start?"
    shippo-best-practices       (the front door / decision-router)

DO, "execute this workflow"
    address-validation          (validate, parse, standardize addresses)
    rate-shopping               (compare carrier rates)
    label-purchase              (buy labels, domestic + international)
    tracking                    (track packages, webhooks)
    batch-shipping              (CSV → bulk labels + manifests)
    shipping-analysis           (cost analysis, optimization)

MAINTAIN, "upgrade / migrate"
    upgrade-shippo              (SDK + API version migration)
```

The Decide skill (`shippo-best-practices`) is the front door for users who don't already know which workflow they need. It routes, "Building a checkout flow → see Rate Shopping. Bulk labels → see Batch Shipping." Once routed, the workflow skills do the actual procedural work.

**Where new content goes:**

| If you're adding... | Add it to |
|---|---|
| A new procedural workflow (e.g., "warehouse manifesting") | A new Do skill at `skills/<name>/` |
| A cross-cutting rule that applies to multiple workflows (e.g., "always validate addresses first") | The Decide skill (`shippo-best-practices/SKILL.md`): it's the rules layer |
| Reference material that a workflow needs (e.g., a new carrier's quirks) | A new file under `skills/shippo/references/` |
| Migration guidance for SDK changes | The Maintain skill (`upgrade-shippo/SKILL.md`) |

**Cross-references between skills:** use sentence-case section names ("see Address Validation"), not skill slugs ("see address-validation skill"). Same prose then works in both per-skill context AND the consolidated ClawHub digest. See the rule below for details.

## In this folder

- **8 skills** organized as 1 Decide / 6 Do / 1 Maintain (above)
- **11 shared reference docs** under `shippo/references/`

See the top-level [README.md](../README.md) for the capabilities table and install instructions, and [CONTRIBUTING.md](../CONTRIBUTING.md) for the full authoring discipline.
