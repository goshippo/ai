<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/tracking/README.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# tracking

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Track packages across carriers, view tracking history, and register webhooks for push updates via the Shippo API. Call `GetTrack` with a lowercase carrier token (`usps`, `ups`, `fedex`, `dhl_express`) and a tracking number to retrieve current status, ETA, and chronological event history. Tracking status uses six standard values, `PRE_TRANSIT`, `TRANSIT`, `DELIVERED`, `RETURNED`, `FAILURE`, `UNKNOWN`: and each event includes a `substatus` object with `code`, `text`, and an `action_required` boolean that flags shipments needing intervention. To find trackable packages, call `ListTransactions` and filter for `object_status: SUCCESS`. To receive push updates, register a webhook via `createWebhook` with `event: track_updated`.

## When to use

- "Show current package status for a tracking number"
- "Get full tracking history for a package"
- "Register a webhook to receive tracking updates"
- "Determine if a package needs intervention (action_required substatus)"

## When NOT to use

- "You're buying a label and just need the tracking number", `label-purchase` returns it directly in the transaction response.
- "You need to track a package that wasn't shipped through Shippo", Shippo only tracks labels purchased through it (or shipments registered via `CreateTrack`).

## Example prompts

- "Track package 9400111899223100001234"
- "What's the status of UPS tracking 1Z999AA10123456784?"
- "Set up a webhook to receive tracking updates at https://my-app.com/webhook"
- "Show me all packages currently in transit"
- "Is there anything wrong with my recent shipments? (check action_required)"

## Related

- `label-purchase`: generates the tracking number in the first place
- `batch-shipping`: for tracking many packages from a batch
- `shippo/references/carrier-guide.md`: carrier-token mapping (`usps`, `ups`, `fedex`, `dhl_express`) and tracking number format hints
