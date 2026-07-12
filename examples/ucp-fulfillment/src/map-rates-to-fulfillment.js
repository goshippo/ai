'use strict';

/**
 * Map a Shippo rates response into a UCP `dev.ucp.shopping.fulfillment` object,
 * annotated with the `com.shippo.shipping.rate_detail` companion extension.
 *
 * Primary sources (verified, see README):
 *   - UCP fulfillment spec: https://ucp.dev/2026-04-08/specification/fulfillment
 *   - UCP fulfillment option schema (base option fields carrier /
 *     earliest_fulfillment_time / latest_fulfillment_time / totals, composed
 *     over fulfillment_option_base.json id / title / description):
 *     https://github.com/Universal-Commerce-Protocol/ucp/blob/main/source/schemas/shopping/types/fulfillment_option.json
 *   - UCP core concepts / namespace governance:
 *     https://github.com/Universal-Commerce-Protocol/ucp/blob/main/docs/documentation/core-concepts.md
 *   - Shippo Rate object:
 *     https://github.com/goshippo/shippo-javascript-sdk/blob/main/docs/models/components/rate.md
 *
 * This module is dependency-free and runs on Node 18+.
 */

// Reverse-domain key under which each option carries Shippo-native detail.
const RATE_DETAIL_KEY = 'com.shippo.shipping.rate_detail';

// One fixed-length UTC day in milliseconds. Timing estimates add whole
// multiples of this to the ship date, the same deterministic approach the
// companion ACP adapter uses: UTC math immune to DST wall-clock shifts, at the
// cost of modeling calendar days rather than carrier business days.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ISO 4217 minor-unit exponents that differ from the default of 2.
// Source: ISO 4217. Only the common non-2 cases are enumerated; everything
// else falls back to 2. Extend as needed.
const MINOR_UNIT_EXPONENT = {
  // zero-decimal
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0, TWD: 0, UGX: 0, RWF: 0,
  XAF: 0, XOF: 0, XPF: 0, DJF: 0, GNF: 0, KMF: 0, PYG: 0, BIF: 0, MGA: 0,
  // three-decimal
  BHD: 3, KWD: 3, OMR: 3, TND: 3, IQD: 3, JOD: 3, LYD: 3,
};

function minorUnitExponent(currency) {
  if (typeof currency !== 'string') return 2;
  const code = currency.toUpperCase();
  return Object.prototype.hasOwnProperty.call(MINOR_UNIT_EXPONENT, code)
    ? MINOR_UNIT_EXPONENT[code]
    : 2;
}

/**
 * Convert a decimal amount string (major units, e.g. "5.50") into an integer
 * number of minor units for the given currency (e.g. 550 for USD).
 *
 * Uses string arithmetic to avoid binary-float rounding error. Rounds
 * half-up on any digits beyond the currency's precision.
 *
 * @param {string|number} amount
 * @param {string} currency ISO 4217 code
 * @returns {number} integer minor units
 */
function toMinorUnits(amount, currency) {
  const exponent = minorUnitExponent(currency);
  const raw = String(amount).trim();
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;

  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new TypeError(`Unparseable money amount: ${JSON.stringify(amount)}`);
  }

  const [intPart, fracPartRaw = ''] = unsigned.split('.');
  // Pad or truncate the fractional part to `exponent` digits, rounding half-up
  // on the first dropped digit.
  const fracPadded = fracPartRaw.padEnd(exponent + 1, '0');
  const kept = fracPadded.slice(0, exponent);
  const roundDigit = fracPadded.charAt(exponent);

  let combined = intPart + kept; // digits of the minor-unit integer, pre-round
  let value = BigInt(combined === '' ? '0' : combined);
  if (roundDigit && Number(roundDigit) >= 5) {
    value += 1n;
  }
  const result = Number(value);
  return negative ? -result : result;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Build the renderable `description.plain` for an option. `description` is the
 * spec's directly-renderable prose slot (its own examples read like "Arrives
 * Dec 12-15 via USPS"). It complements, and does not replace, the structured
 * base fields carrier / earliest_fulfillment_time / latest_fulfillment_time
 * that this mapper also sets. We prefer Shippo's own `duration_terms` phrase
 * and fall back to synthesizing one from `estimated_days`.
 */
function buildDescriptionPlain(rate) {
  const provider = rate.provider ? String(rate.provider) : undefined;
  if (rate.duration_terms) {
    const terms = String(rate.duration_terms).trim().replace(/\.$/, '');
    return provider ? `${terms} via ${provider}` : terms;
  }
  if (rate.estimated_days != null) {
    const d = Number(rate.estimated_days);
    const dayWord = d === 1 ? 'day' : 'days';
    const base = `Arrives in about ${d} business ${dayWord}`;
    return provider ? `${base} via ${provider}` : base;
  }
  return provider ? `Ships via ${provider}` : 'Shipping';
}

/**
 * Build the option title. Combines provider + service name, which distinguishes
 * an option from its siblings as the spec requires for `title`.
 */
function buildTitle(rate) {
  const provider = rate.provider ? String(rate.provider) : '';
  const service =
    rate.servicelevel && rate.servicelevel.name
      ? String(rate.servicelevel.name)
      : '';
  const title = [provider, service].filter(Boolean).join(' ').trim();
  return title || 'Shipping option';
}

/**
 * Derive the base option timing window (earliest_fulfillment_time /
 * latest_fulfillment_time, both RFC 3339 date-time) from Shippo's single
 * `estimated_days` point estimate. Returns undefined when Shippo gave no
 * estimate, since both fields are optional on the UCP fulfillment option.
 *
 * Deterministic and day-based, the same approach the companion ACP adapter
 * uses: add `estimated_days` fixed 24h UTC days to `shipmentDate` for the
 * earliest time, then `deliveryWindowDays` more for the latest. With the
 * default window of 0 the two are equal (a point estimate, not a range). These
 * are calendar days, not carrier business days: no weekend, holiday, or cutoff
 * modeling is applied. For business-day accuracy, compute the dates upstream
 * and pass a `shipmentDate` that reflects real handling time.
 *
 * @param {Object} rate Shippo rate.
 * @param {Object} opts { shipmentDate, deliveryWindowDays }.
 * @returns {{ earliest_fulfillment_time: string, latest_fulfillment_time: string }|undefined}
 */
function deriveFulfillmentWindow(rate, opts) {
  const days = rate.estimated_days;
  if (days == null) return undefined;
  if (!Number.isInteger(days) || days < 0) {
    throw new TypeError(
      `estimated_days must be a non-negative integer, got ${JSON.stringify(days)}`
    );
  }
  const base =
    opts.shipmentDate === undefined ? new Date() : new Date(opts.shipmentDate);
  if (Number.isNaN(base.getTime())) {
    throw new TypeError(
      `Invalid shipmentDate: ${JSON.stringify(opts.shipmentDate)}`
    );
  }
  const windowDays =
    opts.deliveryWindowDays == null ? 0 : opts.deliveryWindowDays;
  if (!Number.isInteger(windowDays) || windowDays < 0) {
    throw new TypeError(
      `deliveryWindowDays must be a non-negative integer, got ${JSON.stringify(windowDays)}`
    );
  }
  const earliest = new Date(base.getTime() + days * MS_PER_DAY);
  const latest = new Date(earliest.getTime() + windowDays * MS_PER_DAY);
  return {
    earliest_fulfillment_time: earliest.toISOString(),
    latest_fulfillment_time: latest.toISOString(),
  };
}

/**
 * Map a single Shippo rate into a UCP fulfillment option (base fields) plus the
 * com.shippo.shipping.rate_detail annotation.
 */
function rateToOption(rate, currency, opts = {}) {
  const amountMinor = toMinorUnits(rate.amount, currency);

  const servicelevel = rate.servicelevel || {};
  const detail = {
    rate_id: rate.object_id,
    provider: rate.provider,
    carrier_account: rate.carrier_account,
    servicelevel_token: servicelevel.token,
    servicelevel_name: servicelevel.name,
    servicelevel_terms: firstDefined(servicelevel.terms, ''),
    estimated_days:
      rate.estimated_days == null ? null : Number(rate.estimated_days),
    duration_terms: firstDefined(rate.duration_terms, ''),
    arrives_by: firstDefined(rate.arrives_by, null),
    zone: firstDefined(rate.zone, null),
    amount: String(rate.amount),
    currency: rate.currency,
    attributes: Array.isArray(rate.attributes) ? rate.attributes.slice() : [],
  };

  const option = {
    id: rate.object_id,
    title: buildTitle(rate),
    description: { plain: buildDescriptionPlain(rate) },
    totals: [{ type: 'total', amount: amountMinor }],
  };

  // Base option fields defined by dev.ucp.shopping.fulfillment itself (see
  // fulfillment_option.json: `carrier`, `earliest_fulfillment_time`,
  // `latest_fulfillment_time`). A generic UCP consumer reads carrier and
  // timing straight from the base option, without understanding the
  // com.shippo.* annotation below.
  if (rate.provider) option.carrier = String(rate.provider);
  const window = deriveFulfillmentWindow(rate, opts);
  if (window) Object.assign(option, window);

  // Shippo-only extras (rate_id, carrier_account, servicelevel_token,
  // structured estimated_days, ...) a Shippo-aware platform needs to buy the
  // label. Kept under the reverse-domain key; a generic consumer ignores it.
  option[RATE_DETAIL_KEY] = detail;

  return option;
}

/**
 * @typedef {Object} MapOptions
 * @property {string[]} lineItemIds      Cart line-item ids this shipment fulfills. Required.
 * @property {string} [checkoutCurrency] UCP checkout root currency (ISO 4217). Defaults
 *                                       to the currency of the first rate. Rates whose
 *                                       `currency` differs are skipped (see `warnings`).
 * @property {Object} [destination]      Optional UCP fulfillment destination object to attach.
 * @property {string} [methodId]         Id for the generated shipping method. Default "shipping".
 * @property {string} [groupId]          Id for the generated group. Default "package_1".
 * @property {string} [selectedRateId]   Shippo object_id to mark as selected_option_id. If
 *                                       omitted, the BESTVALUE (else CHEAPEST) rate is selected;
 *                                       if neither attribute is present, none is selected. A
 *                                       selection that does not match an emitted option is
 *                                       dropped with a warning (never a dangling reference).
 * @property {Date|string|number} [shipmentDate] Reference ship date used to derive each option's
 *                                       earliest_fulfillment_time / latest_fulfillment_time from
 *                                       the rate's estimated_days. Defaults to now.
 * @property {number} [deliveryWindowDays] Extra calendar days added to latest_fulfillment_time
 *                                       beyond the estimated_days point estimate, to present an
 *                                       honest range. Default 0 (earliest equals latest).
 */

/**
 * Map a Shippo rates response into a UCP fulfillment object.
 *
 * @param {Object|Array} shippoRates A Shippo rates response. Accepts either the raw
 *        array of Rate objects, or an object with a `results` array (the shape the
 *        Shippo API returns for GET /shipments/{id}/rates).
 * @param {MapOptions} opts
 * @returns {{ fulfillment: Object, currency: string, warnings: string[] }}
 *   `fulfillment` is a spec-valid `dev.ucp.shopping.fulfillment` object ready to be
 *   placed on a Checkout under the `fulfillment` key. `currency` is the resolved
 *   checkout currency the option `totals` are denominated in. `warnings` collects
 *   non-fatal issues (currency mismatches, empty rate sets).
 */
function mapRatesToFulfillment(shippoRates, opts) {
  if (!opts || !Array.isArray(opts.lineItemIds) || opts.lineItemIds.length === 0) {
    throw new TypeError('opts.lineItemIds (non-empty string[]) is required');
  }

  const rates = Array.isArray(shippoRates)
    ? shippoRates
    : Array.isArray(shippoRates && shippoRates.results)
    ? shippoRates.results
    : null;
  if (!rates) {
    throw new TypeError(
      'shippoRates must be an array of Rate objects or an object with a `results` array'
    );
  }

  const warnings = [];
  if (rates.length === 0) {
    warnings.push('No rates in response; produced an empty shipping method.');
  }

  const currency =
    opts.checkoutCurrency ||
    (rates[0] && rates[0].currency) ||
    'USD';

  // Keep only rates denominated in the checkout currency; a UCP checkout has a
  // single root `currency` and option totals carry no currency of their own, so
  // mixing currencies would be silently wrong. Flag any drops.
  const usable = [];
  for (const rate of rates) {
    if (rate.currency && rate.currency !== currency) {
      warnings.push(
        `Skipped rate ${rate.object_id}: currency ${rate.currency} != checkout currency ${currency}.`
      );
      continue;
    }
    usable.push(rate);
  }

  const options = usable.map((rate) => rateToOption(rate, currency, opts));
  const emittedIds = new Set(options.map((o) => o.id));

  // Resolve which option is selected.
  let selectedOptionId;
  if (opts.selectedRateId) {
    if (emittedIds.has(opts.selectedRateId)) {
      selectedOptionId = opts.selectedRateId;
    } else {
      warnings.push(
        `selectedRateId ${opts.selectedRateId} does not match any emitted option; leaving selection unset.`
      );
    }
  } else {
    const byAttr = (attr) =>
      usable.find((r) => Array.isArray(r.attributes) && r.attributes.includes(attr));
    const pick = byAttr('BESTVALUE') || byAttr('CHEAPEST');
    if (pick) selectedOptionId = pick.object_id;
  }

  const group = {
    id: opts.groupId || 'package_1',
    line_item_ids: opts.lineItemIds.slice(),
    options,
  };
  // Guard: selected_option_id must reference an option we actually emitted.
  if (selectedOptionId && emittedIds.has(selectedOptionId)) {
    group.selected_option_id = selectedOptionId;
  }

  const method = {
    id: opts.methodId || 'shipping',
    type: 'shipping',
    line_item_ids: opts.lineItemIds.slice(),
    groups: [group],
  };

  if (opts.destination && opts.destination.id) {
    method.destinations = [opts.destination];
    method.selected_destination_id = opts.destination.id;
  }

  return {
    fulfillment: { methods: [method] },
    currency,
    warnings,
  };
}

module.exports = {
  mapRatesToFulfillment,
  rateToOption,
  toMinorUnits,
  minorUnitExponent,
  RATE_DETAIL_KEY,
};
