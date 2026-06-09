## Summary
<!-- One-line description of the change -->

## Pre-flight checks

- [ ] Edited canonical sources only (under `skills/`), NOT derived files in `providers/` (exception: `providers/clawhub/skills/goshippo/SKILL.md.template` is the editable source for ClawHub digest framing)
- [ ] Ran `npm test` locally and committed the synced output
- [ ] Bumped `version` in `package.json` ONLY (the single source of truth) if this PR changes anything Claude Code consumes, skill, reference, plugin manifest, `.mcp.json`. `npm test` propagates it into `.claude-plugin/marketplace.json` and `providers/claude/plugin/.claude-plugin/plugin.json`, do NOT hand-edit those manifests.
- [ ] If this PR changes ClawHub-only framing (Setup, Error Handling, Security, section ordering), edited `providers/clawhub/skills/goshippo/SKILL.md.template`: workflow body changes flow into the auto-generated digest automatically via `npm test`
- [ ] Updated `CHANGELOG.md` under "Unreleased"

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full discipline, including version-bump rules.
