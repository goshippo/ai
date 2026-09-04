import type { FulfillmentOption, FulfillmentOptionBase } from './generated/index.js';
import {
  AmountRangeError,
  CurrencyMismatchError,
  InvalidAmountError,
  MalformedRateError,
  UcpFulfillmentError,
} from './errors.js';
import { MAX_MINOR_UNITS, toMinorUnits, type CurrencyExponents } from './money.js';
import {
  deliveryWindow,
  type DeliveryWindowInput,
  type TransitDayBasis,
} from './delivery-window.js';

/** The service level fields the mapping reads from a Shippo rate. */
export interface ShippoServiceLevelInput {
  name?: string | undefined;
  terms?: string | undefined;
  token?: string | undefined;
  extendedToken?: string | undefined;
}

/**
 * The subset of a Shippo Rate the mapping reads, in the SDK's camelCase shape. Declared
 * structurally rather than imported from the SDK, so this module stays dependency free; the
 * compile-time assignability check in test/sdk-contract.test.ts pins it to the real Rate type.
 */
export interface ShippoRateInput {
  objectId: string;
  /** Buyer-facing carrier name as Shippo returns it, for example "USPS" or "DHL Express". */
  provider: string;
  servicelevel?: ShippoServiceLevelInput | undefined;
  /** Decimal string in `currency`, the sender country's currency. */
  amount: string;
  currency: string;
  /** Decimal string in `currencyLocal`, the recipient country's currency. */
  amountLocal?: string | undefined;
  currencyLocal?: string | undefined;
  estimatedDays?: number | null | undefined;
  /** Local time of day "HH:MM:SS" at the destination, with no zone. */
  arrivesBy?: string | null | undefined;
  durationTerms?: string | null | undefined;
  carrierAccount?: string | undefined;
  objectCreated?: Date | string | undefined;
}

/**
 * Which Shippo price pair to charge the buyer.
 * 'auto' (default): the pair whose currency equals the checkout currency, preferring `amount`
 * when both match. 'sender': always (amount, currency). 'local': always (amount_local,
 * currency_local). Any mode that cannot produce the checkout currency throws rather than
 * converting, because a UCP amount carries no currency of its own and a wrong one reconciles
 * against nothing.
 */
export type AmountSource = 'auto' | 'local' | 'sender';

export interface BuildOptionOptions {
  /** The checkout presentment currency. */
  currency: string;
  amountSource?: AmountSource;
  /** Minor-unit exponents for currencies the built-in ISO 4217 table does not name. */
  currencyExponents?: CurrencyExponents;
  /**
   * Design decision 6: options are priced at the Shippo rate with no markup. This hook is where
   * a merchant adds one. It receives the rate and the computed minor units, and must return a
   * non-negative safe integer.
   */
  adjustAmount?: (rate: ShippoRateInput, minorUnits: number) => number;
  /** Override the option id function. The default is design decision 5. */
  optionId?: (rate: ShippoRateInput) => string;
  /** Text for the totals line. Omitted by default, which matches every spec example. */
  displayText?: string;
  now?: Date;
  bufferBusinessDays?: number | ((rate: DeliveryWindowInput) => number);
  transitDayBasis?: TransitDayBasis;
  destinationUtcOffsetMinutes?: number;
  /** Called by buildFulfillmentOptionsResult for each rate it cannot map. */
  onSkip?: (rate: ShippoRateInput, error: UcpFulfillmentError) => void;
}

/** The options the catalog preview reads. It has no destination, so it has no timing inputs. */
export type CatalogPreviewOptions = Pick<
  BuildOptionOptions,
  'currency' | 'amountSource' | 'currencyExponents' | 'adjustAmount' | 'optionId'
>;

/** The catalog-side wrapper: options nest under a method, with no group layer. */
export interface CatalogFulfillmentMethod {
  type: string;
  description?: { plain: string };
  availability?: { available: boolean; status: string };
  options?: FulfillmentOptionBase[];
  [k: string]: unknown;
}

/** Shippo rates can only be purchased within 7 days of creation. */
export const RATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Read a raw Shippo rate body (snake_case, straight from the API or a webhook) into
 * ShippoRateInput. Deliberately tolerant, because Shippo sends JSON null for optional fields
 * such as estimated_days, duration_terms and arrives_by, and the SDK's own inbound parser
 * rejects null where it expects absence. Only the four fields the mapping cannot price without
 * are hard requirements.
 */
export function normalizeRate(raw: unknown): ShippoRateInput {
  if (!raw || typeof raw !== 'object') throw new MalformedRateError('rate body');
  const source = raw as Record<string, unknown>;
  const objectId = text(source['object_id']) ?? text(source['objectId']);
  const provider = text(source['provider']);
  const amount = text(source['amount']);
  const currency = text(source['currency']);
  if (!objectId) throw new MalformedRateError('object_id');
  if (!provider) throw new MalformedRateError('provider');
  if (!amount) throw new MalformedRateError('amount');
  if (!currency) throw new MalformedRateError('currency');

  const rawLevel = source['servicelevel'];
  const level =
    rawLevel && typeof rawLevel === 'object' ? (rawLevel as Record<string, unknown>) : undefined;

  const rate: ShippoRateInput = { objectId, provider, amount, currency };
  if (level) {
    const servicelevel: ShippoServiceLevelInput = {};
    const name = text(level['name']);
    const terms = typeof level['terms'] === 'string' ? (level['terms'] as string) : undefined;
    const token = text(level['token']);
    const extendedToken = text(level['extended_token']) ?? text(level['extendedToken']);
    if (name !== undefined) servicelevel.name = name;
    if (terms !== undefined) servicelevel.terms = terms;
    if (token !== undefined) servicelevel.token = token;
    if (extendedToken !== undefined) servicelevel.extendedToken = extendedToken;
    rate.servicelevel = servicelevel;
  }
  const amountLocal = text(source['amount_local']) ?? text(source['amountLocal']);
  const currencyLocal = text(source['currency_local']) ?? text(source['currencyLocal']);
  const estimatedDays = integer(source['estimated_days']) ?? integer(source['estimatedDays']);
  const arrivesBy = text(source['arrives_by']) ?? text(source['arrivesBy']);
  const durationTerms = text(source['duration_terms']) ?? text(source['durationTerms']);
  const carrierAccount = text(source['carrier_account']) ?? text(source['carrierAccount']);
  const objectCreated = text(source['object_created']) ?? text(source['objectCreated']);
  if (amountLocal !== undefined) rate.amountLocal = amountLocal;
  if (currencyLocal !== undefined) rate.currencyLocal = currencyLocal;
  if (estimatedDays !== undefined) rate.estimatedDays = estimatedDays;
  if (arrivesBy !== undefined) rate.arrivesBy = arrivesBy;
  if (durationTerms !== undefined) rate.durationTerms = durationTerms;
  if (carrierAccount !== undefined) rate.carrierAccount = carrierAccount;
  if (objectCreated !== undefined) rate.objectCreated = objectCreated;
  return rate;
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Design decision 5. A UCP option id is referenced across checkout updates and from catalog into
 * checkout, but a Shippo rate object_id is minted per shipment and expires after seven days, so
 * a re-rate would orphan every selection the agent is holding. The service level token is the
 * stable identity: extended_token first because Shippo documents it as unique across all service
 * levels, then token, then a slug of the provider name when the service level is empty.
 */
export function optionId(rate: ShippoRateInput): string {
  const extended = rate.servicelevel?.extendedToken?.trim();
  if (extended) return extended;
  const token = rate.servicelevel?.token?.trim();
  if (token) return token;
  return slug(rate.provider);
}

function resolveOptionId(rate: ShippoRateInput, opts: BuildOptionOptions | CatalogPreviewOptions): string {
  return (opts.optionId ?? optionId)(rate);
}

export function optionTitle(rate: ShippoRateInput): string {
  const service = rate.servicelevel?.name?.trim();
  return service ? `${rate.provider} ${service}` : rate.provider;
}

/**
 * One buyer-facing delivery claim, never two. estimated_days is a carrier calendar-day average,
 * so it is never described as "business days", and duration_terms is used only when there is no
 * estimate for it to contradict.
 */
export function optionDescription(rate: ShippoRateInput): string | undefined {
  const days = rate.estimatedDays;
  if (typeof days === 'number' && Number.isInteger(days) && days >= 0) {
    const by = rate.arrivesBy ? ` by ${rate.arrivesBy.slice(0, 5)} local time` : '';
    return days === 0 ? `Arrives same day${by}` : `Arrives in about ${days} day${days === 1 ? '' : 's'}${by}`;
  }
  const terms = rate.durationTerms?.trim();
  return terms ? terms : undefined;
}

function priceOf(
  rate: ShippoRateInput,
  opts: Pick<BuildOptionOptions, 'currency' | 'amountSource'>,
): { amount: string; currency: string } {
  const wanted = opts.currency.toUpperCase();
  const sender = { amount: rate.amount, currency: rate.currency };
  const local =
    rate.amountLocal && rate.currencyLocal
      ? { amount: rate.amountLocal, currency: rate.currencyLocal }
      : undefined;
  const source = opts.amountSource ?? 'auto';
  if (source === 'sender') {
    if (sender.currency.toUpperCase() !== wanted) {
      throw new CurrencyMismatchError(rate.objectId, sender.currency, opts.currency);
    }
    return sender;
  }
  if (source === 'local') {
    if (!local) throw new CurrencyMismatchError(rate.objectId, '(amount_local absent)', opts.currency);
    if (local.currency.toUpperCase() !== wanted) {
      throw new CurrencyMismatchError(rate.objectId, local.currency, opts.currency);
    }
    return local;
  }
  if (sender.currency.toUpperCase() === wanted) return sender;
  if (local && local.currency.toUpperCase() === wanted) return local;
  throw new CurrencyMismatchError(
    rate.objectId,
    local ? `${sender.currency} or ${local.currency}` : sender.currency,
    opts.currency,
  );
}

function amountOf(rate: ShippoRateInput, opts: BuildOptionOptions | CatalogPreviewOptions): number {
  const price = priceOf(rate, opts);
  const base = toMinorUnits(price.amount, price.currency, opts.currencyExponents);
  if (!opts.adjustAmount) return base;
  const adjusted = opts.adjustAmount(rate, base);
  if (!Number.isInteger(adjusted) || adjusted < 0) {
    throw new InvalidAmountError(
      adjusted,
      `adjustAmount returned ${JSON.stringify(adjusted)} for rate ${rate.objectId}: it must return a ` +
        `non-negative whole number of minor units, and it was given ${base}.`,
    );
  }
  if (adjusted > MAX_MINOR_UNITS) throw new AmountRangeError(adjusted, price.currency);
  return adjusted;
}

/** The amount on the option's `type: "total"` entry, which is what the buyer pays. */
export function optionTotalAmount(option: FulfillmentOption): number {
  const total = option.totals.find((entry) => entry.type === 'total');
  if (!total) {
    throw new InvalidAmountError(
      option.totals,
      `fulfillment_option ${JSON.stringify(option.id)} has no entry of type "total" in totals, so ` +
        'there is no amount the buyer pays. UCP requires a total entry on every fulfillment_option.',
    );
  }
  return total.amount;
}

/** One Shippo rate as one UCP checkout fulfillment_option: cost plus timing. */
export function buildFulfillmentOption(rate: ShippoRateInput, opts: BuildOptionOptions): FulfillmentOption {
  const amount = amountOf(rate, opts);
  const total: FulfillmentOption['totals'][number] = { type: 'total', amount };
  if (opts.displayText) total.display_text = opts.displayText;
  const option: FulfillmentOption = {
    id: resolveOptionId(rate, opts),
    title: optionTitle(rate),
    carrier: rate.provider,
    ...deliveryWindow(rate, opts),
    totals: [total],
  };
  const description = optionDescription(rate);
  if (description) option.description = { plain: description };
  return orderKeys(option);
}

/**
 * Rebuild the option with a stable key order, so a golden reads in the order a person would
 * write it: identity, then rendering, then timing, then money.
 */
function orderKeys(option: FulfillmentOption): FulfillmentOption {
  const ordered: Record<string, unknown> = { id: option.id, title: option.title };
  if (option.description) ordered.description = option.description;
  if (option.carrier) ordered.carrier = option.carrier;
  if (option.earliest_fulfillment_time) ordered.earliest_fulfillment_time = option.earliest_fulfillment_time;
  if (option.latest_fulfillment_time) ordered.latest_fulfillment_time = option.latest_fulfillment_time;
  ordered.totals = option.totals;
  return ordered as FulfillmentOption;
}

/**
 * The same carrier returns one rate per active carrier account for the same service. Keep the
 * cheapest per option id so ids stay unique inside a group and the buyer is not shown one
 * service twice, then sort cheapest first.
 */
function dedupeAndSort(options: FulfillmentOption[]): FulfillmentOption[] {
  const best = new Map<string, FulfillmentOption>();
  for (const option of options) {
    const current = best.get(option.id);
    if (!current || optionTotalAmount(option) < optionTotalAmount(current)) best.set(option.id, option);
  }
  return [...best.values()].sort((a, b) => optionTotalAmount(a) - optionTotalAmount(b));
}

/** Every rate as an option, cheapest first. Throws on the first rate it cannot map. */
export function buildFulfillmentOptions(
  rates: ShippoRateInput[],
  opts: BuildOptionOptions,
): FulfillmentOption[] {
  return dedupeAndSort(rates.map((rate) => buildFulfillmentOption(rate, opts)));
}

/**
 * The tolerant form: map what can be mapped and report the rest, so one rate in the wrong
 * currency cannot empty a buyer's shipping options. Nothing is dropped silently: every skipped
 * rate appears in `skipped` and, if supplied, is passed to onSkip.
 */
export function buildFulfillmentOptionsResult(
  rates: ShippoRateInput[],
  opts: BuildOptionOptions,
): { options: FulfillmentOption[]; skipped: Array<{ rate: ShippoRateInput; error: UcpFulfillmentError }> } {
  const built: FulfillmentOption[] = [];
  const skipped: Array<{ rate: ShippoRateInput; error: UcpFulfillmentError }> = [];
  for (const rate of rates) {
    try {
      built.push(buildFulfillmentOption(rate, opts));
    } catch (error) {
      if (!(error instanceof UcpFulfillmentError)) throw error;
      skipped.push({ rate, error });
      opts.onSkip?.(rate, error);
    }
  }
  return { options: dedupeAndSort(built), skipped };
}

/**
 * The rate kept per option id, ranked exactly as buildFulfillmentOptionsResult ranks them.
 *
 * A rate this library cannot price is SKIPPED rather than thrown, matching the tolerance of the
 * Result form the checkout path uses: buildShippingFulfillment happily returns a checkout built
 * from a mixed-currency rate array, and the README then calls matchSelectedOption and
 * rateIdsByOptionId on that same array. Throwing here would give a merchant a working checkout and
 * an exception at the moment the buyer chooses. A skipped rate is simply not selectable, which is
 * the same answer the option list already gave.
 */
function winningRates(rates: ShippoRateInput[], opts: BuildOptionOptions): Map<string, ShippoRateInput> {
  const best = new Map<string, { rate: ShippoRateInput; amount: number }>();
  for (const rate of rates) {
    const id = resolveOptionId(rate, opts);
    let amount: number;
    try {
      amount = amountOf(rate, opts);
    } catch (error) {
      if (!(error instanceof UcpFulfillmentError)) throw error;
      continue;
    }
    const current = best.get(id);
    if (!current || amount < current.amount) best.set(id, { rate, amount });
  }
  return new Map([...best].map(([id, entry]) => [id, entry.rate]));
}

/**
 * Option id to the Shippo rate object_id the merchant purchases against, for this rating round.
 * The winner is the same rate buildFulfillmentOptions kept, so the id the buyer selected and the
 * rate the merchant buys always agree.
 */
export function rateIdsByOptionId(
  rates: ShippoRateInput[],
  opts: BuildOptionOptions,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [id, rate] of winningRates(rates, opts)) map[id] = rate.objectId;
  return map;
}

/** The rate a selected_option_id refers to in the current rate set, if any. */
export function matchSelectedOption(
  selectedOptionId: string | null | undefined,
  rates: ShippoRateInput[],
  opts: BuildOptionOptions,
): ShippoRateInput | undefined {
  if (!selectedOptionId) return undefined;
  return winningRates(rates, opts).get(selectedOptionId);
}

/**
 * Catalog preview: no destination and no cart yet, so the spec asks for boundary options rather
 * than the full set. Cheapest, then fastest when that is a different option. Base options carry
 * no totals, so a mixed-currency list would rank by an incomparable number with nothing on the
 * output to reveal it; every rate is therefore priced in the checkout currency first, which
 * makes a mixed list a CurrencyMismatchError rather than a wrong "cheapest".
 */
export function buildCatalogPreviewOptions(
  rates: ShippoRateInput[],
  opts: CatalogPreviewOptions,
): FulfillmentOptionBase[] {
  if (rates.length === 0) return [];
  const priced = rates.map((rate) => ({ rate, amount: amountOf(rate, opts) }));
  const cheapest = [...priced].sort((a, b) => a.amount - b.amount)[0].rate;
  const withEstimate = priced.filter((entry) => Number.isInteger(entry.rate.estimatedDays));
  const fastest = [...withEstimate].sort(
    (a, b) => (a.rate.estimatedDays as number) - (b.rate.estimatedDays as number),
  )[0]?.rate;
  const cheapestId = resolveOptionId(cheapest, opts);
  const picks =
    fastest && resolveOptionId(fastest, opts) !== cheapestId ? [cheapest, fastest] : [cheapest];
  return picks.map((rate) => {
    const base: FulfillmentOptionBase = { id: resolveOptionId(rate, opts), title: optionTitle(rate) };
    const description = optionDescription(rate);
    if (description) base.description = { plain: description };
    return base;
  });
}

/** The catalog method wrapper the fulfillment extension nests catalog options inside. */
export function catalogShippingMethod(
  rates: ShippoRateInput[],
  opts: CatalogPreviewOptions & { description?: string; available?: boolean },
): CatalogFulfillmentMethod {
  const method: CatalogFulfillmentMethod = { type: 'shipping' };
  if (opts.description) method.description = { plain: opts.description };
  if (opts.available !== undefined) {
    method.availability = { available: opts.available, status: opts.available ? 'in_stock' : 'out_of_stock' };
  }
  const options = buildCatalogPreviewOptions(rates, opts);
  if (options.length) method.options = options;
  return method;
}

/** True when a rate is older than Shippo's seven day purchase window. */
export function isRateExpired(rate: Pick<ShippoRateInput, 'objectCreated'>, now: Date = new Date()): boolean {
  if (!rate.objectCreated) return false;
  const created = rate.objectCreated instanceof Date ? rate.objectCreated : new Date(rate.objectCreated);
  if (Number.isNaN(created.getTime())) return false;
  return now.getTime() - created.getTime() > RATE_MAX_AGE_MS;
}
