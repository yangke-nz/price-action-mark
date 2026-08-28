/**
 * Regular against extended hours — the one place in this project that has to
 * know about exchange-local time and daylight saving.
 *
 * Everything DISPLAYED is UTC, deliberately: the stored bar key is UTC and a
 * mark id is built from it, so a local clock would put a different time in
 * front of the reader than the one in the data (see format.ts). A session
 * WINDOW is the opposite case. "Regular trading hours" is defined by the
 * exchange in its own time, 09:30 to 16:15 in New York, and that is 13:30 UTC
 * in summer and 14:30 in winter. Filtering on a UTC clock would quietly shift
 * the window by an hour twice a year, which on a five-minute chart is twelve
 * bars of somebody else's session at one end and twelve missing at the other.
 *
 * WHY FILTERING AND NOT HIDING. The filter produces a new `Dataset`, so
 * metrics, structure, ATR, the rules and the readings all see RTH bars only.
 * That is the point: an RTH chart with an ATR computed over the overnight is
 * not an RTH chart. It also means bar i-1 to bar i crosses the overnight at a
 * session boundary, so `gap` fires there — which is correct, and exactly how a
 * daily series already behaves across a night.
 *
 * COST. One `Intl.DateTimeFormat` call per SESSION DAY, not per bar: measured
 * on a 60-day 5-minute pull, per-bar `formatToParts` is 50 ms and the per-day
 * offset cache is 3 ms for byte-identical output. Intl is the only correct way
 * to get a zone offset without shipping a timezone table, and it is slow enough
 * to matter 11,609 times.
 */
import type { Dataset } from './types.ts';
import { rollIndices } from './rolls.ts';
import { dayOf, specOf } from './interval.ts';

export type Session = 'eth' | 'rth';

export interface SessionSpec {
  readonly id: Session;
  /** For the control and the menu. */
  readonly label: string;
  /** The tooltip, which is where the actual hours belong. */
  readonly title: string;
  /** Suffix for an export filename. */
  readonly slug: string;
}

export const SESSIONS: { readonly [K in Session]: SessionSpec } = {
  eth: {
    id: 'eth',
    label: 'ETH',
    title: 'Extended hours — every bar the feed has, the near-24-hour Globex session',
    slug: 'eth',
  },
  rth: {
    id: 'rth',
    label: 'RTH',
    title: 'Regular hours — 09:30 to 16:15 New York, the session Brooks reads',
    slug: 'rth',
  },
};

export const SESSION_IDS: readonly Session[] = ['eth', 'rth'];

export function isSession(value: unknown): value is Session {
  return value === 'eth' || value === 'rth';
}

/**
 * The ES regular session, in minutes past local midnight: 09:30 to 16:15 in
 * New York.
 *
 * That is the CONTRACT's regular hours, not the cash equities 09:30-16:00 —
 * ES trades fifteen minutes past the NYSE close and those bars are part of the
 * session every charting platform and every Brooks chart shows. The test is on
 * a bar's START, and the close is exclusive, so the last five-minute bar of an
 * RTH session is the one starting 16:10. Measured on a 60-day pull: exactly 81
 * bars a session, every session.
 */
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60 + 15;

const NY = 'America/New_York';

/** Built once. Constructing an Intl formatter is itself not cheap. */
let formatter: Intl.DateTimeFormat | null = null;

function nyFormatter(): Intl.DateTimeFormat {
  formatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter;
}

/**
 * Minutes to add to a UTC clock to get New York's, for the day a key falls on.
 *
 * Cached per UTC day. A day either side of a DST transition gets its own
 * answer, which is the whole reason this is not a constant — the shipped
 * 60-day window happens to sit entirely inside EDT (-240 everywhere), so
 * nothing in the current data would catch a hard-coded offset being wrong.
 */
function nyOffsetMinutes(key: string, cache: Map<string, number>): number {
  const day = dayOf(key);
  const held = cache.get(day);
  if (held !== undefined) return held;

  const parts = nyFormatter().formatToParts(new Date(key));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offset = Math.round((local - Date.parse(key)) / 60_000);
  cache.set(day, offset);
  return offset;
}

/** New York local time of a bar, in minutes past midnight. */
function localMinutes(key: string, cache: Map<string, number>): number {
  const utc = Number(key.slice(11, 13)) * 60 + Number(key.slice(14, 16));
  return ((utc + nyOffsetMinutes(key, cache)) % 1440 + 1440) % 1440;
}

export function inRth(key: string, cache = new Map<string, number>()): boolean {
  const local = localMinutes(key, cache);
  return local >= RTH_OPEN_MIN && local < RTH_CLOSE_MIN;
}

/**
 * A dataset reduced to one session, or returned untouched.
 *
 * A DAILY dataset passes straight through: a daily bar is a whole session, and
 * there is no window to apply to it. `eth` passes through too, because it means
 * "everything the feed has" rather than a second filter.
 *
 * `rolls` is rebuilt rather than remapped. The indices are positions in `d`,
 * and dropping 71% of the bars moves every one of them; recomputing from the
 * surviving keys is both shorter and impossible to get subtly wrong.
 */
export function applySession(ds: Dataset, session: Session): Dataset {
  if (session === 'eth' || !specOf(ds).intraday) return ds;

  const cache = new Map<string, number>();
  const keep: number[] = [];
  for (let i = 0; i < ds.d.length; i++) {
    if (inRth(ds.d[i]!, cache)) keep.push(i);
  }
  if (keep.length === ds.d.length) return ds;

  const d = keep.map((i) => ds.d[i]!);
  return {
    ...ds,
    d,
    o: keep.map((i) => ds.o[i]!),
    h: keep.map((i) => ds.h[i]!),
    l: keep.map((i) => ds.l[i]!),
    c: keep.map((i) => ds.c[i]!),
    v: keep.map((i) => ds.v[i]!),
    rolls: rollIndices(d),
  };
}
