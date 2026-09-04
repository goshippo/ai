/**
 * The four moments a merchant integrates, end to end over the test fixtures. No network: the
 * rates and the tracking payload come from test/fixtures and the platform is a recording double.
 * Every payload is validated against the vendored UCP schemas as it is produced, so this file
 * doubles as the integration test the unit suite cannot express.
 *
 *   npm run example
 */
import { readFileSync } from 'node:fs';
import {
  addressUndeliverableMessage,
  appendFulfillmentEvent,
  buildExpectation,
  buildProcessingEvent,
  buildShipmentRequestResult,
  buildShippingFulfillment,
  buildTrackWebhookRequest,
  catalogShippingMethod,
  matchSelectedOption,
  normalizeRate,
  orderResponseUcp,
  rateIdsByOptionId,
  ucpCapabilities,
  type FetchLike,
  type Order,
} from '../src/index.ts';
import { validateUcp, SCHEMA_IDS } from '../test/helpers/ucp-validator.ts';

const NOW = new Date('2026-09-03T15:00:00Z');
const CURRENCY = 'USD';
const PROFILE = 'https://merchant.example/.well-known/ucp';
const WEBHOOK_URL = 'https://platform.example/webhooks/ucp/orders';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8'));
const rates = ['rate.usps_priority.json', 'rate.ups_next_day.json'].map((name) => normalizeRate(load(name)));
const banner = (title: string) => console.log(`\n=== ${title} ===`);
const show = (value: unknown) => console.log(JSON.stringify(value, null, 2));

banner('0. Profile: what the merchant advertises at /.well-known/ucp');
// exposeCatalog is on because this example also serves catalog previews below.
const capabilities = ucpCapabilities({ exposeCatalog: true });
for (const entries of Object.values(capabilities)) {
  for (const entry of entries) validateUcp(SCHEMA_IDS.capabilityBusiness, entry);
}
show({ ucp: { version: '2026-08-25', capabilities } });

banner('1. Catalog: boundary options before there is a destination or a cart');
const catalogMethod = catalogShippingMethod(rates, {
  currency: CURRENCY,
  description: 'Ships from Chicago',
  available: true,
});
validateUcp(SCHEMA_IDS.catalogFulfillmentMethod, catalogMethod);
show(catalogMethod);

banner('2. Checkout create: the platform sends a destination, we send back the fulfillment container');
const DESTINATION = {
  street_address: '123 Main St',
  address_locality: 'Springfield',
  address_region: 'IL',
  postal_code: '62701',
  address_country: 'US',
  first_name: 'Ada',
  last_name: 'Lovelace',
};
const WAREHOUSE = {
  name: 'Shippo Warehouse',
  street1: '731 Market St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94103',
  country: 'US',
  phone: '+14155551212',
};
// The Result form, so a border crossing with no customs declaration is named rather than
// discovered later as an empty rate list. In a real integration this request goes to
// shippo.rates(); here the fixture rates stand in for the response.
const shipment = buildShipmentRequestResult({
  from: WAREHOUSE,
  to: DESTINATION,
  parcels: [{ massUnit: 'lb', weight: '1.5', distanceUnit: 'in', height: '4', length: '10', width: '8' }],
  metadata: 'ucp:chk_123',
});
show(shipment.request);
console.log('shipment warnings:', shipment.warnings.length ? shipment.warnings : '(none)');

const { methods, skipped } = buildShippingFulfillment({
  currency: CURRENCY,
  now: NOW,
  lineItemIds: ['li_shirt'],
  destinations: [DESTINATION],
  rates,
});
validateUcp(SCHEMA_IDS.fulfillmentMethod, methods[0]);
show({ fulfillment: { methods } });
if (skipped.length) console.log('skipped rates:', skipped.map((entry) => entry.error.message));
if (methods[0].groups[0].options?.length === 0) {
  show(addressUndeliverableMessage({ methodIndex: 0 }));
}

banner('3. Checkout update: the agent picks an option, and the id survives a re-rate');
const chosen = 'usps_priority';
const reRated = rates.map((rate) => ({ ...rate, objectId: `${rate.objectId}_regenerated` }));
const purchasable = matchSelectedOption(chosen, reRated, { currency: CURRENCY, now: NOW });
console.log('selected option id :', chosen);
console.log('rate to purchase   :', purchasable?.objectId);
console.log('option id to rate  :', rateIdsByOptionId(reRated, { currency: CURRENCY, now: NOW }));

banner('4a. Order: the buyer-facing expectation and the post-purchase processing event');
const order = load('order.valid.json') as Order;
order.ucp = orderResponseUcp();
const expectation = buildExpectation({
  id: 'exp_package_1',
  lineItems: [{ id: 'li_shirt', quantity: 2 }],
  destination: methods[0].destinations[0],
  option: methods[0].groups[0].options?.find((option) => option.id === chosen),
  fulfillableOn: 'now',
});
validateUcp(SCHEMA_IDS.expectation, expectation);
const processing = buildProcessingEvent(
  {
    objectId: 'txn_usps_1',
    trackingNumber: '9205590164917312751089',
    trackingUrlProvider: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9205590164917312751089',
    objectCreated: '2026-09-03T16:00:00Z',
  },
  // A lowercase Shippo carrier TOKEN, never rate.provider, which is a display name.
  { lineItems: [{ id: 'li_shirt', quantity: 2 }], carrier: 'usps' },
);
validateUcp(SCHEMA_IDS.strictFulfillmentEvent, processing);
const placed = appendFulfillmentEvent({ ...order, fulfillment: { expectations: [expectation], events: [] } }, processing);
validateUcp(SCHEMA_IDS.order, placed);
show(placed);

banner('4b. Tracking: a Shippo track_updated webhook becomes a signed order event request');
const posted: Array<{ url: string; headers: Record<string, string> }> = [];
const recordingFetch: FetchLike = async (url, init) => {
  posted.push({ url, headers: init.headers });
  return { ok: true, status: 200, text: async () => '' };
};
void recordingFetch;
const plan = await buildTrackWebhookRequest(
  readFileSync(new URL('../test/fixtures/track_updated.accepted.json', import.meta.url), 'utf8'),
  {
    trust: { mode: 'caller_verified', attestation: 'I verified this request came from Shippo' },
    allowTestMode: true,
    resolveOrder: () => ({
      order: placed,
      lineItems: [{ id: 'li_shirt', quantity: 2 }],
      transaction: { trackingUrlProvider: 'https://www.ups.com/track?tracknum=1Z999AA10123456784' },
    }),
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  },
);
if (!plan.handled) throw new Error(`the example webhook was not handled: ${plan.reason}`);
validateUcp(SCHEMA_IDS.strictFulfillmentEvent, plan.event);
validateUcp(SCHEMA_IDS.order, JSON.parse(plan.request.body));
show({ event: plan.event, warnings: plan.warnings, headers: plan.request.headers });

console.log('\nEvery payload above validated against the vendored UCP 2026-08-25 schemas.');
