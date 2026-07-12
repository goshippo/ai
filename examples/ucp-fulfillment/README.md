# Shippo fulfillment reference for the Universal Commerce Protocol (UCP)

A reference adapter that maps a **Shippo rates response** into the
**UCP fulfillment extension** (`dev.ucp.shopping.fulfillment`), plus a small
companion extension published under Shippo's own reverse-DNS namespace
(`com.shippo.shipping.rate_detail`) that carries the identifiers a
Shippo-aware platform needs to actually buy the label.

Everything here is dependency-free and runs on Node 18+.

```
examples/ucp-fulfillment/
  extension/
    rate_detail.schema.json        JSON Schema for the com.shippo.shipping.rate_detail annotation
    profile-capabilities.json      how a Shippo-backed business advertises the extensions in /.well-known/ucp
  src/
    map-rates-to-fulfillment.js    the mapper (Shippo rates -> UCP fulfillment + annotation)
  demo/
    sample-shippo-rates.json       synthetic sample rates response
    demo.js                        runnable end-to-end demo
  test/
    map-rates-to-fulfillment.test.js  node:test suite (no deps)
```

## Read this first: how Shippo fits into UCP

UCP already defines a fulfillment extension, `dev.ucp.shopping.fulfillment`,
and the `dev.ucp.*` namespace is **reserved for the UCP Tech Council** ("The
`dev.ucp.*` namespace is reserved exclusively for capabilities governed by the
UCP Tech Council", core concepts). A third party like Shippo does **not**
define a competing fulfillment extension. The correct integration is:

1. **Implement the existing extension.** A Shippo-backed business populates the
   standard `fulfillment` object on its Checkout. Each Shippo rate becomes one
   fulfillment `option`. This is the primary deliverable: the mapper in `src/`.
2. **Annotate, in your own namespace, the Shippo-specific extras the base
   schema does not carry.** The base option already defines first-class
   `carrier`, `earliest_fulfillment_time`, and `latest_fulfillment_time`
   fields, and this adapter populates them, so carrier and timing are readable
   by any UCP consumer. What the base schema does *not* carry is the Shippo
   purchase plumbing: the `rate_id`, carrier-account id, servicelevel token,
   and the raw `estimated_days`. The spec says a fulfillment option "is open,
   so a business MAY annotate it with additional fields," and UCP's
   collision-safe convention for that is reverse-domain naming. So Shippo
   publishes a companion extension, `com.shippo.shipping.rate_detail`, whose
   object hangs off each option under the key `com.shippo.shipping.rate_detail`.
   A generic platform ignores the key; a Shippo-aware platform uses it to
   create the label.

This is a genuine use of UCP's open extension mechanism, not a redefinition of
the Tech-Council extension.

## Field mapping

### Shippo Rate to UCP fulfillment option (base fields, rendered by any platform)

| UCP option field (`dev.ucp.shopping.fulfillment`) | Source (Shippo Rate) | Notes |
| --- | --- | --- |
| `id` | `object_id` | The rate id doubles as the option id, so a selection round-trips. |
| `title` | `provider` + `servicelevel.name` | e.g. "USPS Priority Mail". Must distinguish siblings (spec). |
| `carrier` | `provider` | First-class base field on the option (`fulfillment_option.json`). A generic UCP consumer reads the carrier here, without understanding the Shippo annotation. |
| `description.plain` | `duration_terms` (+ `provider`) | Renderable prose; falls back to `estimated_days`. `description` is an object `{ "plain": "..." }`, per the spec examples. Complements, does not replace, the structured timing fields below. |
| `earliest_fulfillment_time` | `estimated_days` (+ `shipmentDate`) | Base field, RFC 3339 date-time. Derived deterministically as `shipmentDate` + `estimated_days` calendar days (UTC). Omitted when the rate has no `estimated_days`. |
| `latest_fulfillment_time` | `estimated_days` (+ `shipmentDate`, `deliveryWindowDays`) | Base field, RFC 3339 date-time. `earliest_fulfillment_time` + `deliveryWindowDays` (default 0, so equal to earliest unless a window is requested). |
| `totals[]` | `amount` + `currency` | Emitted as `{ "type": "total", "amount": <minor units> }`. `amount` is converted from the decimal string (e.g. `"5.50"` USD to `550`) using the currency's ISO 4217 minor-unit exponent. No `currency` on the total: the UCP checkout root owns `currency`. |
| `groups[].selected_option_id` | `attributes` | Auto-selects the `BESTVALUE` rate, else `CHEAPEST`, unless the caller passes `selectedRateId`. A selection that is not among the emitted options is dropped with a warning, never left as a dangling reference. |

Option-level `totals[]` are the per-option shipping cost only. They are distinct
from the checkout-level totals and constraints, which own the order's grand total
(items + shipping + tax); this mapper does not compute or touch those.

### Shippo Rate to `com.shippo.shipping.rate_detail` (annotation, used by Shippo-aware platforms)

| Annotation field | Source (Shippo Rate) | Purpose |
| --- | --- | --- |
| `rate_id` | `object_id` | Pass as `rate` when creating a Shippo Transaction (label). |
| `provider` | `provider` | Carrier name. |
| `carrier_account` | `carrier_account` | Shippo carrier account object_id. |
| `servicelevel_token` | `servicelevel.token` | Stable machine service id. |
| `servicelevel_name` | `servicelevel.name` | Human service name. |
| `servicelevel_terms` | `servicelevel.terms` | Carrier terms (often empty). |
| `estimated_days` | `estimated_days` | Shippo's raw integer point estimate, preserved verbatim. The base option's structured timing (`earliest_fulfillment_time` / `latest_fulfillment_time`) is derived from this; the annotation keeps the un-derived source value for a Shippo-aware platform. |
| `duration_terms` | `duration_terms` | Source phrase folded into `description.plain`. |
| `arrives_by` | `arrives_by` | Local arrival time when the carrier provides it. |
| `zone` | `zone` | Carrier rating zone. |
| `amount` / `currency` | `amount` / `currency` | Original un-rounded decimal, preserved. |
| `attributes` | `attributes` | `CHEAPEST` / `FASTEST` / `BESTVALUE` ranking flags. |

## Run it

```bash
# demo: sample rates -> a UCP checkout carrying the fulfillment object
node examples/ucp-fulfillment/demo/demo.js

# tests
node --test examples/ucp-fulfillment/test/map-rates-to-fulfillment.test.js
```

Programmatic use:

```js
const { mapRatesToFulfillment } = require('./src/map-rates-to-fulfillment');

const { fulfillment, currency, warnings } = mapRatesToFulfillment(shippoRatesResponse, {
  lineItemIds: ['li_shirt', 'li_pants'],   // the cart items this shipment covers
  destination,                              // optional UCP fulfillment destination
  // checkoutCurrency: 'USD',               // defaults to the first rate's currency
  // selectedRateId: '<shippo object_id>',  // optional explicit selection
});
// place `fulfillment` on your Checkout under the `fulfillment` key; use `currency` as the checkout root currency.
```

The mapper accepts either the raw array of Rate objects or the
`{ "results": [ ... ] }` envelope the Shippo API returns.

## Publishing / registering the extension per UCP

UCP has **no central registry**. Governance authority is embedded in the
reverse-domain name itself ("This eliminates the need for a central registry,
domain owners control their own namespace", core concepts). To publish
`com.shippo.shipping.rate_detail`:

1. **Own the authority domain.** The namespace `com.shippo.*` maps to authority
   domain `shippo.com`. You must control that domain.
2. **Host the schema on the authority domain.** Serve `rate_detail.schema.json`
   at an `https://shippo.com/...` URL. UCP requires that an entity's `schema`
   URL "must originate from its namespace authority domain," and platforms
   "MUST validate this binding for declared `schema` URLs and MUST reject
   entities that fail it." Here the schema `$id` is
   `https://shippo.com/ucp/schemas/rate_detail.json`. (The `spec` documentation
   URL is not authority-bound and may be any `https` origin.)
3. **Declare it in the business UCP profile.** In the document served at
   `/.well-known/ucp`, add an entry to `ucp.capabilities` keyed by the
   reverse-domain id, with `version` (date-based `YYYY-MM-DD`), `spec`,
   `schema`, and `extends`. See `extension/profile-capabilities.json`. Because
   this extension `extends: "dev.ucp.shopping.fulfillment"`, UCP's coherence
   rule prunes it automatically unless fulfillment is also in the negotiated
   intersection, exactly the desired behavior (rate detail only means something
   when fulfillment is active).
4. **Compose onto the base schema.** UCP extensions "compose onto the base
   schema using JSON Schema `allOf`." A publisher's full fulfillment schema
   would `allOf`-compose the base option with this annotation as an optional
   property under the reverse-domain key.
5. **Negotiation is opt-in.** The extension activates only when both parties
   declare it, so adding it never breaks a platform that does not recognize it.

No pull request to the UCP repo and no maintainer approval are required to
publish a vendor extension ("Any vendor can define and publish capabilities
under their own domain ... without UCP maintainer approval", core concepts).

## Primary sources (verified)

- UCP fulfillment extension spec (current, version `2026-04-08`):
  <https://ucp.dev/latest/specification/fulfillment/> (raw source:
  <https://raw.githubusercontent.com/Universal-Commerce-Protocol/ucp/main/docs/specification/fulfillment.md>)
- UCP core concepts (extensions, namespace governance, authority binding,
  vendor extensions):
  <https://github.com/Universal-Commerce-Protocol/ucp/blob/main/docs/documentation/core-concepts.md>
- UCP repository and site: <https://github.com/Universal-Commerce-Protocol/ucp>,
  <https://ucp.dev/>
- UCP schema validator (fixtures reflect an earlier shape, see caveats):
  <https://github.com/Universal-Commerce-Protocol/ucp-schema>
- Shippo Rate object fields:
  <https://github.com/goshippo/shippo-javascript-sdk/blob/main/docs/models/components/rate.md>,
  <https://docs.goshippo.com/api-reference/rates/retrieve-a-rate>

## Honest caveats

- **UCP is young and moving.** The fulfillment extension carries version
  `2026-04-08`. Treat the shape as a moving target and re-verify against the
  spec before shipping.
- **The spec and its own schema validator disagree on the fulfillment shape.**
  The current spec markdown documents the nested
  `fulfillment.methods[].groups[].options[]` shape used here. The `ucp-schema`
  validator's committed fixture (`valid-fulfillment-response.json`, version
  `2026-01-11`) still uses an older, flatter shape:
  `fulfillment.type`, `fulfillment.options[]` with a scalar `amount` and a
  structured `estimated_days: { min, max }`, and `fulfillment.selected`. This
  reference builds to the **newer, documented spec**. If you validate against
  the older fixture schema it will not match. This drift is the clearest signal
  of the protocol's maturity.
- **Timing on the base option is structured, derived, and not a guarantee.**
  The current fulfillment option defines first-class `carrier`,
  `earliest_fulfillment_time`, and `latest_fulfillment_time` fields
  (`fulfillment_option.json`), and this adapter maps all three: `carrier` from
  the rate `provider`, and the two timestamps derived deterministically from
  the rate's single `estimated_days` point estimate (`shipmentDate` +
  `estimated_days` calendar days, plus `deliveryWindowDays` for the latest).
  Because Shippo returns one integer, not a window, `earliest` and `latest` are
  equal by default; pass `deliveryWindowDays` to widen. The math is calendar
  days in UTC, not carrier business days, so treat the timestamps as
  day-granular estimates, not delivery guarantees. `description.plain` still
  carries the human-readable phrase for direct rendering, and the raw integer
  `estimated_days` is preserved in the `com.shippo.shipping.rate_detail`
  annotation.
- **The open-annotation key convention is inferred, not spelled out.** The spec
  states the option "is open, so a business MAY annotate it with additional
  fields," and core concepts require reverse-domain naming for collision-safe
  identifiers, but the spec does not show a worked example of the exact key at
  which a vendor object hangs. We chose to nest the object under the
  reverse-domain key `com.shippo.shipping.rate_detail` on the option, which is
  consistent with UCP's provenance rules. Confirm the placement convention with
  the UCP maintainers before relying on it in production.
- **Schema field names in `rate_detail.schema.json` are Shippo's, not UCP's.**
  The base option fields UCP itself defines (`id`, `title`, `description`,
  `carrier`, `earliest_fulfillment_time`, `latest_fulfillment_time`, `totals`,
  and the group's `selected_option_id`) are the standard contract. Everything
  under the annotation key is defined by this reference and is subject to change.
- **Money precision.** Amounts are converted to integer minor units using ISO
  4217 exponents. The lookup table covers common zero- and three-decimal
  currencies and defaults to 2; extend `MINOR_UNIT_EXPONENT` if you ship
  currencies outside it.
- **Single-group, single-method by default.** The mapper emits one `shipping`
  method with one group (the UCP default when a platform has not opted into
  `supports_multi_group`). Split-package and split-destination scenarios (which
  the spec supports) are out of scope for this reference.
- **This is a reference adapter, not a Shippo product.** It does not call the
  Shippo API, purchase labels, or handle test-mode vs live credentials. Wire it
  to your own Shippo integration to fetch rates and, on selection, create the
  Transaction from `rate_detail.rate_id`.
