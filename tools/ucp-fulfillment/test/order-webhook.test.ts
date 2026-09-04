import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  assertOrderShape,
  assertLineItemsMatchOrder,
  classifyEvent,
  appendFulfillmentEvent,
  buildOrderEventRequest,
  contentDigest,
  webhookIdForEvent,
  sendOrderEvent,
  type FetchLike,
  type OrderEventRequest,
} from '../src/order-webhook.ts';
import {
  InvalidOrderError,
  LineItemMismatchError,
  OrderEventDeliveryError,
  SignerConflictError,
  UnsignedWebhookError,
} from '../src/errors.ts';
import type { Order, FulfillmentEvent } from '../src/generated/index.ts';
import { validateUcp, assertOnlyKnownKeys, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const order = (): Order =>
  JSON.parse(readFileSync(new URL('./fixtures/order.valid.json', import.meta.url), 'utf8'));

const EVENT: FulfillmentEvent = {
  id: '1Z999AA10123456784:ts_accepted_1',
  occurred_at: '2026-09-03T15:42:10.000Z',
  type: 'shipped',
  line_items: [{ id: 'li_shirt', quantity: 2 }],
  tracking_number: '1Z999AA10123456784',
  tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
  carrier: 'UPS',
};
const WEBHOOK_URL = 'https://platform.example/webhooks/ucp/orders';
const PROFILE = 'https://merchant.example/.well-known/ucp';
const SIGNER = () => ({
  'Signature-Input':
    'sig1=("@method" "@authority" "@path" "ucp-agent" "content-digest" "content-type");created=1788450130;keyid="merchant-2026"',
  Signature: 'sig1=:MEUCIQD0000000000000000000000000000000000000000000000000000000:',
});
const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '' });
const statusFetch = (status: number): FetchLike => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => 'body',
});

test('the fixture is a valid UCP Order', () => {
  const o = order();
  validateUcp(SCHEMA_IDS.order, o);
  assertOnlyKnownKeys(SCHEMA_IDS.order, o as unknown as Record<string, unknown>);
  assert.doesNotThrow(() => assertOrderShape(o));
});

test('assertOrderShape names every missing piece at once', () => {
  assert.throws(() => assertOrderShape(null), InvalidOrderError);
  assert.throws(() => assertOrderShape('order_123'), InvalidOrderError);
  assert.throws(
    () => assertOrderShape({ id: 'order_123' }),
    (error: unknown) =>
      error instanceof InvalidOrderError &&
      error.problems.includes('missing ucp') &&
      error.problems.includes('missing line_items') &&
      error.problems.includes('missing fulfillment') &&
      error.retryable === false,
  );
  const noFulfillment = { ...order(), fulfillment: 'nope' };
  assert.throws(() => assertOrderShape(noFulfillment), /fulfillment/);
});

test('assertOrderShape catches a non-array fulfillment.events before it becomes a raw TypeError', () => {
  const badEvents = { ...order(), fulfillment: { expectations: [], events: 'nope' } };
  assert.throws(
    () => assertOrderShape(badEvents),
    (error: unknown) =>
      error instanceof InvalidOrderError && error.problems.includes('fulfillment.events must be an array'),
  );
  // A well-formed fulfillment with events omitted or null is still fine.
  assert.doesNotThrow(() => assertOrderShape({ ...order(), fulfillment: { expectations: [] } }));
});

test('appendFulfillmentEvent appends once, never mutates, and copies line_items', () => {
  const o = order();
  const next = appendFulfillmentEvent(o, EVENT);
  assert.equal(o.fulfillment.events?.length, 0);
  assert.equal(o.line_items[0].quantity.fulfilled, 0);
  assert.equal(next.fulfillment.events?.length, 1);
  assert.notEqual(next.line_items, o.line_items);
  assert.notEqual(next.fulfillment, o.fulfillment);
  const again = appendFulfillmentEvent(next, EVENT);
  assert.equal(again, next, 'a repeated event id must be a no-op returning the same object');
  assert.equal(classifyEvent(next, EVENT), 'duplicate');
  assert.equal(classifyEvent(o, EVENT), 'new');
});

test('a delivered event advances quantity.fulfilled and the derived status', () => {
  const next = appendFulfillmentEvent(order(), { ...EVENT, type: 'delivered' });
  assert.equal(next.line_items[0].quantity.fulfilled, 2);
  assert.equal(next.line_items[0].status, 'fulfilled');
  assert.equal(next.line_items[0].quantity.total, 2);
  assert.equal(next.line_items[0].quantity.original, 2);
  validateUcp(SCHEMA_IDS.order, next);
});

test('a partial shipment reports partial, and a lifecycle does not double count', () => {
  const half = appendFulfillmentEvent(order(), {
    ...EVENT,
    id: 'e1',
    type: 'shipped',
    line_items: [{ id: 'li_shirt', quantity: 1 }],
  });
  assert.equal(half.line_items[0].quantity.fulfilled, 1);
  assert.equal(half.line_items[0].status, 'partial');
  const same = appendFulfillmentEvent(half, {
    ...EVENT,
    id: 'e2',
    type: 'delivered',
    occurred_at: '2026-09-04T09:00:00.000Z',
    line_items: [{ id: 'li_shirt', quantity: 1 }],
  });
  assert.equal(
    same.line_items[0].quantity.fulfilled,
    1,
    'shipped then delivered for the same goods is one fulfillment, not two',
  );
  assert.equal(same.line_items[0].status, 'partial');
  validateUcp(SCHEMA_IDS.order, same);
});

test('non-fulfilling event types do not mark anything fulfilled', () => {
  for (const type of ['processing', 'failed_attempt', 'canceled', 'undeliverable', 'returned_to_sender']) {
    const next = appendFulfillmentEvent(order(), { ...EVENT, id: `e_${type}`, type });
    assert.equal(next.line_items[0].quantity.fulfilled, 0, type);
    assert.equal(next.line_items[0].status, 'processing', type);
  }
});

test('a removed line reads as removed, and fulfilled never exceeds total', () => {
  const removed = order();
  removed.line_items[0].quantity = { original: 2, total: 0, fulfilled: 0 };
  const next = appendFulfillmentEvent(removed, EVENT);
  assert.equal(next.line_items[0].status, 'removed');
  assert.equal(next.line_items[0].quantity.fulfilled, 0);
});

test('a fulfilledResolver override replaces the derivation entirely', () => {
  const next = appendFulfillmentEvent(order(), EVENT, { fulfilledResolver: () => ({ li_shirt: 1 }) });
  assert.equal(next.line_items[0].quantity.fulfilled, 1);
  assert.equal(next.line_items[0].status, 'partial');
});

test('events are stored in occurred_at order, not arrival order', () => {
  // Both events are non-terminal on purpose: ordering and the stale guard are separate rules,
  // and a terminal `later` would make the earlier one stale rather than out of order.
  const later = { ...EVENT, id: 'b', type: 'in_transit', occurred_at: '2026-09-04T09:00:00.000Z' };
  const earlier = { ...EVENT, id: 'a', type: 'shipped', occurred_at: '2026-09-03T09:00:00.000Z' };
  const o = appendFulfillmentEvent(appendFulfillmentEvent(order(), later), earlier);
  assert.deepEqual(o.fulfillment.events?.map((event) => event.id), ['a', 'b']);
  validateUcp(SCHEMA_IDS.order, o);
});

test('a stale non-terminal event never lands after a terminal one', () => {
  const delivered = { ...EVENT, id: 'd', type: 'delivered', occurred_at: '2026-09-03T15:42:10.000Z' };
  const late = { ...EVENT, id: 'l', type: 'in_transit', occurred_at: '2026-09-03T14:10:00.000Z' };
  const withTerminal = appendFulfillmentEvent(order(), delivered);
  assert.equal(classifyEvent(withTerminal, late), 'stale');
  const after = appendFulfillmentEvent(withTerminal, late);
  assert.equal(after, withTerminal);
  assert.deepEqual(after.fulfillment.events?.map((event) => event.type), ['delivered']);
  // A LATER non-terminal event is real news and is kept.
  const newer = { ...EVENT, id: 'n', type: 'failed_attempt', occurred_at: '2026-09-04T10:00:00.000Z' };
  assert.equal(classifyEvent(withTerminal, newer), 'new');
});

test('a terminal event is always allowed, even out of order, so a return after a delivery is recorded', () => {
  const delivered = { ...EVENT, id: 'd', type: 'delivered', occurred_at: '2026-09-03T15:42:10.000Z' };
  const returned = { ...EVENT, id: 'r', type: 'returned_to_sender', occurred_at: '2026-09-02T09:00:00.000Z' };
  const o = appendFulfillmentEvent(appendFulfillmentEvent(order(), delivered), returned);
  assert.deepEqual(o.fulfillment.events?.map((event) => event.id), ['r', 'd']);
});

test('line item references are reconciled against the order', () => {
  const o = order();
  assert.doesNotThrow(() => assertLineItemsMatchOrder(o, [{ id: 'li_shirt', quantity: 2 }]));
  assert.throws(() => assertLineItemsMatchOrder(o, [{ id: 'li_shrit', quantity: 1 }]), LineItemMismatchError);
  assert.throws(
    () => assertLineItemsMatchOrder(o, [{ id: 'li_shirt', quantity: 5 }]),
    /exceeds the line total of 2/,
  );
  const partial = appendFulfillmentEvent(o, { ...EVENT, id: 'e1', line_items: [{ id: 'li_shirt', quantity: 1 }] });
  assert.doesNotThrow(() => assertLineItemsMatchOrder(partial, [{ id: 'li_shirt', quantity: 1 }]));
  // A later event for the same parcel may restate the full quantity; only above total is refused.
  assert.doesNotThrow(() => assertLineItemsMatchOrder(partial, [{ id: 'li_shirt', quantity: 2 }]));
});

test('the whole carrier lifecycle lands: shipped, in_transit, delivered', () => {
  const refs = [{ id: 'li_shirt', quantity: 2 }];
  let o = order();
  for (const [id, type, at] of [
    ['e1', 'shipped', '2026-09-03T15:42:10.000Z'],
    ['e2', 'in_transit', '2026-09-04T08:00:00.000Z'],
    ['e3', 'delivered', '2026-09-05T11:00:00.000Z'],
  ] as Array<[string, string, string]>) {
    assert.doesNotThrow(() => assertLineItemsMatchOrder(o, refs));
    o = appendFulfillmentEvent(o, { ...EVENT, id, type, occurred_at: at, line_items: refs });
  }
  assert.deepEqual(o.fulfillment.events?.map((event) => event.type), ['shipped', 'in_transit', 'delivered']);
  assert.equal(o.line_items[0].quantity.fulfilled, 2);
  validateUcp(SCHEMA_IDS.order, o);
});

test('contentDigest is RFC 9530 sha-256 with base64 between colons', () => {
  const body = '{"a":1}';
  assert.equal(contentDigest(body), `sha-256=:${createHash('sha256').update(body, 'utf8').digest('base64')}:`);
  assert.match(contentDigest('{}'), /^sha-256=:[A-Za-z0-9+/]+=*:$/);
});

test('golden: the request carries the full order snapshot and the Standard Webhooks headers', () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  assert.equal(request.url, WEBHOOK_URL);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, {
    'Content-Type': 'application/json',
    'Content-Digest': contentDigest(request.body),
    'Webhook-Id': '6a5b1851-8e5e-5c0b-a26c-934051d6cbf2',
    'Webhook-Timestamp': '1788450130',
    'UCP-Agent': 'profile="https://merchant.example/.well-known/ucp"',
  });
  const posted = JSON.parse(request.body);
  assert.equal(posted.id, 'order_123');
  assert.deepEqual(posted.fulfillment.events, [EVENT]);
  assert.equal(posted.line_items[0].quantity.fulfilled, 2);
  assert.equal(posted.line_items[0].status, 'fulfilled');
  validateUcp(SCHEMA_IDS.order, posted);
  assertOnlyKnownKeys(SCHEMA_IDS.order, posted);
});

test('Webhook-Id is a deterministic v5-shaped UUID of the event id, so retries dedupe', () => {
  assert.equal(webhookIdForEvent(EVENT.id), '6a5b1851-8e5e-5c0b-a26c-934051d6cbf2');
  assert.match(
    webhookIdForEvent(EVENT.id),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(webhookIdForEvent('other'), webhookIdForEvent(EVENT.id));
  const build = () =>
    buildOrderEventRequest({ order: order(), event: EVENT, webhookUrl: WEBHOOK_URL, businessProfileUrl: PROFILE });
  assert.equal(build().headers['Webhook-Id'], build().headers['Webhook-Id']);
  const explicit = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
    webhookId: '0f2a5f38-1f0f-4d61-8f5a-9d1f5a2f6b70',
  });
  assert.equal(explicit.headers['Webhook-Id'], '0f2a5f38-1f0f-4d61-8f5a-9d1f5a2f6b70');
});

test('Webhook-Timestamp is the event occurrence, not the send time', () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  assert.equal(request.headers['Webhook-Timestamp'], String(Math.floor(Date.parse(EVENT.occurred_at) / 1000)));
  assert.equal(request.headers['Webhook-Timestamp'], '1788450130');
  const older = buildOrderEventRequest({
    order: order(),
    event: { ...EVENT, occurred_at: '2016-07-23T00:00:00.000Z' },
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  assert.equal(older.headers['Webhook-Timestamp'], '1469232000');
});

test('the business profile URL is validated locally rather than at the platform', () => {
  for (const bad of [
    'http://merchant.example/.well-known/ucp',
    'https://merchant.example/profile',
    'https://merchant.example/.well-known/ucp/extra',
    'not a url',
    'https://merchant.example/.well-known/ucp?x=1',
    'https://merchant.example/.well-known/ucp#frag',
    'https://user:pass@merchant.example/.well-known/ucp',
  ]) {
    assert.throws(
      () => buildOrderEventRequest({ order: order(), event: EVENT, webhookUrl: WEBHOOK_URL, businessProfileUrl: bad }),
      InvalidOrderError,
      bad,
    );
  }
});

test('the business profile URL is normalized to its href, not passed through raw', () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: `  ${PROFILE}  `,
  });
  assert.equal(request.headers['UCP-Agent'], `profile="${PROFILE}"`);
});

test('sendOrderEvent refuses to transmit unsigned unless told to', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  await assert.rejects(sendOrderEvent(request, { fetch: okFetch }), UnsignedWebhookError);
  assert.equal((await sendOrderEvent(request, { fetch: okFetch, allowUnsigned: true })).status, 200);
});

test('sendOrderEvent merges the signer headers and posts the exact body it digested', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
  const recording: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 202, text: async () => '' };
  };
  const result = await sendOrderEvent(request, { fetch: recording, sign: SIGNER });
  assert.equal(result.status, 202);
  assert.equal(calls[0].url, WEBHOOK_URL);
  assert.equal(calls[0].init.body, request.body);
  assert.equal(calls[0].init.headers['Signature'], SIGNER().Signature);
  assert.equal(calls[0].init.headers['Signature-Input'], SIGNER()['Signature-Input']);
  assert.equal(calls[0].init.headers['Webhook-Id'], '6a5b1851-8e5e-5c0b-a26c-934051d6cbf2');
  assert.equal(calls[0].init.headers['Content-Digest'], contentDigest(request.body));
});

test('a signer cannot silently replace the digest or the content type', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  await assert.rejects(
    sendOrderEvent(request, { fetch: okFetch, sign: () => ({ 'Content-Digest': 'sha-256=:AAAA:' }) }),
    (error: unknown) =>
      error instanceof SignerConflictError && error.header === 'Content-Digest' && error.retryable === false,
  );
  await assert.rejects(
    sendOrderEvent(request, { fetch: okFetch, sign: () => ({ 'Content-Type': 'text/plain' }) }),
    (error: unknown) => error instanceof SignerConflictError && error.header === 'Content-Type',
  );
  // Even restating the identical value is refused: the signer's only job is Signature and
  // Signature-Input, and a duplicate header entry is a wire-level hazard regardless of whether
  // its value happens to match.
  await assert.rejects(
    sendOrderEvent(request, {
      fetch: okFetch,
      sign: (req) => ({ 'Content-Digest': req.headers['Content-Digest'] }),
    }),
    (error: unknown) => error instanceof SignerConflictError && error.header === 'Content-Digest',
  );
});

test('a signer conflict is caught case-insensitively, so a lowercase header cannot slip past the guard', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  await assert.rejects(
    sendOrderEvent(request, { fetch: okFetch, sign: () => ({ 'content-digest': 'sha-256=:AAAA:' }) }),
    (error: unknown) =>
      error instanceof SignerConflictError && error.header === 'Content-Digest' && error.retryable === false,
  );
  await assert.rejects(
    sendOrderEvent(request, { fetch: okFetch, sign: () => ({ 'webhook-id': '11111111-1111-5111-8111-111111111111' }) }),
    (error: unknown) => error instanceof SignerConflictError && error.header === 'Webhook-Id',
  );
});

test('platform 4xx and 5xx are distinguishable, so a queue knows whether to retry', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  for (const [status, retryable] of [
    [400, false],
    [404, false],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
  ] as Array<[number, boolean]>) {
    await assert.rejects(
      sendOrderEvent(request, { allowUnsigned: true, fetch: statusFetch(status) }),
      (error: unknown) =>
        error instanceof OrderEventDeliveryError && error.status === status && error.retryable === retryable,
      `HTTP ${status}`,
    );
  }
});

test('a retry of the same request reuses Webhook-Id and Content-Digest', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  const seen: Array<Record<string, string>> = [];
  const recording: FetchLike = async (_url, init) => {
    seen.push(init.headers);
    return { ok: true, status: 200, text: async () => '' };
  };
  await sendOrderEvent(request, { fetch: recording, allowUnsigned: true });
  await sendOrderEvent(request, { fetch: recording, allowUnsigned: true });
  assert.equal(seen[0]['Webhook-Id'], seen[1]['Webhook-Id']);
  assert.equal(seen[0]['Content-Digest'], seen[1]['Content-Digest']);
  assert.equal(seen[0]['Webhook-Timestamp'], seen[1]['Webhook-Timestamp']);
});

test('a hung platform aborts rather than blocking the caller forever', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  // Rejects with the signal's own reason, not an invented AbortError, so this test documents the
  // library's actual behavior: its internal timeout names its abort reason TimeoutError.
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  await assert.rejects(sendOrderEvent(request, { allowUnsigned: true, fetch: hang, timeoutMs: 25 }), {
    name: 'TimeoutError',
  });
});

test('a caller signal aborts too', async () => {
  const request = buildOrderEventRequest({
    order: order(),
    event: EVENT,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
  });
  const controller = new AbortController();
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const pending = sendOrderEvent(request, { allowUnsigned: true, fetch: hang, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('a test double satisfies FetchLike with no casts, and so does the global fetch', () => {
  const double: FetchLike = async () => ({ ok: true, status: 200, text: async () => '' });
  const real: FetchLike = globalThis.fetch;
  assert.equal(typeof double, 'function');
  assert.equal(typeof real, 'function');
  const request: OrderEventRequest = { url: 'https://x/y', method: 'POST', headers: {}, body: '{}' };
  assert.equal(request.method, 'POST');
});
