---
name: rate-shopping
description: Compare multi-carrier shipping rates, find cheapest/fastest options, and get shipping recommendations via the Shippo API
---
<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/rate-shopping/SKILL.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->


# Rate Shopping and Comparison

## Get Rates for a Shipment

1. Collect: origin address, destination address, parcel (length, width, height, distance_unit, weight, mass_unit). All dimension and weight values must be **strings** (e.g., `"10"` not `10`).
2. Optionally validate both addresses with `ValidateAddress` (see Address Validation).
3. Call `CreateShipment` with `address_from`, `address_to` (as inline address objects using v1 field names -- `street1`, `city`, `state`, `zip`, `country` -- not object IDs), and `parcels`.
4. The response `rates` array contains available options. Present a table: carrier, service level, price, estimated days.
5. Note: the same carrier may return duplicate rates from multiple carrier accounts. Present the best rate per carrier/service combination.
6. Each rate carries an `object_id`. To buy a label, pass the chosen rate's `object_id` to the purchase flow (see Label Purchase); you do not re-send the address or parcel.

---

## Rate Expiration

Rates expire after 7 days. If a user tries to purchase a rate that was retrieved more than 7 days ago, create a new shipment to get fresh rates.

---

## Filter by Speed

Map user requests: "overnight" = estimated_days 1, "2-day" = estimated_days <= 2, "within N days" = estimated_days <= N. Filter the rates array accordingly. If nothing matches, show the fastest available option.

---

## International Rates

Some carriers may return international rates without a customs declaration, but others will not. If no rates are returned, try attaching a customs declaration to the shipment. Some carriers also require a phone number on the destination address for international rate retrieval. Inform the user that customs will be required at label purchase time regardless. See `references/customs-guide.md` for customs details.

---

## Checkout Rates (Line Items)

Call `CreateLiveRate` instead of `CreateShipment`. Accepts `address_from`, `address_to`, and `line_items` (each with title, quantity, total_price, currency, weight, weight_unit).

---

## Rates in a Specific Currency

Call `ListShipmentRatesByCurrencyCode` with the preferred ISO currency code (USD, EUR, GBP, CAD, etc.).

---

## Recommendation

Identify the cheapest (lowest `amount`), fastest (lowest `estimated_days`), and best-value options from the rates array. These are not API fields -- compute them by sorting the rates array yourself. State the trade-off: "Option A is $X cheaper but takes Y more days than Option B."

---

## Troubleshooting: No Rates

- Verify both addresses passed validation (most common cause).
- Confirm parcel dimensions are reasonable (not zero, not exceeding carrier limits).
- Shippo provides managed carrier accounts by default for major carriers. If no rates are returned, the issue is more likely address validation, unsupported route, or parcel dimensions -- not missing carrier accounts. You can verify with `ListCarrierAccounts` if needed.
- Rates expire after 7 days. If stale, create a new shipment to get fresh rates.

---

## Quick Reference

**Get rates:**
(optional) `ValidateAddress` (x2) -> `CreateShipment` (with inline addresses) -> read `rates` array
