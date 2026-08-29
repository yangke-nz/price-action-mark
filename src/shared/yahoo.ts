/**
 * Yahoo Finance's undocumented v8 chart endpoint. Free, keyless, and the only
 * source in this project. Runs unchanged in Node and in the Electron main
 * process — both have global `fetch`, and neither is subject to CORS.
 *
 * Three things that cost real time to discover, all encoded below:
 *
 *  - `range=max` is broken for `ES=F`: it returns ~266 near-monthly bars.
 *    An explicit `period1=0` returns the full ~6,590 daily series. Never use
 *    `range` here.
 *  - `ES=F` is an UNADJUSTED stitched front-month series. It has genuine price
 *    discontinuities at quarterly expiries (2024-12-23 is +2.77%). See rolls.ts.
 *  - The feed is dirty: holidays arrive as null OHLC, some sessions carry
 *    volume 0, and the live bar is occasionally duplicated.
 *  - INTRADAY IS A ROLLING WINDOW, not a shorter page of the same archive.
 *    Measured: `interval=5m` serves the last 60 days and refuses anything
 *    older with HTTP 422 — including a 15-day window ending 55 days ago, so
 *    the whole request has to sit inside the window and there is no paging
 *    backwards. `period1=0`, the trick that gets the full daily series, is
 *    rejected outright. `start` is therefore CLAMPED for intraday rather than
 *    passed through, because a 422 and an empty chart look identical to a
 *    reader. (For reference and not used here: 1m allows 8 days per request
 *    over a ~30-day archive, and that one IS pageable.)
 */
import type { Dataset } from './types.ts';
import { rollIndices } from './rolls.ts';
import { INTERVALS, keyOf, type Interval } from './interval.ts';

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/** Yahoo 403s an empty UA; any browser-shaped string is accepted. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export interface FetchOptions {
  symbol?: string;
  /** ISO date. Default `1970-01-01`, i.e. everything the endpoint has. Clamped
   *  forward for an interval the feed only keeps a window of. */
  start?: string;
  interval?: Interval;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface ChartQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

interface ChartResult {
  meta: Record<string, unknown>;
  timestamp?: number[];
  indicators: { quote: ChartQuote[] };
}

export class YahooError extends Error {}

export async function fetchChart(opts: FetchOptions = {}): Promise<ChartResult> {
  const symbol = opts.symbol ?? 'ES=F';
  const interval = opts.interval ?? '1d';
  const spec = INTERVALS[interval];
  const start = opts.start ?? '1970-01-01';
  const asked = Math.max(0, Math.floor(Date.parse(start + 'T00:00:00Z') / 1000));
  const now = Math.floor(Date.now() / 1000);
  // A day short of the stated limit: the window is measured from the instant
  // the request lands, and asking for exactly 60 days has been seen to 422 on
  // the boundary. One day of an intraday archive is a cheap insurance premium.
  const floor = spec.maxDays === null ? 0 : now - (spec.maxDays - 1) * 86_400;
  const period1 = Math.max(asked, floor);
  const period2 = now + 86_400;

  const url =
    `${ENDPOINT}${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${interval}`;

  // Two abort sources: our own timeout and the caller's signal.
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 90_000);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal });
  } catch (err) {
    throw new YahooError(`request to Yahoo failed: ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) throw new YahooError(`Yahoo returned HTTP ${res.status} for ${symbol}`);

  const body = (await res.json()) as {
    chart?: { result?: ChartResult[] | null; error?: { description?: string } | null };
  };
  if (body.chart?.error) {
    throw new YahooError(`Yahoo rejected ${symbol}: ${body.chart.error.description ?? 'unknown'}`);
  }
  const result = body.chart?.result?.[0];
  if (!result) throw new YahooError(`Yahoo returned no series for ${symbol}`);
  return result;
}

export interface Row {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Drop null bars, de-duplicate by BAR, round to the tick.
 *
 * The de-duplication key is the bar's own key, not its calendar day. That
 * distinction is the whole of intraday support in this function: keyed on the
 * day, a 5-minute pull collapses 275 bars a session into one, and it does it
 * silently — the guard that exists to drop Yahoo's duplicated live bar would
 * quietly become a downsampler. Around 19% of a 60-day 5m pull is null closes
 * (2,804 of 14,688 measured), which is the overnight and weekend gaps.
 */
export function toRows(result: ChartResult, interval: Interval = '1d'): Row[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0];
  if (!q) throw new YahooError('Yahoo returned no quote block');
  const { intraday } = INTERVALS[interval];

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ts.length; i++) {
    const open = q.open[i], high = q.high[i], low = q.low[i], close = q.close[i];
    if (open == null || high == null || low == null || close == null) continue;
    const date = keyOf(ts[i]!, intraday);
    if (seen.has(date)) continue;
    seen.add(date);
    rows.push({
      date,
      open: round2(open), high: round2(high), low: round2(low), close: round2(close),
      volume: Math.trunc(q.volume[i] ?? 0),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

/**
 * The bar the feed has opened and not closed, if it is holding one.
 *
 * ONLY the final row, and only when it carries prices. A partial row anywhere
 * else in the series is dirt, and naming it "pending" would promise a close
 * that is never coming: measured on the daily series, 6,593 of 6,594 rows
 * carry a close, and the row that does not is the one whose timestamp IS
 * `meta.currentTradingPeriod.regular.start`. Trailing ALL-null rows are the
 * ordinary intraday tail -- the overnight, and the weekend -- and are not this.
 */
export function pendingBar(result: ChartResult, interval: Interval = '1d'): string | undefined {
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0];
  const i = ts.length - 1;
  if (!q || i < 0 || q.close[i] != null) return undefined;
  if (q.open[i] == null && q.high[i] == null && q.low[i] == null) return undefined;
  return keyOf(ts[i]!, INTERVALS[interval].intraday);
}

export function toDataset(
  result: ChartResult,
  interval: Interval = '1d',
  rows = toRows(result, interval),
): Dataset {
  if (rows.length === 0) throw new YahooError('no usable bars after filtering');
  const meta = result.meta;
  const str = (k: string, fallback: string): string =>
    typeof meta[k] === 'string' && meta[k] ? (meta[k] as string) : fallback;
  const num = (k: string): number | null => (typeof meta[k] === 'number' ? (meta[k] as number) : null);

  const pending = pendingBar(result, interval);

  const d = rows.map((r) => r.date);
  return {
    symbol: str('symbol', 'ES=F'),
    name: str('shortName', 'E-Mini S&P 500'),
    exchange: str('fullExchangeName', 'CME'),
    currency: str('currency', 'USD'),
    fetched: new Date().toISOString(),
    w52h: num('fiftyTwoWeekHigh'),
    w52l: num('fiftyTwoWeekLow'),
    d,
    o: rows.map((r) => r.open),
    h: rows.map((r) => r.high),
    l: rows.map((r) => r.low),
    c: rows.map((r) => r.close),
    v: rows.map((r) => r.volume),
    rolls: rollIndices(d),
    interval,
    ...(pending === undefined ? {} : { pending }),
  };
}

export async function fetchDataset(opts: FetchOptions = {}): Promise<Dataset> {
  const interval = opts.interval ?? '1d';
  return toDataset(await fetchChart(opts), interval);
}

/** Structural check — a truncated write or a hand-edited cache must not boot. */
export function isDataset(value: unknown): value is Dataset {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['d']) || v['d'].length === 0) return false;
  const n = v['d'].length;
  for (const key of ['o', 'h', 'l', 'c', 'v']) {
    const col = v[key];
    if (!Array.isArray(col) || col.length !== n) return false;
  }
  return Array.isArray(v['rolls']) && typeof v['symbol'] === 'string';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
