// @ts-check
'use strict';

// Run with: node --test examples/acp-fulfillment/shippo-to-acp.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rateToFulfillmentOption,
  ratesToFulfillmentOptions,
  toMinorUnits,
  currencyExponent,
} = require('./shippo-to-acp');

const SHIP_DATE = '2026-07-10T16:00:00.000Z';

function sampleRate(overrides = {}) {
  return {
    object_id: 'rate_test_0000000000000000000000001',
    amount: '5.50',
    currency: 'USD',
    provider: 'USPS',
    servicelevel: { name: 'Priority Mail', token: 'usps_priority', terms: '' },
    estimated_days: 2,
    duration_terms: 'Delivery in 1 to 3 business days.',
    ...overrides,
  };
}

test('toMinorUnits converts decimal strings without float drift', () => {
  assert.equal(toMinorUnits('5.50', 'USD'), 550);
  assert.equal(toMinorUnits('5.5', 'USD'), 550);
  assert.equal(toMinorUnits('5', 'USD'), 500);
  assert.equal(toMinorUnits('0.05', 'USD'), 5);
  assert.equal(toMinorUnits('19.99', 'usd'), 1999);
  // Classic float trap: 0.29 * 100 = 28.999999999999996.
  assert.equal(toMinorUnits('0.29', 'USD'), 29);
});

test('toMinorUnits respects ISO 4217 minor-unit exponents', () => {
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('KWD'), 3);
  assert.equal(toMinorUnits('500', 'JPY'), 500);
  assert.equal(toMinorUnits('1.250', 'KWD'), 1250);
  // Trailing zeros beyond the exponent are fine; nonzero digits are not.
  assert.equal(toMinorUnits('5.500', 'USD'), 550);
  assert.throws(() => toMinorUnits('5.505', 'USD'), RangeError);
  assert.throws(() => toMinorUnits('1.5', 'JPY'), RangeError);
});

test('toMinorUnits rejects malformed amounts', () => {
  assert.throws(() => toMinorUnits('-5.50', 'USD'), TypeError);
  assert.throws(() => toMinorUnits('5,50', 'USD'), TypeError);
  assert.throws(() => toMinorUnits('', 'USD'), TypeError);
  // @ts-expect-error deliberate wrong type
  assert.throws(() => toMinorUnits(5.5, 'USD'), TypeError);
});

test('rateToFulfillmentOption emits the 2026-04-17 shape by default', () => {
  const option = rateToFulfillmentOption(sampleRate(), { shipmentDate: SHIP_DATE });
  assert.deepEqual(option, {
    type: 'shipping',
    id: 'rate_test_0000000000000000000000001',
    title: 'Priority Mail',
    description: 'Delivery in 1 to 3 business days.',
    carrier: 'USPS',
    earliest_delivery_time: '2026-07-12T16:00:00.000Z',
    latest_delivery_time: '2026-07-12T16:00:00.000Z',
    totals: [{ type: 'total', display_text: 'Shipping', amount: 550 }],
  });
});

test('rateToFulfillmentOption emits the 2025-09-29 shape on request', () => {
  const option = rateToFulfillmentOption(sampleRate(), {
    specVersion: '2025-09-29',
    shipmentDate: SHIP_DATE,
    deliveryWindowDays: 2,
  });
  assert.deepEqual(option, {
    type: 'shipping',
    id: 'rate_test_0000000000000000000000001',
    title: 'Priority Mail',
    subtitle: 'Delivery in 1 to 3 business days.',
    carrier: 'USPS',
    earliest_delivery_time: '2026-07-12T16:00:00.000Z',
    latest_delivery_time: '2026-07-14T16:00:00.000Z',
    subtotal: 550,
    tax: 0,
    total: 550,
  });
});

test('deliveryWindowDays pads latest_delivery_time only', () => {
  const option = rateToFulfillmentOption(sampleRate(), {
    shipmentDate: SHIP_DATE,
    deliveryWindowDays: 3,
  });
  assert.equal(option.earliest_delivery_time, '2026-07-12T16:00:00.000Z');
  assert.equal(option.latest_delivery_time, '2026-07-15T16:00:00.000Z');
});

test('optional fields are omitted when Shippo does not populate them', () => {
  const option = rateToFulfillmentOption(
    sampleRate({ estimated_days: null, duration_terms: '' }),
    { shipmentDate: SHIP_DATE }
  );
  assert.ok(!('earliest_delivery_time' in option));
  assert.ok(!('latest_delivery_time' in option));
  assert.ok(!('description' in option));
  // Required 2026-04-17 fields are always present.
  assert.equal(option.type, 'shipping');
  assert.ok(option.id && option.title && Array.isArray(option.totals));
});

test('title falls back to the servicelevel token', () => {
  const option = rateToFulfillmentOption(
    sampleRate({ servicelevel: { token: 'usps_priority' } }),
    { shipmentDate: SHIP_DATE }
  );
  assert.equal(option.title, 'usps_priority');
});

test('rateToFulfillmentOption validates required inputs', () => {
  assert.throws(() => rateToFulfillmentOption(sampleRate({ object_id: '' })), TypeError);
  assert.throws(() => rateToFulfillmentOption(sampleRate({ servicelevel: {} })), TypeError);
  assert.throws(() => rateToFulfillmentOption(sampleRate({ estimated_days: 1.5 })), TypeError);
  // @ts-expect-error deliberate wrong type
  assert.throws(() => rateToFulfillmentOption(null), TypeError);
  assert.throws(
    () => rateToFulfillmentOption(sampleRate(), /** @type {any} */ ({ specVersion: '2024-01-01' })),
    RangeError
  );
});

test('ratesToFulfillmentOptions accepts a shipment, a results page, or an array', () => {
  const rates = [sampleRate(), sampleRate({ object_id: 'rate_test_0000000000000000000000002' })];
  const fromShipment = ratesToFulfillmentOptions({ rates }, { shipmentDate: SHIP_DATE });
  const fromPage = ratesToFulfillmentOptions({ results: rates }, { shipmentDate: SHIP_DATE });
  const fromArray = ratesToFulfillmentOptions(rates, { shipmentDate: SHIP_DATE });
  assert.deepEqual(fromShipment, fromPage);
  assert.deepEqual(fromShipment, fromArray);
  assert.equal(fromShipment.currency, 'USD');
  assert.equal(fromShipment.fulfillment_options.length, 2);
});

test('ratesToFulfillmentOptions rejects empty and mixed-currency inputs', () => {
  assert.throws(() => ratesToFulfillmentOptions([]), RangeError);
  assert.throws(
    () => ratesToFulfillmentOptions([sampleRate(), sampleRate({ currency: 'CAD' })]),
    RangeError
  );
  // @ts-expect-error deliberate wrong type
  assert.throws(() => ratesToFulfillmentOptions({}), TypeError);
});

test('output satisfies the spec required-field lists', () => {
  const rates = [sampleRate({ estimated_days: null, duration_terms: '', provider: '' })];
  const { fulfillment_options: [current] } = ratesToFulfillmentOptions(rates);
  // 2026-04-17 required: type, id, title, totals.
  for (const key of ['type', 'id', 'title', 'totals']) assert.ok(key in current, key);
  for (const total of current.totals) {
    for (const key of ['type', 'display_text', 'amount']) assert.ok(key in total, key);
    assert.ok(Number.isInteger(total.amount));
  }
  const { fulfillment_options: [legacy] } = ratesToFulfillmentOptions(rates, {
    specVersion: '2025-09-29',
  });
  // 2025-09-29 required: type, id, title, subtotal, tax, total.
  for (const key of ['type', 'id', 'title', 'subtotal', 'tax', 'total']) {
    assert.ok(key in legacy, key);
  }
});
