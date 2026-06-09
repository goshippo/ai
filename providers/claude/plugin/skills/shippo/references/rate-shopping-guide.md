<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/shippo/references/rate-shopping-guide.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# Rate Shopping Guide

How to compare shipping rates effectively, understand pricing factors, and present options to users.

---

## Basic Flow

1. **Create a shipment** with `CreateShipment` (addresses + parcels).
2. **Retrieve rates** from the shipment response (or poll via `GetShipment` if async).
3. **Compare rates** by price, transit time, and carrier.
4. **Purchase the selected rate** with `CreateTransaction`.

---

## Dimensional Weight

Carriers charge based on the greater of actual weight and dimensional weight.

**Dimensional weight formula:**
```
dim_weight = (length x width x height) / divisor
```

**Divisors by carrier:**
| Carrier | Divisor (inches) | Divisor (cm) |
|---|---|---|
| USPS | 166 | 5000 |
| UPS | 139 | 5000 |
| FedEx | 139 | 5000 |
| DHL Express | 139 | 5000 |

If the package is large but light (e.g., a pillow), dimensional weight will exceed actual weight and the carrier will charge the higher dim weight rate. This causes unexpected price jumps when dimensions increase.

**Example:** A 24x18x12 inch box weighing 5 lbs:
- Dim weight (UPS/FedEx): 24 x 18 x 12 / 139 = 37.3 lbs
- Carrier charges for 38 lbs, not 5 lbs

When a user reports surprisingly high rates, check if dimensional weight is the cause.

---

## Flat Rate vs Custom Dimensions

USPS flat-rate options charge a fixed price regardless of weight (up to 70 lbs). Flat rate wins when:
- The contents are heavy relative to the flat-rate box size.
- The destination is far away (flat rate ignores zones).

To use flat rate, set the parcel `template` to a flat-rate template token (e.g., `USPS_SmallFlatRateBox`) instead of specifying custom dimensions.

Custom dimensions win when:
- The package is light and small.
- The destination is nearby (lower zone = lower price).

---

## Zone Pricing

Most carriers price based on the distance between origin and destination, measured in "zones" (1-8 for domestic US):
- **Zone 1-2:** Local / nearby (cheapest)
- **Zone 5-6:** Cross-regional
- **Zone 8:** Coast to coast (most expensive)

USPS flat-rate options bypass zone pricing entirely.

---

## Rate Expiration

**Rates expire after 7 days.** If the user waits too long between getting rates and purchasing a label, the rate will be invalid. Create a new shipment to get fresh rates.

---

## Duplicate Rates

When a user has multiple carrier accounts for the same carrier (e.g., their own FedEx account plus Shippo's managed FedEx rates), the shipment response may contain duplicate rates from both accounts.

**Best practice:** When presenting rates to the user:
1. Group rates by carrier and service level.
2. Show the cheapest rate for each unique carrier + service combination.
3. Note which account the rate comes from if relevant.

---

## Currency-Specific Rates

Use `ListShipmentRatesByCurrencyCode` to get rates in a specific currency:
```
list_shipment_rates_by_currency shipment_id="..." currency_code="EUR"
```

This is useful for international sellers who need to see rates in their local currency. Shippo converts rates automatically.

---

## Presenting Rates to Users

When showing rate comparisons, include:
- **Carrier and service name** (e.g., "USPS Priority Mail")
- **Price** with currency
- **Estimated transit days** (from `estimated_days` field)
- **Rate object_id** (needed for purchase)

Sort by price ascending unless the user requests sorting by speed.

### Example Output Format

```
1. USPS Ground Advantage -- $8.25 (5-7 business days)
2. USPS Priority Mail -- $12.50 (2-3 business days)
3. UPS Ground -- $14.80 (4-5 business days)
4. FedEx Home Delivery -- $15.20 (3-5 business days)
5. UPS 2nd Day Air -- $28.50 (2 business days)
6. FedEx Priority Overnight -- $45.00 (1 business day)
```

---

## Tips for Getting Better Rates

- **Validate addresses first.** Invalid addresses can cause rate lookup failures or missing rates.
- **Use accurate dimensions.** Overestimating dimensions inflates dimensional weight and prices.
- **Check flat-rate options.** For heavy or long-distance USPS shipments, flat rate is often cheapest.
- **Filter by carrier_accounts** in `CreateShipment` to speed up rate retrieval if only certain carriers are needed.
- **Consider all carriers.** The cheapest option varies by lane, weight, and dimensions. Do not default to one carrier without comparing.
