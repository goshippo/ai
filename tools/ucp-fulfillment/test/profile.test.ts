import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ucpCapabilities, orderResponseUcp, UCP_VERSION } from '../src/profile.ts';
import { validateUcp, SCHEMA_IDS } from './helpers/ucp-validator.ts';

test('golden: the checkout-only profile entries', () => {
  const caps = ucpCapabilities();
  assert.equal(UCP_VERSION, '2026-08-25');
  assert.deepEqual(caps, {
    'dev.ucp.shopping.fulfillment': [
      {
        version: '2026-08-25',
        spec: 'https://ucp.dev/2026-08-25/specification/shopping/extensions/fulfillment',
        schema: 'https://ucp.dev/2026-08-25/schemas/shopping/fulfillment.json',
        extends: 'dev.ucp.shopping.checkout',
      },
    ],
    'dev.ucp.shopping.order': [
      {
        version: '2026-08-25',
        spec: 'https://ucp.dev/2026-08-25/specification/shopping/order',
        schema: 'https://ucp.dev/2026-08-25/schemas/shopping/order.json',
      },
    ],
  });
  for (const entries of Object.values(caps)) {
    for (const entry of entries) validateUcp(SCHEMA_IDS.capabilityBusiness, entry);
  }
});

test('golden: exposing catalog widens extends to the two catalog capabilities', () => {
  const caps = ucpCapabilities({ exposeCatalog: true });
  assert.deepEqual(caps['dev.ucp.shopping.fulfillment'][0].extends, [
    'dev.ucp.shopping.checkout',
    'dev.ucp.shopping.catalog.search',
    'dev.ucp.shopping.catalog.lookup',
  ]);
  for (const entry of caps['dev.ucp.shopping.fulfillment']) {
    validateUcp(SCHEMA_IDS.capabilityBusiness, entry);
  }
  // Opting in is deliberate: advertising catalog fulfillment a merchant does not serve is worse
  // than not advertising it, so the default stays checkout only.
  assert.equal(ucpCapabilities()['dev.ucp.shopping.fulfillment'][0].extends, 'dev.ucp.shopping.checkout');
});

test('the version is overridable and threads through every URL', () => {
  const caps = ucpCapabilities({ version: '2026-04-08' });
  assert.equal(caps['dev.ucp.shopping.order'][0].version, '2026-04-08');
  assert.equal(caps['dev.ucp.shopping.order'][0].schema, 'https://ucp.dev/2026-04-08/schemas/shopping/order.json');
  assert.equal(
    caps['dev.ucp.shopping.fulfillment'][0].spec,
    'https://ucp.dev/2026-04-08/specification/shopping/extensions/fulfillment',
  );
});

test('golden: the order response envelope confirms the active capabilities', () => {
  assert.deepEqual(orderResponseUcp(), {
    version: '2026-08-25',
    capabilities: {
      'dev.ucp.shopping.order': [{ version: '2026-08-25' }],
      'dev.ucp.shopping.fulfillment': [{ version: '2026-08-25' }],
    },
  });
  assert.equal(orderResponseUcp({ version: '2026-04-08' }).version, '2026-04-08');
  assert.deepEqual(orderResponseUcp({ version: '2026-04-08' }).capabilities['dev.ucp.shopping.order'], [
    { version: '2026-04-08' },
  ]);
});

test('an order carrying that envelope validates', () => {
  validateUcp(SCHEMA_IDS.order, {
    ucp: orderResponseUcp(),
    id: 'order_1',
    checkout_id: 'chk_1',
    permalink_url: 'https://merchant.example/orders/order_1',
    line_items: [
      {
        id: 'li_1',
        item: { id: 'sku_1', title: 'Shirt', price: 2000 },
        quantity: { original: 1, total: 1, fulfilled: 0 },
        totals: [{ type: 'subtotal', amount: 2000 }, { type: 'total', amount: 2000 }],
        status: 'processing',
      },
    ],
    fulfillment: { expectations: [], events: [] },
    currency: 'USD',
    totals: [{ type: 'subtotal', amount: 2000 }, { type: 'total', amount: 2000 }],
  });
});
