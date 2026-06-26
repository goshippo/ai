<!--
Title should speak the intent, not the implementation.
Example: "feat: add support-ticket builder skill" not "edit SKILL.md".
Include the Jira ticket code if there is one.
-->

## Problem
<!-- What is this solving, and why now? Link the ticket / issue / design doc. -->

## Approach
<!-- How does this solve it? Call out anything non-obvious. -->

## Trade-offs
<!-- What did you decide against, and why? Known limitations? "None" is a valid answer. -->

## Testing
<!-- How did you verify it? CI output, eval results, sample prompts/responses, screenshots. -->

## Roll-back plan
<!-- How do we undo this if it goes wrong? For most content PRs: "revert the PR". -->

---

## Pre-flight checks

- [ ] Self-reviewed the diff before requesting review
- [ ] Edited canonical sources only (under `skills/`), NOT derived files in `providers/` (exception: `providers/clawhub/skills/shippo/SKILL.md.template` is the editable source for ClawHub digest framing)
- [ ] Ran `npm test` locally and committed the synced output
- [ ] Bumped `version` in `package.json` ONLY (the single source of truth) if this PR changes anything Claude Code consumes, skill, reference, plugin manifest, `.mcp.json`. `npm test` propagates it into `.claude-plugin/marketplace.json` and `providers/claude/plugin/.claude-plugin/plugin.json`, do NOT hand-edit those manifests.
- [ ] If this PR changes ClawHub-only framing (Setup, Error Handling, Security, section ordering), edited `providers/clawhub/skills/shippo/SKILL.md.template`: workflow body changes flow into the auto-generated digest automatically via `npm test`
- [ ] Updated `CHANGELOG.md` under "Unreleased"
- [ ] No em dashes; tool names match `tools/mcp-catalog.json`; no API-key / test-mode content
- [ ] If this adds a new skill: added `tests/skill-triggering.json` cases AND registered it in `SKILL_NAMES` (`scripts/eval-skill-triggering.js`)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full discipline, and [CODE_REVIEW.md](../CODE_REVIEW.md) for how changes are reviewed.
