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
 */
import type { Dataset } from './types.ts';
import { rollIndices } from './rolls.ts';

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/** Yahoo 403s an empty UA; any browser-shaped string is accepted. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export interface FetchOptions {
  symbol?: string;
  /** ISO date. Default `1970-01-01`, i.e. everything the endpoint has. */
  start?: string;
  interval?: '1d' | '1wk' | '1mo';
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
  const start = opts.start ?? '1970-01-01';
  const period1 = Math.max(0, Math.floor(Date.parse(start + 'T00:00:00Z') / 1000));
  const period2 = Math.floor(Date.now() / 1000) + 86_400;

  const url =
    `${ENDPOINT}${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=${opts.interval ?? '1d'}`;

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

/** Drop null bars, de-duplicate by session date, round to the tick. */
export function toRows(result: ChartResult): Row[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0];
  if (!q) throw new YahooError('Yahoo returned no quote block');

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ts.length; i++) {
    const open = q.open[i], high = q.high[i], low = q.low[i], close = q.close[i];
    if (open == null || high == null || low == null || close == null) continue;
    const date = new Date(ts[i]! * 1000).toISOString().slice(0, 10);
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

export function toDataset(result: ChartResult, rows = toRows(result)): Dataset {
  if (rows.length === 0) throw new YahooError('no usable bars after filtering');
  const meta = result.meta;
  const str = (k: string, fallback: string): string =>
    typeof meta[k] === 'string' && meta[k] ? (meta[k] as string) : fallback;
  const num = (k: string): number | null => (typeof meta[k] === 'number' ? (meta[k] as number) : null);

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
  };
}

export async function fetchDataset(opts: FetchOptions = {}): Promise<Dataset> {
  return toDataset(await fetchChart(opts));
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
