import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { buildTrackWebhookRequest, handleShippoTrackWebhook } from '../src/shippo-webhook.ts';
import { appendFulfillmentEvent } from '../src/order-webhook.ts';
import type { FetchLike } from '../src/order-webhook.ts';
import {
  InvalidOrderError,
  MalformedTrackError,
  ShippoApiVersionError,
  ShippoSignatureError,
  LineItemMismatchError,
} from '../src/errors.ts';
import type { Order } from '../src/generated/index.ts';
import { validateUcp, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const order = (): Order => JSON.parse(raw('order.valid.json'));
const TRUST = { mode: 'caller_verified' as const, attestation: 'I verified this request came from Shippo' as const };
const WEBHOOK_URL = 'https://platform.example/webhooks/ucp/orders';
const PROFILE = 'https://merchant.example/.well-known/ucp';
const LINE_ITEMS = [{ id: 'li_shirt', quantity: 2 }];
const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '' });
// The same six-component signer order-webhook.test.ts uses. A one-component Signature-Input is
// rejected by UCP's own verifier as coverage_insufficient, and this fixture is the one a merchant
// reads first because it sits in the end-to-end golden.
const SIGNER = () => ({
  'Signature-Input':
    'sig1=("@method" "@authority" "@path" "ucp-agent" "content-digest" "content-type");created=1788450130;keyid="merchant-2026"',
  Signature: 'sig1=:MEUCIQD0000000000000000000000000000000000000000000000000000000:',
});
const base = {
  trust: TRUST,
  allowTestMode: true,
  webhookUrl: WEBHOOK_URL,
  businessProfileUrl: PROFILE,
};

test('golden: a track_updated payload becomes a posted order event', async () => {
  const posted: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
  const recording: FetchLike = async (url, init) => {
    posted.push({ url, init });
    return { ok: true, status: 200, text: async () => '' };
  };
  const result = await handleShippoTrackWebhook(raw('track_updated.accepted.json'), {
    ...base,
    resolveOrder: (track) => {
      assert.equal(track.trackingNumber, '1Z999AA10123456784');
      assert.equal(track.carrier, 'ups');
      return {
        order: order(),
        lineItems: LINE_ITEMS,
        transaction: { trackingUrlProvider: 'https://www.ups.com/track?tracknum=1Z999AA10123456784' },
      };
    },
    sign: SIGNER,
    fetch: recording,
  });
  assert.equal(result.handled, true);
  if (!result.handled) return;
  assert.equal(result.status, 200);
  assert.deepEqual(result.event, {
    id: '1Z999AA10123456784:ts_accepted_1',
    occurred_at: '2026-09-03T15:42:10.000Z',
    type: 'shipped',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: '1Z999AA10123456784',
    tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    carrier: 'UPS',
    description: 'Origin Scan',
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.order.line_items[0].quantity.fulfilled, 2);
  assert.equal(result.order.line_items[0].status, 'fulfilled');
  validateUcp(SCHEMA_IDS.order, result.order);
  validateUcp(SCHEMA_IDS.strictFulfillmentEvent, result.event);
  assert.equal(posted[0].url, WEBHOOK_URL);
  assert.equal(posted[0].init.headers['Webhook-Id'], '6a5b1851-8e5e-5c0b-a26c-934051d6cbf2');
  assert.equal(posted[0].init.headers['Webhook-Timestamp'], '1788450130');
  assert.deepEqual(JSON.parse(posted[0].init.body), result.order);
});

test('the pure builder does everything except the network', async () => {
  const plan = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
    ...base,
    resolveOrder: () => ({ order: order(), lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' }),
  });
  assert.equal(plan.handled, true);
  if (!plan.handled) return;
  assert.equal(plan.request.url, WEBHOOK_URL);
  assert.equal(plan.event.type, 'shipped');
  assert.equal(plan.order.fulfillment.events?.length, 1);
  validateUcp(SCHEMA_IDS.order, JSON.parse(plan.request.body));
});

test('a forged body is rejected before resolveOrder runs, let alone before anything is posted', async () => {
  let resolved = 0;
  await assert.rejects(
    buildTrackWebhookRequest(raw('track_updated.delivered.json'), {
      ...base,
      trust: { mode: 'hmac', secret: 'whsec_shippo_example', signatureHeader: 't=1788451200,v1=deadbeef' },
      resolveOrder: () => {
        resolved += 1;
        return undefined;
      },
    }),
    ShippoSignatureError,
  );
  assert.equal(resolved, 0, 'resolveOrder must not run on an unverified body');
});

test('a genuine HMAC body is accepted, over the raw bytes and not a re-serialization', async () => {
  const body = raw('track_updated.accepted.json');
  const timestamp = '1788451200';
  const signature = createHmac('sha256', 'whsec_shippo_example')
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  const plan = await buildTrackWebhookRequest(body, {
    ...base,
    trust: {
      mode: 'hmac',
      secret: 'whsec_shippo_example',
      signatureHeader: `t=${timestamp},v1=${signature}`,
    },
    now: new Date(Number(timestamp) * 1000),
    resolveOrder: () => ({ order: order(), lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' }),
  });
  assert.equal(plan.handled, true);
});

test('a test-mode payload is not posted unless explicitly allowed', async () => {
  let posted = 0;
  const counting: FetchLike = async () => {
    posted += 1;
    return { ok: true, status: 200, text: async () => '' };
  };
  const result = await handleShippoTrackWebhook(raw('track_updated.accepted.json'), {
    trust: TRUST,
    webhookUrl: WEBHOOK_URL,
    businessProfileUrl: PROFILE,
    resolveOrder: () => ({ order: order(), lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' }),
    allowUnsigned: true,
    fetch: counting,
  });
  assert.deepEqual(result, { handled: false, reason: 'test_mode' });
  assert.equal(posted, 0);
});

test('other Shippo events are ignored', async () => {
  const result = await buildTrackWebhookRequest(
    JSON.stringify({ event: 'transaction_created', test: false, data: {} }),
    { ...base, resolveOrder: () => undefined },
  );
  assert.deepEqual(result, { handled: false, reason: 'not_track_updated' });
});

test('a track the merchant cannot tie to an order is skipped', async () => {
  const result = await buildTrackWebhookRequest(raw('track_updated.delivered.json'), {
    ...base,
    resolveOrder: () => undefined,
  });
  assert.deepEqual(result, { handled: false, reason: 'no_order' });
});

test('a malformed payload is reported as a permanent build failure, not thrown at the endpoint', async () => {
  const missingNumber = await buildTrackWebhookRequest(
    JSON.stringify({ event: 'track_updated', test: true, data: { carrier: 'usps' } }),
    { ...base, resolveOrder: () => undefined },
  );
  assert.equal(missingNumber.handled, false);
  if (missingNumber.handled) return;
  assert.equal(missingNumber.reason, 'build_failed');
  assert.ok(missingNumber.error instanceof MalformedTrackError);
  assert.equal(missingNumber.error.retryable, false);
  const notJson = await buildTrackWebhookRequest('{not json', { ...base, resolveOrder: () => undefined });
  assert.equal(notJson.handled, false);
  if (notJson.handled) return;
  assert.equal(notJson.reason, 'build_failed');
  assert.ok(notJson.error instanceof MalformedTrackError);
});

test('a line item mismatch is a build failure the endpoint can acknowledge', async () => {
  const result = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
    ...base,
    resolveOrder: () => ({ order: order(), lineItems: [{ id: 'li_shrit', quantity: 1 }], trackingUrl: 'https://x/y' }),
  });
  assert.equal(result.handled, false);
  if (result.handled) return;
  assert.equal(result.reason, 'build_failed');
  assert.ok(result.error instanceof LineItemMismatchError);
});

test('a redelivered webhook does not re-post the same snapshot', async () => {
  let posted = 0;
  const counting: FetchLike = async () => {
    posted += 1;
    return { ok: true, status: 200, text: async () => '' };
  };
  const stored = { order: order(), lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' };
  const options = {
    ...base,
    resolveOrder: () => stored,
    allowUnsigned: true,
    fetch: counting,
  };
  const first = await handleShippoTrackWebhook(raw('track_updated.accepted.json'), options);
  assert.equal(first.handled, true);
  if (first.handled) stored.order = first.order;
  const second = await handleShippoTrackWebhook(raw('track_updated.accepted.json'), options);
  assert.deepEqual(second, { handled: false, reason: 'duplicate_event' });
  assert.equal(posted, 1);
});

test('a stale event arriving after a terminal one is reported, not appended', async () => {
  const delivered = {
    id: 'd',
    occurred_at: '2026-09-03T20:00:00.000Z',
    type: 'delivered',
    line_items: LINE_ITEMS,
    tracking_number: '1Z999AA10123456784',
    tracking_url: 'https://x/y',
    carrier: 'UPS',
  };
  const withTerminal = appendFulfillmentEvent(order(), delivered);
  const result = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
    ...base,
    resolveOrder: () => ({ order: withTerminal, lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' }),
  });
  assert.deepEqual(result, { handled: false, reason: 'stale_event' });
});

test('an old Shippo API version is refused with an explanation', async () => {
  await assert.rejects(
    buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
      ...base,
      headers: { 'shippo-api-version': '2017-03-29' },
      resolveOrder: () => undefined,
    }),
    (error: unknown) => error instanceof ShippoApiVersionError && error.version === '2017-03-29',
  );
  const fine = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
    ...base,
    headers: { 'Shippo-API-Version': '2018-02-08' },
    resolveOrder: () => undefined,
  });
  assert.deepEqual(fine, { handled: false, reason: 'no_order' });
});

test('an order line item with no quantity is a build_failed, never a raw TypeError', async () => {
  // The same door Task 7 closed for fulfillment.events, one field over: assertLineItemsMatchOrder
  // reads line.quantity.total, and an entry without one used to escape the whole taxonomy.
  const broken = { ...order(), line_items: [{ id: 'li_shirt' }] } as unknown as Order;
  const result = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
    ...base,
    resolveOrder: () => ({ order: broken, lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' }),
  });
  assert.equal(result.handled, false);
  if (result.handled || result.reason !== 'build_failed') {
    assert.fail(`expected build_failed, got ${JSON.stringify(result)}`);
  }
  assert.ok(result.error instanceof InvalidOrderError);
  assert.equal(result.error.retryable, false);
});

test('the Shippo-API-Version floor is a date comparison, not a string compare', async () => {
  // '2018-2-8' sorts above '2018-02-08' lexicographically, so the unpadded form used to slip past
  // the floor. An unreadable version counts as below the floor rather than as good enough.
  for (const version of ['2018-2-8', 'not-a-date', '2018-02-07', '2018-13-01']) {
    await assert.rejects(
      buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
        ...base,
        headers: { 'shippo-api-version': version },
        resolveOrder: () => undefined,
      }),
      (error: unknown) => error instanceof ShippoApiVersionError && error.version === version,
      version,
    );
  }
  for (const version of ['2018-02-08', '2025-01-01']) {
    const fine = await buildTrackWebhookRequest(raw('track_updated.accepted.json'), {
      ...base,
      headers: { 'shippo-api-version': version },
      resolveOrder: () => undefined,
    });
    assert.deepEqual(fine, { handled: false, reason: 'no_order' }, version);
  }
});

test('an old Shippo API version only matters for a track_updated payload', async () => {
  const result = await buildTrackWebhookRequest(
    JSON.stringify({ event: 'transaction_created', test: false, data: {} }),
    { ...base, headers: { 'shippo-api-version': '2017-03-29' }, resolveOrder: () => undefined },
  );
  assert.deepEqual(result, { handled: false, reason: 'not_track_updated' });
});

test('an omitted tracking URL surfaces as a warning on the result, never as silence', async () => {
  const plan = await buildTrackWebhookRequest(raw('track_updated.pre_transit.json'), {
    ...base,
    resolveOrder: () => ({ order: order(), lineItems: LINE_ITEMS }),
  });
  assert.equal(plan.handled, true);
  if (!plan.handled) return;
  assert.equal(plan.event.type, 'processing');
  assert.equal(plan.event.tracking_url, undefined);
  assert.deepEqual(plan.warnings, []);
  const delivered = raw('track_updated.pre_transit.json').replace('"PRE_TRANSIT"', '"DELIVERED"');
  const past = await buildTrackWebhookRequest(delivered, {
    ...base,
    resolveOrder: () => ({ order: order(), lineItems: LINE_ITEMS }),
  });
  assert.equal(past.handled, true);
  if (!past.handled) return;
  assert.equal(past.event.tracking_url, undefined);
  assert.equal(past.warnings.length, 1);
  assert.match(past.warnings[0], /^tracking_url_omitted: no tracking_url for deutsche_post/);
});
