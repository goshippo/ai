// @ts-check
'use strict';

/**
 * shippo-to-acp.js, Convert a Shippo rates response into Agentic Commerce
 * Protocol (ACP) fulfillment options for an agentic checkout session.
 *
 * Zero runtime dependencies. Node >= 18. CommonJS, like the rest of this repo.
 *
 * Spec sources (see README.md for the field-mapping table and caveats):
 *   - ACP 2026-04-17 `FulfillmentOptionShipping` and `Total`:
 *     https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/json-schema/schema.agentic_checkout.json
 *   - ACP 2025-09-29 `FulfillmentOptionShipping` (flat subtotal/tax/total),
 *     the shape OpenAI's Agentic Checkout docs currently pin:
 *     https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2025-09-29/json-schema/schema.agentic_checkout.json
 *     https://developers.openai.com/commerce/specs/checkout
 */

/**
 * A Shippo rate object, as returned inside `rates` on POST /shipments or
 * `results` on GET /shipments/{id}/rates. Only the fields this adapter reads
 * are declared here; extra fields are ignored.
 *
 * @typedef {object} ShippoRate
 * @property {string} object_id       Unique Shippo identifier for the rate.
 * @property {string} amount          Decimal string in major units, e.g. "5.50".
 * @property {string} currency        ISO 4217 code, e.g. "USD".
 * @property {string} provider        Carrier name, e.g. "USPS".
 * @property {{ name?: string, token?: string, terms?: string }} servicelevel
 *                                    Service level; `name` is display-ready.
 * @property {number|null} [estimated_days]  Estimated transit time in days.
 * @property {string} [duration_terms]       Carrier's own delivery-time prose.
 */

/**
 * One entry of the ACP `Total` cost breakdown (2026-04-17 spec).
 * Amounts are integers in minor currency units.
 *
 * @typedef {object} AcpTotal
 * @property {string} type          One of the spec's total types, e.g. "total".
 * @property {string} display_text  Localized display text for this total.
 * @property {number} amount        Amount in minor units (cents for USD).
 */

/**
 * ACP `FulfillmentOptionShipping`, 2026-04-17 spec.
 * Required by the spec: type, id, title, totals.
 *
 * @typedef {object} AcpFulfillmentOptionShipping
 * @property {'shipping'} type
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [carrier]
 * @property {string} [earliest_delivery_time]  RFC 3339 timestamp.
 * @property {string} [latest_delivery_time]    RFC 3339 timestamp.
 * @property {AcpTotal[]} totals
 */

/**
 * ACP `FulfillmentOptionShipping`, 2025-09-29 spec (flat money fields).
 * Required by the spec: type, id, title, subtotal, tax, total.
 *
 * @typedef {object} AcpFulfillmentOptionShipping2025
 * @property {'shipping'} type
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [carrier]
 * @property {string} [earliest_delivery_time]
 * @property {string} [latest_delivery_time]
 * @property {number} subtotal   Minor units, pre-tax.
 * @property {number} tax        Minor units. Shippo rates are pre-tax, so 0.
 * @property {number} total      Minor units, subtotal + tax.
 */

/**
 * @typedef {object} ConvertOptions
 * @property {'2026-04-17'|'2025-09-29'} [specVersion]  Output shape. Default '2026-04-17'.
 * @property {Date|string|number} [shipmentDate]  Base date the parcel ships;
 *   delivery estimates are computed from it. Default: now.
 * @property {number} [deliveryWindowDays]  Days added to `latest_delivery_time`
 *   beyond the Shippo point estimate, to present an honest range. Default 0.
 * @property {string} [displayText]  `display_text` for the cost line in the
 *   2026-04-17 `totals` breakdown. Default 'Shipping'.
 */

// One fixed-length UTC day. Delivery estimates add whole multiples of this to
// the ship timestamp (see deliveryEstimate). Using UTC milliseconds keeps the
// output deterministic and immune to DST wall-clock shifts, at the cost of
// modeling calendar days rather than carrier business days.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ISO 4217 currencies with a non-2 minor-unit exponent. Everything else uses 2.
// Sources: ISO 4217 active-codes table.
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/**
 * Validate an ISO 4217 alphabetic currency code (three ASCII letters) and
 * return it upper-cased. Throws a clear TypeError otherwise.
 *
 * This is the guard for the missing-currency case: a Shippo rate that lacks
 * `currency` would otherwise stringify to "UNDEFINED", miss both exponent
 * sets, and silently price the option with a default 2-decimal exponent while
 * surfacing a bogus "UNDEFINED" settlement currency. Failing loudly here is
 * safer than emitting a malformed ACP option.
 *
 * @param {unknown} currency
 * @returns {string}
 */
function normalizeCurrency(currency) {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
    throw new TypeError(
      `Expected a 3-letter ISO 4217 currency code, got ${JSON.stringify(currency)}`
    );
  }
  return currency.toUpperCase();
}

/**
 * Minor-unit exponent for an ISO 4217 currency code (2 unless listed above).
 * Throws a clear TypeError on a missing or malformed code (see
 * {@link normalizeCurrency}).
 *
 * @param {string} currency
 * @returns {number}
 */
function currencyExponent(currency) {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Convert a Shippo decimal-string amount (major units) to an ACP integer
 * amount in minor units, without floating-point drift ("5.50" USD -> 550).
 *
 * @param {string} amount    Decimal string, e.g. "5.50", "5", "0.05".
 * @param {string} currency  ISO 4217 code.
 * @returns {number}
 */
function toMinorUnits(amount, currency) {
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) {
    throw new TypeError(
      `Expected a non-negative decimal string amount, got ${JSON.stringify(amount)}`
    );
  }
  const exponent = currencyExponent(currency);
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) {
    throw new RangeError(
      `Amount ${amount} has more precision than ${currency} supports (${exponent} decimal places)`
    );
  }
  const scaledFraction = fraction.slice(0, exponent).padEnd(exponent, '0');
  const minor = Number(whole + scaledFraction);
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Amount ${amount} ${currency} exceeds Number.MAX_SAFE_INTEGER minor units`);
  }
  return minor;
}

/**
 * Derive RFC 3339 delivery-estimate timestamps from Shippo's single
 * `estimated_days` point estimate. Returns null when Shippo did not provide
 * an estimate (both timestamp fields are optional in the ACP spec).
 *
 * Approximation, stated plainly so callers do not over-read the output:
 *   - `estimated_days` is a whole-day point estimate. This function adds
 *     `days` fixed 24h UTC days to `shipmentDate` for `earliest_delivery_time`,
 *     then `deliveryWindowDays` more for `latest_delivery_time`. With the
 *     default window of 0 the two timestamps are equal: a point, not a range.
 *   - Days are calendar days, not carrier business days, and no weekend,
 *     holiday, carrier-cutoff, or time-zone/DST modeling is applied. The
 *     result is a deterministic UTC estimate, not a delivery guarantee.
 *   - The output inherits the time-of-day of `shipmentDate`, so its sub-day
 *     precision is not meaningful; treat it as day-granular. Pass a
 *     `shipmentDate` that reflects real handling time, and widen with
 *     `deliveryWindowDays` to present an honest range.
 * For business-day accuracy, compute the dates upstream and pass them in.
 *
 * @param {ShippoRate} rate
 * @param {ConvertOptions} options
 * @returns {{ earliest_delivery_time: string, latest_delivery_time: string } | null}
 */
function deliveryEstimate(rate, options) {
  const days = rate.estimated_days;
  if (days === null || days === undefined) return null;
  if (!Number.isInteger(days) || days < 0) {
    throw new TypeError(`estimated_days must be a non-negative integer, got ${JSON.stringify(days)}`);
  }
  const base = options.shipmentDate === undefined ? new Date() : new Date(options.shipmentDate);
  if (Number.isNaN(base.getTime())) {
    throw new TypeError(`Invalid shipmentDate: ${JSON.stringify(options.shipmentDate)}`);
  }
  const windowDays = options.deliveryWindowDays ?? 0;
  if (!Number.isInteger(windowDays) || windowDays < 0) {
    throw new TypeError(`deliveryWindowDays must be a non-negative integer, got ${JSON.stringify(windowDays)}`);
  }
  const earliest = new Date(base.getTime() + days * MS_PER_DAY);
  const latest = new Date(earliest.getTime() + windowDays * MS_PER_DAY);
  return {
    earliest_delivery_time: earliest.toISOString(),
    latest_delivery_time: latest.toISOString(),
  };
}

/**
 * Convert one Shippo rate to one ACP shipping fulfillment option.
 *
 * @param {ShippoRate} rate
 * @param {ConvertOptions} [options]
 * @returns {AcpFulfillmentOptionShipping|AcpFulfillmentOptionShipping2025}
 */
function rateToFulfillmentOption(rate, options = {}) {
  if (rate === null || typeof rate !== 'object') {
    throw new TypeError('rate must be a Shippo rate object');
  }
  if (typeof rate.object_id !== 'string' || rate.object_id === '') {
    throw new TypeError('rate.object_id is required (used as the fulfillment option id)');
  }
  const specVersion = options.specVersion ?? '2026-04-17';
  if (specVersion !== '2026-04-17' && specVersion !== '2025-09-29') {
    throw new RangeError(`Unsupported specVersion: ${JSON.stringify(specVersion)}`);
  }

  const servicelevel = rate.servicelevel ?? {};
  const title = servicelevel.name || servicelevel.token;
  if (!title) {
    throw new TypeError('rate.servicelevel.name (or .token) is required (used as the option title)');
  }
  const amountMinor = toMinorUnits(rate.amount, rate.currency);
  const estimate = deliveryEstimate(rate, options);

  if (specVersion === '2025-09-29') {
    /** @type {AcpFulfillmentOptionShipping2025} */
    const legacy = {
      type: 'shipping',
      id: rate.object_id,
      title,
      // Shippo rates are pre-tax. Tax on shipping is jurisdiction-specific
      // and must be computed by the merchant's tax engine; see README caveats.
      subtotal: amountMinor,
      tax: 0,
      total: amountMinor,
    };
    if (rate.duration_terms) legacy.subtitle = rate.duration_terms;
    if (rate.provider) legacy.carrier = rate.provider;
    if (estimate) Object.assign(legacy, estimate);
    return legacy;
  }

  /** @type {AcpFulfillmentOptionShipping} */
  const option = {
    type: 'shipping',
    id: rate.object_id,
    title,
    totals: [
      {
        type: 'total',
        display_text: options.displayText ?? 'Shipping',
        amount: amountMinor,
      },
    ],
  };
  if (rate.duration_terms) option.description = rate.duration_terms;
  if (rate.provider) option.carrier = rate.provider;
  if (estimate) Object.assign(option, estimate);
  return option;
}

/**
 * Convert a Shippo rates response to the `fulfillment_options` array of an
 * ACP checkout session.
 *
 * Accepts any of:
 *   - a shipment object from POST /shipments (reads `.rates`),
 *   - a paginated response from GET /shipments/{id}/rates (reads `.results`),
 *   - a plain array of rate objects.
 *
 * All rates must share one currency: ACP prices every fulfillment option in
 * the checkout session's single ISO 4217 settlement currency.
 *
 * @param {{ rates: ShippoRate[] } | { results: ShippoRate[] } | ShippoRate[]} input
 * @param {ConvertOptions} [options]
 * @returns {{ currency: string, fulfillment_options: Array<AcpFulfillmentOptionShipping|AcpFulfillmentOptionShipping2025> }}
 */
function ratesToFulfillmentOptions(input, options = {}) {
  /** @type {ShippoRate[]|undefined} */
  let rates;
  if (Array.isArray(input)) {
    rates = input;
  } else if (input && typeof input === 'object') {
    if (Array.isArray(/** @type {any} */ (input).rates)) rates = /** @type {any} */ (input).rates;
    else if (Array.isArray(/** @type {any} */ (input).results)) rates = /** @type {any} */ (input).results;
  }
  if (!rates) {
    throw new TypeError('Expected a rates array, a shipment with .rates, or a response with .results');
  }
  if (rates.length === 0) {
    throw new RangeError('No rates to convert; check the shipment for messages explaining why no rates returned');
  }
  const currency = normalizeCurrency(rates[0].currency);
  for (const rate of rates) {
    if (normalizeCurrency(rate.currency) !== currency) {
      throw new RangeError(
        `Mixed currencies in rates (${currency} vs ${rate.currency}); an ACP checkout session has a single settlement currency`
      );
    }
  }
  return {
    currency,
    fulfillment_options: rates.map((rate) => rateToFulfillmentOption(rate, options)),
  };
}

module.exports = {
  rateToFulfillmentOption,
  ratesToFulfillmentOptions,
  toMinorUnits,
  currencyExponent,
  normalizeCurrency,
};
