import { AmountRangeError, InvalidAmountError, UnknownCurrencyError } from './errors.js';

/** Per-currency minor-unit exponent overrides, keyed by uppercase ISO 4217 code. */
export type CurrencyExponents = Readonly<Record<string, number>>;

/** The largest value UCP's signed_amount can carry. */
export const MAX_MINOR_UNITS = 9007199254740991;
const MAX_MINOR_UNITS_BIG = 9007199254740991n;

/**
 * Active ISO 4217 codes with no minor unit. A currency absent from all four tables throws
 * UnknownCurrencyError rather than defaulting to 2, because a wrong exponent is a silent
 * factor-of-100 error that nothing downstream can detect: UCP amounts carry no currency.
 * Metals, funds and the test codes (XAU, XAG, XPT, XPD, XDR, XSU, XUA, XTS, XXX) are
 * deliberately absent: they are not spendable currencies. Retired codes are absent too; use
 * the currencyExponents override map for anything this table does not name.
 */
const EXPONENT_ZERO = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI',
  'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Active ISO 4217 codes with a three-digit minor unit. */
const EXPONENT_THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Active ISO 4217 codes with a four-digit minor unit. */
const EXPONENT_FOUR = new Set(['CLF', 'UYW']);

/** Active ISO 4217 codes with a two-digit minor unit. */
const EXPONENT_TWO = new Set([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD',
  'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK',
  'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS',
  'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IRR',
  'JMD', 'KES', 'KGS', 'KHR', 'KPW', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN',
  'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'PAB', 'PEN', 'PGK',
  'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RSD', 'RUB', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK',
  'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS',
  'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'USD', 'USN', 'UYU', 'UZS', 'VED',
  'VES', 'WST', 'XCD', 'XCG', 'YER', 'ZAR', 'ZMW', 'ZWG',
]);

/**
 * Number of minor-unit digits for a currency. MGA and MRU are exponent 2 by the standard even
 * though they subdivide by five, which is what ISO 4217 assigns and what carriers price in.
 */
export function currencyExponent(currency: string, overrides?: CurrencyExponents): number {
  const code = String(currency).trim().toUpperCase();
  const override = overrides?.[code];
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 0 || override > 4) {
      throw new InvalidAmountError(`currencyExponents.${code} = ${override}`);
    }
    return override;
  }
  if (EXPONENT_TWO.has(code)) return 2;
  if (EXPONENT_ZERO.has(code)) return 0;
  if (EXPONENT_THREE.has(code)) return 3;
  if (EXPONENT_FOUR.has(code)) return 4;
  throw new UnknownCurrencyError(currency);
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Convert a Shippo decimal amount ("8.35") to a UCP amount in minor units (835).
 *
 * Exact digit-string arithmetic in BigInt, so a large amount is either right or refused:
 * Number(integerPart) * 10 ** exponent loses precision past 2^53 and would return a confidently
 * wrong integer. Rounds half away from zero on the first digit past the exponent, which is the
 * only digit that can decide the result. Negative zero is normalized to +0 so that a golden
 * expecting 0 does not fail an Object.is comparison.
 */
export function toMinorUnits(
  amount: string | number,
  currency: string,
  overrides?: CurrencyExponents,
): number {
  const text = typeof amount === 'number' ? String(amount) : String(amount).trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new InvalidAmountError(amount);
  const [, sign, integerPart, fractionPart = ''] = match;
  const exponent = currencyExponent(currency, overrides);
  const digits = (fractionPart + '0'.repeat(exponent + 1)).slice(0, exponent + 1);
  const roundingDigit = Number(digits[exponent]);
  let minor = BigInt(integerPart + digits.slice(0, exponent));
  if (roundingDigit >= 5) minor += 1n;
  if (minor > MAX_MINOR_UNITS_BIG) throw new AmountRangeError(amount, currency);
  const value = Number(minor);
  return sign === '-' && value !== 0 ? -value : value;
}
