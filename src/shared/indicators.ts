/**
 * Series maths. Pure functions over the price columns, so the chart, the
 * readout, the marking rules and any export all compute an indicator once.
 *
 * A caveat specific to THIS dataset: `ES=F` is an unadjusted stitched
 * front-month series, so a moving average computed straight across a quarterly
 * roll absorbs the carry gap — the December 2024 roll alone is +2.77% that
 * nobody traded. Resetting the average at each roll would be worse (it would
 * restart the warm-up 104 times and print a discontinuity of its own), so the
 * average runs continuously and the chart labels the rolls instead. Treat a
 * cross that happens within a few sessions of a roll marker with suspicion.
 */

/**
 * Exponential moving average, seeded with the simple average of the first
 * `period` values — the standard warm-up. Entries before the seed are `null`
 * rather than 0 or the raw close: a line has to be absent there, not wrong.
 */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export const EMA_PERIOD = 20;

/** A price column: a plain array, or one of the typed columns in
 *  marks/metrics.ts. Both index to a number and report a length. */
export type Column = ArrayLike<number>;

/** Matched to EMA_PERIOD so "one session" means the same span to both. */
export const ATR_PERIOD = 20;

/**
 * True range, per bar: the larger of this bar's own range and the distance
 * each extreme sits from the previous close, so an overnight gap counts as
 * movement rather than being invisible.
 *
 * The caveat above applies here with teeth. On the first session of a new
 * contract the previous close belongs to a DIFFERENT one, so
 * `|high - prevClose|` measures carry: 2024-12-23 would score 202.74 points of
 * true range against its own 78-point span, none of it traded. Every
 * relative-size test in the marking rules divides by ATR, so one inflated bar
 * quietly raises the threshold for "big" across the whole smoothing window
 * after it. At a contract start the gap component is therefore dropped and the
 * bar contributes its own high - low.
 *
 * `starts` is `contractStarts()` from rolls.ts, NOT `Dataset.rolls` — those
 * differ by one bar and only one of them is the discontinuity.
 */
export function trueRange(
  high: Column,
  low: Column,
  close: Column,
  starts: ReadonlySet<number> = new Set(),
): number[] {
  const n = high.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const span = high[i]! - low[i]!;
    // No previous close at i = 0, and none worth trusting across contracts.
    out[i] = i === 0 || starts.has(i)
      ? span
      : Math.max(span, Math.abs(high[i]! - close[i - 1]!), Math.abs(low[i]! - close[i - 1]!));
  }
  return out;
}

/**
 * Wilder's average true range, seeded with the simple mean of the first
 * `period` true ranges and smoothed at 1/period thereafter. Warm-up entries
 * are `null` for the same reason the EMA's are: an average has to be absent
 * where it does not exist, not zero.
 *
 * This is the yardstick for every "big bar", "climactic" and "within
 * tolerance" test in the marking rules, which is why it is here rather than
 * inside them — one definition, shared by the chart, the rules and the CLI.
 */
export function atr(
  high: Column,
  low: Column,
  close: Column,
  period = ATR_PERIOD,
  starts: ReadonlySet<number> = new Set(),
): (number | null)[] {
  const tr = trueRange(high, low, close, starts);
  const out: (number | null)[] = new Array(tr.length).fill(null);
  if (period < 1 || tr.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i]!;
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}
