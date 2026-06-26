---
name: label-purchase
description: Purchase domestic and international shipping labels, handle customs declarations, return labels, and void/refund labels via the Shippo API
---

# Label Purchase

## Purchases Are Live

Label purchases charge the authorized Shippo account for real. **Before purchasing, explicitly state "this will charge your Shippo account" with the carrier, service, and cost, and require the user to acknowledge.** Do not purchase without that confirmation.

---

## Purchase Confirmation Gate

Before every call to `CreateTransaction`, summarize the following and ask the user for explicit confirmation:
- Carrier and service level
- Estimated cost
- Estimated delivery time
- Origin and destination

**Do not proceed without explicit user confirmation.**

---

## Domestic Label

1. Optionally validate both addresses with `ValidateAddress` (see Address Validation).
2. Call `CreateShipment` with `address_from`, `address_to` (as inline address objects using v1 field names -- `street1`, `city`, `state`, `zip`, `country`), `parcels`, and `async: false`.
3. Present rates to the user. Let them choose.
4. **Confirm purchase** (see Purchase Confirmation Gate above).
5. Call `CreateTransaction` with: `rate` (selected rate object_id), `label_file_type` (default `PDF_4x6`), `async: false`.
6. Check response `status`:
   - `SUCCESS`: return `tracking_number`, `label_url` (display the COMPLETE URL -- S3 signed URLs break if truncated), and `tracking_url_provider`.
   - `QUEUED`/`WAITING`: poll `GetTransaction` until resolved.
   - `ERROR`: report messages from the `messages` array.

---

## International Label

All domestic steps apply, plus customs handling before shipment creation. See `shippo/references/customs-guide.md` for the full customs workflow.

1. Optionally validate addresses with `ValidateAddress`. Sender must include `email` and `phone`. Ask if missing.
2. Create customs items: call `CreateCustomsItem` per item (description, quantity, net_weight, mass_unit, value_amount, value_currency, origin_country, tariff_number). Alternatively, you can skip this step and pass inline item objects directly in the declaration (step 3).
3. Create the customs declaration: call `CreateCustomsDeclaration` with contents_type, non_delivery_option, certify: true, certify_signer, and the items (either object_ids from step 2, or inline item objects). See `shippo/references/customs-guide.md` for field details.
4. Call `CreateShipment` with all standard fields plus `customs_declaration` (the declaration object_id).
5. Present rates, **confirm purchase** (see Purchase Confirmation Gate), then purchase label and return results as in the domestic flow.

### Contents Type Decision Tree

Use this to determine the correct `contents_type` value:

| Scenario | Value |
|---|---|
| Selling to the recipient (commercial sale) | `MERCHANDISE` |
| Sending a free gift | `GIFT` |
| Sending a product sample | `SAMPLE` |
| Paper documents only | `DOCUMENTS` |
| Customer returning a purchased item | `RETURN_MERCHANDISE` |
| Charitable donation | `HUMANITARIAN_DONATION` |
| None of the above | `OTHER` (requires `contents_explanation`) |

### Incoterms Decision Logic

The `incoterm` field on the customs declaration controls who pays duties and taxes:

- **B2C / e-commerce (default):** Use `DDU` (Delivered Duty Unpaid) -- recipient pays duties at delivery.
- **Seller prepays duties:** Use `DDP` (Delivered Duty Paid) -- seller covers all duties and taxes.
- **FedEx/DHL only:** `FCA` (Free Carrier) is available for advanced trade scenarios.

If the user does not specify, default to `DDU` for standard e-commerce shipments.

---

## Return Labels

To generate a return label, swap `address_from` and `address_to` so the original recipient becomes the sender and the original sender becomes the recipient. All other steps (shipment creation, rate selection, label purchase) remain the same.

---

## Label Format Options

Default to `PDF_4x6` unless the user specifies otherwise. Supported formats: `PDF_4x6`, `PDF_4x8`, `PDF_A4`, `PDF_A5`, `PDF_A6`, `PDF`, `PDF_2.3x7.5`, `PNG`, `PNG_2.3x7.5`, `ZPLII`.

---

## Label Customization Options

When purchasing a label via `CreateTransaction`, the following options may be set on the shipment or rate:

- **Signature confirmation**: set `signature_confirmation` on the shipment's `extra` field. Values: `STANDARD`, `ADULT`, `CERTIFIED`, `INDIRECT`, `CARRIER_CONFIRMATION`.
- **Insurance**: set `insurance` on the shipment's `extra` field with `amount`, `currency`, and `provider`.
- **Saturday delivery**: set `saturday_delivery` to `true` in the shipment's `extra` field. Only supported by certain carriers and service levels.
- **Reference fields**: pass `metadata` on the transaction for order numbers or internal references.

---

## Label from Existing Rate

If the user already has a rate object_id: optionally call `GetRate` to confirm details, then **confirm purchase** (see Purchase Confirmation Gate), then call `CreateTransaction` directly.

---

## Voiding a Label

Call `CreateRefund` with the transaction object_id.

**Refund limitations:** Void/refund eligibility depends on carrier and timing. Not all labels can be refunded after purchase. If `CreateRefund` fails, advise the user to contact Shippo support.

---

## Quick Reference

**Domestic label:**
(optional) `ValidateAddress` (x2) -> `CreateShipment` (with inline addresses) -> user picks rate -> confirm -> `CreateTransaction`

**International label:**
(optional) `ValidateAddress` (x2) -> `CreateCustomsItem` (per item) -> `CreateCustomsDeclaration` -> `CreateShipment` (with inline addresses + customs_declaration) -> user picks rate -> confirm -> `CreateTransaction`

**Return label:**
Same as domestic/international, but swap `address_from` and `address_to`.

**Order-to-label:**
`CreateOrder` -> `CreateShipment` (using order address/item data) -> user picks rate -> confirm -> `CreateTransaction` -> packing slip (REST fallback, see below)

---

## Orders and Packing Slips

Use orders to represent e-commerce fulfillment requests. An order captures the shipping address, line items, and totals -- then feeds into the standard label purchase workflow.

### Tools

- **`CreateOrder`**: Create an order with line items, shipping address, and order details.
- **`GetOrder`**: Retrieve an order by its object_id.
- **`ListOrders`**: List all orders.
- **Packing slip (known gap):** Generate a packing slip PDF for an order. There is no packing-slip tool in the MCP catalog. The underlying REST endpoint exists at `GET /orders/{ORDER_ID}/packingslip/` (returns a 24-hour S3 PDF link). Fall back to a direct REST call, or advise the user to use the Shippo dashboard until the MCP gap is closed.

### Workflow

1. Call `CreateOrder` with the shipping address, line items (title, quantity, sku, total_price, etc.), and order-level fields.
2. Use the order's address and item data to call `CreateShipment`, then follow the standard label purchase flow (rate selection, confirmation, `CreateTransaction`).
3. After purchasing the label, generate a packing slip via the REST fallback (see Tools above for the known MCP gap).
