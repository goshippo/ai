# shippo-support-ticket

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Turn a single shipment identifier into a complete, auto-classified, ready-to-paste support ticket for the Shippo support team. Given any one of a tracking number + carrier, a transaction (label) ID, a shipment ID, or an order number / customer email, the skill classifies the issue into one canonical type, runs the right read-only Shippo MCP lookups for that type, computes a triage timeline (label-created → first scan, last scan → now, overdue vs ETA), and emits **two** blocks: a human copy-paste ticket body and a routing-tagged JSON block for the ticketing pipeline. It is read-only; it documents and recommends (e.g. "refund this label"), never issues a write. Audience is Shippo support agents, not end customers.

## When to use

- "Build a support ticket for this stuck/late package"
- "Customer says they were charged more than the rate they saw, write it up for billing"
- "Refund request for a label that was never used, gather the facts"
- "Tracking webhooks aren't firing for this account, escalate it"
- "Customs hold, package this for the customs queue with the declaration details"

## When NOT to use

- "Track a package" with no escalation intent: use `tracking`.
- "Validate / fix an address" as a workflow step: use `address-validation`.
- "Actually issue the refund": this skill recommends; it never calls a write op. Use the refund/void guidance in `label-purchase`.

## Example prompts

- "Build a Shippo support ticket for tracking 9400111899223100001234 on usps"
- "Make a support ticket for transaction txn_abc123, charged more than quoted"
- "Refund-eligibility ticket for the label on order #10482"
- "Why is shipment shp_def456 stuck in customs? Write it up for support."

## Related

- `tracking`: the underlying `GetTrack` history this skill's timeline is built from
- `address-validation`: the validation reads used by the address-exception branch
- `label-purchase`: refund/void guidance for when support actually acts on the ticket
- `shippo/references/customs-guide.md`: customs-declaration completeness for the international branch
