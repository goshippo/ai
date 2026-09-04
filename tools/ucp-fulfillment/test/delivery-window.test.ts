import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addBusinessDays,
  addCalendarDays,
  firstBusinessDayOnOrAfter,
  defaultBufferDays,
  deliveryWindow,
} from '../src/delivery-window.ts';

const THU = new Date('2026-09-03T15:00:00Z'); // Thursday
const SAT = new Date('2026-09-05T09:00:00Z'); // Saturday

test('business-day arithmetic skips weekends (UTC)', () => {
  assert.equal(addBusinessDays(THU, 1).toISOString(), '2026-09-04T00:00:00.000Z'); // Fri
  assert.equal(addBusinessDays(THU, 2).toISOString(), '2026-09-07T00:00:00.000Z'); // Mon
  assert.equal(addBusinessDays(THU, 0).toISOString(), '2026-09-03T00:00:00.000Z');
  assert.equal(firstBusinessDayOnOrAfter(SAT).toISOString(), '2026-09-07T00:00:00.000Z');
  assert.equal(firstBusinessDayOnOrAfter(THU).toISOString(), '2026-09-03T00:00:00.000Z');
});

test('calendar-day arithmetic does not skip weekends', () => {
  assert.equal(addCalendarDays(THU, 1).toISOString(), '2026-09-04T00:00:00.000Z'); // Fri
  assert.equal(addCalendarDays(THU, 2).toISOString(), '2026-09-05T00:00:00.000Z'); // Sat
  assert.equal(addCalendarDays(THU, 4).toISOString(), '2026-09-07T00:00:00.000Z'); // Mon
  assert.equal(addCalendarDays(THU, 0).toISOString(), '2026-09-03T00:00:00.000Z');
});

test('the helpers never mutate their input', () => {
  const before = THU.toISOString();
  addBusinessDays(THU, 3);
  addCalendarDays(THU, 3);
  firstBusinessDayOnOrAfter(THU);
  assert.equal(THU.toISOString(), before);
});

test('the default buffer is 0 for a committed or overnight service and 2 otherwise', () => {
  assert.equal(defaultBufferDays({ estimatedDays: 1, arrivesBy: '10:30:00' }), 0);
  assert.equal(defaultBufferDays({ estimatedDays: 4, arrivesBy: '17:00:00' }), 0);
  assert.equal(defaultBufferDays({ estimatedDays: 0 }), 0);
  assert.equal(defaultBufferDays({ estimatedDays: 1 }), 0);
  assert.equal(defaultBufferDays({ estimatedDays: 2 }), 2);
  assert.equal(defaultBufferDays({ estimatedDays: 9 }), 2);
});

test('golden: a 2 day estimate quoted Thursday keeps the carrier calendar-day promise', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU }), {
    earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
  });
});

test('golden: an overnight service with a carrier commitment gets a one day window', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 1, arrivesBy: '10:30:00' }, { now: THU }), {
    earliest_fulfillment_time: '2026-09-04T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-04T23:59:59.000Z',
  });
});

test('business-day basis is opt in and under-promises by design', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU, transitDayBasis: 'business' }), {
    earliest_fulfillment_time: '2026-09-07T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-09T23:59:59.000Z',
  });
});

test('a weekend "now" ships on Monday', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: SAT }), {
    earliest_fulfillment_time: '2026-09-09T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-11T23:59:59.000Z',
  });
});

test('an earliest bound is never in the past', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 0 }, { now: THU }), {
    earliest_fulfillment_time: '2026-09-03T15:00:00.000Z',
    latest_fulfillment_time: '2026-09-03T23:59:59.000Z',
  });
  const window = deliveryWindow({ estimatedDays: 0 }, { now: THU });
  assert.ok(new Date(window.earliest_fulfillment_time as string) >= THU);
});

test('a same-day rate in the last second of the day never inverts the window', () => {
  // earliest is clamped forward to now while latest is the end of the unclamped day, so the two
  // bounds cross in the final second unless latest is pushed out with it.
  const lastSecond = new Date('2026-09-03T23:59:59.500Z');
  const window = deliveryWindow({ estimatedDays: 0 }, { now: lastSecond });
  assert.equal(window.earliest_fulfillment_time, '2026-09-03T23:59:59.500Z');
  assert.equal(window.latest_fulfillment_time, '2026-09-03T23:59:59.500Z');
  assert.ok(
    Date.parse(window.latest_fulfillment_time as string) >=
      Date.parse(window.earliest_fulfillment_time as string),
    'latest must never precede earliest',
  );
});

test('the buffer takes a number or a function of the rate', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU, bufferBusinessDays: 0 }), {
    earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-05T23:59:59.000Z',
  });
  assert.deepEqual(
    deliveryWindow({ estimatedDays: 2 }, { now: THU, bufferBusinessDays: (rate) => (rate.estimatedDays ?? 0) * 2 }),
    {
      earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
      latest_fulfillment_time: '2026-09-09T23:59:59.000Z',
    },
  );
});

test('negative buffers are clamped to zero', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU, bufferBusinessDays: () => -3 }), {
    earliest_fulfillment_time: '2026-09-05T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-05T23:59:59.000Z',
  });
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU, bufferBusinessDays: () => -3, transitDayBasis: 'business' }), {
    earliest_fulfillment_time: '2026-09-07T00:00:00.000Z',
    latest_fulfillment_time: '2026-09-07T23:59:59.000Z',
  });
});

test('a destination offset shifts the day boundaries into the buyer day', () => {
  assert.deepEqual(deliveryWindow({ estimatedDays: 2 }, { now: THU, destinationUtcOffsetMinutes: -420 }), {
    earliest_fulfillment_time: '2026-09-05T07:00:00.000Z',
    latest_fulfillment_time: '2026-09-08T06:59:59.000Z',
  });
});

test('the invariant a buyer relies on: a faster option never ends after a slower one starts', () => {
  const fast = deliveryWindow({ estimatedDays: 1, arrivesBy: '10:30:00' }, { now: THU });
  const slow = deliveryWindow({ estimatedDays: 2 }, { now: THU });
  assert.ok(
    new Date(fast.latest_fulfillment_time as string) <= new Date(slow.earliest_fulfillment_time as string),
    `${fast.latest_fulfillment_time} must not be after ${slow.earliest_fulfillment_time}`,
  );
});

test('no usable estimate means no window at all', () => {
  assert.deepEqual(deliveryWindow({}, { now: THU }), {});
  assert.deepEqual(deliveryWindow({ estimatedDays: null }, { now: THU }), {});
  assert.deepEqual(deliveryWindow({ estimatedDays: -1 }, { now: THU }), {});
  assert.deepEqual(deliveryWindow({ estimatedDays: 1.5 }, { now: THU }), {});
  assert.deepEqual(deliveryWindow({ estimatedDays: Number.NaN }, { now: THU }), {});
});

test('the output is timezone independent', () => {
  // Every helper uses getUTC*/Date.UTC and every input carries an offset, so the process
  // timezone cannot change the answer. Asserted directly rather than trusted.
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Auckland';
    const auckland = deliveryWindow({ estimatedDays: 2 }, { now: THU });
    process.env.TZ = 'UTC';
    const utc = deliveryWindow({ estimatedDays: 2 }, { now: THU });
    assert.deepEqual(auckland, utc);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
