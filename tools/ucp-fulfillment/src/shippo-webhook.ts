import type { FulfillmentEvent, Order } from './generated/index.js';
import { MalformedTrackError, ShippoApiVersionError, UcpFulfillmentError } from './errors.js';
import {
  buildFulfillmentEventResult,
  normalizeTrack,
  type LineItemRef,
  type ShippoTrackInput,
  type ShippoTransactionInput,
} from './tracking.js';
import type { TrackingUrlTemplates } from './carriers.js';
import {
  appendFulfillmentEvent,
  assertLineItemsMatchOrder,
  assertOrderShape,
  buildOrderEventRequest,
  classifyEvent,
  sendOrderEvent,
  type FetchLike,
  type FulfilledResolver,
  type OrderEventRequest,
  type RequestSigner,
} from './order-webhook.js';
import { verifyShippoTrust, type ShippoTrust } from './shippo-verify.js';

/** What the merchant knows about the order a Shippo track belongs to. */
export interface OrderResolution {
  order: Order;
  /** Which order lines this shipment fulfills, in steps of each line's quantity_unit. */
  lineItems: LineItemRef[];
  /** An explicit tracking URL, which outranks every other source. */
  trackingUrl?: string;
  /** The purchasing Shippo transaction. Store tracking_url_provider at purchase and pass it here. */
  transaction?: ShippoTransactionInput | null;
  trackingUrlTemplates?: TrackingUrlTemplates;
  shippoTrackingUserId?: string;
  carrierDisplayNames?: Readonly<Record<string, string>>;
}

export interface TrackWebhookBuildOptions {
  /** REQUIRED. How this request was authenticated as coming from Shippo. */
  trust: ShippoTrust;
  /** Look up the order and its line items for a track. Return undefined to skip. */
  resolveOrder: (
    track: ShippoTrackInput,
  ) => Promise<OrderResolution | undefined> | OrderResolution | undefined;
  /** The Platform's order webhook_url. */
  webhookUrl: string;
  /** The merchant's own /.well-known/ucp profile URL. */
  businessProfileUrl: string;
  /**
   * Inbound request headers, so the handler can check Shippo-API-Version. OPTIONAL, and the
   * version refusal runs ONLY when this is passed. Without it an old-version payload (a Transaction
   * where this library expects a Track) degrades to MalformedTrackError('carrier') and a
   * build_failed skip instead of the clear ShippoApiVersionError, so pass the headers through as
   * the worker example in the README does.
   */
  headers?: Record<string, string | undefined>;
  /** Accept Shippo test-mode payloads. Default false: test traffic must not mutate real orders. */
  allowTestMode?: boolean;
  /** Override the deterministic Webhook-Id. */
  webhookId?: string;
  /** Throw when an event past processing has no tracking URL. Default false. */
  requireTrackingUrl?: boolean;
  fulfilledResolver?: FulfilledResolver;
  /** Clock for the HMAC timestamp tolerance. */
  now?: Date;
  /** HMAC timestamp tolerance in seconds. Default 300. */
  toleranceSeconds?: number;
}

export type TrackWebhookSkip =
  | { handled: false; reason: 'not_track_updated' | 'no_order' | 'test_mode' | 'duplicate_event' | 'stale_event' }
  | { handled: false; reason: 'build_failed'; error: UcpFulfillmentError };

export type TrackWebhookPlan =
  | TrackWebhookSkip
  | {
      handled: true;
      event: FulfillmentEvent;
      /** The order snapshot with the event inserted. Persist this; it is what was posted. */
      order: Order;
      request: OrderEventRequest;
      /** Named omissions and approximations. Log them; they are never silent. */
      warnings: string[];
    };

export interface TrackWebhookHandlerOptions extends TrackWebhookBuildOptions {
  sign?: RequestSigner;
  allowUnsigned?: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type TrackWebhookResult =
  | TrackWebhookSkip
  | {
      handled: true;
      event: FulfillmentEvent;
      order: Order;
      request: OrderEventRequest;
      warnings: string[];
      status: number;
    };

/**
 * The oldest Shippo API version whose track_updated payload carries a Track rather than a
 * Transaction.
 */
const SHIPPO_API_VERSION_FLOOR = '2018-02-08';

/**
 * Whether a Shippo-API-Version header sits below the floor, compared as DATES.
 *
 * A lexicographic string compare passes an unpadded version such as `2018-2-8`, which sorts above
 * `2018-02-08` because '2' > '0' at the fifth character. Both sides are parsed as a zero-padded
 * YYYY-MM-DD at UTC midnight instead, which is timezone independent; anything that is not that
 * shape, or that is a real string but not a real date, counts as below the floor rather than as
 * good enough, because a version this library cannot read is not a version it can vouch for.
 */
function apiVersionBelowFloor(version: string, floor: string): boolean {
  const asUtcDay = (value: string): number => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return Number.NaN;
    return Date.parse(`${value.trim()}T00:00:00Z`);
  };
  const parsed = asUtcDay(version);
  if (Number.isNaN(parsed)) return true;
  return parsed < asUtcDay(floor);
}

function headerValue(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value) return value;
  }
  return undefined;
}

/**
 * Parse, resolve and build. No network.
 *
 * Takes the RAW body string, not a parsed object: Shippo's HMAC covers `${timestamp}.${rawBody}`,
 * and once the body has been through JSON.parse the exact bytes are gone. Trust is verified
 * before the parse, so a forged payload never reaches resolveOrder.
 *
 * Shippo expects a 2XX within three seconds and retries twice on 408, 429 or 5XX, and its tracking
 * webhooks are not idempotent. A merchant serving real volume should enqueue the raw body, answer
 * 2XX, and call this from a worker. Called inline, the outbound POST in handleShippoTrackWebhook
 * sits inside Shippo's three second budget.
 *
 * A permanent build failure is returned as { handled: false, reason: 'build_failed', error }
 * rather than thrown, so a webhook endpoint can acknowledge it and stop an infinite retry loop.
 * A failed trust check still throws, because a rejected signature is not a payload to acknowledge.
 * An old Shippo API version on a track_updated payload also still throws, for the same reason;
 * on any other event type it is irrelevant and the payload is skipped as not_track_updated
 * instead. That version check runs only when `headers` is passed, which is why the worker example
 * in the README passes them.
 */
export async function buildTrackWebhookRequest(
  rawBody: string,
  opts: TrackWebhookBuildOptions,
): Promise<TrackWebhookPlan> {
  verifyShippoTrust(rawBody, opts.trust, { now: opts.now, toleranceSeconds: opts.toleranceSeconds });

  // Parsing and the not_track_updated check sit outside the try/catch below (which converts a
  // permanent UcpFulfillmentError to build_failed) so that a malformed body still resolves to a
  // clean build_failed result via this direct return, and so the API-version check that follows
  // can still throw for real: it must not be swallowed into build_failed.
  let envelope: { event?: unknown; data?: unknown; test?: unknown };
  try {
    envelope = JSON.parse(rawBody) as { event?: unknown; data?: unknown; test?: unknown };
  } catch {
    return { handled: false, reason: 'build_failed', error: new MalformedTrackError('JSON body') };
  }
  if (!envelope || envelope.event !== 'track_updated') {
    return { handled: false, reason: 'not_track_updated' };
  }

  // Below the not_track_updated return: an old API version only matters for a track_updated
  // payload this library is actually about to read as a Track. An unrelated event type (say,
  // transaction_created) is skipped regardless of the sender's API version, not thrown for it.
  const version = headerValue(opts.headers, 'shippo-api-version');
  if (version && apiVersionBelowFloor(version, SHIPPO_API_VERSION_FLOOR)) {
    throw new ShippoApiVersionError(version);
  }

  try {
    if (envelope.test === true && !opts.allowTestMode) return { handled: false, reason: 'test_mode' };

    const track = normalizeTrack(envelope.data);
    const resolution = await opts.resolveOrder(track);
    if (!resolution) return { handled: false, reason: 'no_order' };

    assertOrderShape(resolution.order);

    const { event, warnings } = buildFulfillmentEventResult(track, {
      lineItems: resolution.lineItems,
      trackingUrl: resolution.trackingUrl,
      transaction: resolution.transaction,
      trackingUrlTemplates: resolution.trackingUrlTemplates,
      shippoTrackingUserId: resolution.shippoTrackingUserId,
      carrierDisplayNames: resolution.carrierDisplayNames,
      requireTrackingUrl: opts.requireTrackingUrl,
    });

    // Classify BEFORE reconciling. A redelivered or stale event is not a merchant mistake, and
    // running the line item reconciliation first would report it as a permanent build_failed.
    const classification = classifyEvent(resolution.order, event);
    if (classification === 'duplicate') return { handled: false, reason: 'duplicate_event' };
    if (classification === 'stale') return { handled: false, reason: 'stale_event' };

    assertLineItemsMatchOrder(resolution.order, resolution.lineItems);

    const order = appendFulfillmentEvent(resolution.order, event, {
      fulfilledResolver: opts.fulfilledResolver,
    });
    const request = buildOrderEventRequest({
      order,
      event,
      webhookUrl: opts.webhookUrl,
      businessProfileUrl: opts.businessProfileUrl,
      webhookId: opts.webhookId,
      fulfilledResolver: opts.fulfilledResolver,
    });
    return { handled: true, event, order, request, warnings };
  } catch (error) {
    if (error instanceof UcpFulfillmentError && !error.retryable) {
      return { handled: false, reason: 'build_failed', error };
    }
    throw error;
  }
}

/** Build, then send. Equivalent to buildTrackWebhookRequest followed by sendOrderEvent. */
export async function handleShippoTrackWebhook(
  rawBody: string,
  opts: TrackWebhookHandlerOptions,
): Promise<TrackWebhookResult> {
  const plan = await buildTrackWebhookRequest(rawBody, opts);
  if (!plan.handled) return plan;
  const { status } = await sendOrderEvent(plan.request, {
    sign: opts.sign,
    allowUnsigned: opts.allowUnsigned,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  return { ...plan, status };
}
