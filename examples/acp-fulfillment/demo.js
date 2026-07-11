// @ts-check
'use strict';

/**
 * demo.js, Runnable demo: convert a sample Shippo rates response into ACP
 * fulfillment options.
 *
 *   node examples/acp-fulfillment/demo.js
 *
 * The sample below mirrors the shape of a Shippo test-mode POST /shipments
 * response (trimmed to the fields the adapter reads). Swap it for a live
 * response and the same call works unchanged. Test-mode rates produce test
 * labels, so you can exercise the whole flow without spending money.
 */

const { ratesToFulfillmentOptions } = require('./shippo-to-acp');

const shipment = {
  object_id: 'a5f6d4e3c2b1a0987654321fedcba098',
  status: 'SUCCESS',
  rates: [
    {
      object_id: 'rate_usps_priority_000000000000001',
      amount: '7.90',
      currency: 'USD',
      provider: 'USPS',
      servicelevel: { name: 'Priority Mail', token: 'usps_priority', terms: '' },
      estimated_days: 2,
      duration_terms: 'Delivery within 1, 2, or 3 days based on where your package started and where it is being sent.',
    },
    {
      object_id: 'rate_usps_ground_0000000000000002',
      amount: '5.55',
      currency: 'USD',
      provider: 'USPS',
      servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage', terms: '' },
      estimated_days: 4,
      duration_terms: 'Delivery in 2 to 5 business days.',
    },
    {
      object_id: 'rate_ups_ground_00000000000000003',
      amount: '11.02',
      currency: 'USD',
      provider: 'UPS',
      servicelevel: { name: 'Ground', token: 'ups_ground', terms: '' },
      estimated_days: 3,
      duration_terms: '',
    },
  ],
};

// Latest released ACP spec shape (2026-04-17): totals[] cost breakdown.
const current = ratesToFulfillmentOptions(shipment, {
  shipmentDate: '2026-07-10T16:00:00Z',
  deliveryWindowDays: 1,
});

// 2025-09-29 shape (flat subtotal/tax/total), the shape OpenAI's Agentic
// Checkout docs currently pin.
const legacy = ratesToFulfillmentOptions(shipment, {
  specVersion: '2025-09-29',
  shipmentDate: '2026-07-10T16:00:00Z',
  deliveryWindowDays: 1,
});

console.log('ACP 2026-04-17 fulfillment_options:');
console.log(JSON.stringify(current, null, 2));
console.log();
console.log('ACP 2025-09-29 fulfillment_options:');
console.log(JSON.stringify(legacy, null, 2));
