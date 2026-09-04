import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFulfillmentGroup,
  buildShippingMethod,
  buildShippingFulfillment,
  addressUndeliverableMessage,
  destinationRejectedMessage,
} from '../src/checkout.ts';
import { normalizeRate, buildFulfillmentOptions, type ShippoRateInput } from '../src/rates.ts';
import { SelectedOptionUnknownError, SelectedDestinationUnknownError, CurrencyMismatchError } from '../src/errors.ts';
import { validateUcp, assertOnlyKnownKeys, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const NOW = new Date('2026-09-03T15:00:00Z');
const USD = { currency: 'USD', now: NOW } as const;

const fixture = (name: string): ShippoRateInput =>
  normalizeRate(JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')));
const usps = fixture('rate.usps_priority.json');
const ups = fixture('rate.ups_next_day.json');
const dhl = fixture('rate.dhl_eur.json');

const DEST = {
  type: 'shipping_address' as const,
  id: 'dest_1',
  street_address: '123 Main St',
  address_locality: 'Springfield',
  address_region: 'IL',
  postal_code: '62701',
  address_country: 'US',
};

const USPS_OPTION = {
  id: 'usps_priority',
  title: 'USPS Priority Mail',
  description: { plain: 'Arrives in about 2 days' },
  carrier: 'USPS',
  earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
  latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
  totals: [{ type: 'total', amount: 835 }],
};
const UPS_OPTION = {
  id: 'ups_next_day_air',
  title: 'UPS Next Day Air',
  description: { plain: 'Arrives in about 1 day by 10:30 local time' },
  carrier: 'UPS',
  earliest_fulfillment_time: '2026-09-04T00:00:00.000Z',
  latest_fulfillment_time: '2026-09-04T23:59:59.000Z',
  totals: [{ type: 'total', amount: 4210 }],
};

test('golden: a group carries its line items, its options and a null selection on create', () => {
  const group = buildFulfillmentGroup({
    id: 'package_1',
    lineItemIds: ['li_shirt', 'li_pants'],
    options: buildFulfillmentOptions([usps, ups], USD),
  });
  assert.deepEqual(group, {
    id: 'package_1',
    line_item_ids: ['li_shirt', 'li_pants'],
    options: [USPS_OPTION, UPS_OPTION],
    selected_option_id: null,
  });
  validateUcp(SCHEMA_IDS.fulfillmentGroup, group);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentGroup, group);
});

test('an accepted selection is echoed and must name an option we quoted', () => {
  const options = buildFulfillmentOptions([usps, ups], USD);
  const group = buildFulfillmentGroup({
    id: 'package_1',
    lineItemIds: ['li_shirt'],
    options,
    selectedOptionId: 'usps_priority',
  });
  assert.equal(group.selected_option_id, 'usps_priority');
  assert.ok(group.options?.some((option) => option.id === group.selected_option_id));
  validateUcp(SCHEMA_IDS.fulfillmentGroup, group);
  assert.throws(
    () => buildFulfillmentGroup({ id: 'package_1', lineItemIds: ['li_shirt'], options, selectedOptionId: 'not_offered' }),
    SelectedOptionUnknownError,
  );
});

test('golden: a shipping method echoes exactly one destination for the accepted selection', () => {
  const method = buildShippingMethod({
    id: 'shipping',
    lineItemIds: ['li_shirt'],
    destinations: [DEST],
    selectedDestinationId: 'dest_1',
    groups: [
      buildFulfillmentGroup({
        id: 'package_1',
        lineItemIds: ['li_shirt'],
        options: buildFulfillmentOptions([usps], USD),
        selectedOptionId: 'usps_priority',
      }),
    ],
  });
  assert.deepEqual(method, {
    id: 'shipping',
    type: 'shipping',
    line_item_ids: ['li_shirt'],
    destinations: [DEST],
    selected_destination_id: 'dest_1',
    groups: [
      {
        id: 'package_1',
        line_item_ids: ['li_shirt'],
        options: [USPS_OPTION],
        selected_option_id: 'usps_priority',
      },
    ],
  });
  assert.equal(method.destinations.filter((d) => d.id === 'dest_1').length, 1);
  validateUcp(SCHEMA_IDS.fulfillmentMethod, method);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentMethod, method);
  for (const destination of method.destinations) {
    validateUcp(SCHEMA_IDS.shippingDestination, destination);
    assertOnlyKnownKeys(SCHEMA_IDS.shippingDestination, destination);
  }
});

test('an unrecognized destination selection is rejected rather than quietly ignored', () => {
  assert.throws(
    () =>
      buildShippingMethod({
        id: 'shipping',
        lineItemIds: ['li_shirt'],
        destinations: [DEST],
        selectedDestinationId: 'dest_9',
        groups: [],
      }),
    SelectedDestinationUnknownError,
  );
});

test('a destination id that matches more than once is rejected, not silently accepted', () => {
  // UCP requires EXACTLY ONE destination whose id equals the accepted selection, so a duplicate id
  // is as unusable as a missing one: the buyer's address would be ambiguous on the response.
  assert.throws(
    () =>
      buildShippingMethod({
        id: 'shipping',
        lineItemIds: ['li_shirt'],
        destinations: [DEST, { ...DEST, postal_code: '10001' }],
        selectedDestinationId: 'dest_1',
        groups: [],
      }),
    (error: unknown) => error instanceof SelectedDestinationUnknownError && error.destinationId === 'dest_1',
  );
  // A second destination with its own id is fine: exactly one still matches.
  assert.doesNotThrow(() =>
    buildShippingMethod({
      id: 'shipping',
      lineItemIds: ['li_shirt'],
      destinations: [DEST, { ...DEST, id: 'dest_2' }],
      selectedDestinationId: 'dest_1',
      groups: [],
    }),
  );
});

test('golden: a rejected destination selection carries the message UCP requires', () => {
  const message = destinationRejectedMessage({ methodIndex: 0, destinationId: 'dest_9' });
  assert.deepEqual(message, {
    type: 'error',
    code: 'address_undeliverable',
    severity: 'recoverable',
    content: 'We cannot ship to the selected address (dest_9). Choose another one.',
    path: '$.fulfillment.methods[0].selected_destination_id',
  });
  validateUcp(SCHEMA_IDS.message, message);
  assertOnlyKnownKeys(SCHEMA_IDS.messageError, message);
  // The path is the attempted selection, not the destination it names: the checkout spec asks for
  // the most specific path applicable, and this is a different condition from an undeliverable
  // address, which points at destinations[0] instead.
  assert.notEqual(
    destinationRejectedMessage({ methodIndex: 1, destinationId: 'd' }).path,
    addressUndeliverableMessage({ methodIndex: 1 }).path,
  );
  assert.equal(
    destinationRejectedMessage({ methodIndex: 0, destinationId: 'dest_9', content: 'We do not ship there.' }).content,
    'We do not ship there.',
  );
});

test('golden: the whole container from a platform destination and a rate list', () => {
  const { methods, skipped } = buildShippingFulfillment({
    ...USD,
    lineItemIds: ['li_shirt', 'li_pants'],
    destinations: [
      {
        street_address: '123 Main St',
        address_locality: 'Springfield',
        address_region: 'IL',
        postal_code: '62701',
        address_country: 'US',
      },
    ],
    rates: [ups, usps],
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(methods, [
    {
      id: 'shipping',
      type: 'shipping',
      line_item_ids: ['li_shirt', 'li_pants'],
      destinations: [
        {
          type: 'shipping_address',
          id: 'dest_1',
          street_address: '123 Main St',
          address_locality: 'Springfield',
          address_region: 'IL',
          postal_code: '62701',
          address_country: 'US',
        },
      ],
      selected_destination_id: null,
      groups: [
        {
          id: 'package_1',
          line_item_ids: ['li_shirt', 'li_pants'],
          options: [USPS_OPTION, UPS_OPTION],
          selected_option_id: null,
        },
      ],
    },
  ]);
  validateUcp(SCHEMA_IDS.fulfillmentMethod, methods[0]);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentMethod, methods[0]);
});

test('a destination that already carries an id keeps it, and the type is always stamped', () => {
  const { methods } = buildShippingFulfillment({
    ...USD,
    lineItemIds: ['li_shirt'],
    destinations: [{ id: 'addr_from_my_store', address_country: 'US', postal_code: '62701' }],
    selectedDestinationId: 'addr_from_my_store',
    rates: [usps],
    methodId: 'method_1',
    groupId: 'pkg_1',
  });
  assert.equal(methods[0].id, 'method_1');
  assert.equal(methods[0].groups[0].id, 'pkg_1');
  assert.equal(methods[0].destinations[0].id, 'addr_from_my_store');
  assert.equal(methods[0].destinations[0].type, 'shipping_address');
  assert.equal(methods[0].selected_destination_id, 'addr_from_my_store');
});

test('a rate the container cannot price is reported, not thrown, and never silently dropped', () => {
  const { methods, skipped } = buildShippingFulfillment({
    ...USD,
    lineItemIds: ['li_shirt'],
    destinations: [DEST],
    rates: [usps, dhl],
  });
  assert.deepEqual(methods[0].groups[0].options?.map((option) => option.id), ['usps_priority']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].rate.objectId, 'rate_dhl_eur');
  assert.ok(skipped[0].error instanceof CurrencyMismatchError);
});

test('an empty rate list yields an empty option list plus the message a platform can render', () => {
  const { methods } = buildShippingFulfillment({
    ...USD,
    lineItemIds: ['li_shirt'],
    destinations: [DEST],
    rates: [],
  });
  assert.deepEqual(methods[0].groups[0].options, []);
  const message = addressUndeliverableMessage({
    methodIndex: 0,
    shippoMessages: [{ text: 'No rates for this destination' }, { text: 'Carrier does not serve this ZIP' }],
  });
  assert.deepEqual(message, {
    type: 'error',
    code: 'address_undeliverable',
    severity: 'recoverable',
    content: 'No rates for this destination; Carrier does not serve this ZIP',
    path: '$.fulfillment.methods[0].destinations[0]',
  });
  validateUcp(SCHEMA_IDS.message, message);
  assertOnlyKnownKeys(SCHEMA_IDS.messageError, message);
});

test('the undeliverable message falls back to a sentence a buyer can act on', () => {
  assert.deepEqual(addressUndeliverableMessage({ methodIndex: 2 }), {
    type: 'error',
    code: 'address_undeliverable',
    severity: 'recoverable',
    content: 'No carrier can deliver to this address.',
    path: '$.fulfillment.methods[2].destinations[0]',
  });
  assert.equal(
    addressUndeliverableMessage({ methodIndex: 0, content: 'We do not ship to PO boxes.' }).content,
    'We do not ship to PO boxes.',
  );
  assert.equal(addressUndeliverableMessage({ methodIndex: 0, shippoMessages: [{ text: '' }, {}] }).content,
    'No carrier can deliver to this address.');
});

test('the container never mutates the destinations the caller passed in', () => {
  const input = [{ address_country: 'US', postal_code: '62701' }];
  const snapshot = JSON.stringify(input);
  buildShippingFulfillment({ ...USD, lineItemIds: ['li_shirt'], destinations: input, rates: [usps] });
  assert.equal(JSON.stringify(input), snapshot);
});
