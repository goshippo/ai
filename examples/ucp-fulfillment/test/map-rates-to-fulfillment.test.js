'use strict';

/**
 * Tests for the Shippo-rates -> UCP fulfillment mapper.
 * Dependency-free: uses Node's built-in test runner and assert.
 *
 *   node --test examples/ucp-fulfillment/test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  mapRatesToFulfillment,
  toMinorUnits,
  minorUnitExponent,
  RATE_DETAIL_KEY,
} = require('../src/map-rates-to-fulfillment');

const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'demo', 'sample-shippo-rates.json'), 'utf8')
);

test('toMinorUnits converts USD decimal strings correctly', () => {
  assert.equal(toMinorUnits('5.50', 'USD'), 550);
  assert.equal(toMinorUnits('5.5', 'USD'), 550);
  assert.equal(toMinorUnits('28.75', 'USD'), 2875);
  assert.equal(toMinorUnits('0', 'USD'), 0);
  assert.equal(toMinorUnits('10', 'USD'), 1000);
});

test('toMinorUnits rounds half-up beyond currency precision', () => {
  assert.equal(toMinorUnits('1.005', 'USD'), 101);
  assert.equal(toMinorUnits('1.004', 'USD'), 100);
});

test('toMinorUnits respects zero-decimal and three-decimal currencies', () => {
  assert.equal(minorUnitExponent('JPY'), 0);
  assert.equal(minorUnitExponent('USD'), 2);
  assert.equal(minorUnitExponent('BHD'), 3);
  assert.equal(toMinorUnits('1200', 'JPY'), 1200);
  assert.equal(toMinorUnits('1.234', 'BHD'), 1234);
});

test('toMinorUnits rejects unparseable amounts', () => {
  assert.throws(() => toMinorUnits('not-money', 'USD'), TypeError);
});

test('mapper requires non-empty lineItemIds', () => {
  assert.throws(() => mapRatesToFulfillment(sample, {}), TypeError);
  assert.throws(() => mapRatesToFulfillment(sample, { lineItemIds: [] }), TypeError);
});

test('mapper produces a spec-shaped single shipping method with one group', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, {
    lineItemIds: ['li_a', 'li_b'],
  });
  assert.ok(Array.isArray(fulfillment.methods));
  assert.equal(fulfillment.methods.length, 1);

  const method = fulfillment.methods[0];
  assert.equal(method.type, 'shipping');
  assert.equal(method.id, 'shipping');
  assert.deepEqual(method.line_item_ids, ['li_a', 'li_b']);
  assert.equal(method.groups.length, 1);

  const group = method.groups[0];
  assert.equal(group.id, 'package_1');
  assert.deepEqual(group.line_item_ids, ['li_a', 'li_b']);
  assert.equal(group.options.length, 3);
});

test('each option carries base rendering fields exactly per spec', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, { lineItemIds: ['li_a'] });
  for (const opt of fulfillment.methods[0].groups[0].options) {
    assert.equal(typeof opt.id, 'string');
    assert.equal(typeof opt.title, 'string');
    assert.ok(opt.title.length > 0);
    // description is an object with a `plain` string, per the spec examples.
    assert.equal(typeof opt.description, 'object');
    assert.equal(typeof opt.description.plain, 'string');
    // totals is an array of {type, amount(minor units integer)}.
    assert.ok(Array.isArray(opt.totals));
    const total = opt.totals.find((t) => t.type === 'total');
    assert.ok(total, 'a total of type "total" is present');
    assert.equal(Number.isInteger(total.amount), true);
    // total carries no currency of its own (checkout root owns currency).
    assert.equal('currency' in total, false);
  }
});

test('option id equals the Shippo rate object_id, and totals are correct minor units', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, { lineItemIds: ['li_a'] });
  const opts = fulfillment.methods[0].groups[0].options;
  const priority = opts.find((o) => o.title === 'USPS Priority Mail');
  assert.equal(priority.id, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  assert.equal(priority.totals.find((t) => t.type === 'total').amount, 920);
});

test('description.plain folds in Shippo duration_terms and provider', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, { lineItemIds: ['li_a'] });
  const ground = fulfillment.methods[0].groups[0].options.find(
    (o) => o.title === 'USPS Ground Advantage'
  );
  assert.equal(ground.description.plain, 'Delivery in 2 to 5 business days via USPS');
});

test('com.shippo.shipping.rate_detail annotation carries purchase identifiers', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, { lineItemIds: ['li_a'] });
  const opt = fulfillment.methods[0].groups[0].options[0];
  const detail = opt[RATE_DETAIL_KEY];
  assert.ok(detail, 'annotation present under reverse-domain key');
  // Required by rate_detail.schema.json.
  assert.equal(typeof detail.rate_id, 'string');
  assert.equal(detail.rate_id, opt.id);
  assert.equal(typeof detail.carrier_account, 'string');
  assert.equal(typeof detail.servicelevel_token, 'string');
  // Structured transit estimate lives here (not in the base option).
  assert.equal(detail.estimated_days, 3);
  assert.deepEqual(detail.attributes, ['CHEAPEST', 'BESTVALUE']);
  assert.equal(detail.amount, '5.50');
  assert.equal(detail.currency, 'USD');
});

test('BESTVALUE rate is auto-selected when no explicit selection is given', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, { lineItemIds: ['li_a'] });
  const group = fulfillment.methods[0].groups[0];
  assert.equal(group.selected_option_id, '5c9a2be5f3f04c1e8c9b0f6a1d2e3f40');
});

test('explicit selectedRateId overrides attribute-based selection', () => {
  const { fulfillment } = mapRatesToFulfillment(sample, {
    lineItemIds: ['li_a'],
    selectedRateId: 'f0e1d2c3b4a5968778695a4b3c2d1e0f',
  });
  assert.equal(
    fulfillment.methods[0].groups[0].selected_option_id,
    'f0e1d2c3b4a5968778695a4b3c2d1e0f'
  );
});

test('destination is attached and marked selected when provided', () => {
  const destination = { id: 'dest_1', address_country: 'US', postal_code: '62701' };
  const { fulfillment } = mapRatesToFulfillment(sample, {
    lineItemIds: ['li_a'],
    destination,
  });
  const method = fulfillment.methods[0];
  assert.deepEqual(method.destinations, [destination]);
  assert.equal(method.selected_destination_id, 'dest_1');
});

test('currency mismatch rates are skipped with a warning', () => {
  const mixed = {
    results: [
      sample.results[0],
      { ...sample.results[1], currency: 'CAD', object_id: 'cad_rate' },
    ],
  };
  const { fulfillment, currency, warnings } = mapRatesToFulfillment(mixed, {
    lineItemIds: ['li_a'],
  });
  assert.equal(currency, 'USD');
  assert.equal(fulfillment.methods[0].groups[0].options.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Skipped rate cad_rate/);
});

test('empty rate set yields an empty method and a warning', () => {
  const { fulfillment, warnings } = mapRatesToFulfillment(
    { results: [] },
    { lineItemIds: ['li_a'] }
  );
  assert.equal(fulfillment.methods[0].groups[0].options.length, 0);
  assert.ok(warnings.some((w) => /No rates/.test(w)));
});

test('accepts a bare array of rates as well as a {results} envelope', () => {
  const { fulfillment } = mapRatesToFulfillment(sample.results, {
    lineItemIds: ['li_a'],
  });
  assert.equal(fulfillment.methods[0].groups[0].options.length, 3);
});
