# batch-shipping

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Process bulk shipments from a CSV file, create and purchase batch labels, and generate end-of-day manifests for picked-up packages. The skill parses and validates the CSV (see `shippo/references/csv-format.md`), detects international rows (sender_country != recipient_country) and builds customs declarations for them, then assembles the `batch_shipments` array and calls `CreateBatch`. It polls `GetBatch` until status flips from `VALIDATING` to `VALID`, surfaces per-shipment validation failures, and, **only after explicit user confirmation of count, carrier/service, and estimated total cost**: calls `PurchaseBatch` and polls again until `PURCHASED`. Polling cadence is 3-5s for batches under 100 shipments and 5-10s for 100+ (split anything over 500 into multiple batches). Rate shopping inside a batch runs `CreateShipment` per row to get quotes, then applies a service-level rule (e.g. cheapest-each) before purchase. End-of-day manifests are produced via `CreateManifest` with explicit transaction object_ids, there is no auto-include for a date range.

## When to use

- "Process a CSV with 50+ shipments at once"
- "Generate end-of-day manifest for picked-up packages"
- "Bulk-buy labels with cheapest-each rate selection"
- "Add or remove shipments from a batch before purchase"

## When NOT to use

- You only need to ship one package, use `label-purchase`.
- You need real-time rate display at checkout, use `rate-shopping` (Rates at Checkout flow).
- Your batch is over 500, split into multiple batches first.

## Example prompts

- "Process this CSV of 200 shipments and buy the cheapest label for each"
- "Create a batch from this CSV but don't purchase yet, let me review first"
- "Generate today's USPS end-of-day manifest"
- "Add 3 more shipments to batch_xyz before purchase"

## Related skills

- `rate-shopping`: per-shipment rate quotes that feed the service-level rule inside the batch.
- `address-validation`: upstream CSV row validation before `CreateBatch`.
- `tracking`: once labels are purchased and tracking numbers are returned.
- `shippo/references/csv-format.md`: required column spec for batch CSVs.
- `shippo/references/customs-guide.md`: building customs declarations for international rows.
