import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyExponent, toMinorUnits, MAX_MINOR_UNITS } from '../src/money.ts';
import { InvalidAmountError, AmountRangeError, UnknownCurrencyError, UcpFulfillmentError } from '../src/errors.ts';

test('currency exponents follow ISO 4217 across all four sets', () => {
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('eur'), 2);
  assert.equal(currencyExponent(' GBP '), 2);
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('KRW'), 0);
  assert.equal(currencyExponent('XOF'), 0);
  assert.equal(currencyExponent('KWD'), 3);
  assert.equal(currencyExponent('BHD'), 3);
  assert.equal(currencyExponent('CLF'), 4);
  assert.equal(currencyExponent('UYW'), 4);
});

test('an unknown or malformed currency throws instead of assuming 2', () => {
  for (const code of ['MMM', '', 'XXX', 'XAU', 'XDR', 'US', 'USDT']) {
    assert.throws(() => currencyExponent(code), UnknownCurrencyError, code);
  }
  assert.equal(new UnknownCurrencyError('MMM').retryable, false);
});

test('an override supplies an exponent the table lacks, and is validated', () => {
  assert.equal(currencyExponent('MMM', { MMM: 3 }), 3);
  assert.equal(currencyExponent('mmm', { MMM: 3 }), 3);
  assert.equal(currencyExponent('USD', { USD: 0 }), 0);
  assert.throws(() => currencyExponent('MMM', { MMM: 7 }), InvalidAmountError);
  assert.throws(() => currencyExponent('MMM', { MMM: 1.5 }), InvalidAmountError);
});

test('converts decimal strings exactly, with no float drift', () => {
  assert.equal(toMinorUnits('8.35', 'USD'), 835);
  assert.equal(toMinorUnits('0.1', 'USD'), 10);
  assert.equal(toMinorUnits('19.99', 'EUR'), 1999);
  assert.equal(toMinorUnits('42.10', 'USD'), 4210);
  assert.equal(toMinorUnits('38.60', 'EUR'), 3860);
  assert.equal(toMinorUnits('500', 'JPY'), 500);
  assert.equal(toMinorUnits('1.234', 'KWD'), 1234);
  assert.equal(toMinorUnits('12.90', 'CLF'), 129000);
  assert.equal(toMinorUnits('1234.5', 'USD'), 123450);
});

test('rounds half away from zero on the digit past the exponent', () => {
  assert.equal(toMinorUnits('5.505', 'USD'), 551);
  assert.equal(toMinorUnits('5.504', 'USD'), 550);
  assert.equal(toMinorUnits('5.5049999', 'USD'), 550);
  assert.equal(toMinorUnits('5.4999999', 'USD'), 550);
  assert.equal(toMinorUnits('500.5', 'JPY'), 501);
  assert.equal(toMinorUnits('-2.505', 'USD'), -251);
  assert.equal(toMinorUnits('-2.504', 'USD'), -250);
});

test('accepts numbers and negative amounts, and never emits negative zero', () => {
  assert.equal(toMinorUnits(8.35, 'USD'), 835);
  assert.equal(toMinorUnits(0.1 + 0.2, 'USD'), 30);
  assert.equal(toMinorUnits('-2.50', 'USD'), -250);
  assert.ok(Object.is(toMinorUnits('-0.001', 'USD'), 0), 'must be +0, not -0');
  assert.ok(Object.is(toMinorUnits('-0.004', 'USD'), 0));
  assert.ok(Object.is(toMinorUnits('0.001', 'USD'), 0));
});

test('large amounts are exact or refused, never silently rounded', () => {
  assert.equal(toMinorUnits('90071992547409.91', 'USD'), 9007199254740991);
  assert.equal(MAX_MINOR_UNITS, 9007199254740991);
  assert.throws(() => toMinorUnits('99999999999999.99', 'USD'), AmountRangeError);
  assert.throws(() => toMinorUnits('-99999999999999.99', 'USD'), AmountRangeError);
});

test('rejects garbage with a typed, permanent error', () => {
  for (const bad of ['', '  ', '8,35', 'abc', '+8.35', '1e5', '8.', '.35', 'NaN', 'Infinity']) {
    assert.throws(() => toMinorUnits(bad, 'USD'), InvalidAmountError, JSON.stringify(bad));
  }
  assert.throws(() => toMinorUnits(Number.NaN, 'USD'), InvalidAmountError);
  assert.throws(() => toMinorUnits(Number.POSITIVE_INFINITY, 'USD'), InvalidAmountError);
  assert.throws(() => toMinorUnits(1e21, 'USD'), InvalidAmountError);
  const caught = (() => {
    try {
      toMinorUnits('8,35', 'USD');
    } catch (error) {
      return error;
    }
    return undefined;
  })();
  assert.ok(caught instanceof UcpFulfillmentError);
  assert.equal((caught as UcpFulfillmentError).retryable, false);
});

test('overrides thread through toMinorUnits', () => {
  assert.equal(toMinorUnits('1.5', 'MMM', { MMM: 3 }), 1500);
});
