# Code Review Standard

How we review changes to `goshippo/ai`. It follows Shippo's engineering code
review practices and adds the checks specific to this repo, a public,
multi-surface Agent Skills + plugin distribution repo.

## Why we review

Two reasons, nothing else: **improve quality** and **share knowledge**. Reviews
are not a gate to argue taste through. Style and lint are automated so humans can
focus on correctness risks, hidden complexity, missing context, and anything that
ships to the public.

This repo is **public** and its artifacts install into real users' agents
(Claude Code, the Claude apps, OpenAI Codex, ClawHub). A bad merge ships to
people outside Shippo, so the bar is "would I be comfortable with this being
public and auto-installed", not "does it look fine."

## How we work

- **PRs are blockers.** Review promptly and do not let a PR sit without feedback.
- **PRs stay small and cohesive.** Aim under ~400 lines of substantive change.
  Large skills are the exception (a single SKILL.md can be long), but split
  unrelated changes into separate PRs.
- **Red CI means not ready.** `validate` and `eval` must be green. If the eval
  shows a harness/auth error (for example a disabled `ANTHROPIC_API_KEY`),
  re-run it; do not read a harness failure as a content failure.
- **Critique the code, not the author.** Suggest alternatives with examples.
  Acknowledge good patterns.
- **Every comment ends resolved, accepted, or ticketed.** Re-request review after
  you address changes.

## Roles

**Author** opens the PR, fills the template, self-reviews first, keeps it small,
and answers comments promptly.

**Reviewer** starts from the "why", focuses on the high-value checks below, and
gives a clear outcome: approve, approve-with-remarks, comment-only, or request
changes.

**Code owner** is the `@goshippo/solutions-architects` team (CODEOWNERS routes
all reviews here). At least one SA approval is required to merge; this is enforced
in branch protection.

## Reviewer checklist

Not every PR needs every item. Use judgment.

### Functionality and correctness
- [ ] Does it do what the description / linked ticket says?
- [ ] Any input or edge case that breaks it?
- [ ] For skill content: are the documented workflows factually correct about
      Shippo (carrier tokens, object relationships, what each operation returns)?

### Organization and readability
- [ ] Clear, consistent naming; no commented-out or dead content.
- [ ] Comments explain non-obvious decisions, not the obvious.

### Design
- [ ] Change lives in the right place (canonical `skills/`, not a derived mirror).
- [ ] Reasonable size and single responsibility.

### Error handling
- [ ] Edge cases and error paths handled; messages clear and actionable.
- [ ] Skill content describes the Speakeasy response envelope / error handling
      where it reads nested response fields.

### Testing
- [ ] Adequate coverage for the change. **A new skill MUST add skill-triggering
      test cases** (`tests/skill-triggering.json`, both should-trigger and
      should-NOT-trigger) **and register in `SKILL_NAMES`** in
      `scripts/eval-skill-triggering.js`, otherwise the eval cannot see it and
      reports a false pass.
- [ ] `npm test` passes with no drift.

### Repo-specific (this repo only)
- [ ] **No em dashes** anywhere (hard house rule, use comma / period / colon /
      parens). This applies to every file including docs and comments.
- [ ] **Tool names are real.** Every Shippo operation referenced exists in
      `tools/mcp-catalog.json` (PascalCase like `GetTrack` / `CreateShipment`;
      Webhooks ops camelCase). No invented or kebab-case names.
- [ ] **Canonical, not derived.** Edits are under `skills/` (or
      `SKILL.md.template` for ClawHub framing), never directly in the
      `providers/**` mirrors. `npm test` regenerates the mirrors.
- [ ] **Version discipline.** If the change touches anything Claude Code consumes,
      `package.json:version` is bumped and the 4 manifests stay in sync via
      `npm test`.
- [ ] **OAuth-only / no test-mode.** No reintroduction of API-key setup,
      `SHIPPO_API_KEY`, or "test mode" guidance (the hosted MCP is live OAuth only).
- [ ] **Public-safe.** No secrets, no internal infrastructure names, no internal
      URLs / queue names / employee names, no real customer data in examples.

## Outcomes

- **Approved:** good to go.
- **Approved with remarks:** merge after addressing the minor notes; no
  re-review needed.
- **Comment only:** reviewer is not yet confident either way; engagement
  expected.
- **Changes requested:** needs adjustments before merge; re-request review once
  addressed.

## Comment style

Prefer [conventional comments](https://conventionalcomments.org/): a label
(`praise`, `nit`, `suggestion`, `question`, `issue`, `blocker`) plus the point
plus the why. Mark nits clearly so they do not read as blockers.

## Reduce review over time

If a manual finding could be a lint rule, a test, or a checklist line, add it.
Reviews should shrink as the automation grows. Example: the tool-name catalog
check and the no-em-dash rule started as manual review notes and are now CI checks.
