import { createHash } from 'node:crypto';
import type { Expectation, FulfillmentEvent, FulfillmentOption, PostalAddress } from './generated/index.js';
import {
  LineItemsRequiredError,
  MalformedTrackError,
  MissingTrackingStatusError,
  TrackingUrlUnresolvedError,
  UnmappedTrackingStatusError,
} from './errors.js';
import {
  carrierDisplayName,
  carrierTrackingUrl,
  templateTrackingUrl,
  shippoTrackingPageUrl,
  type TrackingUrlTemplates,
} from './carriers.js';
import type { ShippingDestinationLike } from './shipment.js';

/**
 * The fulfillment_event types this library emits, as a runtime array so a test can enumerate
 * them and the strict overlay can pin them. UCP's own vocabulary is OPEN: fulfillment_event.type
 * is a bare string whose common values live in a description, and the order spec says a business
 * may use any value that makes sense. BuildEventOptions.type is how a merchant does that.
 */
export const FULFILLMENT_EVENT_TYPES = [
  'processing',
  'shipped',
  'in_transit',
  'delivered',
  'failed_attempt',
  'canceled',
  'undeliverable',
  'returned_to_sender',
] as const;

export type FulfillmentEventType = (typeof FULFILLMENT_EVENT_TYPES)[number];

export interface ShippoSubstatusInput {
  code?: string | undefined;
  text?: string | undefined;
  actionRequired?: boolean | undefined;
}

export interface ShippoTrackingStatusInput {
  objectId?: string | undefined;
  status: string;
  substatus?: ShippoSubstatusInput | null | undefined;
  statusDate?: Date | string | null | undefined;
  statusDetails?: string | undefined;
  objectCreated?: Date | string | undefined;
}

/**
 * The subset of a Shippo Track the mapping reads. Declared structurally, so this module stays
 * dependency free and so a raw webhook body can be normalized into it without the SDK parser,
 * which rejects the nulls and naive timestamps Shippo's own documented payloads contain.
 */
export interface ShippoTrackInput {
  trackingNumber: string;
  /** Shippo carrier token, lowercase, for example "usps". */
  carrier: string;
  /**
   * The object id of the Shippo Transaction that bought the label, when the label was bought on
   * Shippo. This is the join key a merchant should key resolveOrder on: it is unique across
   * carriers, while a tracking number is unique only per carrier and carriers do reuse them.
   */
  transaction?: string | undefined;
  trackingStatus?: ShippoTrackingStatusInput | null | undefined;
  /** Full history, oldest first, as Shippo returns it. */
  trackingHistory?: ShippoTrackingStatusInput[] | undefined;
}

/** The subset of a Shippo Transaction the post-purchase event reads. */
export interface ShippoTransactionInput {
  objectId?: string | undefined;
  trackingNumber?: string | undefined;
  trackingUrlProvider?: string | undefined;
  objectCreated?: Date | string | undefined;
}

export interface LineItemRef {
  id: string;
  /**
   * Integer count of STEPS of the order line's item.quantity_unit, per the UCP fulfillment_event
   * schema. When quantity_unit is absent this is a whole-item count. For a line sold by weight at
   * scale 2, quantity 250 means 2.50 units, not 250 items.
   */
  quantity: number;
}

export interface ResolveTrackingUrlOptions {
  /** An explicit URL. Outranks everything. */
  trackingUrl?: string | undefined;
  /** The purchasing Shippo transaction, whose tracking_url_provider is Shippo's own answer. */
  transaction?: ShippoTransactionInput | null | undefined;
  /** Merchant patterns keyed by carrier token, with a {tracking_number} placeholder. */
  trackingUrlTemplates?: TrackingUrlTemplates | undefined;
  /** The merchant's Shippo user id, which turns the Shippo tracking page into a universal answer. */
  shippoTrackingUserId?: string | undefined;
}

export interface BuildEventOptions extends ResolveTrackingUrlOptions {
  /** Which order line items this shipment fulfills. Shippo does not know them; the merchant does. */
  lineItems: LineItemRef[];
  /** Event id. Default `${tracking_number}:${tracking_status.object_id}`, or a derived hash. */
  id?: string;
  /** Override the mapped type. UCP's type vocabulary is open. */
  type?: string;
  /** Carrier display-name overrides, keyed by carrier token. */
  carrierDisplayNames?: Readonly<Record<string, string>>;
  /**
   * Throw TrackingUrlUnresolvedError when an event past `processing` has no tracking URL or no
   * tracking number. Default false: UCP puts that requirement in a field description rather than
   * in the schema, and a throw inside a webhook handler turns one unmapped carrier into a
   * permanently looping endpoint. The omission is always reported in `warnings`.
   */
  requireTrackingUrl?: boolean;
}

export interface BuildExpectationOptions {
  id: string;
  lineItems: LineItemRef[];
  /** A UCP shipping destination or bare postal address. Any id and type are stripped. */
  destination: ShippingDestinationLike;
  /** Well-known values: shipping, pickup, digital. Default "shipping". */
  methodType?: string;
  /** Buyer-facing timing text. Defaults to the selected option's description. */
  description?: string;
  /**
   * The option the buyer chose, used for the default description. Typed as Pick plus an index
   * signature, not a bare Pick: a real FulfillmentOption (id, title, totals and more) is what a
   * caller actually has in hand, and Pick's stripped index signature would otherwise reject that
   * literal for carrying properties beyond the one this function reads.
   */
  option?: Pick<FulfillmentOption, 'description'> & Record<string, unknown>;
  /** "now", or an ISO 8601 timestamp for a backorder or preorder. */
  fulfillableOn?: string;
}

export interface BuildProcessingEventOptions extends ResolveTrackingUrlOptions {
  lineItems: LineItemRef[];
  /** Shippo carrier token for the purchased rate, for example "ups". */
  carrier: string;
  id?: string;
  occurredAt?: Date;
  carrierDisplayNames?: Readonly<Record<string, string>>;
}

/**
 * TRANSIT substatuses that mean a delivery attempt failed or the parcel is stalled pending
 * action. Eight are flagged action_required in Shippo's own substatus table; package_held is
 * added because the parcel is stopped at a carrier location until someone contacts the carrier,
 * which a buyer needs to see and which "in transit" hides.
 */
const TRANSIT_NEEDS_ACTION = new Set([
  'address_issue',
  'contact_carrier',
  'delivery_attempted',
  'location_inaccessible',
  'notice_left',
  'package_damaged',
  'package_held',
  'pickup_available',
  'reschedule_delivery',
]);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeStatus(raw: unknown): ShippoTrackingStatusInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  // status is required on Shippo's TrackingStatus, in the OpenAPI contract and in the SDK type. If
  // it is absent the payload is not one this library can read, and inventing UNKNOWN here would
  // post a fabricated "processing" event onto a real order while putting the guess one layer below
  // mapTrackingStatus, where UnmappedTrackingStatusError can no longer see it.
  const status = text(source['status']);
  if (!status) throw new MalformedTrackError('tracking_status.status');
  const result: ShippoTrackingStatusInput = { status };
  const objectId = text(source['object_id']) ?? text(source['objectId']);
  const statusDate = text(source['status_date']) ?? text(source['statusDate']);
  const statusDetails = text(source['status_details']) ?? text(source['statusDetails']);
  const objectCreated = text(source['object_created']) ?? text(source['objectCreated']);
  if (objectId !== undefined) result.objectId = objectId;
  if (statusDate !== undefined) result.statusDate = statusDate;
  if (statusDetails !== undefined) result.statusDetails = statusDetails;
  if (objectCreated !== undefined) result.objectCreated = objectCreated;
  const rawSub = source['substatus'];
  if (rawSub && typeof rawSub === 'object') {
    const sub = rawSub as Record<string, unknown>;
    const substatus: ShippoSubstatusInput = {};
    const code = text(sub['code']);
    const subText = text(sub['text']);
    const actionRequired = sub['action_required'] ?? sub['actionRequired'];
    if (code !== undefined) substatus.code = code;
    if (subText !== undefined) substatus.text = subText;
    if (typeof actionRequired === 'boolean') substatus.actionRequired = actionRequired;
    result.substatus = substatus;
  }
  return result;
}

/**
 * Read a raw Shippo track body (snake_case, straight from a webhook or GET /tracks/) into
 * ShippoTrackInput.
 *
 * Deliberately tolerant, and deliberately not the SDK's inbound parser. Shippo sends JSON null
 * for optional fields, sends naive timestamps in test mode, and can add a status value without an
 * API version bump; the SDK schema treats all three as hard failures, which would turn Shippo's
 * own documented test flow into a permanently retrying 500. The hard requirements are carrier,
 * tracking_number and, when a tracking_status is present, its status: nothing downstream can
 * proceed without the first two, and a status is required on Shippo's own TrackingStatus, so
 * inventing one would post a fabricated event rather than report an unreadable payload.
 */
export function normalizeTrack(raw: unknown): ShippoTrackInput {
  if (!raw || typeof raw !== 'object') throw new MalformedTrackError('track body');
  const source = raw as Record<string, unknown>;
  const carrier = text(source['carrier']);
  const trackingNumber = text(source['tracking_number']) ?? text(source['trackingNumber']);
  if (!carrier) throw new MalformedTrackError('carrier');
  if (!trackingNumber) throw new MalformedTrackError('tracking_number');
  const result: ShippoTrackInput = { carrier, trackingNumber };
  // Carried through because the README tells merchants to key resolveOrder on it. Shippo sends
  // JSON null when the label was not bought on Shippo, which must stay absent rather than become
  // the string "null".
  const transaction = text(source['transaction']);
  if (transaction !== undefined) result.transaction = transaction;
  const status = normalizeStatus(source['tracking_status'] ?? source['trackingStatus']);
  if (status) result.trackingStatus = status;
  const rawHistory = source['tracking_history'] ?? source['trackingHistory'];
  if (Array.isArray(rawHistory)) {
    const history = rawHistory
      .map((entry) => normalizeStatus(entry))
      .filter((entry): entry is ShippoTrackingStatusInput => entry !== undefined);
    if (history.length) result.trackingHistory = history;
  }
  return result;
}

/**
 * Design decision 2. PRE_TRANSIT is processing, because a label exists but the carrier has not
 * taken possession. shipped is the carrier acceptance scan and nothing else. A TRANSIT substatus
 * that requires action is a failed_attempt, because an autonomous flow watching for in_transit
 * would otherwise wait while the parcel sits at a depot. RETURNED with package_unclaimed is a
 * failed_attempt too: the buyer can still collect it, and calling it a completed return would
 * make a restock bot count inventory nobody has shipped back. Anything outside the six
 * documented statuses throws instead of degrading to a plausible wrong answer.
 */
export function mapTrackingStatus(
  status: string,
  substatusCode?: string | null,
  actionRequired?: boolean,
): FulfillmentEventType {
  const sub = (substatusCode ?? '').toLowerCase();
  switch (status.toUpperCase()) {
    case 'DELIVERED':
      return 'delivered';
    case 'RETURNED':
      return sub === 'package_unclaimed' ? 'failed_attempt' : 'returned_to_sender';
    case 'FAILURE':
      return 'undeliverable';
    case 'TRANSIT':
      if (sub === 'package_accepted') return 'shipped';
      if (TRANSIT_NEEDS_ACTION.has(sub) || actionRequired === true) return 'failed_attempt';
      return 'in_transit';
    case 'PRE_TRANSIT':
      return 'processing';
    case 'UNKNOWN':
      return 'processing';
    default:
      throw new UnmappedTrackingStatusError(status, substatusCode ?? undefined);
  }
}

/** Design decision 3, in precedence order. A blank candidate falls through to the next one. */
export function resolveTrackingUrl(
  track: Pick<ShippoTrackInput, 'carrier' | 'trackingNumber'>,
  opts: ResolveTrackingUrlOptions,
): string | undefined {
  // templateTrackingUrl, not carrierTrackingUrl: only a pattern the merchant actually supplied for
  // THIS carrier ranks here. carrierTrackingUrl falls through to the built-in table when no
  // template matches, which would return a built-in URL at this position and leave the merchant's
  // own Shippo tracking page unreachable for USPS, UPS, FedEx and DHL Express.
  const candidates = [
    opts.trackingUrl,
    opts.transaction?.trackingUrlProvider,
    templateTrackingUrl(track.carrier, track.trackingNumber, opts.trackingUrlTemplates),
    opts.shippoTrackingUserId
      ? shippoTrackingPageUrl(opts.shippoTrackingUserId, track.carrier, track.trackingNumber)
      : undefined,
    carrierTrackingUrl(track.carrier, track.trackingNumber),
  ];
  return candidates.map((candidate) => candidate?.trim()).find((candidate): candidate is string => Boolean(candidate));
}

const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Shippo documents status_date as UTC, and its test-mode payloads omit the offset. Reading a
 * naive string with the platform's local timezone would make every golden move with TZ, so an
 * offset-less timestamp is explicitly read as UTC.
 */
function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = NAIVE_TIMESTAMP.test(value.trim()) ? `${value.trim().replace(' ', 'T')}Z` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new MalformedTrackError(`tracking_status timestamp ${value}`);
  return parsed.toISOString();
}

function validLineItems(items: LineItemRef[] | undefined): items is LineItemRef[] {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(
      (item) =>
        typeof item?.id === 'string' &&
        item.id.length > 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1,
    )
  );
}

function copyLineItems(items: LineItemRef[]): Array<{ id: string; quantity: number }> {
  return items.map((item) => ({ id: item.id, quantity: item.quantity }));
}

function eventId(
  track: ShippoTrackInput,
  status: ShippoTrackingStatusInput,
  occurredAt: string,
): string {
  if (status.objectId) return `${track.trackingNumber}:${status.objectId}`;
  // No object_id: derive a stable id from the whole status identity, so two distinct same-second
  // scans do not collide into one id (which appendFulfillmentEvent would silently swallow as a
  // duplicate) and the same scan redelivered keeps one id.
  const material = [
    track.carrier,
    track.trackingNumber,
    status.status,
    status.substatus?.code ?? '',
    occurredAt,
    status.statusDetails ?? '',
  ].join('|');
  return `${track.trackingNumber}:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * The reporting form. Returns the event plus every judgment call the mapping made: fields it
 * omitted, and whether occurred_at came from the carrier scan or from Shippo's ingestion time.
 * The webhook builder uses this form and surfaces the warnings, so nothing is dropped in silence.
 */
export function buildFulfillmentEventResult(
  track: ShippoTrackInput,
  opts: BuildEventOptions,
): { event: FulfillmentEvent; warnings: string[]; occurredAtSource: 'status_date' | 'object_created' } {
  if (!validLineItems(opts.lineItems)) throw new LineItemsRequiredError();
  const status = track.trackingStatus;
  if (!status) throw new MissingTrackingStatusError(track.trackingNumber);
  const occurredAtSource = status.statusDate ? 'status_date' : 'object_created';
  const occurred = status.statusDate ?? status.objectCreated;
  if (!occurred) throw new MissingTrackingStatusError(track.trackingNumber);

  const warnings: string[] = [];
  const type = opts.type ?? mapTrackingStatus(status.status, status.substatus?.code, status.substatus?.actionRequired);
  const trackingUrl = resolveTrackingUrl(track, opts);
  const trackingNumber = track.trackingNumber.trim();
  const pastProcessing = type !== 'processing';
  if (pastProcessing && !trackingUrl) {
    warnings.push(
      `tracking_url omitted for ${track.carrier} ${track.trackingNumber} on a ${type} event: ` +
        'no explicit url, no transaction tracking_url_provider, no merchant template, ' +
        'no shippoTrackingUserId and no built-in url for this carrier',
    );
  }
  if (pastProcessing && !trackingNumber) {
    warnings.push(`tracking_number missing for ${track.carrier} on a ${type} event`);
  }
  if (pastProcessing && opts.requireTrackingUrl && (!trackingUrl || !trackingNumber)) {
    throw new TrackingUrlUnresolvedError(track.carrier, track.trackingNumber);
  }
  if (occurredAtSource === 'object_created') {
    warnings.push(
      'occurred_at fell back to object_created (Shippo ingestion time) because ' +
        'tracking_status.status_date was absent',
    );
  }

  const occurredAt = toIso(occurred);
  const event: FulfillmentEvent = {
    id: opts.id ?? eventId(track, status, occurredAt),
    occurred_at: occurredAt,
    type,
    line_items: copyLineItems(opts.lineItems),
  };
  if (trackingNumber) event.tracking_number = trackingNumber;
  if (trackingUrl) event.tracking_url = trackingUrl;
  event.carrier = carrierDisplayName(track.carrier, opts.carrierDisplayNames);
  const details = status.statusDetails?.trim();
  if (details) event.description = details;
  return { event, warnings, occurredAtSource };
}

/** The pure form: one Shippo tracking status as one UCP fulfillment_event. */
export function buildFulfillmentEvent(track: ShippoTrackInput, opts: BuildEventOptions): FulfillmentEvent {
  return buildFulfillmentEventResult(track, opts).event;
}

/**
 * Every entry in tracking_history as an event, oldest first, which is the order Shippo returns.
 * Use this to backfill an order that was already in flight when the integration went live.
 */
export function buildFulfillmentEvents(track: ShippoTrackInput, opts: BuildEventOptions): FulfillmentEvent[] {
  return (track.trackingHistory ?? []).map((status) =>
    buildFulfillmentEvent({ ...track, trackingStatus: status }, opts),
  );
}

/**
 * The buyer-facing promise that pairs with the append-only event log. UCP does not require a
 * business to publish expectations, but without one the buyer sees no arrival estimate on the
 * order. expectation.destination is a BARE postal_address, so a shipping destination's id and
 * type come off here rather than in every merchant's own code.
 */
export function buildExpectation(opts: BuildExpectationOptions): Expectation {
  if (!validLineItems(opts.lineItems)) throw new LineItemsRequiredError();
  const { id: _ignoredId, type: _ignoredType, ...destination } = opts.destination;
  const expectation: Expectation = {
    id: opts.id,
    line_items: copyLineItems(opts.lineItems),
    method_type: opts.methodType ?? 'shipping',
    destination: destination as PostalAddress,
  };
  const description = opts.description ?? opts.option?.description?.plain;
  if (description) expectation.description = description;
  if (opts.fulfillableOn) expectation.fulfillable_on = opts.fulfillableOn;
  return expectation;
}

/**
 * The first fulfillment event: the label exists and the carrier has not taken possession. Right
 * after purchase the merchant holds a Shippo Transaction rather than a Track, and this is the one
 * moment tracking_url_provider is guaranteed to be in hand, which is why design decision 3 ranks
 * it above the built-in carrier table.
 *
 * Two caveats worth knowing before a split shipment. With neither an objectId nor a trackingNumber
 * the default event id is the constant "transaction:processing", so two parcels on one order would
 * collide and appendFulfillmentEvent would swallow the second as a duplicate: pass `id` yourself
 * when you split. And with neither `occurredAt` nor `transaction.objectCreated` this falls back to
 * the wall clock, which is the only nondeterminism in the library: pass one of them in a test.
 */
export function buildProcessingEvent(
  transaction: ShippoTransactionInput,
  opts: BuildProcessingEventOptions,
): FulfillmentEvent {
  if (!validLineItems(opts.lineItems)) throw new LineItemsRequiredError();
  const trackingNumber = transaction.trackingNumber?.trim();
  const occurredAt = toIso(opts.occurredAt ?? transaction.objectCreated ?? new Date());
  const event: FulfillmentEvent = {
    id: opts.id ?? `${transaction.objectId ?? trackingNumber ?? 'transaction'}:processing`,
    occurred_at: occurredAt,
    type: 'processing',
    line_items: copyLineItems(opts.lineItems),
  };
  if (trackingNumber) {
    const trackingUrl = resolveTrackingUrl(
      { carrier: opts.carrier, trackingNumber },
      { ...opts, transaction: opts.transaction ?? transaction },
    );
    event.tracking_number = trackingNumber;
    if (trackingUrl) event.tracking_url = trackingUrl;
  }
  event.carrier = carrierDisplayName(opts.carrier, opts.carrierDisplayNames);
  return event;
}
