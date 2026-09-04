import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUcp,
  assertOnlyKnownKeys,
  SCHEMA_IDS,
  STRICT_FULFILLMENT_EVENT,
  FULFILLMENT_EVENT_TYPE_VALUES,
} from './helpers/ucp-validator.ts';

const VALID_EVENT = {
  id: 'evt_1',
  occurred_at: '2026-09-03T15:00:00Z',
  type: 'shipped',
  line_items: [{ id: 'li_1', quantity: 1 }],
  tracking_number: '9400111899223197428490',
  tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490',
  carrier: 'USPS',
};

test('the spec example fulfillment_option validates', () => {
  validateUcp(SCHEMA_IDS.fulfillmentOption, {
    id: 'standard',
    title: 'Standard Shipping',
    description: { plain: 'Arrives Dec 12-15 via USPS' },
    totals: [{ type: 'total', amount: 500 }],
  });
});

test('a fulfillment_option without totals is rejected', () => {
  assert.throws(() => validateUcp(SCHEMA_IDS.fulfillmentOption, { id: 'x', title: 'X' }), /totals/);
});

test('a fulfillment_event needs id, occurred_at, type and line_items', () => {
  assert.throws(() => validateUcp(SCHEMA_IDS.fulfillmentEvent, { type: 'shipped' }), /required/);
  validateUcp(SCHEMA_IDS.fulfillmentEvent, VALID_EVENT);
});

test('the vendored event schema really is too loose on its own, which is why the overlay exists', () => {
  // Each of these passes the vendored schema. If any of them ever starts failing, UCP has
  // tightened fulfillment_event.json and the overlay below can be reconsidered.
  validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, type: 'totally_bogus' });
  validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, line_items: [] });
  const noUrl = { ...VALID_EVENT };
  delete (noUrl as Record<string, unknown>).tracking_url;
  delete (noUrl as Record<string, unknown>).tracking_number;
  validateUcp(SCHEMA_IDS.fulfillmentEvent, noUrl);
});

test('the strict overlay catches what the vendored schema cannot', () => {
  validateUcp(SCHEMA_IDS.strictFulfillmentEvent, VALID_EVENT);
  assert.throws(
    () => validateUcp(SCHEMA_IDS.strictFulfillmentEvent, { ...VALID_EVENT, type: 'totally_bogus' }),
    /enum/,
  );
  assert.throws(
    () => validateUcp(SCHEMA_IDS.strictFulfillmentEvent, { ...VALID_EVENT, line_items: [] }),
    /minItems/,
  );
  const noUrl = { ...VALID_EVENT };
  delete (noUrl as Record<string, unknown>).tracking_url;
  assert.throws(() => validateUcp(SCHEMA_IDS.strictFulfillmentEvent, noUrl), /tracking_url/);
});

test('the overlay still allows a processing event with no tracking fields', () => {
  validateUcp(SCHEMA_IDS.strictFulfillmentEvent, {
    id: 'evt_0',
    occurred_at: '2026-09-03T15:00:00Z',
    type: 'processing',
    line_items: [{ id: 'li_1', quantity: 1 }],
    carrier: 'Deutsche Post',
  });
});

test('the overlay enumerates exactly the eight types the library emits', () => {
  assert.deepEqual(
    [...FULFILLMENT_EVENT_TYPE_VALUES],
    [
      'processing',
      'shipped',
      'in_transit',
      'delivered',
      'failed_attempt',
      'canceled',
      'undeliverable',
      'returned_to_sender',
    ],
  );
  const overlayEnum = (STRICT_FULFILLMENT_EVENT.allOf[1] as { properties: { type: { enum: string[] } } })
    .properties.type.enum;
  assert.deepEqual(overlayEnum, [...FULFILLMENT_EVENT_TYPE_VALUES]);
  for (const type of FULFILLMENT_EVENT_TYPE_VALUES) {
    validateUcp(SCHEMA_IDS.strictFulfillmentEvent, { ...VALID_EVENT, type });
  }
});

test('formats are enforced, so a bad URL or timestamp is rejected', () => {
  // The uri format keyword is what catches a tracking_url that is not a URL. Without ajv-formats
  // registered, Ajv ignores `format` entirely and every string below would validate.
  for (const badUrl of ['not a url', 'not a url at all', 'merchant.example/track', '']) {
    assert.throws(
      () => validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, tracking_url: badUrl }),
      /"format": "uri"/,
      JSON.stringify(badUrl),
    );
  }
  assert.doesNotThrow(() =>
    validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, tracking_url: 'https://merchant.example/t/1' }),
  );
  assert.throws(
    () => validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, occurred_at: 'yesterday' }),
    /"format": "date-time"/,
  );
});

test('line item quantities must be integers of at least one step', () => {
  assert.throws(
    () => validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, line_items: [{ id: 'l', quantity: 0 }] }),
    />= 1/,
  );
  assert.throws(
    () => validateUcp(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, line_items: [{ id: 'l', quantity: 1.5 }] }),
    /integer/,
  );
});

test('a fragment schema id compiles and validates', () => {
  validateUcp(SCHEMA_IDS.capabilityBusiness, {
    version: '2026-08-25',
    schema: 'https://ucp.dev/2026-08-25/schemas/shopping/order.json',
  });
  assert.throws(() => validateUcp(SCHEMA_IDS.capabilityBusiness, { version: '2026-08-25' }), /schema/);
  // Compiled twice on purpose: the second call must come from the validator cache.
  validateUcp(SCHEMA_IDS.capabilityBusiness, {
    version: '2026-08-25',
    schema: 'https://ucp.dev/2026-08-25/schemas/shopping/order.json',
    extends: ['dev.ucp.shopping.checkout'],
  });
});

test('assertOnlyKnownKeys closes the world the schemas leave open', () => {
  const option = {
    id: 'usps_priority',
    title: 'USPS Priority Mail',
    description: { plain: 'Arrives in about 2 days' },
    carrier: 'USPS',
    earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
    totals: [{ type: 'total', amount: 835 }],
  };
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentOption, option);
  // Ajv accepts the typo because the schema is open; the key check does not.
  validateUcp(SCHEMA_IDS.fulfillmentOption, { ...option, earliest_fulfilment_time: 'x' });
  assert.throws(
    () => assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentOption, { ...option, earliest_fulfilment_time: 'x' }),
    /earliest_fulfilment_time/,
  );
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentEvent, VALID_EVENT);
  assert.throws(
    () => assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentEvent, { ...VALID_EVENT, tracking_numbr: '1' }),
    /tracking_numbr/,
  );
});

test('assertOnlyKnownKeys resolves keys through $ref and allOf', () => {
  // fulfillment_option composes fulfillment_option_base by allOf + $ref: id and title come
  // from the base, totals and carrier from the checkout branch.
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentOption, { id: 'a', title: 'b', totals: [], carrier: 'c' });
  // shipping_destination composes postal_address the same way.
  assertOnlyKnownKeys(SCHEMA_IDS.shippingDestination, {
    id: 'dest_1',
    type: 'shipping_address',
    street_address: '123 Main St',
    address_locality: 'Springfield',
    address_region: 'IL',
    postal_code: '62701',
    address_country: 'US',
  });
  assert.throws(
    () => assertOnlyKnownKeys(SCHEMA_IDS.shippingDestination, { id: 'd', type: 'shipping_address', line_1: 'x' }),
    /line_1/,
  );
});
