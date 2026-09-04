import { createHash } from 'node:crypto';
import type { FulfillmentEvent, Order } from './generated/index.js';
import {
  InvalidOrderError,
  LineItemMismatchError,
  OrderEventDeliveryError,
  SignerConflictError,
  UnsignedWebhookError,
} from './errors.js';
import type { LineItemRef } from './tracking.js';

export interface OrderEventRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/**
 * The slice of fetch this library uses. The global fetch satisfies it, and so does a plain test
 * double, which removes the `as unknown as typeof fetch` cast that otherwise hides a real
 * signature mismatch in every test.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Produces the RFC 9421 headers (Signature-Input, Signature) for a request. */
export type RequestSigner = (
  request: OrderEventRequest,
) => Promise<Record<string, string>> | Record<string, string>;

/** Replaces the derivation of quantity.fulfilled with the merchant's own bookkeeping. */
export type FulfilledResolver = (order: Order, events: FulfillmentEvent[]) => Record<string, number>;

/** Event types that move goods toward the buyer and therefore count toward quantity.fulfilled. */
const FULFILLING_TYPES = new Set(['shipped', 'in_transit', 'delivered']);

/** Event types that end the fulfillment story for a parcel. */
const TERMINAL_TYPES = new Set(['delivered', 'canceled', 'undeliverable', 'returned_to_sender']);

const REQUIRED_ORDER_KEYS = [
  'ucp',
  'id',
  'checkout_id',
  'permalink_url',
  'line_items',
  'fulfillment',
  'currency',
  'totals',
] as const;

/**
 * The headers this library builds itself. A signer may add Signature and Signature-Input but must
 * never touch any of these, in any case: HTTP header names are case-insensitive on the wire, and
 * undici merges a differently-cased duplicate into the same outgoing header rather than rejecting
 * it, so a lowercase `content-digest` from a signer would otherwise slip past a name-exact check
 * and silently corrupt (or duplicate) the header the Content-Digest was computed for.
 */
const RESERVED_REQUEST_HEADERS = [
  'Content-Type',
  'Content-Digest',
  'Webhook-Id',
  'Webhook-Timestamp',
  'UCP-Agent',
] as const;

/**
 * Fail at the library boundary rather than at the platform. An order that is missing a required
 * member produces a webhook body a conformant Platform answers with a 400, which the merchant
 * would otherwise discover in production against a real partner.
 */
export function assertOrderShape(order: unknown): asserts order is Order {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    throw new InvalidOrderError(['order must be an object']);
  }
  const candidate = order as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of REQUIRED_ORDER_KEYS) {
    if (candidate[key] === undefined || candidate[key] === null) problems.push(`missing ${key}`);
  }
  if (candidate.line_items !== undefined && !Array.isArray(candidate.line_items)) {
    problems.push('line_items must be an array');
  }
  if (candidate.totals !== undefined && !Array.isArray(candidate.totals)) {
    problems.push('totals must be an array');
  }
  if (
    candidate.fulfillment !== undefined &&
    candidate.fulfillment !== null &&
    (typeof candidate.fulfillment !== 'object' || Array.isArray(candidate.fulfillment))
  ) {
    problems.push('fulfillment must be an object with expectations and events');
  } else if (candidate.fulfillment && typeof candidate.fulfillment === 'object') {
    // A non-array fulfillment.events would otherwise reach classifyEvent's `events.some(...)`
    // unguarded and throw a raw TypeError instead of the build_failed classification a webhook
    // endpoint knows how to acknowledge.
    const events = (candidate.fulfillment as Record<string, unknown>).events;
    if (events !== undefined && events !== null && !Array.isArray(events)) {
      problems.push('fulfillment.events must be an array');
    }
  }
  // Same door, one field over. assertLineItemsMatchOrder reads line.quantity.total and
  // appendFulfillmentEvent reads quantity.fulfilled and quantity.total, so an entry without a
  // quantity object throws a raw TypeError that escapes both this taxonomy and the build_failed
  // classification, and a route following the README's error block then answers 5xx and Shippo
  // redelivers the same payload forever. `original` is optional in the schema and is only checked
  // when present, since appendFulfillmentEvent copies it through rather than reading it.
  if (Array.isArray(candidate.line_items)) {
    candidate.line_items.forEach((entry, index) => {
      const at = `line_items[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        problems.push(`${at} must be an object`);
        return;
      }
      const line = entry as Record<string, unknown>;
      if (typeof line.id !== 'string' || line.id === '') problems.push(`${at}.id must be a non-empty string`);
      const quantity = line.quantity;
      if (!quantity || typeof quantity !== 'object' || Array.isArray(quantity)) {
        problems.push(`${at}.quantity must be an object with integer total and fulfilled`);
        return;
      }
      const counts = quantity as Record<string, unknown>;
      for (const field of ['total', 'fulfilled'] as const) {
        if (!Number.isInteger(counts[field])) problems.push(`${at}.quantity.${field} must be an integer`);
      }
      if (counts.original !== undefined && !Number.isInteger(counts.original)) {
        problems.push(`${at}.quantity.original must be an integer when present`);
      }
    });
  }
  if (problems.length) throw new InvalidOrderError(problems);
}

/**
 * Cross-check the event's line item references against the order the library is holding. The
 * fulfillment_event schema has no cross-reference constraint, so Ajv accepts an event naming a
 * line item that does not exist, and the Platform then cannot reconcile the shipment to a line.
 *
 * The check is deliberately narrow: it refuses an unknown line id and a quantity above the line's
 * TOTAL, and nothing else. It must not compare against unfulfilled steps, because quantity.fulfilled
 * is a max rather than a sum, so the ordinary shipped, in_transit, delivered sequence restates the
 * same quantity three times and would otherwise be rejected after the first event. Callers run it
 * after classifyEvent, so a redelivery is reported as a duplicate rather than as a mismatch.
 */
export function assertLineItemsMatchOrder(order: Order, refs: LineItemRef[]): void {
  const byId = new Map(order.line_items.map((line) => [line.id, line]));
  const problems: string[] = [];
  for (const ref of refs) {
    const line = byId.get(ref.id);
    if (!line) {
      problems.push(`no line item ${ref.id} on order ${order.id}`);
      continue;
    }
    // quantity.fulfilled is a MAX across shipped, in_transit and delivered for the same goods,
    // never a sum, so a later event about one parcel legitimately restates a quantity already
    // counted. Only a quantity above the line's current total is impossible.
    if (ref.quantity > line.quantity.total) {
      problems.push(`${ref.id}: ${ref.quantity} exceeds the line total of ${line.quantity.total} steps`);
    }
  }
  if (problems.length) throw new LineItemMismatchError(problems);
}

/**
 * Whether an event is new to this order, a redelivery of one already recorded, or a stale
 * non-terminal event that arrived after a terminal one. Shippo gives no ordering guarantee and
 * polls carriers with hours of latency, so a DELIVERED and a retried out-for-delivery scan can
 * land in either order; letting the second one become the order's last event would tell a
 * Platform the package is still moving after it arrived.
 */
export function classifyEvent(order: Order, event: FulfillmentEvent): 'new' | 'duplicate' | 'stale' {
  const events = order.fulfillment?.events ?? [];
  if (events.some((existing) => existing.id === event.id)) return 'duplicate';
  if (TERMINAL_TYPES.has(event.type)) return 'new';
  const terminalTimes = events
    .filter((existing) => TERMINAL_TYPES.has(existing.type))
    .map((existing) => Date.parse(existing.occurred_at));
  if (!terminalTimes.length) return 'new';
  // A stored terminal event whose occurred_at does not parse counts as terminal at infinity rather
  // than dropping out of the comparison: Date.parse returns NaN, every comparison against it is
  // false, and the stale guard would switch itself off precisely on the order whose log is already
  // suspect. Fail closed. The terminal event supersedes a non-terminal one whatever its clock says,
  // and a later terminal event is still admitted by the check above.
  if (terminalTimes.some((time) => Number.isNaN(time))) return 'stale';
  if (Date.parse(event.occurred_at) <= Math.max(...terminalTimes)) return 'stale';
  return 'new';
}

function deriveFulfilled(order: Order, events: FulfillmentEvent[]): Record<string, number> {
  const fulfilled: Record<string, number> = {};
  for (const event of events) {
    if (!FULFILLING_TYPES.has(event.type)) continue;
    for (const ref of event.line_items ?? []) {
      // Max, never a sum: shipped then in_transit then delivered for one parcel are three
      // events about the same goods, and summing them would report 6 of 2 fulfilled.
      fulfilled[ref.id] = Math.max(fulfilled[ref.id] ?? 0, ref.quantity);
    }
  }
  void order;
  return fulfilled;
}

/**
 * A new Order with the event inserted into fulfillment.events in occurred_at order, and with the
 * derived per-line quantity.fulfilled and status recomputed from the whole log.
 *
 * order_line_item.json defines status as derived: removed if quantity.total is 0, fulfilled if
 * total is above 0 and fulfilled equals total, partial if total is above 0 and fulfilled is above
 * 0, otherwise processing. Appending an event without recomputing those two fields makes the
 * snapshot contradict itself, saying both "this was delivered" and "nothing has been fulfilled".
 *
 * Returns the SAME object when the event is a duplicate or stale, so a caller can detect it with
 * a reference comparison, or ask classifyEvent for the reason.
 */
export function appendFulfillmentEvent(
  order: Order,
  event: FulfillmentEvent,
  opts: { fulfilledResolver?: FulfilledResolver } = {},
): Order {
  if (classifyEvent(order, event) !== 'new') return order;
  const events = order.fulfillment?.events ?? [];
  const nextEvents = [...events, event].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );
  const fulfilledById = (opts.fulfilledResolver ?? deriveFulfilled)(order, nextEvents);
  const line_items = order.line_items.map((line) => {
    const fulfilled = Math.min(fulfilledById[line.id] ?? line.quantity.fulfilled, line.quantity.total);
    // Annotated explicitly: under this function's declared `: Order` return type, tsc infers the
    // bare ternary as widened to `string` rather than the literal union, and rejects it against
    // OrderLineItem['status']. The annotation is compile-time only; the derivation is unchanged.
    const status: Order['line_items'][number]['status'] =
      line.quantity.total === 0
        ? 'removed'
        : fulfilled === line.quantity.total
          ? 'fulfilled'
          : fulfilled > 0
            ? 'partial'
            : 'processing';
    return { ...line, quantity: { ...line.quantity, fulfilled }, status };
  });
  return { ...order, line_items, fulfillment: { ...order.fulfillment, events: nextEvents } };
}

/** RFC 9530 Content-Digest over the exact UTF-8 body bytes being sent. */
export function contentDigest(body: string): string {
  return `sha-256=:${createHash('sha256').update(body, 'utf8').digest('base64')}:`;
}

/**
 * A deterministic RFC 4122 version 5 shaped id derived from the fulfillment event id, so a retry
 * of the same event carries the same Webhook-Id and the Platform's Standard Webhooks dedupe can
 * collapse it. The OpenAPI parameter declares format: uuid, so a raw event id would not do.
 */
export function webhookIdForEvent(eventId: string): string {
  const digest = createHash('sha256').update(`ucp.order.event:${eventId}`, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface BuildOrderEventRequestOptions {
  /** The merchant's current Order snapshot. */
  order: Order;
  event: FulfillmentEvent;
  /** The Platform's order webhook_url, from its profile's dev.ucp.shopping.order config. */
  webhookUrl: string;
  /** The merchant's own profile URL, sent as UCP-Agent. */
  businessProfileUrl: string;
  /** Override the deterministic Webhook-Id. Must be a UUID. */
  webhookId?: string;
  fulfilledResolver?: FulfilledResolver;
}

/**
 * Validates businessProfileUrl and returns its canonical `href`, not the caller's raw string:
 * `new URL()` trims stray leading/trailing whitespace and otherwise normalizes the input, and the
 * UCP-Agent header must carry that canonical form rather than whatever bytes the caller happened
 * to pass. Userinfo, a query string and a fragment are all rejected: none of them can appear on a
 * bare /.well-known/ucp profile URL, and silently dropping them (as reading only protocol and
 * pathname would) would let a caller believe an extra component was accepted.
 */
function assertBusinessProfileUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidOrderError([`businessProfileUrl is not a URL: ${value}`]);
  }
  // The host check is the last two clauses. A quote or a backslash survives WHATWG parsing into
  // `href`, and the UCP-Agent value is an RFC 8941 quoted string, so such a host emits
  // profile="https://ho"st.example/..." which the Platform's signature canonicalization reads
  // differently from the sender's.
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/.well-known/ucp' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.host.includes('"') ||
    url.host.includes('\\')
  ) {
    throw new InvalidOrderError([
      'businessProfileUrl must be an https URL whose path is exactly /.well-known/ucp, with no ' +
        `userinfo, query string, fragment, quote or backslash, got ${value}`,
    ]);
  }
  return url.href;
}

/**
 * The Platform's webhook_url has to be a URL this library can POST to, and it is the URL that
 * actually receives the buyer's address, so it is checked rather than left to fail at fetch time.
 * http is allowed as well as https, unlike businessProfileUrl: a merchant's first run of this flow
 * is against a local receiver, and UCP's https requirement binds the Platform that publishes the
 * value rather than this library. The caller's exact string is what gets sent; only its shape is
 * checked here.
 */
function assertWebhookUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidOrderError([`webhookUrl is not a URL: ${value}`]);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidOrderError([`webhookUrl must be an http or https URL, got ${value}`]);
  }
}

/**
 * The UCP order capability pushes the FULL order snapshot on every event, not the bare event.
 * Headers follow Standard Webhooks (Webhook-Id, Webhook-Timestamp) plus RFC 9530 Content-Digest
 * and the UCP-Agent profile pointer. Webhook-Timestamp is the EVENT OCCURRENCE in unix seconds,
 * per the order spec's header table; Standard Webhooks reads the same header as the attempt time,
 * and the two readings disagree. The spec text wins here because a UCP Platform is what reads it,
 * and replay protection lives in the signature's own created parameter.
 *
 * RFC 9421 signing is applied by the caller's signer in sendOrderEvent, over this exact body.
 */
export function buildOrderEventRequest(opts: BuildOrderEventRequestOptions): OrderEventRequest {
  assertOrderShape(opts.order);
  assertWebhookUrl(opts.webhookUrl);
  const businessProfileUrl = assertBusinessProfileUrl(opts.businessProfileUrl);
  const occurredAt = Date.parse(opts.event.occurred_at);
  if (Number.isNaN(occurredAt)) {
    throw new InvalidOrderError([`event occurred_at is not an RFC 3339 timestamp: ${opts.event.occurred_at}`]);
  }
  const body = JSON.stringify(
    appendFulfillmentEvent(opts.order, opts.event, { fulfilledResolver: opts.fulfilledResolver }),
  );
  return {
    url: opts.webhookUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Digest': contentDigest(body),
      'Webhook-Id': opts.webhookId ?? webhookIdForEvent(opts.event.id),
      'Webhook-Timestamp': String(Math.floor(occurredAt / 1000)),
      'UCP-Agent': `profile="${businessProfileUrl}"`,
    },
    body,
  };
}

export interface SendOrderEventOptions {
  /** Produces the RFC 9421 headers. Required unless allowUnsigned is set. */
  sign?: RequestSigner;
  /** Send without a signature. UCP requires one; use this only against a local test receiver. */
  allowUnsigned?: boolean;
  fetch?: FetchLike;
  /** Abort the POST after this many milliseconds. Default 10000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Post one order event.
 *
 * UCP makes retry a business obligation ("MUST retry failed webhook deliveries"), and this
 * function deliberately does not retry: it throws OrderEventDeliveryError carrying the status and
 * a `retryable` flag, so the caller's queue owns backoff and dead-lettering. Retry by calling this
 * again with the SAME OrderEventRequest, which preserves Webhook-Id and Content-Digest and lets
 * the Platform dedupe.
 */
export async function sendOrderEvent(
  request: OrderEventRequest,
  opts: SendOrderEventOptions = {},
): Promise<{ status: number }> {
  if (!opts.sign && !opts.allowUnsigned) throw new UnsignedWebhookError();
  const signed = opts.sign ? await opts.sign(request) : {};
  const signedKeysLower = new Set(Object.keys(signed).map((key) => key.toLowerCase()));
  for (const reserved of RESERVED_REQUEST_HEADERS) {
    if (signedKeysLower.has(reserved.toLowerCase())) {
      throw new SignerConflictError(reserved);
    }
  }
  const doFetch: FetchLike = opts.fetch ?? globalThis.fetch;
  // Not AbortSignal.timeout(): its internal timer is unref'd by design, so it never fires when
  // nothing else keeps the event loop alive (a short-lived script or a lambda handler awaiting
  // this call and nothing else, or a FetchLike double with no I/O of its own, as this library's
  // own test for this exact behavior uses). A manually managed, ref'd setTimeout guarantees the
  // documented "abort after timeoutMs" contract regardless of what else is on the event loop,
  // and is cleared in `finally` so a normal response never leaves a dangling timer behind.
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(
    () => timeoutController.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    opts.timeoutMs ?? 10_000,
  );
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;
  try {
    const response = await doFetch(request.url, {
      method: request.method,
      headers: { ...request.headers, ...signed },
      body: request.body,
      signal,
    });
    if (!response.ok) throw new OrderEventDeliveryError(response.status, await response.text());
    return { status: response.status };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
