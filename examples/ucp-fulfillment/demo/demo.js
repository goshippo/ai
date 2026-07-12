'use strict';

/**
 * Runnable demo: read a sample Shippo rates response, map it into a UCP
 * `dev.ucp.shopping.fulfillment` object, and print the result plus a
 * checkout skeleton that embeds it.
 *
 *   node examples/ucp-fulfillment/demo/demo.js
 *
 * Dependency-free; Node 18+.
 */

const fs = require('fs');
const path = require('path');
const { mapRatesToFulfillment } = require('../src/map-rates-to-fulfillment');

const samplePath = path.join(__dirname, 'sample-shippo-rates.json');
const shippoRates = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

// The cart line items this shipment fulfills, and where it ships to. In a real
// integration these come from the UCP checkout the platform is negotiating.
const lineItemIds = ['li_shirt', 'li_pants'];
const destination = {
  id: 'dest_1',
  street_address: '123 Main St',
  address_locality: 'Springfield',
  address_region: 'IL',
  postal_code: '62701',
  address_country: 'US',
};

const { fulfillment, currency, warnings } = mapRatesToFulfillment(shippoRates, {
  lineItemIds,
  destination,
});

// Embed the fulfillment object on a minimal UCP checkout skeleton so the shape
// is shown in context. `currency` is the checkout root; option totals are in
// this currency's minor units.
const checkout = {
  ucp: {
    capabilities: {
      'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
      'dev.ucp.shopping.fulfillment': [
        { version: '2026-04-08', extends: 'dev.ucp.shopping.checkout' },
      ],
      'com.shippo.shipping.rate_detail': [
        { version: '2026-04-08', extends: 'dev.ucp.shopping.fulfillment' },
      ],
    },
  },
  id: 'checkout_demo',
  status: 'incomplete',
  currency,
  line_items: [
    { id: 'li_shirt', item: { id: 'prod_shirt', title: 'Shirt' }, quantity: 1 },
    { id: 'li_pants', item: { id: 'prod_pants', title: 'Pants' }, quantity: 1 },
  ],
  fulfillment,
};

console.log('=== UCP checkout with Shippo-mapped fulfillment ===\n');
console.log(JSON.stringify(checkout, null, 2));

if (warnings.length) {
  console.log('\n=== warnings ===');
  for (const w of warnings) console.log('- ' + w);
}

console.log('\n=== rendered option cards (title + description + total) ===');
for (const method of fulfillment.methods) {
  for (const group of method.groups) {
    for (const opt of group.options) {
      const total = opt.totals.find((t) => t.type === 'total');
      const price = (total.amount / 100).toFixed(2);
      const selected = group.selected_option_id === opt.id ? ' [selected]' : '';
      console.log(`- ${opt.title} - $${price} ${currency}${selected}`);
      console.log(`    ${opt.description.plain}`);
    }
  }
}
