import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUcp, SCHEMA_IDS } from './helpers/ucp-validator.ts';

test('the spec example fulfillment_option validates', () => {
  validateUcp(SCHEMA_IDS.fulfillmentOption, {
    id: 'standard',
    title: 'Standard Shipping',
    description: { plain: 'Arrives Dec 12-15 via USPS' },
    totals: [{ type: 'total', amount: 500 }],
  });
});

test('a fulfillment_option without totals is rejected', () => {
  assert.throws(
    () => validateUcp(SCHEMA_IDS.fulfillmentOption, { id: 'x', title: 'X' }),
    /totals/,
  );
});

test('a fulfillment_event needs id, occurred_at, type and line_items', () => {
  assert.throws(
    () => validateUcp(SCHEMA_IDS.fulfillmentEvent, { type: 'shipped' }),
    /required/,
  );
  validateUcp(SCHEMA_IDS.fulfillmentEvent, {
    id: 'evt_1',
    occurred_at: '2026-09-03T15:00:00Z',
    type: 'shipped',
    line_items: [{ id: 'li_1', quantity: 1 }],
    tracking_number: '9400111899223197428490',
    tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490',
    carrier: 'USPS',
  });
});
