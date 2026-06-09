---
name: batch-shipping
description: Process bulk shipments from CSV files, create and purchase batch labels, and generate end-of-day manifests via the Shippo API
---
<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/batch-shipping/SKILL.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->


# Batch Shipping

## Purchases Are Live

Batch purchases charge the authorized Shippo account for real. Before `PurchaseBatch`, show the shipment count, carrier/service, and estimated total cost, and require explicit user confirmation.

---

## Purchase Confirmation Gate

Before every call to `PurchaseBatch`, summarize the following and ask the user for explicit confirmation:
- Total number of shipments to be purchased
- Carrier and service level (or selection rule if varied)
- Estimated total cost
- Number of domestic vs international shipments

**Do not proceed without explicit user confirmation.**

---

## CSV Batch Processing

See `references/csv-format.md` for the column specification.

1. Read and parse the CSV. Validate required columns are present. Report row count.
2. Validate each row for non-empty required fields. Report invalid rows with reasons.
3. Detect international rows (sender_country != recipient_country). Create customs declarations for those rows. See `references/customs-guide.md`. Use correct customs enum values: `RETURN_MERCHANDISE` (not `RETURN`) for returned goods, `HUMANITARIAN_DONATION` (not `HUMANITARIAN`) for charitable donations.
4. Build the `batch_shipments` array with inline address and parcel objects per row.
5. Call `CreateBatch` with the array.
6. Poll `GetBatch` until status changes from `VALIDATING` to `VALID`. See Polling Intervals below.
7. Review per-shipment validation results. Report failures before proceeding.
8. **Confirm purchase** (see Purchase Confirmation Gate above).
9. Call `PurchaseBatch` to buy labels for all valid shipments.
10. Poll `GetBatch` until status changes from `PURCHASING` to `PURCHASED`. See Polling Intervals below.
11. Report: total attempted, succeeded, failed. For successes: tracking_number and label_url (complete URL). For failures: error messages.

### Batch Size Guidance

For batches over 500 shipments, consider splitting into multiple batches. Large batches take longer to validate and purchase, and a single failure can be harder to diagnose.

---

## Polling Intervals

- For batches under 100 shipments: poll every 3-5 seconds.
- For batches with 100+ shipments: poll every 5-10 seconds.
- Report progress to the user every 30 seconds.
- Stop after 60 retries and suggest the user check back later using `GetBatch` with the batch object_id.

---

## Batch with Rate Shopping

1. Call `CreateShipment` per shipment to get rate quotes (see Rate Shopping).
2. Present rates. User picks a service level rule (e.g., "cheapest for each" or a specific carrier/service).
3. Build `batch_shipments` with `servicelevel_token` per item.
4. Create, validate, **confirm purchase**, purchase, report as above.

---

## Managing an Existing Batch

- Add shipments: `AddShipmentsToBatch` (before purchase only). Note: adding an invalid shipment will change the entire batch status to `INVALID`. Check per-shipment statuses after adding.
- Remove shipments: `RemoveShipmentsFromBatch` (before purchase only).

---

## End-of-Day Manifest

1. Collect: `carrier_account` (object_id), `shipment_date` (YYYY-MM-DD, default today), `address_from` (pickup address).
2. Optionally collect specific transaction object_ids to scope the manifest. You must pass specific transaction object_ids -- there is no auto-include for a date range.
3. Call `CreateManifest`.
4. Poll `GetManifest` until status is `SUCCESS` or `ERROR`.
5. Return the manifest PDF URL(s) and shipment count.

---

## Quick Reference

**CSV batch:**
Parse CSV -> `CreateCustomsDeclaration` (international rows) -> `CreateBatch` -> poll `GetBatch` -> confirm -> `PurchaseBatch` -> poll `GetBatch`

**Manifest:**
`CreateManifest` (with transaction object_ids) -> poll `GetManifest`
