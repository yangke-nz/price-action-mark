/**
 * The bar size, and everything that depends on it.
 *
 * One idea makes the rest of the codebase survive intraday almost untouched:
 * `Dataset.d[i]` stays a STRING KEY that sorts lexicographically. A daily bar
 * is `2026-08-28`; a five-minute bar is `2026-08-28T13:45:00Z`. Both are ISO
 * 8601, so `<` and `>` order them correctly, `Map<string, number>` indexes
 * them, `markId(rule, at)` keys a verdict on them, and the viewport test
 * `mk.at >= lo && mk.at <= hi` is unchanged. Nothing that treats a bar's date
 * as an opaque handle had to learn about time.
 *
 * What DOES have to know is small and listed here rather than scattered:
 * turning an epoch into a key, a key back into an epoch (the chart's time
 * axis), a key into its session day (contract rolls), and which range presets
 * make sense for a bar size — a 5-year button is nonsense against a 60-day
 * archive.
 *
 * `Dataset.interval` is OPTIONAL for the same reason `tick` was never added to
 * Dataset: making it required would invalidate every cached dataset and the
 * committed snapshot, and `isDataset()` would have to keep accepting the old
 * shape anyway. Absent means daily, which is true of every file that exists.
 */
import type { Dataset, RangeId } from './types.ts';

export type Interval = '1d' | '5m';

export interface IntervalSpec {
  readonly id: Interval;
  /** For the timeframe control and the menu: a noun. */
  readonly label: string;
  /** For a sentence: an adjective, so `${bars} bars` reads. "5 minutes bars"
   *  is what one field for both gives you. */
  readonly bars: string;
  /** Nominal seconds a bar covers. */
  readonly seconds: number;
  /** True when a bar is shorter than a session, so its key carries a time. */
  readonly intraday: boolean;
  /**
   * How far back the feed will serve this, in days — MEASURED against Yahoo's
   * v8 endpoint for `ES=F`, not taken from documentation:
   *
   *   1d   everything; `period1=0` returns the full ~6,550 bars
   *   5m   the last 60 days, and NOT pageable — a window covering days 60-120
   *        ago returns HTTP 422 "must be within the last 60 days", and so does
   *        a 15-day window ending 55 days ago. Sixty days is the archive, not
   *        a per-request cap you can walk backwards through.
   */
  readonly maxDays: number | null;
  /** Range presets worth offering. A 5Y button against 60 days is a lie. */
  readonly ranges: readonly RangeId[];
  readonly defaultRange: RangeId;
  /** Suffix for the cache file and the export filename. */
  readonly slug: string;
}

export const INTERVALS: { readonly [K in Interval]: IntervalSpec } = {
  '1d': {
    id: '1d',
    label: 'Daily',
    bars: 'Daily',
    seconds: 86_400,
    intraday: false,
    maxDays: null,
    ranges: ['1M', '3M', '6M', '1Y', '5Y', 'MAX'],
    defaultRange: '6M',
    slug: 'daily',
  },
  '5m': {
    id: '5m',
    label: '5 minutes',
    bars: '5-minute',
    seconds: 300,
    intraday: true,
    maxDays: 60,
    // No 3M+: the archive is 60 days, so those buttons would all show the same
    // thing as MAX while implying history that is not there.
    ranges: ['1D', '3D', '1W', '2W', '1M', 'MAX'],
    defaultRange: '3D',
    slug: '5m',
  },
};

export const INTERVAL_IDS: readonly Interval[] = ['1d', '5m'];

/**
 * The interval an RTH DAILY chart is built from.
 *
 * Five-minute rather than hourly, and that is a correctness choice, not a
 * convenience one: hourly bars sit on the hour in New York, so the 09:00 bar
 * straddles the 09:30 open and the 16:00 bar straddles the 16:15 close. They
 * would buy 730 days of history — measured — in exchange for an open and a
 * close that are both guesses, and those two prices are what a price-action
 * chart is read on. Five-minute bars land exactly on the session's edges: 81 a
 * session, every session.
 */
export const RTH_DAILY_SOURCE: Interval = '5m';

export function isInterval(value: unknown): value is Interval {
  return value === '1d' || value === '5m';
}

/** A dataset's bar size. Absent means daily — see the note at the top. */
export function intervalOf(ds: Pick<Dataset, 'interval'>): Interval {
  return isInterval(ds.interval) ? ds.interval : '1d';
}

export function specOf(ds: Pick<Dataset, 'interval'>): IntervalSpec {
  return INTERVALS[intervalOf(ds)];
}

/**
 * Epoch seconds -> the key stored in `Dataset.d`.
 *
 * Intraday keys are truncated to the MINUTE and always in UTC. Seconds are
 * kept in the string (`:00Z`) rather than omitted because `Date.parse` of a
 * seconds-less ISO string is not something every runtime agrees on, and this
 * value round-trips through JSON, the chart and a mark id.
 */
export function keyOf(epochSeconds: number, intraday: boolean): string {
  const iso = new Date(epochSeconds * 1000).toISOString();
  return intraday ? `${iso.slice(0, 16)}:00Z` : iso.slice(0, 10);
}

/** A key back to epoch SECONDS, which is what a chart time axis wants. */
export function epochOf(key: string): number {
  const ms = Date.parse(key.length === 10 ? `${key}T00:00:00Z` : key);
  return Math.floor(ms / 1000);
}

/** The session day a key belongs to. Contract rolls are a calendar fact. */
export function dayOf(key: string): string {
  return key.slice(0, 10);
}

/**
 * The range preset to use when the stored one does not apply to this interval.
 *
 * Settings hold ONE range across a timeframe switch, and `5Y` means nothing on
 * a 60-day archive. Rather than store a range per interval — which would
 * freeze today's preset list into every settings file, the same argument
 * `settings.marks.rules` makes for being sparse — an out-of-range value falls
 * back to the interval's own default.
 */
export function rangeFor(interval: Interval, stored: RangeId): RangeId {
  const spec = INTERVALS[interval];
  return spec.ranges.includes(stored) ? stored : spec.defaultRange;
}
