import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeRate,
  optionId,
  optionTitle,
  optionDescription,
  optionTotalAmount,
  buildFulfillmentOption,
  buildFulfillmentOptions,
  buildFulfillmentOptionsResult,
  buildCatalogPreviewOptions,
  catalogShippingMethod,
  rateIdsByOptionId,
  matchSelectedOption,
  isRateExpired,
  RATE_MAX_AGE_MS,
  type ShippoRateInput,
} from '../src/rates.ts';
import { CurrencyMismatchError, MalformedRateError, InvalidAmountError } from '../src/errors.ts';
import { validateUcp, assertOnlyKnownKeys, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const NOW = new Date('2026-09-03T15:00:00Z'); // Thursday
const USD = { currency: 'USD', now: NOW } as const;
const EUR = { currency: 'EUR', now: NOW } as const;

const fixture = (name: string): ShippoRateInput =>
  normalizeRate(JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')));

const usps = fixture('rate.usps_priority.json');
const ups = fixture('rate.ups_next_day.json');
const dhl = fixture('rate.dhl_eur.json');
const crossborder = fixture('rate.dhl_crossborder.json');

const checkOption = (option: Record<string, unknown>) => {
  validateUcp(SCHEMA_IDS.fulfillmentOption, option);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentOption, option);
};
const checkBase = (option: Record<string, unknown>) => {
  validateUcp(SCHEMA_IDS.fulfillmentOptionBase, option);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentOptionBase, option);
};

test('normalizeRate reads raw Shippo JSON, tolerating the nulls the SDK parser rejects', () => {
  assert.deepEqual(dhl, {
    objectId: 'rate_dhl_eur',
    provider: 'DHL Express',
    servicelevel: { name: 'Express Worldwide', token: 'dhl_express_worldwide', terms: '' },
    amount: '12.90',
    currency: 'EUR',
    amountLocal: '12.90',
    currencyLocal: 'EUR',
    carrierAccount: 'ca_dhl',
    objectCreated: '2026-09-03T15:00:00.000Z',
  });
  assert.equal(crossborder.servicelevel?.extendedToken, 'dhl_express_worldwide_ddp');
  assert.equal(usps.estimatedDays, 2);
  assert.equal(ups.arrivesBy, '10:30:00');
});

test('normalizeRate refuses a payload it cannot price', () => {
  assert.throws(() => normalizeRate({ provider: 'USPS', amount: '1.00', currency: 'USD' }), MalformedRateError);
  assert.throws(() => normalizeRate({ object_id: 'r', amount: '1.00', currency: 'USD' }), MalformedRateError);
  assert.throws(() => normalizeRate({ object_id: 'r', provider: 'USPS', currency: 'USD' }), MalformedRateError);
  assert.throws(() => normalizeRate({ object_id: 'r', provider: 'USPS', amount: '1.00' }), MalformedRateError);
  assert.throws(() => normalizeRate(null), MalformedRateError);
  assert.throws(() => normalizeRate('nope'), MalformedRateError);
});

test('option ids come from the service token, never the rate object id (design decision 5)', () => {
  assert.equal(optionId(usps), 'usps_priority');
  assert.equal(optionId(ups), 'ups_next_day_air');
  assert.equal(optionId(dhl), 'dhl_express_worldwide');
  assert.equal(optionId(crossborder), 'dhl_express_worldwide_ddp');
  assert.equal(optionId({ ...usps, servicelevel: undefined }), 'usps');
  assert.equal(optionId({ ...usps, servicelevel: {}, provider: 'DHL Express' }), 'dhl_express');
  assert.equal(optionId({ ...usps, servicelevel: { token: '  ' }, provider: 'Deutsche Post DHL' }), 'deutsche_post_dhl');
});

test('option ids survive a re-rate that mints a whole new rate object id', () => {
  const reRated = { ...usps, objectId: 'rate_regenerated_9999' };
  assert.equal(optionId(reRated), optionId(usps));
  assert.deepEqual(rateIdsByOptionId([reRated], USD), { usps_priority: 'rate_regenerated_9999' });
  assert.equal(matchSelectedOption('usps_priority', [reRated], USD)?.objectId, 'rate_regenerated_9999');
  assert.equal(matchSelectedOption('never_offered', [reRated], USD), undefined);
  assert.equal(matchSelectedOption(null, [reRated], USD), undefined);
  assert.equal(matchSelectedOption(undefined, [reRated], USD), undefined);
});

test('catalog and checkout agree on the id, so a discovered choice carries forward', () => {
  assert.equal(buildCatalogPreviewOptions([usps], USD)[0].id, buildFulfillmentOption(usps, USD).id);
});

test('golden: the USPS Priority rate becomes a schema-valid fulfillment_option', () => {
  const option = buildFulfillmentOption(usps, USD);
  assert.deepEqual(option, {
    id: 'usps_priority',
    title: 'USPS Priority Mail',
    description: { plain: 'Arrives in about 2 days' },
    carrier: 'USPS',
    earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
    totals: [{ type: 'total', amount: 835 }],
  });
  checkOption(option);
});

test('golden: arrives_by shapes the description and the buffer, never the timestamps', () => {
  const option = buildFulfillmentOption(ups, USD);
  assert.deepEqual(option, {
    id: 'ups_next_day_air',
    title: 'UPS Next Day Air',
    description: { plain: 'Arrives in about 1 day by 10:30 local time' },
    carrier: 'UPS',
    earliest_fulfillment_time: '2026-09-04T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-04T23:59:59.000Z',
    totals: [{ type: 'total', amount: 4210 }],
  });
  checkOption(option);
});

test('golden: no estimate means no window and no description', () => {
  const option = buildFulfillmentOption(dhl, EUR);
  assert.deepEqual(option, {
    id: 'dhl_express_worldwide',
    title: 'DHL Express Express Worldwide',
    carrier: 'DHL Express',
    totals: [{ type: 'total', amount: 1290 }],
  });
  checkOption(option);
});

test('golden: cross-border prices in whichever pair matches the checkout currency', () => {
  const euro = buildFulfillmentOption(crossborder, EUR);
  assert.deepEqual(euro, {
    id: 'dhl_express_worldwide_ddp',
    title: 'DHL Express Express Worldwide',
    description: { plain: 'Arrives in about 4 days' },
    carrier: 'DHL Express',
    earliest_fulfillment_time: '2026-09-07T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-09T23:59:59.000Z',
    totals: [{ type: 'total', amount: 3860 }],
  });
  checkOption(euro);
  assert.equal(optionTotalAmount(buildFulfillmentOption(crossborder, USD)), 4200);
  assert.equal(optionTotalAmount(buildFulfillmentOption(crossborder, { ...USD, amountSource: 'sender' })), 4200);
  assert.equal(optionTotalAmount(buildFulfillmentOption(crossborder, { ...EUR, amountSource: 'local' })), 3860);
});

test('a currency neither pair carries throws and names the remedy', () => {
  assert.throws(
    () => buildFulfillmentOption(crossborder, { currency: 'GBP', now: NOW }),
    (error: unknown) =>
      error instanceof CurrencyMismatchError &&
      error.checkoutCurrency === 'GBP' &&
      /ratesInCurrency/.test(error.message) &&
      error.retryable === false,
  );
  assert.throws(() => buildFulfillmentOption(crossborder, { ...USD, amountSource: 'local' }), CurrencyMismatchError);
  assert.throws(() => buildFulfillmentOption(dhl, { ...USD, amountSource: 'local' }), CurrencyMismatchError);
  // The USPS fixture prices both pairs in USD, so 'local' is simply the local pair and nothing throws.
  assert.equal(optionTotalAmount(buildFulfillmentOption(usps, { ...USD, amountSource: 'local' })), 835);
  // A rate with no local pair at all is the other CurrencyMismatchError path.
  assert.throws(
    () =>
      buildFulfillmentOption(
        { ...usps, amountLocal: undefined, currencyLocal: undefined },
        { ...USD, amountSource: 'local' },
      ),
    (error: unknown) => error instanceof CurrencyMismatchError && error.rateCurrency === '(amount_local absent)',
  );
});

test('golden: options are sorted cheapest first and every one is pinned', () => {
  const options = buildFulfillmentOptions([ups, usps], USD);
  assert.deepEqual(options, [
    {
      id: 'usps_priority',
      title: 'USPS Priority Mail',
      description: { plain: 'Arrives in about 2 days' },
      carrier: 'USPS',
      earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
      latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
      totals: [{ type: 'total', amount: 835 }],
    },
    {
      id: 'ups_next_day_air',
      title: 'UPS Next Day Air',
      description: { plain: 'Arrives in about 1 day by 10:30 local time' },
      carrier: 'UPS',
      earliest_fulfillment_time: '2026-09-04T00:00:00.000Z',
      latest_fulfillment_time: '2026-09-04T23:59:59.000Z',
      totals: [{ type: 'total', amount: 4210 }],
    },
  ]);
  for (const option of options) checkOption(option);
});

test('two carrier accounts on the same service collapse to the cheaper option', () => {
  const expensive = { ...usps, objectId: 'rate_usps_a', carrierAccount: 'ca_usps_a', amount: '9.10' };
  const cheap = { ...usps, objectId: 'rate_usps_b', carrierAccount: 'ca_usps_b', amount: '8.35' };
  const options = buildFulfillmentOptions([expensive, cheap], USD);
  assert.equal(options.length, 1, 'the same service must not appear twice with the same id');
  assert.equal(options[0].id, 'usps_priority');
  assert.equal(optionTotalAmount(options[0]), 835);
  assert.deepEqual(rateIdsByOptionId([expensive, cheap], USD), { usps_priority: 'rate_usps_b' });
  assert.equal(matchSelectedOption('usps_priority', [expensive, cheap], USD)?.objectId, 'rate_usps_b');
});

test('the strict builder throws on a bad rate; the Result builder reports it and keeps the rest', () => {
  assert.throws(() => buildFulfillmentOptions([usps, dhl], USD), CurrencyMismatchError);
  const skips: Array<{ id: string; message: string }> = [];
  const result = buildFulfillmentOptionsResult([usps, dhl, ups], {
    ...USD,
    onSkip: (rate, error) => skips.push({ id: rate.objectId, message: error.message }),
  });
  assert.deepEqual(result.options.map((option) => option.id), ['usps_priority', 'ups_next_day_air']);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].rate.objectId, 'rate_dhl_eur');
  assert.ok(result.skipped[0].error instanceof CurrencyMismatchError);
  assert.deepEqual(skips.map((s) => s.id), ['rate_dhl_eur']);
  assert.match(skips[0].message, /EUR/);
});

test('an empty rate list produces an empty option list, never an invented option', () => {
  assert.deepEqual(buildFulfillmentOptions([], USD), []);
  assert.deepEqual(buildFulfillmentOptionsResult([], USD), { options: [], skipped: [] });
  assert.deepEqual(buildCatalogPreviewOptions([], USD), []);
});

test('displayText and adjustAmount are opt in (design decision 6)', () => {
  const labelled = buildFulfillmentOption(usps, { ...USD, displayText: 'Shipping' });
  assert.deepEqual(labelled.totals, [{ type: 'total', amount: 835, display_text: 'Shipping' }]);
  checkOption(labelled);
  const marked = buildFulfillmentOption(usps, { ...USD, adjustAmount: (_rate, minor) => minor + 200 });
  assert.equal(optionTotalAmount(marked), 1035);
  assert.throws(() => buildFulfillmentOption(usps, { ...USD, adjustAmount: () => 1.5 }), InvalidAmountError);
  assert.throws(() => buildFulfillmentOption(usps, { ...USD, adjustAmount: () => -1 }), InvalidAmountError);
});

test('a caller can override the id function without forking the library', () => {
  const option = buildFulfillmentOption(usps, { ...USD, optionId: (rate) => `x_${rate.objectId}` });
  assert.equal(option.id, 'x_rate_usps_priority');
  checkOption(option);
});

test('title and description helpers make exactly one delivery claim', () => {
  assert.equal(optionTitle(usps), 'USPS Priority Mail');
  assert.equal(optionTitle({ ...usps, servicelevel: {} }), 'USPS');
  assert.equal(optionTitle({ ...usps, servicelevel: { name: '  ' } }), 'USPS');
  assert.equal(optionDescription(usps), 'Arrives in about 2 days');
  assert.equal(optionDescription({ ...usps, estimatedDays: 1 }), 'Arrives in about 1 day');
  assert.equal(optionDescription({ ...usps, estimatedDays: 0 }), 'Arrives same day');
  assert.equal(optionDescription(ups), 'Arrives in about 1 day by 10:30 local time');
  assert.equal(optionDescription(dhl), undefined);
  // duration_terms is carrier boilerplate that often contradicts the point estimate, so it is
  // used only when there is no estimate to contradict.
  assert.equal(
    optionDescription({ ...dhl, durationTerms: 'Delivery in 3 to 5 business days.' }),
    'Delivery in 3 to 5 business days.',
  );
  const claims = optionDescription(usps)?.match(/[Aa]rrives|[Dd]elivery within/g) ?? [];
  assert.equal(claims.length, 1, `two competing claims: ${optionDescription(usps)}`);
});

test('golden: the catalog preview is the cheapest and the fastest, as base options', () => {
  const preview = buildCatalogPreviewOptions([usps, ups], USD);
  assert.deepEqual(preview, [
    {
      id: 'usps_priority',
      title: 'USPS Priority Mail',
      description: { plain: 'Arrives in about 2 days' },
    },
    {
      id: 'ups_next_day_air',
      title: 'UPS Next Day Air',
      description: { plain: 'Arrives in about 1 day by 10:30 local time' },
    },
  ]);
  for (const option of preview) checkBase(option);
  assert.equal(buildCatalogPreviewOptions([usps], USD).length, 1);
});

test('the catalog preview refuses to rank rates it cannot compare', () => {
  assert.throws(() => buildCatalogPreviewOptions([usps, dhl], USD), CurrencyMismatchError);
});

test('golden: the catalog method wraps the preview the way the spec nests it', () => {
  assert.deepEqual(catalogShippingMethod([usps, ups], { ...USD, description: 'Ships from Chicago', available: true }), {
    type: 'shipping',
    description: { plain: 'Ships from Chicago' },
    availability: { available: true, status: 'in_stock' },
    options: [
      { id: 'usps_priority', title: 'USPS Priority Mail', description: { plain: 'Arrives in about 2 days' } },
      {
        id: 'ups_next_day_air',
        title: 'UPS Next Day Air',
        description: { plain: 'Arrives in about 1 day by 10:30 local time' },
      },
    ],
  });
  assert.deepEqual(catalogShippingMethod([], { ...USD, available: false }), {
    type: 'shipping',
    availability: { available: false, status: 'out_of_stock' },
  });
  for (const method of [
    catalogShippingMethod([usps, ups], { ...USD, description: 'Ships from Chicago', available: true }),
    catalogShippingMethod([], { ...USD, available: false }),
  ]) {
    validateUcp(SCHEMA_IDS.catalogFulfillmentMethod, method);
    assertOnlyKnownKeys(SCHEMA_IDS.catalogFulfillmentMethod, method);
  }
});

test('rate expiry is surfaced before a merchant discovers it at purchase', () => {
  assert.equal(RATE_MAX_AGE_MS, 604800000);
  assert.equal(isRateExpired(usps, new Date('2026-09-10T15:00:00.000Z')), false);
  assert.equal(isRateExpired(usps, new Date('2026-09-10T15:00:00.001Z')), true);
  assert.equal(isRateExpired({ objectCreated: new Date('2026-09-03T15:00:00Z') }, new Date('2026-09-04T00:00:00Z')), false);
  assert.equal(isRateExpired({}, new Date('2030-01-01T00:00:00Z')), false);
});
