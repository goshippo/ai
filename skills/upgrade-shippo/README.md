# upgrade-shippo

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Guide for Shippo API version changes, webhook payload versioning, and how the hosted MCP server handles updates. The Shippo MCP is hosted at `https://mcp.shippo.com`, is OAuth-only, and auto-updates server-side, so there is nothing to install or upgrade. The current Shippo API version is `2018-02-08`, managed server-side; most changes are backward-compatible (new optional fields, new resources, additional webhook events), and breaking changes are rare and announced via the API changelog. Covers webhook event versioning discipline (ignore unknown fields, subscribe to specific event types, verify `Shippo-Signature`) and hosted-MCP troubleshooting: 401/403 (re-authorize the OAuth session), tools changed or missing after an auto-update (re-list via `shippo_list_tools`), and "not found" errors when an object lives on a different account. Includes a pre-change audit checklist for production integrations: verify webhook handlers, review the changelog, and re-list tools after updates.

## When to use

- "Reason about backward compatibility before a Shippo change"
- "Review the API changelog before promoting to production"
- "Audit a webhook handler for backward compatibility"
- "Diagnose a 401/403 or missing-tools problem against the hosted MCP"

## When NOT to use

- "You're building a NEW integration", use `shippo-best-practices` to choose APIs first.
- "You need workflow help for a specific API call", use the corresponding workflow skill (`rate-shopping`, `label-purchase`, `tracking`, etc.).
- "You're debugging a non-version-related error", see `shippo/references/error-reference.md`.

## Example prompts

- "Do I need to upgrade anything to get the latest Shippo MCP tools?"
- "I'm getting a 401 from the Shippo MCP, what should I do?"
- "My webhook handler started seeing new fields, what should I do?"
- "How does Shippo handle API versioning for the hosted MCP?"

## Related

- `shippo-best-practices`: new-integration discipline before you pick APIs
- `tracking`: webhook setup and `Shippo-Signature` validation
- `shippo/references/error-reference.md`: "not found" and other API error patterns
