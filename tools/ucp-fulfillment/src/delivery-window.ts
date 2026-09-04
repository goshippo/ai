/** Whether a transit estimate is counted in calendar days or Monday-to-Friday business days. */
export type TransitDayBasis = 'calendar' | 'business';

export interface DeliveryWindowInput {
  /** Shippo rate.estimated_days: an average transit time from the carrier, not binding. */
  estimatedDays?: number | null | undefined;
  /** Shippo rate.arrives_by: a local time of day "HH:MM:SS" with no zone, so never a timestamp. */
  arrivesBy?: string | null | undefined;
}

export interface DeliveryWindowOptions {
  /** The moment the option is being built. Defaults to the wall clock, so pass it when caching. */
  now?: Date;
  /**
   * Days added past the estimate to form the latest bound, counted in the same basis as the
   * transit estimate. Number or a function of the rate. Defaults to defaultBufferDays.
   */
  bufferBusinessDays?: number | ((rate: DeliveryWindowInput) => number);
  /**
   * How to count estimated_days. Default 'calendar', which is the carrier's own reading: Shippo
   * documents estimated_days only as an average transit time and says nothing about weekends,
   * while USPS delivers Saturdays and UPS and FedEx both sell weekend delivery. 'business' is
   * the deliberately conservative reading that under-promises.
   */
  transitDayBasis?: TransitDayBasis;
  /**
   * The destination's UTC offset in minutes, so that day boundaries mean the buyer's day.
   * Default 0. A bound of 2026-09-07T00:00:00Z reads as 6 September in Honolulu, one calendar
   * day earlier than intended, which this option corrects.
   */
  destinationUtcOffsetMinutes?: number;
}

export interface DeliveryWindow {
  earliest_fulfillment_time?: string;
  latest_fulfillment_time?: string;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** First Monday to Friday (UTC) on or after the given date, at 00:00:00Z. Does not mutate. */
export function firstBusinessDayOnOrAfter(date: Date): Date {
  const d = utcMidnight(date);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Add whole business days (Monday to Friday, UTC, no holiday calendar). Does not mutate.
 *
 * A zero-day step is the identity on the START date and does NOT roll a weekend forward, so
 * addBusinessDays(aSaturday, 0) returns that Saturday. deliveryWindow never calls it that way: it
 * always steps from firstBusinessDayOnOrAfter(now), which is already a weekday.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const d = utcMidnight(start);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

/** Add whole calendar days (UTC). Does not mutate. */
export function addCalendarDays(start: Date, days: number): Date {
  const d = utcMidnight(start);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function endOfDay(date: Date): Date {
  return new Date(date.getTime() + 23 * 3_600_000 + 59 * 60_000 + 59_000);
}

/**
 * Buffer days when the caller does not choose one. A carrier that publishes an arrives_by time
 * has committed to a delivery moment, and a one day service with a two day buffer is not a one
 * day service, so both get 0. Everything else gets 2, which absorbs an ordinary carrier delay
 * without swamping the difference between a standard and an express option.
 */
export function defaultBufferDays(rate: DeliveryWindowInput): number {
  if (rate.arrivesBy) return 0;
  return (rate.estimatedDays ?? 0) <= 1 ? 0 : 2;
}

/**
 * Design decision 1. Shippo gives a point estimate in days; UCP wants a window.
 *
 * Ship on the first business day on or after now, because a label bought at the weekend is
 * tendered on Monday. earliest = ship date plus estimated_days in the chosen basis, at the start
 * of the day; latest = earliest plus the buffer in the same basis, at the end of the day. The
 * earliest bound is clamped forward to now, so a same-day service quoted at 15:00 never promises
 * a moment that has already passed. Buffers below zero are treated as zero.
 *
 * UCP does not define whether earliest_fulfillment_time and latest_fulfillment_time mean handoff
 * to the carrier or arrival to the buyer: the two fields appear in no example and no prose, only
 * in the schema's one-line descriptions. This library reads them as the buyer's ARRIVAL window,
 * which is what makes an option render as "Arrives in about 2 days", and says so in the README.
 */
export function deliveryWindow(
  rate: DeliveryWindowInput,
  opts: DeliveryWindowOptions = {},
): DeliveryWindow {
  const days = rate.estimatedDays;
  if (days === undefined || days === null || !Number.isInteger(days) || days < 0) return {};

  const now = opts.now ?? new Date();
  const offsetMs = (opts.destinationUtcOffsetMinutes ?? 0) * 60_000;
  const localNow = new Date(now.getTime() + offsetMs);
  const bufferOption = opts.bufferBusinessDays;
  const buffer = Math.max(
    0,
    bufferOption === undefined
      ? defaultBufferDays(rate)
      : typeof bufferOption === 'function'
        ? bufferOption(rate)
        : bufferOption,
  );
  const addDays = (opts.transitDayBasis ?? 'calendar') === 'business' ? addBusinessDays : addCalendarDays;

  const shipDate = firstBusinessDayOnOrAfter(localNow);
  const rawEarliest = addDays(shipDate, days);
  const rawLatest = endOfDay(addDays(rawEarliest, buffer));
  const earliest = rawEarliest.getTime() < localNow.getTime() ? new Date(localNow.getTime()) : rawEarliest;
  // latest is computed from the UNCLAMPED earliest, so a same-day rate quoted in the last second of
  // a day would otherwise end before it starts (earliest 23:59:59.5, latest 23:59:59.0). Carry the
  // clamp through rather than emitting an inverted window a Platform cannot render.
  const latest = new Date(Math.max(rawLatest.getTime(), earliest.getTime()));

  return {
    earliest_fulfillment_time: new Date(earliest.getTime() - offsetMs).toISOString(),
    latest_fulfillment_time: new Date(latest.getTime() - offsetMs).toISOString(),
  };
}
