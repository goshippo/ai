---
name: batch-shipping
description: Process bulk shipments from CSV files, create and purchase batch labels, and generate end-of-day manifests via the Shippo API
---

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

See `shippo/references/csv-format.md` for the column specification.

1. Read and parse the CSV. Validate required columns are present. Report row count.
2. Validate each row for non-empty required fields. Report invalid rows with reasons.
3. Detect international rows (sender_country != recipient_country). Create customs declarations for those rows. See `shippo/references/customs-guide.md`. Use correct customs enum values: `RETURN_MERCHANDISE` (not `RETURN`) for returned goods, `HUMANITARIAN_DONATION` (not `HUMANITARIAN`) for charitable donations.
4. Build the `batch_shipments` array with inline address and parcel objects per row.
5. Call `CreateBatch` with the array.
6. Poll `GetBatch` until status is `VALID` or `INVALID`. See Polling Intervals below.
7. If the status is `INVALID`, some batch shipments failed validation: see "Fixing an INVALID batch" below, fix them, and re-poll until `VALID`. Report per-shipment failures either way before proceeding.
8. **Confirm purchase** (see Purchase Confirmation Gate above).
9. Call `PurchaseBatch` to buy labels for all valid shipments.
10. Poll `GetBatch` until status changes from `PURCHASING` to `PURCHASED`. See Polling Intervals below.
11. Report: total attempted, succeeded, failed. For successes: tracking_number and label_url (complete URL). For failures: error messages.

### Retrieving batch labels

A purchased batch does not put each label URL inline on the batch object. Each entry in `batch_shipments[]` carries a `transaction` field, which is a Transaction object_id. Call `GetTransaction` on it to get that shipment's `label_url` and `tracking_number`. The batch-level `label_url` is a merged multi-label PDF (up to 100 labels per file) and cannot be split per order.

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

## Fixing an INVALID batch

If `GetBatch` returns status `INVALID`, one or more batch shipments failed validation and the batch cannot be purchased until they are fixed.

1. **Find the failures.** Call `GetBatch` with `object_results=creation_failed` to return only the failed shipments (paginate with `?page=` if there are many), or read each `batch_shipments[].status` (`VALID` / `INVALID` / `INCOMPLETE` / `TRANSACTION_FAILED`) and its `messages` for the reason. The batch-level `errors` array collects the same per-shipment failures in one place.
2. **Fix them,** either:
   - Remove: `RemoveShipmentsFromBatch` with the failed batch-shipment `object_id`s (from `batch_shipments[].object_id`, not the shipment object_id) to drop them, or
   - Correct and re-add: `AddShipmentsToBatch` with corrected shipment objects (fixed address, parcel, or servicelevel).
3. **Re-poll `GetBatch`** until status is `VALID`.
4. Then **confirm purchase** (see Purchase Confirmation Gate) and `PurchaseBatch`.

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
