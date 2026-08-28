/**
 * The vocabulary every marking rule is written in: one pass over the dataset
 * producing the per-bar quantities that "trend bar", "doji", "shaved", "big"
 * and "gap" are actually definitions over.
 *
 * Columns rather than an array of objects, and computed exactly once per
 * dataset, because ~30 rules each walking 6,550 bars must not each rebuild
 * this. Typed arrays keep the whole set around 0.6 MB.
 *
 * Three things here are not arithmetic, and are the reason this file exists.
 *
 * CONTRACT-AWARE TRUE RANGE, ON THE RIGHT BAR. The gap across a contract
 * change is carry — see indicators.ts — and the bar it lands on is NOT the one
 * the chart marks. `Dataset.rolls` holds the expiry sessions; the
 * discontinuity is the session after, where the new front month opens. The
 * chart marks 2024-12-20 and the +2.77% of carry is 2024-12-23. So `tr` and
 * `gap` are suppressed at `contractStarts()`, one bar later, and getting this
 * off by one leaves the carry in ATR while suppressing a real move next to
 * it. `gap` is forced to 0 there for the same reason: 2024-12-23 is a textbook
 * gap up by every geometric test and a tradable gap by none.
 *
 * SELF-CONSISTENT EXTREMES. On ten of the 6,550 sessions the feed prints a
 * close outside its own high/low. Eight are quarterly expiries carrying the
 * final settlement price — recognisable because they are the only closes in
 * the series off the 0.25 tick grid — and the other two (2002-01-31 by half a
 * point, 2008-03-18 by forty) are plain feed dirt. Left alone they make
 * `closePos` exceed 1 and `bodyPct` exceed the range, which would fire
 * `shaved` and `reversal-bar` on the strength of a bad print. So `high` and
 * `low` here are the printed extremes WIDENED to enclose open and close, the
 * ratios below are computed against those, and `suspect` marks the bars where
 * that widening was needed. Rules read `m.high` / `m.low`, never `data.h` /
 * `data.l`, so the correction cannot be bypassed by accident.
 *
 * NOTHING IS SKIPPED HERE. `isRoll` and `suspect` are reported, not acted on:
 * a bar rule wants to decline those sessions, but a line rule legitimately
 * spans them.
 */
import type { Dataset } from '../types.ts';
import { ATR_PERIOD, atr, trueRange } from '../indicators.ts';
import { contractStarts } from '../rolls.ts';

export interface Metrics {
  /** Bar count. Every column below has this length. */
  readonly n: number;
  /** The ATR period these columns were built with. */
  readonly period: number;

  /** Printed high, widened to enclose open and close. Use this, not `data.h`. */
  readonly high: Float64Array;
  /** Printed low, widened to enclose open and close. Use this, not `data.l`. */
  readonly low: Float64Array;

  /** high - low. Zero is possible: a limit-locked session prints one price. */
  readonly range: Float64Array;
  /** |close - open|. */
  readonly body: Float64Array;
  /** body / range, in 0..1. Zero where range is zero. */
  readonly bodyPct: Float64Array;

  /** high - max(open, close). */
  readonly upperTail: Float64Array;
  /** min(open, close) - low. */
  readonly lowerTail: Float64Array;
  /** upperTail / range, in 0..1. */
  readonly upperTailPct: Float64Array;
  /** lowerTail / range, in 0..1. */
  readonly lowerTailPct: Float64Array;

  /** (close - low) / range: 0 closing on the low, 1 closing on the high.
   *  0.5 where the bar has no range at all. */
  readonly closePos: Float64Array;

  /** 1 close above open, -1 close below, 0 exactly equal. */
  readonly dir: Int8Array;

  /** True range, gap component dropped at rolls. */
  readonly tr: Float64Array;
  /** Wilder ATR. NaN through the warm-up, where it does not exist. */
  readonly atr: Float64Array;
  /** range / atr — "big" is only ever relative. NaN through the warm-up. */
  readonly rangeAtr: Float64Array;

  /** 1 at the expiry sessions the chart marks. Reported for the readout;
   *  a rule that wants to decline a discontinuity wants `isContractStart`. */
  readonly isRoll: Uint8Array;
  /** 1 at the first session of a new contract — the bar whose comparison
   *  against the previous session crosses contracts, and where `tr` and `gap`
   *  are suppressed. One bar after `isRoll`, except across a holiday expiry. */
  readonly isContractStart: Uint8Array;
  /** 1 where the printed high/low did not enclose the printed open/close. */
  readonly suspect: Uint8Array;
  /** 1 gap up (low above the prior high), -1 gap down, 0 otherwise.
   *  Always 0 at a contract start and at the first bar. */
  readonly gap: Int8Array;
}

/** `null` from the indicator functions becomes NaN in a Float64Array: both say
 *  "absent", and NaN loses every comparison a rule can make, so a warm-up bar
 *  can never accidentally satisfy a threshold. */
function toFloats(values: readonly (number | null)[]): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = v === null || v === undefined ? Number.NaN : v;
  }
  return out;
}

export function metrics(data: Dataset, period = ATR_PERIOD): Metrics {
  const n = data.d.length;
  const { o, c } = data;
  const rolls = new Set(data.rolls);
  const starts = new Set(contractStarts(data.d, data.rolls));

  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const range = new Float64Array(n);
  const body = new Float64Array(n);
  const bodyPct = new Float64Array(n);
  const upperTail = new Float64Array(n);
  const lowerTail = new Float64Array(n);
  const upperTailPct = new Float64Array(n);
  const lowerTailPct = new Float64Array(n);
  const closePos = new Float64Array(n);
  const dir = new Int8Array(n);
  const isRoll = new Uint8Array(n);
  const isContractStart = new Uint8Array(n);
  const suspect = new Uint8Array(n);
  const gap = new Int8Array(n);

  for (let i = 0; i < n; i++) {
    const open = o[i]!;
    const close = c[i]!;
    const top = open > close ? open : close;
    const bottom = open < close ? open : close;

    const h = data.h[i]!;
    const l = data.l[i]!;
    if (top > h || bottom < l) suspect[i] = 1;
    const hi = top > h ? top : h;
    const lo = bottom < l ? bottom : l;
    const span = hi - lo;

    high[i] = hi;
    low[i] = lo;
    range[i] = span;
    body[i] = top - bottom;
    upperTail[i] = hi - top;
    lowerTail[i] = bottom - lo;
    dir[i] = close > open ? 1 : close < open ? -1 : 0;
    isRoll[i] = rolls.has(i) ? 1 : 0;
    isContractStart[i] = starts.has(i) ? 1 : 0;

    if (span > 0) {
      bodyPct[i] = body[i]! / span;
      upperTailPct[i] = upperTail[i]! / span;
      lowerTailPct[i] = lowerTail[i]! / span;
      closePos[i] = (close - lo) / span;
    } else {
      // A no-range bar is all body by one reading and all doji by another.
      // Neither is useful, so it gets the values that make every threshold
      // test decline it rather than fire spuriously.
      closePos[i] = 0.5;
    }
  }

  for (let i = 1; i < n; i++) {
    if (starts.has(i)) continue;
    gap[i] = low[i]! > high[i - 1]! ? 1 : high[i]! < low[i - 1]! ? -1 : 0;
  }

  // Same widened extremes, so ATR is never measured against a high the feed
  // itself contradicts.
  const tr = new Float64Array(trueRange(high, low, c, starts));
  const atrCol = toFloats(atr(high, low, c, period, starts));
  const rangeAtr = new Float64Array(n);
  for (let i = 0; i < n; i++) rangeAtr[i] = range[i]! / atrCol[i]!;

  return {
    n, period,
    high, low, range, body, bodyPct,
    upperTail, lowerTail, upperTailPct, lowerTailPct,
    closePos, dir,
    tr, atr: atrCol, rangeAtr,
    isRoll, isContractStart, suspect, gap,
  };
}
