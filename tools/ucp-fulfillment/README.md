# @shippo/ucp-fulfillment

Map Shippo rates and tracking onto the [Universal Commerce Protocol](https://ucp.dev) (UCP) fulfillment extension and order capability. A library the merchant (the UCP Business) embeds; Shippo stays the shipping engine underneath.

Status: Phase 1 spike (AI-469). Pre-1.0, so the API can change. Pinned to UCP `2026-08-25`.

Requires Node 20.19 or later. Talks to the Shippo API at version `2018-02-08` or later; on older versions Shippo's `track_updated` webhook carries a Transaction rather than a Track. Pass the inbound request `headers` to the webhook builder and the library refuses such a payload with `ShippoApiVersionError`. That check runs ONLY when `headers` is passed, as the worker example below does; without them an old-version payload degrades to a `build_failed` skip instead of the clear error.

## Install and import

```
npm install @shippo/ucp-fulfillment
```

Two entries:

- `@shippo/ucp-fulfillment/core` is the mapping and the webhook builders. It imports nothing outside Node builtins, loads in about four milliseconds, and needs no Shippo SDK.
- `@shippo/ucp-fulfillment` adds `createShippoClient`. That path needs `shippo` installed, which is why `shippo` is an optional peer dependency rather than a hard one: merchants already pin the SDK, and two copies at two versions means two zod instances and cross-boundary `instanceof` failures.

## The four moments

### 1. Catalog: preview before there is a destination

```ts
import { catalogShippingMethod, normalizeRate } from '@shippo/ucp-fulfillment/core';

const method = catalogShippingMethod(rates.map(normalizeRate), {
  currency: 'USD',
  description: 'Ships from Chicago',
  available: true,
});
// -> { type: 'shipping', description: { plain: 'Ships from Chicago' },
//      availability: { available: true, status: 'in_stock' },
//      options: [cheapestBaseOption, fastestBaseOption] }
```

Advertise it: `ucpCapabilities({ exposeCatalog: true })`, which widens `extends` to the two catalog capabilities. Without that, a Platform never asks for catalog fulfillment and you never learn why.

### 2. Checkout create and update: the fulfillment container

```ts
import {
  buildShipmentRequestResult,
  buildShippingFulfillment,
  addressUndeliverableMessage,
} from '@shippo/ucp-fulfillment/core';
import { createShippoClient } from '@shippo/ucp-fulfillment';

const shippo = createShippoClient({ apiKeyHeader: process.env.SHIPPO_API_KEY });
const destination = request.fulfillment?.methods?.find((m) => m.type === 'shipping')?.destinations?.[0];

const shipment = buildShipmentRequestResult({
  from: WAREHOUSE,               // your origin, in Shippo shape
  to: destination,               // the UCP shipping destination, as sent
  parcels: packItems(cart),      // yours: dimensions and weights come from your catalog
  contact: { email: request.buyer?.email },
  metadata: `ucp:${checkoutId}`,
});
for (const warning of shipment.warnings) log.warn(warning);
const rates = await shippo.rates(shipment.request);

const { methods, skipped } = buildShippingFulfillment({
  currency: cart.currency,
  lineItemIds: cart.physicalLineItemIds,
  destinations: [destination],
  selectedDestinationId: destination.id ?? null,
  selectedOptionId: submitted?.selected_option_id ?? null,
  rates,
});
for (const entry of skipped) log.warn('rate skipped', entry.rate.objectId, entry.error.message);
```

`buildShipmentRequestResult` returns the same request `buildShipmentRequest` builds, plus the two warnings that otherwise surface only as an empty international rate list: `international_without_customs` when the shipment crosses a border with no customs declaration, and `destination_missing_phone_international` when it crosses a border with no destination phone. Both are prefixes on a longer sentence, so you can switch on the code and log the sentence. Internationality is only knowable when both ends are addresses, so a request built against stored Shippo address ids carries no warnings rather than a guess.

Both forms set Shippo's inline `validate` flag on the destination by default, because an unvalidated destination is the most common cause of an empty rate list; pass `validateDestination: false` to turn it off. The origin is never re-validated, since it is your own address.

When `shippo.rates` throws `NoRatesError`, return the checkout unchanged with a recoverable message rather than an empty option list:

```ts
return { ...checkout, fulfillment: { methods }, messages: [addressUndeliverableMessage({ methodIndex: 0 })] };
```

When `buildShippingMethod` throws `SelectedDestinationUnknownError`, UCP requires you to return the checkout unchanged with `destinationRejectedMessage({ methodIndex, destinationId })`. Never substitute a different destination.

On an update, the option id the agent sends still resolves after a re-rate, because it is the service token rather than the rate object id:

```ts
import { matchSelectedOption, rateIdsByOptionId } from '@shippo/ucp-fulfillment/core';

const rate = matchSelectedOption(submitted.selected_option_id, freshRates, { currency: cart.currency });
await store.putRateIds(checkoutId, rateIdsByOptionId(freshRates, { currency: cart.currency }));
```

### 3. Order and label purchase: expectation plus the first event

```ts
import { buildExpectation, buildProcessingEvent, appendFulfillmentEvent, orderResponseUcp } from '@shippo/ucp-fulfillment/core';

const transaction = await sdk.transactions.create({ rate: rate.objectId, metadata: `ucp:${orderId}` });

const expectation = buildExpectation({
  id: `exp_${group.id}`,
  lineItems: group.lineItems,
  destination: method.destinations[0],   // id and type are stripped for you
  option: group.options.find((o) => o.id === group.selected_option_id),
  fulfillableOn: 'now',
});
const processing = buildProcessingEvent(transaction, {
  lineItems: group.lineItems,
  carrier: shipment.carrierToken,   // lowercase Shippo token, e.g. 'ups' or 'dhl_express'
});
const order = appendFulfillmentEvent(
  { ...draftOrder, ucp: orderResponseUcp(), fulfillment: { expectations: [expectation], events: [] } },
  processing,
);
```

`carrier` is the lowercase Shippo carrier TOKEN, not `rate.provider`. `provider` is a display name ("DHL Express", "Deutsche Post DHL"), and passing it yields no built-in URL and a Shippo tracking page path Shippo does not serve. Take the token from the carrier account you rated against, or from `track.carrier` once the first `track_updated` arrives.

Store `transaction.trackingUrlProvider` now. It is the one moment Shippo's own tracking URL is guaranteed to be in hand, and it outranks the built-in carrier table on every later event.

Label purchase goes through the Shippo SDK directly rather than through `createShippoClient`, which exposes only `rates`, `ratesInCurrency` and `track`. That is deliberate: the library never spends your money.

### 4. Tracking: Shippo's webhook drives the UCP order webhook

```ts
import express from 'express';
import { handleShippoTrackWebhook } from '@shippo/ucp-fulfillment/core';

app.post('/webhooks/shippo', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await queue.publish({ body: req.body.toString('utf8'), headers: req.headers });
  } catch (error) {
    log.error(error);
    return res.sendStatus(500);                          // Shippo retries a 5xx; it never retries a 202
  }
  res.sendStatus(202);                                   // ack inside Shippo's three second budget
});

// worker
const secret = process.env.SHIPPO_WEBHOOK_SECRET;
if (!secret) throw new Error('SHIPPO_WEBHOOK_SECRET is required');

const result = await handleShippoTrackWebhook(job.body, {
  trust: { mode: 'hmac', secret, signatureHeader: job.headers['shippo-auth-signature'] },
  headers: job.headers,                                  // the API-version check runs only with these
  resolveOrder: async (track) => {
    const row = await store.findShipment({
      transactionId: track.transaction,                   // preferred join key
      carrier: track.carrier, trackingNumber: track.trackingNumber,  // fallback PAIR
    });
    if (!row) return undefined;
    return {
      order: await store.getOrder(row.orderId),
      lineItems: row.lineItems,
      transaction: { trackingUrlProvider: row.trackingUrlProvider },
    };
  },
  webhookUrl: platformProfile.capabilities['dev.ucp.shopping.order'][0].config.webhook_url,
  businessProfileUrl: 'https://merchant.example/.well-known/ucp',
  sign: rfc9421Signer({ privateKey: SIGNING_KEY, keyid: 'merchant-2026' }),
});

if (result.handled) {
  await store.putOrder(result.order);                     // the snapshot that was posted
  for (const warning of result.warnings) log.warn(warning);
} else {
  log.info('shippo webhook skipped', result.reason);
}
```

Wiring notes that are easy to get wrong:

- Key `resolveOrder` on `track.transaction` first, with `(carrier, tracking_number)` as the fallback PAIR. A tracking number alone is unique per carrier, not globally, and carriers reuse numbers.
- Set `metadata` on the Transaction at purchase so the join key travels with the shipment.
- Pass the RAW body string. Shippo's HMAC covers `${timestamp}.${rawBody}`; once the body has been through `JSON.parse` the exact bytes are gone.
- `trust` is required. Shippo documents three mechanisms: an inbound IP allowlist, a self-generated URL query token, and HMAC. Use `{ mode: 'hmac', secret, signatureHeader }` when you have a secret (Shippo support issues it, which can take up to ten business days), `{ mode: 'url_token', expected, received }` for the query token, and `{ mode: 'caller_verified', attestation: 'I verified this request came from Shippo' }` when you checked the IP allowlist yourself.
- Handle the skip reasons: `not_track_updated`, `test_mode`, `no_order`, `duplicate_event`, `stale_event`, `build_failed`. All six mean "answer 2xx and log"; none of them is a retry.

## Who owns what

| Piece | Owner | Why |
| --- | --- | --- |
| UCP destination to Shippo address | Library (`toShippoAddress`) | Two schemas that name nothing the same way, with fixed traps |
| Cart items to parcels | Merchant | Dimensions, weights and packing are your catalog |
| Creating the shipment, choosing carrier accounts | Merchant (`buildShipmentRequest` shapes it) | Insurance, signature and account filtering are your policy |
| Which items go in which package | Merchant | Business logic |
| Rates to `fulfillment_option[]` | Library | Pure mapping |
| Method, group, destination echo | Library (`buildShippingFulfillment`) | UCP shape assembly with required-field traps |
| Order created webhook | Merchant | This library builds fulfillment event webhooks only |
| Rolling the selected option into checkout totals | Merchant | Your pricing |
| Buying the label | Merchant | The library never spends your money |
| Expectation and the processing event | Library | Pure mapping over objects it already understands |
| Tracking to `fulfillment_event` | Library | Pure mapping |
| Signing the outbound UCP webhook | Merchant (`sign` hook) | Your private key never enters this process |
| Retry and backoff on delivery | Merchant | The library throws a typed, classified error instead |

## Design decisions, pinned in tests

1. **Delivery window.** Ship on the first business day on or after now; `earliest_fulfillment_time` is that plus `estimated_days` in CALENDAR days by default, because Shippo documents `estimated_days` only as a carrier average and USPS, UPS and FedEx all deliver at weekends. `transitDayBasis: 'business'` opts into the conservative reading. The latest bound adds a buffer in the same basis: 0 when `arrives_by` is present or the estimate is one day or less, 2 otherwise, and `bufferBusinessDays` takes a number or a function of the rate. The earliest bound is clamped so it is never in the past, and `destinationUtcOffsetMinutes` shifts day boundaries into the buyer's day. UCP does not say whether these fields mean handoff or arrival; this library reads them as the buyer's ARRIVAL window, which matches how options are rendered. `arrives_by` is a local time of day with no zone, so it appears only in the description.
2. **Status map.** `PRE_TRANSIT` and `UNKNOWN` are `processing`; `TRANSIT` with `package_accepted` is `shipped`; `TRANSIT` with any of the nine stalled or action-required substatuses, or with `action_required: true`, is `failed_attempt`; other `TRANSIT` is `in_transit`; `DELIVERED` is `delivered`; `RETURNED` with `package_unclaimed` is `failed_attempt` and other `RETURNED` is `returned_to_sender`; `FAILURE` is `undeliverable`. Anything outside those six statuses throws `UnmappedTrackingStatusError` instead of guessing. `returned_to_sender` means the carrier has BEGUN returning the parcel, not that it is back in your warehouse; physical receipt is your own event to record. Events are stored in `occurred_at` order, and a non-terminal event older than a recorded terminal one is dropped and reported as `stale_event`.
3. **Tracking URL.** Precedence: explicit option, then the transaction's `tracking_url_provider`, then a `trackingUrlTemplates` entry, then your Shippo tracking page (`shippoTrackingUserId`), then the built-in table for USPS, UPS, FedEx and DHL Express. UCP requires `tracking_url` past `processing` in the field DESCRIPTION only; there is no `if`/`then` in `fulfillment_event.json`, so schema validation will not catch a missing URL. The library therefore omits the field and names the omission in `warnings`, and throws only when you pass `requireTrackingUrl: true`. Every tracking warning leads with a stable code, `tracking_url_omitted:`, `tracking_number_missing:` and `occurred_at_fallback:`, so you switch on the prefix and log the sentence, exactly as with `SHIPMENT_WARNINGS`. The built-in table is a dated fallback; `scripts/check-tracking-urls.ts` re-checks it by hand.
4. **Line items.** You supply `{ id, quantity }` pairs; Shippo does not know them. `quantity` counts STEPS of the order line's `item.quantity_unit`, which is whole items only when that unit is absent: for a line sold by weight at scale 2, `quantity: 250` means 2.50 units. References are reconciled against the order and a mismatch throws. Because `appendFulfillmentEvent` derives each line's `quantity.fulfilled` as the maximum across fulfilling events rather than a sum, so that one parcel's shipped, in_transit and delivered sequence counts once, a line genuinely split across two parcels settles at the larger parcel's quantity and stays `partial`; pass `fulfilledResolver` to substitute your own cumulative count when you split a line across parcels.
5. **Option identity.** `fulfillment_option.id` is `servicelevel.extended_token ?? token ?? slug(provider)`, never `rate.object_id`, because UCP references options by id across checkout updates and from catalog into checkout while a rate object id is minted per shipment and expires in seven days. Options are deduplicated by option id keeping the cheapest, so two carrier accounts on one service produce one option. `rateIdsByOptionId` and `matchSelectedOption` map an id back to the rate to purchase. `isRateExpired(rate)` and `RATE_MAX_AGE_MS` are the check for that seven day window, which a checkout left open longer than a Shippo rate lives will otherwise hit only at purchase.
6. **Pricing.** Options are priced at the Shippo rate with NO MARKUP. `amountSource` defaults to `'auto'`: the `(amount, currency)` or `(amount_local, currency_local)` pair whose currency matches the checkout, preferring `amount` when both match, and `CurrencyMismatchError` when neither does. This library never converts currency; `ratesInCurrency` re-requests rates from Shippo instead. `adjustAmount(rate, minorUnits)` is the hook if you mark shipping up.

Money is converted with exact BigInt digit arithmetic, rounding half away from zero, against the full ISO 4217 exponent table. An unknown currency throws rather than assuming two decimals, because a wrong exponent is a silent factor-of-100 error that nothing downstream can detect.

## Errors

Every error this library throws extends `UcpFulfillmentError` and carries `retryable`. No error class from a dependency and no bare built-in escapes the public API.

```ts
import { UcpFulfillmentError } from '@shippo/ucp-fulfillment/core';

try {
  await handleShippoTrackWebhook(body, options);
} catch (error) {
  if (error instanceof UcpFulfillmentError && !error.retryable) {
    log.error(error);
    return res.sendStatus(200);   // permanent: acknowledge so the sender stops redelivering
  }
  throw error;                    // transient: answer 5xx and let it redeliver
}
```

`retryable` is false for every error except `OrderEventDeliveryError`, which is retryable exactly for HTTP 408, 429 and 5xx.

## Retry policy

UCP makes retry a Business obligation, and this library deliberately does not retry: `sendOrderEvent` throws `OrderEventDeliveryError` with the status so your queue owns backoff and dead-lettering. Retry by calling `sendOrderEvent` again with the SAME `OrderEventRequest`. That preserves `Webhook-Id` and `Content-Digest`, so the Platform's Standard Webhooks deduplication can collapse the attempts. Building a fresh request would mint the same `Webhook-Id` anyway, because it is a deterministic UUID of the event id, but reusing the request also preserves the exact body the digest covers. The POST times out after 10 seconds by default (`timeoutMs`), and honours a caller `signal`.

## Signer contract

`sendOrderEvent` refuses to transmit without a `sign` hook unless you pass `allowUnsigned: true`, which is for a local test receiver only. Your signer receives `{ url, method, headers, body }` and returns the RFC 9421 headers. It must:

- cover `@method`, `@authority`, `@path`, and `@query` when a query string is present;
- cover `ucp-agent`, `content-digest` and `content-type`, all three of which are on the request already. UCP's verifier requires `ucp-agent` coverage whenever the header is present, and rejects the signature as `coverage_insufficient` otherwise;
- use `keyid` equal to the RFC 7638 JWK thumbprint of your signing key;
- emit ECDSA signatures as raw `r || s`, not DER.

The library never fakes a signature, and it builds five headers itself: `Content-Type`, `Content-Digest`, `Webhook-Id`, `Webhook-Timestamp` and `UCP-Agent`. A signer may add ONLY `Signature` and `Signature-Input`. Returning any of those five raises `SignerConflictError`, matched case-insensitively and whatever the value, because the digest must cover the exact body and headers being sent and because HTTP header names are case-insensitive on the wire: undici merges a differently-cased duplicate into the same outgoing header rather than rejecting it, so a lowercase `content-digest` from a signer would otherwise slip past a name-exact check.

## Data handling

Every order event posts the FULL order snapshot, which the UCP order capability requires ("MUST send full order entity on updates"). That means each event transmits `fulfillment.expectations[].destination`, a complete postal address, and `line_items`, which reveal what was purchased.

Two guards are built in, and neither of them reduces the number of scans you post. Duplicate suppression collapses REDELIVERIES of the same carrier scan, since each Shippo `track_updated` carries its own `tracking_status.object_id` and each distinct scan therefore gets its own event id. The stale guard drops a non-terminal event that arrives after a terminal one. Every accepted scan still posts a full order snapshot including the buyer's address, so three successive in-transit scans are three posts. UCP tells Platforms to treat order data as ephemeral; that is a contract, not an enforcement, so send only the lines a Platform needs and consider trimming expectations you do not need it to render.

## Export notes

Most builders come in a pair, and the `Result` form is the reporting one: `buildFulfillmentOption` / `buildFulfillmentOptionsResult`, `buildShipmentRequest` / `buildShipmentRequestResult`, `buildFulfillmentEvent` / `buildFulfillmentEventResult`, `buildFulfillmentEvents` / `buildFulfillmentEventsResult`. The bare form throws on the first thing it cannot map; the `Result` form returns what it built alongside the judgment calls it made, which is why the webhook path uses it and why nothing is dropped in silence. `buildFulfillmentEventsResult` deduplicates warnings across a whole tracking history, so a carrier with no resolvable tracking URL reports the omission once rather than once per scan.

`buildShippingFulfillment` is the one exception to that naming. It returns `{ methods, skipped }`, which is Result-shaped, without the `Result` suffix, and it has no bare counterpart. Renaming it is not worth the churn before 1.0, so the exception is recorded here rather than fixed.

## Two notes on scope

**Rates at Checkout.** Shippo's checkout-shaped API is the wrong primitive for this seam despite the name. `LiveRate` has no `object_id`, so there is nothing to put in `fulfillment_option.id`, nothing for `selected_option_id` to reference, and no way to turn a selection into a purchasable rate. `shipments.create` with `async: false` is the seam that round-trips, and it is what `buildShipmentRequest` produces.

**API keys.** This package is a library that calls the Shippo REST API with an API key. It is not a client of the hosted MCP server at `mcp.shippo.com`. The OAuth-only rule in `CODE_REVIEW.md` governs canonical skill content describing that hosted server and does not apply here.

## What it does not do

It does not sign AP2 mandates, does not buy labels, does not hold PII or transaction liability, does not retry deliveries, and does not convert currency. You trigger label purchase, you supply the trust check on Shippo's webhook, and you sign the outbound UCP webhook.

## Develop

```
npm install
npm test
npm run typecheck
npm run build
npm run example
npm run gen:types    # regenerate src/generated/ucp.ts from schemas/
```

UCP schemas under `schemas/ucp/2026-08-25` are copied verbatim from the UCP repository at tag `v2026-08-25` (Apache-2.0, see the NOTICE there). They are used for type generation and tests only and are not published, which keeps the published tarball single-license MIT.
