/**
 * Series maths. Pure functions over the close column, so the chart, the
 * readout and any future export all compute an indicator exactly once.
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
