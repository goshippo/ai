# Shippo rates to ACP fulfillment options

A small, typed, zero-dependency converter that maps a [Shippo rates response](https://docs.goshippo.com/shippoapi/public-api/#tag/Rates) to the `fulfillment_options` array of an [Agentic Commerce Protocol (ACP)](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) checkout session.

During agentic checkout (for example OpenAI's Instant Checkout), the merchant's server must return shipping choices as ACP `FulfillmentOptionShipping` objects. If you rate-shop with Shippo, this adapter is the glue: Shippo rates in, spec-shaped fulfillment options out.

Plain CommonJS with JSDoc types (`// @ts-check`), Node 18+, no dependencies.

## Usage

```js
const { ratesToFulfillmentOptions } = require('./shippo-to-acp');

// `shipment` is the response of POST /shipments (or pass the rates array
// from GET /shipments/{id}/rates directly).
const { currency, fulfillment_options } = ratesToFulfillmentOptions(shipment, {
  shipmentDate: '2026-07-10T16:00:00Z', // when the parcel will ship
  deliveryWindowDays: 1,                // pad latest_delivery_time by a day
});
// -> put `fulfillment_options` on your ACP checkout session; make sure
//    `currency` matches the session's settlement currency.
```

Try it:

```bash
node examples/acp-fulfillment/demo.js
node --test examples/acp-fulfillment/shippo-to-acp.test.js
```

## Spec versions

The adapter emits the latest released ACP shape by default and the earlier flat shape on request:

| `specVersion` option | Shape | Source |
|---|---|---|
| `'2026-04-17'` (default) | `totals[]` cost breakdown | [`spec/2026-04-17/json-schema/schema.agentic_checkout.json`](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/json-schema/schema.agentic_checkout.json), `$defs.FulfillmentOptionShipping` and `$defs.Total` |
| `'2025-09-29'` | flat `subtotal` / `tax` / `total` | [`spec/2025-09-29/json-schema/schema.agentic_checkout.json`](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2025-09-29/json-schema/schema.agentic_checkout.json); this is the shape [OpenAI's Agentic Checkout spec page](https://developers.openai.com/commerce/specs/checkout) documents (API version header `2025-09-12`) |

In both versions, money is an **integer in minor currency units** (550 means $5.50 USD) and delivery estimates are **RFC 3339 timestamps**. The checkout session carries a single ISO 4217 settlement currency; the fulfillment option itself has no currency field.

## Field mapping

| Shippo rate field | ACP 2026-04-17 field | ACP 2025-09-29 field | Notes |
|---|---|---|---|
| (constant) | `type: "shipping"` | `type: "shipping"` | Discriminator, required |
| `object_id` | `id` | `id` | Required. Stable Shippo rate id; echo it back on session updates as the selected option id |
| `servicelevel.name` (fallback `servicelevel.token`) | `title` | `title` | Required. Display-ready, e.g. "Priority Mail" |
| `duration_terms` | `description` | `subtitle` | Optional carrier prose, e.g. "Delivery in 1 to 3 business days." |
| `provider` | `carrier` | `carrier` | Optional, e.g. "USPS" |
| `estimated_days` (+ `shipmentDate` option) | `earliest_delivery_time`, `latest_delivery_time` | same | Optional RFC 3339 timestamps, computed as `shipmentDate + estimated_days` days; see caveats |
| `amount` + `currency` | `totals: [{ type: "total", display_text: "Shipping", amount }]` | `subtotal`, `total` | Decimal-string major units converted to integer minor units with exact string math (no float drift), honoring ISO 4217 exponents (JPY has 0 decimals, KWD has 3) |
| (none) | n/a | `tax: 0` | See caveats |

The `totals` entry shape (`type` / `display_text` / `amount`, all required) and the `type: "total"` value follow the spec's own [`fulfillment_options` example](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/examples/2026-04-17/examples.agentic_checkout.json).

## Caveats: what Shippo does not populate

Honest gaps you must cover in a production integration:

* **Tax.** Shippo rates are pre-tax carrier prices. The 2025-09-29 shape requires a `tax` field, which the adapter sets to `0` with `total = subtotal`. If your jurisdiction taxes shipping, compute it in your tax engine and adjust before returning the option.
* **Delivery windows.** Shippo returns a single `estimated_days` point estimate, not a range. By default `earliest_delivery_time` equals `latest_delivery_time`; pass `deliveryWindowDays` to widen the range honestly. Some carrier services return no `estimated_days` at all, in which case both timestamps are omitted (they are optional in every ACP version).
* **Ship date.** `estimated_days` counts from when the parcel ships, not from checkout. Pass `shipmentDate` reflecting your real handling time; the default is "now".
* **Currency.** ACP prices the whole session in one settlement currency. The adapter throws on mixed-currency rate lists and returns the detected `currency` so you can assert it matches the session.
* **Business days.** `estimated_days` is calendar-added here. Carrier estimates are usually business days; adjust if the distinction matters for your promise dates.

## Related protocols

The [Universal Commerce Protocol (UCP)](https://ucp.dev/) covers similar ground through its [Fulfillment extension](https://ucp.dev/latest/specification/fulfillment/): fulfillment methods carry `line_item_ids`, destinations, and grouped options with `title` / `description` / totals. The same Shippo fields map naturally onto that shape, but UCP output is out of scope for this example.

## Trying it against real rates

Create a test-mode shipment with your Shippo test token (test-mode rates purchase test labels, so nothing is billed), then feed the response straight into `ratesToFulfillmentOptions`. The [rate-shopping skill](../../skills/rate-shopping) in this repo walks through creating shipments and comparing rates.
