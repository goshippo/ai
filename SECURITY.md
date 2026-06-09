# Security Policy

## Reporting a vulnerability

Please do not open GitHub issues or pull requests for security-related findings, this makes the problem immediately visible to everyone, including malicious actors.

Security issues in this repo (Shippo's AI distribution surfaces, the Claude Code plugin, ClawHub skill, and supporting scripts) can be reported to Shippo's security team at **security@goshippo.com**.

For vulnerabilities affecting the underlying Shippo API or product platform, see [Shippo's responsible disclosure page](https://goshippo.com/security) for the most up-to-date reporting channel.

Shippo's security team will triage your report and respond according to its impact on Shippo users and systems.

## Scope

This repo distributes:

- **Skill content**: Markdown files (`SKILL.md`, references) intended to be loaded into AI assistants. Reportable issues here include: prompt-injection vulnerabilities, instructions that would cause an assistant to mishandle user data or credentials, content that violates Shippo's data-handling policies.
- **Scripts**: `scripts/sync.js` and `scripts/build-clawhub-bundle.js`. Reportable issues here include: path traversal, injection, dependency vulnerabilities.
- **MCP server config**: `.mcp.json` files configure how AI assistants connect to Shippo's MCP server. Reportable issues here include: credential leakage, insecure transport, unintended privilege escalation.

## Out of scope

- Bugs in the underlying [Shippo API](https://docs.goshippo.com): report via [goshippo.com/security](https://goshippo.com/security).
- Bugs in the Shippo MCP server itself, report directly to security@goshippo.com.
- Issues in third-party dependencies (Claude Code, ClawHub, the OpenClaw spec): report to those upstream projects.
