import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FULFILLMENT_EVENT_TYPES,
  normalizeTrack,
  mapTrackingStatus,
  resolveTrackingUrl,
  buildFulfillmentEvent,
  buildFulfillmentEventResult,
  buildFulfillmentEvents,
  buildFulfillmentEventsResult,
  buildExpectation,
  buildProcessingEvent,
  type ShippoTrackInput,
} from '../src/tracking.ts';
import {
  LineItemsRequiredError,
  MalformedTrackError,
  MissingTrackingStatusError,
  TrackingUrlUnresolvedError,
  UnmappedTrackingStatusError,
} from '../src/errors.ts';
import { validateUcp, assertOnlyKnownKeys, SCHEMA_IDS } from './helpers/ucp-validator.ts';

const payload = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const track = (name: string): ShippoTrackInput => normalizeTrack(payload(name).data);
const LINE_ITEMS = [{ id: 'li_shirt', quantity: 2 }];

/** Every event the library emits is checked three ways, with the overlay standing in for prose. */
const checkEvent = (event: object) => {
  validateUcp(SCHEMA_IDS.strictFulfillmentEvent, event);
  assertOnlyKnownKeys(SCHEMA_IDS.fulfillmentEvent, event);
};

test('the eight event types are a runtime array the union is derived from', () => {
  assert.deepEqual([...FULFILLMENT_EVENT_TYPES], [
    'processing',
    'shipped',
    'in_transit',
    'delivered',
    'failed_attempt',
    'canceled',
    'undeliverable',
    'returned_to_sender',
  ]);
});

test('normalizeTrack reads the documented test-mode payload the SDK parser rejects', () => {
  const t = normalizeTrack(payload('track.test_mode.json'));
  assert.deepEqual(t, {
    carrier: 'shippo',
    trackingNumber: 'SHIPPO_TRANSIT',
    trackingStatus: {
      objectId: '560f1b9cfe8341a2899e0388f1b9081c',
      status: 'TRANSIT',
      statusDate: '2018-07-29T16:44:42.586',
      statusDetails: 'Your shipment has departed from the origin.',
      objectCreated: '2018-07-30T18:49:42.586',
    },
    trackingHistory: [
      {
        objectId: '9a056563ad874a0b9bf79dee321f25f5',
        status: 'UNKNOWN',
        statusDate: '2018-07-28T14:39:42.589',
        statusDetails: 'The carrier has received the electronic shipment information.',
        objectCreated: '2018-07-30T18:49:42.589',
      },
      {
        objectId: '82ef073b04ef48368e79b835af788fce',
        status: 'TRANSIT',
        statusDate: '2018-07-29T16:44:42.589',
        statusDetails: 'Your shipment has departed from the origin.',
        objectCreated: '2018-07-30T18:49:42.589',
      },
    ],
  });
});

test('the transaction id, the join key a merchant needs, survives normalization', () => {
  assert.equal(track('track_updated.accepted.json').transaction, 'txn_ups_1');
  assert.equal(track('track_updated.delivered.json').transaction, 'string');
  // The documented test-mode payload sends null, which must stay absent rather than become "null".
  assert.equal(normalizeTrack(payload('track.test_mode.json')).transaction, undefined);
});

test('normalizeTrack carries action_required through and refuses what it cannot key on', () => {
  const t = normalizeTrack({
    carrier: 'ups',
    tracking_number: '1Z',
    tracking_status: { status: 'TRANSIT', substatus: { code: 'brand_new_code', action_required: true } },
  });
  assert.equal(t.trackingStatus?.substatus?.actionRequired, true);
  assert.equal(t.trackingStatus?.substatus?.code, 'brand_new_code');
  assert.throws(() => normalizeTrack({ tracking_number: '1Z' }), MalformedTrackError);
  assert.throws(() => normalizeTrack({ carrier: 'ups' }), MalformedTrackError);
  assert.throws(() => normalizeTrack(null), MalformedTrackError);
  assert.throws(() => normalizeTrack('nope'), MalformedTrackError);
  assert.throws(
    () => normalizeTrack({ carrier: 'ups' }),
    (error: unknown) => error instanceof MalformedTrackError && error.field === 'tracking_number',
  );
  // A tracking_status with no status is refused rather than fabricated as UNKNOWN, which would
  // otherwise post a "processing" event onto a real order. The endpoint sees build_failed.
  assert.throws(
    () => normalizeTrack({ carrier: 'ups', tracking_number: '1Z', tracking_status: { status_details: 'x' } }),
    (error: unknown) => error instanceof MalformedTrackError && error.field === 'tracking_status.status',
  );
});

test('a history entry with no status is dropped, not fatal, and its index is recorded', () => {
  const raw = payload('track_updated.accepted.json');
  // Index 0 is the fixture's own (valid) live tracking_status reused as history; index 1 has no
  // status at all. Only index 1 should be dropped: one bad scan buried in a long history must not
  // make an otherwise-good live tracking_status unreadable.
  const withBadHistory = {
    ...raw.data,
    tracking_history: [
      raw.data.tracking_status,
      { object_id: 'h2', object_created: '2026-09-03T16:00:00Z', object_updated: '2026-09-03T16:00:00Z', status_details: 'no status here' },
    ],
  };
  const t = normalizeTrack(withBadHistory);
  assert.equal(t.trackingHistory?.length, 1);
  assert.deepEqual(t.droppedHistoryIndexes, [1]);
  // The live tracking_status is unaffected by the malformed history entry.
  assert.equal(t.trackingStatus?.status, 'TRANSIT');
});

test('status map: the six documented statuses, and nothing else (design decision 2)', () => {
  assert.equal(mapTrackingStatus('UNKNOWN'), 'processing');
  assert.equal(mapTrackingStatus('UNKNOWN', 'other'), 'processing');
  assert.equal(mapTrackingStatus('PRE_TRANSIT', 'information_received'), 'processing');
  assert.equal(mapTrackingStatus('TRANSIT', 'package_accepted'), 'shipped');
  assert.equal(mapTrackingStatus('transit', 'PACKAGE_ACCEPTED'), 'shipped');
  assert.equal(mapTrackingStatus('TRANSIT', 'out_for_delivery'), 'in_transit');
  assert.equal(mapTrackingStatus('TRANSIT', 'package_departed'), 'in_transit');
  assert.equal(mapTrackingStatus('TRANSIT', 'delayed'), 'in_transit');
  assert.equal(mapTrackingStatus('TRANSIT'), 'in_transit');
  assert.equal(mapTrackingStatus('DELIVERED', 'delivered'), 'delivered');
  assert.equal(mapTrackingStatus('RETURNED', 'return_to_sender'), 'returned_to_sender');
  assert.equal(mapTrackingStatus('FAILURE', 'package_lost'), 'undeliverable');
  assert.equal(mapTrackingStatus('FAILURE'), 'undeliverable');
});

test('TRANSIT substatuses that need action are not reported as normal transit', () => {
  for (const code of [
    'address_issue',
    'contact_carrier',
    'delivery_attempted',
    'location_inaccessible',
    'notice_left',
    'package_damaged',
    'package_held',
    'pickup_available',
    'reschedule_delivery',
  ]) {
    assert.equal(mapTrackingStatus('TRANSIT', code), 'failed_attempt', code);
  }
});

test('a future action-required substatus is caught by the flag, not the list', () => {
  assert.equal(mapTrackingStatus('TRANSIT', 'brand_new_code', true), 'failed_attempt');
  assert.equal(mapTrackingStatus('TRANSIT', 'package_departed', false), 'in_transit');
  assert.equal(mapTrackingStatus('TRANSIT', undefined, true), 'failed_attempt');
});

test('an unclaimed parcel is a failed attempt, not a completed return', () => {
  assert.equal(mapTrackingStatus('RETURNED', 'package_unclaimed'), 'failed_attempt');
  assert.equal(mapTrackingStatus('RETURNED', 'return_to_sender'), 'returned_to_sender');
});

test('an unrecognized status throws rather than becoming a plausible wrong answer', () => {
  assert.throws(() => mapTrackingStatus('CANCELLED'), UnmappedTrackingStatusError);
  assert.throws(() => mapTrackingStatus('IN_CUSTOMS'), UnmappedTrackingStatusError);
  assert.throws(() => mapTrackingStatus(''), UnmappedTrackingStatusError);
  assert.throws(
    () => mapTrackingStatus('CANCELLED', 'x'),
    (error: unknown) =>
      error instanceof UnmappedTrackingStatusError && error.status === 'CANCELLED' && error.retryable === false,
  );
});

test('golden: the docs DELIVERED webhook becomes a schema-valid fulfillment_event', () => {
  const event = buildFulfillmentEvent(track('track_updated.delivered.json'), { lineItems: LINE_ITEMS });
  assert.deepEqual(event, {
    id: '9205590164917312751089:string',
    occurred_at: '2016-07-23T00:00:00.000Z',
    type: 'delivered',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: '9205590164917312751089',
    tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9205590164917312751089',
    carrier: 'USPS',
    description: 'Your shipment has been delivered at the destination mailbox.',
  });
  checkEvent(event);
});

test('golden: TRANSIT plus package_accepted is shipped, and the transaction URL outranks the built-in', () => {
  const event = buildFulfillmentEvent(track('track_updated.accepted.json'), {
    lineItems: LINE_ITEMS,
    transaction: { trackingUrlProvider: 'https://wwwapps.ups.com/tracking/tracking.cgi?tracknum=1Z999AA10123456784' },
  });
  assert.deepEqual(event, {
    id: '1Z999AA10123456784:ts_accepted_1',
    occurred_at: '2026-09-03T15:42:10.000Z',
    type: 'shipped',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: '1Z999AA10123456784',
    tracking_url: 'https://wwwapps.ups.com/tracking/tracking.cgi?tracknum=1Z999AA10123456784',
    carrier: 'UPS',
    description: 'Origin Scan',
  });
  checkEvent(event);
});

test('golden: the documented test-mode payload maps, naive timestamps and all', () => {
  const event = buildFulfillmentEvent(normalizeTrack(payload('track.test_mode.json')), {
    lineItems: LINE_ITEMS,
    shippoTrackingUserId: 'usr_42',
  });
  assert.deepEqual(event, {
    id: 'SHIPPO_TRANSIT:560f1b9cfe8341a2899e0388f1b9081c',
    occurred_at: '2018-07-29T16:44:42.586Z',
    type: 'in_transit',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: 'SHIPPO_TRANSIT',
    tracking_url: 'https://track.goshippo.com/tracking/usr_42/shippo/SHIPPO_TRANSIT',
    carrier: 'Shippo',
    description: 'Your shipment has departed from the origin.',
  });
  checkEvent(event);
});

test('a naive Shippo timestamp is read as UTC, so the result does not move with the process timezone', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Auckland';
    const auckland = buildFulfillmentEvent(normalizeTrack(payload('track.test_mode.json')), {
      lineItems: LINE_ITEMS,
      shippoTrackingUserId: 'usr_42',
    }).occurred_at;
    process.env.TZ = 'UTC';
    const utc = buildFulfillmentEvent(normalizeTrack(payload('track.test_mode.json')), {
      lineItems: LINE_ITEMS,
      shippoTrackingUserId: 'usr_42',
    }).occurred_at;
    assert.equal(auckland, utc);
    assert.equal(utc, '2018-07-29T16:44:42.586Z');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('golden: PRE_TRANSIT on a carrier with no built-in URL is processing without a URL', () => {
  const event = buildFulfillmentEvent(track('track_updated.pre_transit.json'), { lineItems: LINE_ITEMS });
  assert.deepEqual(event, {
    id: 'LX000000000DE:ts_pre_1',
    occurred_at: '2026-09-03T15:00:00.000Z',
    type: 'processing',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: 'LX000000000DE',
    carrier: 'Deutsche Post',
    description: 'Shipment information received',
  });
  checkEvent(event);
});

test('tracking_url precedence, all five steps (design decision 3)', () => {
  const t = track('track_updated.accepted.json');
  const transaction = { trackingUrlProvider: 'https://transaction.example/t' };
  assert.equal(
    resolveTrackingUrl(t, { trackingUrl: 'https://explicit.example/t', transaction, shippoTrackingUserId: 'usr_42' }),
    'https://explicit.example/t',
  );
  assert.equal(resolveTrackingUrl(t, { transaction, shippoTrackingUserId: 'usr_42' }), 'https://transaction.example/t');
  assert.equal(
    resolveTrackingUrl(t, {
      shippoTrackingUserId: 'usr_42',
      trackingUrlTemplates: { ups: 'https://merchant.example/t/{tracking_number}' },
    }),
    'https://merchant.example/t/1Z999AA10123456784',
  );
  assert.equal(
    resolveTrackingUrl(t, { shippoTrackingUserId: 'usr_42' }),
    'https://track.goshippo.com/tracking/usr_42/ups/1Z999AA10123456784',
  );
  assert.equal(resolveTrackingUrl(t, {}), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
});

test('a throwing merchant template cannot defeat a higher-precedence explicit URL', () => {
  const t = track('track_updated.accepted.json');
  const trackingUrlTemplates = {
    ups: () => {
      throw new Error('merchant template blew up');
    },
  };
  // Candidates are evaluated lazily in precedence order, so the explicit URL wins without the
  // lower-precedence template ever running.
  assert.equal(
    resolveTrackingUrl(t, { trackingUrl: 'https://explicit.example/t', trackingUrlTemplates }),
    'https://explicit.example/t',
  );
  assert.equal(
    resolveTrackingUrl(t, {
      transaction: { trackingUrlProvider: 'https://transaction.example/t' },
      trackingUrlTemplates,
    }),
    'https://transaction.example/t',
  );
  // With nothing above it the template is still reached, so a merchant bug is not swallowed.
  assert.throws(() => resolveTrackingUrl(t, { trackingUrlTemplates }), /merchant template blew up/);
});

test('a blank candidate falls through instead of becoming the answer', () => {
  const t = track('track_updated.accepted.json');
  assert.equal(resolveTrackingUrl(t, { trackingUrl: '   ' }), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  assert.equal(
    resolveTrackingUrl(t, { transaction: { trackingUrlProvider: '' } }),
    'https://www.ups.com/track?tracknum=1Z999AA10123456784',
  );
});

test('an unresolvable URL past processing is omitted with a named warning, and throws only on request', () => {
  const base = track('track_updated.pre_transit.json');
  const delivered: ShippoTrackInput = {
    ...base,
    trackingStatus: { ...base.trackingStatus!, status: 'DELIVERED', substatus: { code: 'delivered' } },
  };
  const { event, warnings } = buildFulfillmentEventResult(delivered, { lineItems: LINE_ITEMS });
  assert.equal(event.tracking_url, undefined);
  assert.equal(event.type, 'delivered');
  assert.deepEqual(warnings, [
    'tracking_url_omitted: no tracking_url for deutsche_post LX000000000DE on a delivered event: no explicit url, no transaction tracking_url_provider, no merchant template, no shippoTrackingUserId and no built-in url for this carrier',
  ]);
  // The code is a stable prefix a merchant can switch on, matching SHIPMENT_WARNINGS.
  assert.ok(warnings[0].startsWith('tracking_url_omitted: '));
  // The omission is deliberate and is NOT strict-overlay valid: the overlay encodes the spec's
  // prose rule, and the library prefers a reported omission to a webhook endpoint that loops.
  validateUcp(SCHEMA_IDS.fulfillmentEvent, event);
  assert.throws(() => validateUcp(SCHEMA_IDS.strictFulfillmentEvent, event), /tracking_url/);
  assert.throws(
    () => buildFulfillmentEvent(delivered, { lineItems: LINE_ITEMS, requireTrackingUrl: true }),
    TrackingUrlUnresolvedError,
  );
});

test('a missing tracking number past processing is warned about too', () => {
  const base = track('track_updated.accepted.json');
  const numberless: ShippoTrackInput = { ...base, trackingNumber: '   ' };
  const { event, warnings } = buildFulfillmentEventResult(numberless, {
    lineItems: LINE_ITEMS,
    trackingUrl: 'https://explicit.example/t',
  });
  assert.equal(event.tracking_number, undefined);
  assert.deepEqual(warnings, ['tracking_number_missing: no tracking_number for ups on a shipped event']);
  assert.throws(
    () => buildFulfillmentEvent(numberless, { lineItems: LINE_ITEMS, trackingUrl: 'https://x/y', requireTrackingUrl: true }),
    TrackingUrlUnresolvedError,
  );
});

test('a blank tracking number defeats the Shippo tracking page too, not just the built-in table', () => {
  const base = track('track_updated.accepted.json');
  const blankNumber = '   ';
  const blank: ShippoTrackInput = { ...base, trackingNumber: blankNumber };
  // shippoTrackingPageUrl builds a URL from the tracking number with no guard of its own; without a
  // blank check in resolveTrackingUrl it would return a truthy but untrackable
  // ".../usr_42/ups/" (trailing slash, no number), which would silently swallow the warning below.
  const { event, warnings } = buildFulfillmentEventResult(blank, {
    lineItems: LINE_ITEMS,
    shippoTrackingUserId: 'usr_42',
  });
  assert.equal(event.tracking_url, undefined);
  assert.equal(event.tracking_number, undefined);
  assert.equal(event.type, 'shipped');
  assert.deepEqual(warnings, [
    `tracking_url_omitted: no tracking_url for ups ${blankNumber} on a shipped event: no explicit url, no transaction tracking_url_provider, no merchant template, no shippoTrackingUserId and no built-in url for this carrier`,
    'tracking_number_missing: no tracking_number for ups on a shipped event',
  ]);
  // An explicit trackingUrl is not derived from the tracking number, so it still resolves even when
  // the number is blank (matching the precedent set by the test above, which pins the same thing).
  assert.equal(
    resolveTrackingUrl(blank, { trackingUrl: 'https://explicit.example/t', shippoTrackingUserId: 'usr_42' }),
    'https://explicit.example/t',
  );
});

test('an occurred_at derived from Shippo ingestion time is reported, not hidden', () => {
  const base = track('track_updated.accepted.json');
  const noStatusDate: ShippoTrackInput = { ...base, trackingStatus: { ...base.trackingStatus!, statusDate: null } };
  const result = buildFulfillmentEventResult(noStatusDate, {
    lineItems: LINE_ITEMS,
    transaction: { trackingUrlProvider: 'https://x/y' },
  });
  assert.equal(result.occurredAtSource, 'object_created');
  assert.equal(result.event.occurred_at, '2026-09-03T16:00:00.000Z');
  assert.deepEqual(result.warnings, [
    'occurred_at_fallback: occurred_at fell back to object_created (Shippo ingestion time) because tracking_status.status_date was absent',
  ]);
  const withDate = buildFulfillmentEventResult(base, {
    lineItems: LINE_ITEMS,
    transaction: { trackingUrlProvider: 'https://x/y' },
  });
  assert.equal(withDate.occurredAtSource, 'status_date');
  assert.deepEqual(withDate.warnings, []);
});

test('carrier display names are overridable per call', () => {
  const event = buildFulfillmentEvent(track('track_updated.pre_transit.json'), {
    lineItems: LINE_ITEMS,
    carrierDisplayNames: { deutsche_post: 'Deutsche Post DHL' },
  });
  assert.equal(event.carrier, 'Deutsche Post DHL');
});

test('the mapped type is overridable, because the UCP vocabulary is open', () => {
  const event = buildFulfillmentEvent(track('track_updated.accepted.json'), {
    lineItems: LINE_ITEMS,
    type: 'awaiting_customs_clearance',
    transaction: { trackingUrlProvider: 'https://x/y' },
  });
  assert.equal(event.type, 'awaiting_customs_clearance');
  // Our own overlay rejects it, correctly: the overlay pins what THIS library emits by default.
  validateUcp(SCHEMA_IDS.fulfillmentEvent, event);
  assert.throws(() => validateUcp(SCHEMA_IDS.strictFulfillmentEvent, event), /enum/);
});

test('line_items are required and must be positive integer step counts (design decision 4)', () => {
  const t = track('track_updated.delivered.json');
  assert.throws(() => buildFulfillmentEvent(t, { lineItems: [] }), LineItemsRequiredError);
  assert.throws(() => buildFulfillmentEvent(t, { lineItems: [{ id: 'li', quantity: 0 }] }), LineItemsRequiredError);
  assert.throws(() => buildFulfillmentEvent(t, { lineItems: [{ id: 'li', quantity: 1.5 }] }), LineItemsRequiredError);
  assert.throws(() => buildFulfillmentEvent(t, { lineItems: [{ id: '', quantity: 1 }] }), LineItemsRequiredError);
  assert.throws(
    () => buildFulfillmentEvent(t, { lineItems: undefined as unknown as [] }),
    LineItemsRequiredError,
  );
});

test('the emitted line_items array is a copy, so a caller cannot mutate an appended event', () => {
  const items = [{ id: 'li_shirt', quantity: 2 }];
  const event = buildFulfillmentEvent(track('track_updated.delivered.json'), { lineItems: items });
  items[0].quantity = 99;
  assert.deepEqual(event.line_items, [{ id: 'li_shirt', quantity: 2 }]);
  assert.notEqual(event.line_items, items);
});

test('a track without tracking_status cannot produce an event', () => {
  const t = { ...track('track_updated.delivered.json'), trackingStatus: undefined };
  assert.throws(() => buildFulfillmentEvent(t, { lineItems: LINE_ITEMS }), MissingTrackingStatusError);
});

test('a tracking status with a status but no timestamp cannot produce an event either', () => {
  // occurred_at is required on fulfillment_event and neither status_date nor object_created is
  // present, so there is nothing to date the event with and nothing is invented.
  const base = track('track_updated.delivered.json');
  const undated: ShippoTrackInput = {
    ...base,
    trackingStatus: { status: 'DELIVERED', objectId: 'ts_undated' },
  };
  assert.throws(() => buildFulfillmentEvent(undated, { lineItems: LINE_ITEMS }), MissingTrackingStatusError);
  assert.throws(
    () => buildFulfillmentEventResult(undated, { lineItems: LINE_ITEMS }),
    MissingTrackingStatusError,
  );
});

test('an unreadable timestamp names the field it came from', () => {
  const base = track('track_updated.delivered.json');
  assert.throws(
    () =>
      buildFulfillmentEvent(
        { ...base, trackingStatus: { ...base.trackingStatus!, statusDate: 'yesterday' } },
        { lineItems: LINE_ITEMS },
      ),
    (error: unknown) =>
      error instanceof MalformedTrackError && error.field.startsWith('tracking_status.status_date'),
  );
  assert.throws(
    () =>
      buildFulfillmentEvent(
        { ...base, trackingStatus: { status: 'DELIVERED', objectCreated: 'whenever' } },
        { lineItems: LINE_ITEMS },
      ),
    (error: unknown) =>
      error instanceof MalformedTrackError && error.field.startsWith('tracking_status.object_created'),
  );
  assert.throws(
    () =>
      buildProcessingEvent(
        { objectId: 'txn_1', objectCreated: 'whenever' },
        { lineItems: LINE_ITEMS, carrier: 'ups' },
      ),
    (error: unknown) =>
      error instanceof MalformedTrackError && error.field.startsWith('transaction.object_created'),
  );
  assert.throws(
    () =>
      buildProcessingEvent(
        { objectId: 'txn_1' },
        { lineItems: LINE_ITEMS, carrier: 'ups', occurredAt: new Date('nope') },
      ),
    (error: unknown) => error instanceof MalformedTrackError && error.field.startsWith('occurredAt'),
  );
});

test('an explicit id wins, and a blank status_details produces no description', () => {
  const t = track('track_updated.accepted.json');
  const event = buildFulfillmentEvent(
    { ...t, trackingStatus: { ...t.trackingStatus!, statusDetails: '  ' } },
    { lineItems: LINE_ITEMS, id: 'evt_custom', trackingUrl: 'https://x/y' },
  );
  assert.equal(event.id, 'evt_custom');
  assert.equal(event.description, undefined);
  checkEvent(event);
});

test('two same-second scans with no object_id get distinct, stable ids', () => {
  const base = track('track_updated.accepted.json');
  const make = (details: string) =>
    buildFulfillmentEvent(
      { ...base, trackingStatus: { ...base.trackingStatus!, objectId: undefined, statusDetails: details } },
      { lineItems: LINE_ITEMS, trackingUrl: 'https://x/y' },
    );
  assert.notEqual(make('Arrived at facility').id, make('Departed facility').id);
  assert.equal(make('Arrived at facility').id, make('Arrived at facility').id);
  assert.match(make('Arrived at facility').id, /^1Z999AA10123456784:[0-9a-f]{16}$/);
});

test('golden: buildFulfillmentEvents backfills a shipment already in flight', () => {
  const events = buildFulfillmentEvents(normalizeTrack(payload('track.test_mode.json')), {
    lineItems: LINE_ITEMS,
    shippoTrackingUserId: 'usr_42',
  });
  assert.deepEqual(events, [
    {
      id: 'SHIPPO_TRANSIT:9a056563ad874a0b9bf79dee321f25f5',
      occurred_at: '2018-07-28T14:39:42.589Z',
      type: 'processing',
      line_items: [{ id: 'li_shirt', quantity: 2 }],
      tracking_number: 'SHIPPO_TRANSIT',
      tracking_url: 'https://track.goshippo.com/tracking/usr_42/shippo/SHIPPO_TRANSIT',
      carrier: 'Shippo',
      description: 'The carrier has received the electronic shipment information.',
    },
    {
      id: 'SHIPPO_TRANSIT:82ef073b04ef48368e79b835af788fce',
      occurred_at: '2018-07-29T16:44:42.589Z',
      type: 'in_transit',
      line_items: [{ id: 'li_shirt', quantity: 2 }],
      tracking_number: 'SHIPPO_TRANSIT',
      tracking_url: 'https://track.goshippo.com/tracking/usr_42/shippo/SHIPPO_TRANSIT',
      carrier: 'Shippo',
      description: 'Your shipment has departed from the origin.',
    },
  ]);
  for (const event of events) checkEvent(event);
  assert.deepEqual(buildFulfillmentEvents({ carrier: 'ups', trackingNumber: '1Z' }, { lineItems: LINE_ITEMS }), []);
  // id is per-status, not per-track: forwarding an explicit override to every history entry would
  // collapse two distinct scans onto one id, which appendFulfillmentEvent would treat as a duplicate.
  const fixedIdEvents = buildFulfillmentEvents(normalizeTrack(payload('track.test_mode.json')), {
    lineItems: LINE_ITEMS,
    shippoTrackingUserId: 'usr_42',
    id: 'evt_fixed',
  });
  assert.equal(fixedIdEvents.length, 2);
  assert.notEqual(fixedIdEvents[0].id, fixedIdEvents[1].id);
  assert.notEqual(fixedIdEvents[0].id, 'evt_fixed');
});

test('buildFulfillmentEventsResult reports the backfill warnings beside the events', () => {
  // deutsche_post has no built-in tracking URL and no user id is supplied, so every scan past
  // processing omits tracking_url and says so.
  const base = normalizeTrack(payload('track.test_mode.json'));
  const t: ShippoTrackInput = {
    ...base,
    carrier: 'deutsche_post',
    trackingHistory: [
      { objectId: 'h1', status: 'TRANSIT', statusDate: '2018-07-29T16:44:42.589Z' },
      { objectId: 'h2', status: 'TRANSIT', statusDate: '2018-07-29T18:10:00.000Z' },
    ],
  };
  const { events, warnings } = buildFulfillmentEventsResult(t, { lineItems: LINE_ITEMS });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.type), ['in_transit', 'in_transit']);
  assert.deepEqual(events.map((event) => event.tracking_url), [undefined, undefined]);
  // Two scans, one warning: the two omissions are the same code and the same sentence, so they
  // deduplicate rather than repeating once per scan.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^tracking_url_omitted: /);
  // A scan of a different type carries its own sentence, so deduplication never hides one.
  const mixed = buildFulfillmentEventsResult(
    { ...t, trackingHistory: [...(t.trackingHistory ?? []), { objectId: 'h3', status: 'DELIVERED', statusDate: '2018-07-30T09:00:00.000Z' }] },
    { lineItems: LINE_ITEMS },
  );
  assert.equal(mixed.events.length, 3);
  assert.equal(mixed.warnings.length, 2);
  assert.ok(mixed.warnings.every((warning) => warning.startsWith('tracking_url_omitted: ')));
  // The bare form is unchanged and returns exactly the same events.
  assert.deepEqual(buildFulfillmentEvents(t, { lineItems: LINE_ITEMS }), events);
  assert.deepEqual(buildFulfillmentEventsResult({ carrier: 'ups', trackingNumber: '1Z' }, { lineItems: LINE_ITEMS }), {
    events: [],
    warnings: [],
  });
});

test('golden: an expectation is the buyer-facing promise beside the event log', () => {
  const expectation = buildExpectation({
    id: 'exp_package_1',
    lineItems: LINE_ITEMS,
    destination: {
      type: 'shipping_address',
      id: 'dest_1',
      street_address: '123 Main St',
      address_locality: 'Springfield',
      address_region: 'IL',
      postal_code: '62701',
      address_country: 'US',
    },
    option: {
      id: 'usps_priority',
      title: 'USPS Priority Mail',
      description: { plain: 'Arrives in about 2 days' },
      totals: [{ type: 'total', amount: 835 }],
    },
    fulfillableOn: 'now',
  });
  assert.deepEqual(expectation, {
    id: 'exp_package_1',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    method_type: 'shipping',
    destination: {
      street_address: '123 Main St',
      address_locality: 'Springfield',
      address_region: 'IL',
      postal_code: '62701',
      address_country: 'US',
    },
    description: 'Arrives in about 2 days',
    fulfillable_on: 'now',
  });
  validateUcp(SCHEMA_IDS.expectation, expectation);
  assertOnlyKnownKeys(SCHEMA_IDS.expectation, expectation);
});

test('an expectation drops the destination id and type, and takes an explicit description', () => {
  const expectation = buildExpectation({
    id: 'exp_1',
    lineItems: LINE_ITEMS,
    destination: { type: 'shipping_address', id: 'dest_1', address_country: 'US' },
    description: 'Ships in two batches',
    methodType: 'pickup',
  });
  assert.equal((expectation.destination as Record<string, unknown>).id, undefined);
  assert.equal((expectation.destination as Record<string, unknown>).type, undefined);
  assert.equal(expectation.description, 'Ships in two batches');
  assert.equal(expectation.method_type, 'pickup');
  assert.equal(expectation.fulfillable_on, undefined);
  validateUcp(SCHEMA_IDS.expectation, expectation);
  assert.throws(() => buildExpectation({ id: 'x', lineItems: [], destination: {} }), LineItemsRequiredError);
});

test('golden: the post-purchase processing event, the one moment the transaction URL is in hand', () => {
  const event = buildProcessingEvent(
    {
      objectId: 'txn_ups_1',
      trackingNumber: '1Z999AA10123456784',
      trackingUrlProvider: 'https://wwwapps.ups.com/tracking/tracking.cgi?tracknum=1Z999AA10123456784',
      objectCreated: '2026-09-03T16:00:00Z',
    },
    { lineItems: LINE_ITEMS, carrier: 'ups' },
  );
  assert.deepEqual(event, {
    id: 'txn_ups_1:processing',
    occurred_at: '2026-09-03T16:00:00.000Z',
    type: 'processing',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    tracking_number: '1Z999AA10123456784',
    tracking_url: 'https://wwwapps.ups.com/tracking/tracking.cgi?tracknum=1Z999AA10123456784',
    carrier: 'UPS',
  });
  checkEvent(event);
});

test('a provider display name is not a carrier token, and the library does not pretend otherwise', () => {
  const transaction = { objectId: 'txn_1', trackingNumber: '1234567890', objectCreated: '2026-09-03T16:00:00Z' };
  const withToken = buildProcessingEvent(transaction, { lineItems: LINE_ITEMS, carrier: 'dhl_express' });
  assert.equal(withToken.tracking_url, 'https://www.dhl.com/en/express/tracking.html?AWB=1234567890');
  assert.equal(withToken.carrier, 'DHL Express');
  // rate.provider is a display name ("DHL Express"), not the token, and no built-in URL matches it.
  const withProvider = buildProcessingEvent(transaction, { lineItems: LINE_ITEMS, carrier: 'DHL Express' });
  assert.equal(withProvider.tracking_url, undefined);
});

test('a transaction with no tracking number still yields a valid processing event', () => {
  const event = buildProcessingEvent(
    { objectId: 'txn_2', objectCreated: '2026-09-03T16:00:00Z' },
    { lineItems: LINE_ITEMS, carrier: 'deutsche_post' },
  );
  assert.deepEqual(event, {
    id: 'txn_2:processing',
    occurred_at: '2026-09-03T16:00:00.000Z',
    type: 'processing',
    line_items: [{ id: 'li_shirt', quantity: 2 }],
    carrier: 'Deutsche Post',
  });
  checkEvent(event);
  const explicit = buildProcessingEvent(
    { trackingNumber: '9400' },
    { lineItems: LINE_ITEMS, carrier: 'usps', id: 'evt_p', occurredAt: new Date('2026-09-03T16:00:00Z') },
  );
  assert.equal(explicit.id, 'evt_p');
  assert.equal(explicit.tracking_url, 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400');
  // An explicit trackingUrl is not derived from the tracking number, so it must still resolve even
  // when the transaction has no tracking number of its own to offer.
  const noNumberExplicitUrl = buildProcessingEvent(
    { objectId: 'txn_3', objectCreated: '2026-09-03T16:00:00Z' },
    { lineItems: LINE_ITEMS, carrier: 'usps', trackingUrl: 'https://merchant.example/t/1' },
  );
  assert.equal(noNumberExplicitUrl.tracking_url, 'https://merchant.example/t/1');
  assert.equal(noNumberExplicitUrl.tracking_number, undefined);
});
