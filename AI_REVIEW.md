# AI Review Guidance: ai

This is Shippo's public repo for Claude skills, the Claude Code plugin, and MCP bridge distribution. Everything here is public and much of it is customer-facing.

Repo-specific checks for every PR:
- Public repo: no internal hostnames, account IDs, credentials, employee names, internal ticket links, or internal process details in any file, including examples and fixtures.
- Customer-facing copy: Shippo test-mode labels are called "test labels", never "free labels".
- Skills: SKILL.md frontmatter needs a specific, trigger-rich description; skill content must be runnable without internal access.
- Version consistency: when the plugin or bridge version bumps, all references must move together (plugin manifest, marketplace entry, package versions, release artifacts), and releases must attach the complete artifact set.
- The marketplace/plugin identity is "shippo"; flag renames.
