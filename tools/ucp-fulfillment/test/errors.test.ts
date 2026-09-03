import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UcpFulfillmentError,
  InvalidAmountError,
  AmountRangeError,
  UnknownCurrencyError,
  CurrencyMismatchError,
  NoRatesError,
  LineItemsRequiredError,
  LineItemMismatchError,
  TrackingUrlUnresolvedError,
  MissingTrackingStatusError,
  MalformedTrackError,
  MalformedRateError,
  UnmappedTrackingStatusError,
  SelectedOptionUnknownError,
  SelectedDestinationUnknownError,
  DestinationIncompleteError,
  InvalidOrderError,
  UnsignedWebhookError,
  SignerConflictError,
  ShippoSignatureError,
  ShippoApiVersionError,
  ShippoClientConfigError,
  OrderEventDeliveryError,
} from '../src/errors.ts';

const PERMANENT: Array<[string, UcpFulfillmentError]> = [
  ['InvalidAmountError', new InvalidAmountError('8,35')],
  ['AmountRangeError', new AmountRangeError('99999999999999.99', 'USD')],
  ['UnknownCurrencyError', new UnknownCurrencyError('MMM')],
  ['CurrencyMismatchError', new CurrencyMismatchError('rate_1', 'EUR', 'USD')],
  ['NoRatesError', new NoRatesError('QUEUED')],
  ['LineItemsRequiredError', new LineItemsRequiredError()],
  ['LineItemMismatchError', new LineItemMismatchError(['no line item li_x on order order_123'])],
  ['TrackingUrlUnresolvedError', new TrackingUrlUnresolvedError('deutsche_post', 'LX000000000DE')],
  ['MissingTrackingStatusError', new MissingTrackingStatusError('9400')],
  ['MalformedTrackError', new MalformedTrackError('tracking_number')],
  ['MalformedRateError', new MalformedRateError('object_id')],
  ['UnmappedTrackingStatusError', new UnmappedTrackingStatusError('CANCELLED', undefined)],
  ['SelectedOptionUnknownError', new SelectedOptionUnknownError('not_offered')],
  ['SelectedDestinationUnknownError', new SelectedDestinationUnknownError('dest_9')],
  ['DestinationIncompleteError', new DestinationIncompleteError('address_country')],
  ['InvalidOrderError', new InvalidOrderError(['missing line_items'])],
  ['UnsignedWebhookError', new UnsignedWebhookError()],
  ['SignerConflictError', new SignerConflictError('Content-Digest')],
  ['ShippoSignatureError', new ShippoSignatureError('digest mismatch')],
  ['ShippoApiVersionError', new ShippoApiVersionError('2017-03-29')],
  ['ShippoClientConfigError', new ShippoClientConfigError()],
];

test('every library error is a UcpFulfillmentError with a matching name and a real message', () => {
  for (const [name, error] of PERMANENT) {
    assert.ok(error instanceof UcpFulfillmentError, `${name} must extend UcpFulfillmentError`);
    assert.ok(error instanceof Error, `${name} must extend Error`);
    assert.equal(error.name, name);
    assert.ok(error.message.length > 20, `${name} message is too short to help: ${error.message}`);
    assert.equal(error.retryable, false, `${name} must be permanent`);
  }
});

test('delivery failures are retryable only for 408, 429 and 5xx', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(new OrderEventDeliveryError(status, '').retryable, true, `HTTP ${status}`);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(new OrderEventDeliveryError(status, '').retryable, false, `HTTP ${status}`);
  }
  const error = new OrderEventDeliveryError(503, 'upstream busy');
  assert.equal(error.name, 'OrderEventDeliveryError');
  assert.equal(error.status, 503);
  assert.equal(error.responseText, 'upstream busy');
  assert.equal(error.message, 'Platform webhook rejected the order event with HTTP 503');
});

test('errors carry the structured fields a caller branches on', () => {
  assert.equal(new CurrencyMismatchError('rate_1', 'EUR', 'USD').rateCurrency, 'EUR');
  assert.equal(new UnknownCurrencyError('MMM').currency, 'MMM');
  assert.deepEqual(new LineItemMismatchError(['a', 'b']).problems, ['a', 'b']);
  assert.equal(new UnmappedTrackingStatusError('CANCELLED', 'x').substatusCode, 'x');
  assert.equal(new TrackingUrlUnresolvedError('ups', '1Z').trackingNumber, '1Z');
  assert.equal(new SignerConflictError('Content-Type').header, 'Content-Type');
});

test('the cause chain survives', () => {
  class Wrapped extends UcpFulfillmentError {
    constructor(cause: unknown) {
      super('wrapped', { retryable: false, cause });
      this.name = 'Wrapped';
    }
  }
  const root = new Error('root cause');
  assert.equal(new Wrapped(root).cause, root);
});
