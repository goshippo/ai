<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/shipping-analysis/README.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# shipping-analysis

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

## What it does

Performs multi-call rate analysis and historical spend review against the Shippo API. Sweeps rates across a destination list (geographic cost analysis) by calling `CreateShipment` per route. Tests multiple dimension profiles on the same route to surface dimensional weight cliffs and flat-rate template wins (package optimization). Groups the `rates` array by `provider` to compute cheapest and fastest service per carrier (carrier comparison). Cross-references `ListShipments` and `ListTransactions` to flag overpayment patterns, carrier concentration, and service-level mismatches (historical cost optimization). All reports are written as paired markdown + CSV under an `analysis/` directory, with timestamps and input parameters captured in the markdown header.

## When to use

- "Compare costs to ship a 5lb box to all 50 states"
- "Optimize package dimensions for a recurring route"
- "Audit my Shippo account for overpayment patterns"
- "Generate a carrier comparison report for a single route"

## When NOT to use

- You need rates for ONE shipment, not many, use `rate-shopping`
- You're processing a CSV of shipments to actually buy, use `batch-shipping`
- You need real-time tracking analytics, use `tracking` (this skill is read-only on past data)

## Example prompts

- "Compare shipping costs from San Francisco to top 10 US cities for a 2lb package"
- "What dimensions minimize shipping cost on the SF→NYC route?"
- "Audit my last 6 months of Shippo transactions for overpayment"
- "Which carrier is cheapest for 1-day delivery from CA to TX?"

## Related

- `rate-shopping`: underlying rate-quote calls (`CreateShipment` is free; this skill calls it many times)
- `tracking`: actual-vs-estimated delivery time analysis
- `shippo/references/carrier-guide.md`: carrier-specific size limits and surcharges
- `shippo/references/rate-shopping-guide.md`: dimensional weight reference
