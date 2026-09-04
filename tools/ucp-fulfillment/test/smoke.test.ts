import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.ts';
import * as core from '../src/core.ts';

const FUNCTIONS = [
  'toMinorUnits',
  'currencyExponent',
  'carrierDisplayName',
  'carrierTrackingUrl',
  'templateTrackingUrl',
  'shippoTrackingPageUrl',
  'deliveryWindow',
  'addBusinessDays',
  'addCalendarDays',
  'firstBusinessDayOnOrAfter',
  'defaultBufferDays',
  'normalizeRate',
  'optionId',
  'optionTitle',
  'optionDescription',
  'optionTotalAmount',
  'buildFulfillmentOption',
  'buildFulfillmentOptions',
  'buildFulfillmentOptionsResult',
  'rateIdsByOptionId',
  'matchSelectedOption',
  'buildCatalogPreviewOptions',
  'catalogShippingMethod',
  'isRateExpired',
  'normalizeCountry',
  'toShippoAddress',
  'isInternational',
  'buildShipmentRequest',
  'buildShipmentRequestResult',
  'buildFulfillmentGroup',
  'buildShippingMethod',
  'buildShippingFulfillment',
  'addressUndeliverableMessage',
  'destinationRejectedMessage',
  'normalizeTrack',
  'mapTrackingStatus',
  'resolveTrackingUrl',
  'buildFulfillmentEvent',
  'buildFulfillmentEventResult',
  'buildFulfillmentEvents',
  'buildExpectation',
  'buildProcessingEvent',
  'assertOrderShape',
  'assertLineItemsMatchOrder',
  'classifyEvent',
  'appendFulfillmentEvent',
  'contentDigest',
  'webhookIdForEvent',
  'buildOrderEventRequest',
  'sendOrderEvent',
  'verifyShippoSignature',
  'verifyShippoTrust',
  'buildTrackWebhookRequest',
  'handleShippoTrackWebhook',
  'ucpCapabilities',
  'orderResponseUcp',
  'createShippoClient',
] as const;

const ERRORS = [
  'UcpFulfillmentError',
  'InvalidAmountError',
  'AmountRangeError',
  'UnknownCurrencyError',
  'CurrencyMismatchError',
  'NoRatesError',
  'LineItemsRequiredError',
  'LineItemMismatchError',
  'TrackingUrlUnresolvedError',
  'MissingTrackingStatusError',
  'MalformedTrackError',
  'MalformedRateError',
  'UnmappedTrackingStatusError',
  'SelectedOptionUnknownError',
  'SelectedDestinationUnknownError',
  'DestinationIncompleteError',
  'InvalidOrderError',
  'UnsignedWebhookError',
  'SignerConflictError',
  'ShippoSignatureError',
  'ShippoApiVersionError',
  'ShippoClientConfigError',
  'OrderEventDeliveryError',
] as const;

test('the public API surface is complete', () => {
  const surface = api as unknown as Record<string, unknown>;
  for (const name of FUNCTIONS) assert.equal(typeof surface[name], 'function', name);
  for (const name of ERRORS) assert.equal(typeof surface[name], 'function', name);
  assert.equal(api.UCP_VERSION, '2026-08-25');
  assert.equal(api.PACKAGE_NAME, '@shippo/ucp-fulfillment');
  assert.equal(api.MAX_MINOR_UNITS, 9007199254740991);
  assert.equal(api.RATE_MAX_AGE_MS, 604800000);
  assert.equal(api.SHIPPO_SIGNATURE_HEADER, 'Shippo-Auth-Signature');
  assert.deepEqual(Object.keys(api.SHIPMENT_WARNINGS).sort(), [
    'destinationMissingPhoneInternational',
    'internationalWithoutCustoms',
  ]);
  assert.equal(api.FULFILLMENT_EVENT_TYPES.length, 8);
});

test('the core entry is the full surface minus the SDK client', () => {
  const coreNames = new Set(Object.keys(core));
  const apiNames = new Set(Object.keys(api));
  assert.equal(coreNames.has('createShippoClient'), false, 'core must not export the SDK client');
  assert.equal(apiNames.has('createShippoClient'), true);
  for (const name of coreNames) assert.equal(apiNames.has(name), true, `${name} missing from the root entry`);
  assert.equal(apiNames.size, coreNames.size + 1);
  assert.equal(coreNames.size, 86);
});

test('every library error class descends from the one base a consumer catches', () => {
  for (const name of ERRORS) {
    if (name === 'UcpFulfillmentError') continue;
    const constructor = (api as unknown as Record<string, new (...args: never[]) => unknown>)[name];
    assert.ok(
      Object.prototype.isPrototypeOf.call(api.UcpFulfillmentError, constructor),
      `${name} must extend UcpFulfillmentError`,
    );
  }
});
