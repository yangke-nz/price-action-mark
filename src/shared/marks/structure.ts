/**
 * Market structure: the swing pivots, the legs between them, whether the
 * market is always-in-long or always-in-short, and how many times a pullback
 * has tried to resume the trend. Everything in `rules/lines.ts` and
 * `rules/entries.ts` is written against this rather than against raw bars.
 *
 * Brooks reads swings by eye and the eye is not available here, so a
 * strength-N fractal stands in: a swing high is a bar whose high is not
 * exceeded by the N bars either side of it. Two consequences follow and both
 * are load-bearing.
 *
 * IT LAGS, AND IT SAYS SO. A pivot at bar i cannot be known until bar i + N,
 * so every pivot carries `confirmedAt`. `trend` and `pullback` are built by
 * walking the bars forward and consuming each pivot only once it confirms —
 * they are what was readable at the time, not what the finished chart shows.
 * A tool that draws a swing high on the day it printed is claiming foresight.
 *
 * THE REDUCTION IS STREAMING, NOT GLOBAL. Raw fractals do not alternate: runs
 * of two or three highs with no low between them are ordinary. They are merged
 * in confirmation order, keeping the more extreme of a same-kind pair and
 * discarding a counter-swing that never travelled `minSwingAtr` worth of ATR.
 * Doing that as a global fixed point instead would let a pivot in 2011 be
 * deleted by something that happened in 2012, and every `trend` value before
 * it would silently become a fact from the future.
 *
 * `pivots` and `legs` are therefore the reading AS OF THE LAST BAR; `trend`,
 * `pullback` and `lastPivot` are the causal per-bar record. They can disagree
 * about the recent past, and that disagreement is correct.
 */
import type { Metrics } from './metrics.ts';

export interface Pivot {
  readonly i: number;
  readonly kind: 'high' | 'low';
  readonly price: number;
  /** First bar at which this pivot could be known: `i + strength`. */
  readonly confirmedAt: number;
}

export interface Leg {
  readonly from: Pivot;
  readonly to: Pivot;
  /** 1 for a low -> high leg, -1 for high -> low. */
  readonly dir: 1 | -1;
  /** Absolute price travelled. */
  readonly size: number;
  /** `size` in ATRs at the leg's end. NaN inside the ATR warm-up. */
  readonly sizeAtr: number;
  /** Sessions spanned. */
  readonly bars: number;
}

/** 1 always-in-long, -1 always-in-short, 0 neither — a trading range. */
export type Trend = 1 | -1 | 0;

export interface Structure {
  readonly strength: number;
  readonly minSwingAtr: number;
  /** Strictly alternating, as read at the last bar. */
  readonly pivots: readonly Pivot[];
  readonly legs: readonly Leg[];
  /** Per bar, from pivots confirmed by that bar only. */
  readonly trend: Int8Array;
  /**
   * Per bar: +n on an H{n} in a bull trend, -n on an L{n} in a bear trend,
   * 0 everywhere else. Capped at 4 — Brooks stops counting there, and so does
   * anything useful you can say about the fifth attempt.
   */
  readonly pullback: Int8Array;
  /** Per bar, the index of the most recently confirmed pivot; -1 before any. */
  readonly lastPivot: Int32Array;
}

export interface StructureOptions {
  /** Bars either side that a swing extreme must not be exceeded by. */
  strength?: number;
  /** A counter-swing smaller than this many ATRs is noise, not a leg. */
  minSwingAtr?: number;
}

/**
 * Chosen by sweeping both dials over the whole 26-year series (`npm run marks
 * -- --tune`). Strength 3 puts a pivot every 6.8 sessions with a median leg of
 * 2.8 ATR over 5 bars — the scale a daily chart is actually marked at — and
 * flips always-in 19 times a year, once every 2.7 weeks. Strength 2 is twitchy
 * at 26 flips a year; strength 4 stretches the median leg to 7 bars and starts
 * stepping over swings worth marking.
 */
export const DEFAULT_STRENGTH = 3;
/**
 * Near-inert above strength 2 and kept anyway: at strength 3 it removes 24 of
 * 989 legs, all of them sub-ATR wiggles that cleared the fractal test only
 * because volatility was low. It earns its place if the strength is ever
 * dialled down, where it removes a fifth of them.
 */
export const DEFAULT_MIN_SWING_ATR = 1;
/** Brooks stops counting pullback attempts at four. */
export const MAX_PULLBACK = 4;

/**
 * Raw strength-N fractals, in bar order, before any alternation.
 *
 * Strict on the left and inclusive on the right, which is what resolves a
 * plateau: where two adjacent bars share the same high, the earlier one is the
 * pivot and the later one fails its own left test. Without the asymmetry a
 * flat top emits a pivot per bar.
 */
export function fractals(m: Metrics, strength: number): Pivot[] {
  const out: Pivot[] = [];
  const n = m.n;
  for (let i = strength; i < n - strength; i++) {
    const h = m.high[i]!;
    const l = m.low[i]!;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= strength; k++) {
      if (h <= m.high[i - k]! || h < m.high[i + k]!) isHigh = false;
      if (l >= m.low[i - k]! || l > m.low[i + k]!) isLow = false;
      if (!isHigh && !isLow) break;
    }
    // An outside bar can satisfy both. It is one bar and cannot be two pivots,
    // so the larger tail decides which extreme the market actually rejected.
    if (isHigh && isLow) {
      if (m.upperTail[i]! >= m.lowerTail[i]!) isLow = false;
      else isHigh = false;
    }
    if (isHigh) out.push({ i, kind: 'high', price: h, confirmedAt: i + strength });
    if (isLow) out.push({ i, kind: 'low', price: l, confirmedAt: i + strength });
  }
  return out;
}

/** Is `p` a further extreme than `against` of the same kind? */
function extends_(p: Pivot, against: Pivot): boolean {
  return p.kind === 'high' ? p.price > against.price : p.price < against.price;
}

/**
 * The whole structure, in one forward pass.
 *
 * The pass is the point: raw pivots are fed into the reduction in the order
 * they CONFIRM, and `trend`, `pullback` and `lastPivot` are written from the
 * reduction's state at each bar. Nothing later than bar i can reach back and
 * change what bar i knew.
 */
export function structure(m: Metrics, opts: StructureOptions = {}): Structure {
  const strength = opts.strength ?? DEFAULT_STRENGTH;
  const minSwingAtr = opts.minSwingAtr ?? DEFAULT_MIN_SWING_ATR;
  const n = m.n;

  const raw = fractals(m, strength);
  const kept: Pivot[] = [];

  const trend = new Int8Array(n);
  const pullback = new Int8Array(n);
  const lastPivot = new Int32Array(n).fill(-1);

  let cursor = 0;
  // Pullback state, reset whenever the trend flips.
  let state: Trend = 0;
  let legExtreme = 0;
  let pulling = false;
  let count = 0;

  for (let i = 0; i < n; i++) {
    while (cursor < raw.length && raw[cursor]!.confirmedAt <= i) {
      admit(kept, raw[cursor]!, m, minSwingAtr);
      cursor++;
    }
    lastPivot[i] = kept.length > 0 ? kept[kept.length - 1]!.i : -1;

    const next = readTrend(kept);
    trend[i] = next;

    if (next !== state) {
      state = next;
      count = 0;
      pulling = false;
      legExtreme = next === 1 ? m.high[i]! : next === -1 ? m.low[i]! : 0;
      continue;                     // nothing to count on the bar it flipped
    }
    if (next === 0 || i === 0) continue;

    if (next === 1) {
      const h = m.high[i]!;
      const prev = m.high[i - 1]!;
      if (pulling && h > prev) {
        count = Math.min(count + 1, MAX_PULLBACK);
        pullback[i] = count;
        pulling = false;
      }
      if (h < prev) pulling = true;
      // A new swing extreme ends the sequence: the leg resumed, so whatever
      // comes next is a fresh pullback starting at H1. Resetting only on the
      // attempt bar instead lets the count run away through a grinding trend
      // and pile everything into H4.
      if (h > legExtreme) {
        legExtreme = h;
        count = 0;
      }
    } else {
      const l = m.low[i]!;
      const prev = m.low[i - 1]!;
      if (pulling && l < prev) {
        count = Math.min(count + 1, MAX_PULLBACK);
        pullback[i] = -count;
        pulling = false;
      }
      if (l > prev) pulling = true;
      if (l < legExtreme) {
        legExtreme = l;
        count = 0;
      }
    }
  }

  return { strength, minSwingAtr, pivots: kept, legs: toLegs(kept, m), trend, pullback, lastPivot };
}

/**
 * Fold one raw pivot into the alternating sequence.
 *
 * Same kind as the last: the further extreme wins and replaces it — a dip that
 * did not qualify as a leg has not interrupted the swing. Opposite kind: it
 * only becomes a pivot if the leg it would create is worth `minSwingAtr` of
 * ATR, otherwise it is noise inside the existing swing.
 */
function admit(kept: Pivot[], p: Pivot, m: Metrics, minSwingAtr: number): void {
  const last = kept[kept.length - 1];
  if (last === undefined) {
    kept.push(p);
    return;
  }
  if (last.kind === p.kind) {
    if (extends_(p, last)) kept[kept.length - 1] = p;
    return;
  }
  const atr = m.atr[p.i]!;
  // Inside the ATR warm-up there is no yardstick, so nothing is filtered.
  const floor = Number.isFinite(atr) ? atr * minSwingAtr : 0;
  if (Math.abs(p.price - last.price) >= floor) kept.push(p);
}

/**
 * Higher highs with higher lows is always-in-long, lower highs with lower lows
 * is always-in-short, and anything else is a trading range. Four alternating
 * pivots is the minimum that can express it — two of each kind.
 *
 * This lags by design. Brooks flips always-in on a strong breakout bar, well
 * before structure confirms it; that flip needs `rules/bars.ts`, so it belongs
 * to phase 05 and not here. What this reports is what the swings alone say.
 */
function readTrend(kept: readonly Pivot[]): Trend {
  const k = kept.length;
  if (k < 4) return 0;
  const a = kept[k - 4]!, b = kept[k - 3]!, c = kept[k - 2]!, d = kept[k - 1]!;
  const highs = [a, b, c, d].filter((p) => p.kind === 'high');
  const lows = [a, b, c, d].filter((p) => p.kind === 'low');
  if (highs.length !== 2 || lows.length !== 2) return 0;
  const hh = highs[1]!.price > highs[0]!.price;
  const hl = lows[1]!.price > lows[0]!.price;
  const lh = highs[1]!.price < highs[0]!.price;
  const ll = lows[1]!.price < lows[0]!.price;
  if (hh && hl) return 1;
  if (lh && ll) return -1;
  return 0;
}

function toLegs(pivots: readonly Pivot[], m: Metrics): Leg[] {
  const out: Leg[] = [];
  for (let k = 1; k < pivots.length; k++) {
    const from = pivots[k - 1]!;
    const to = pivots[k]!;
    const size = Math.abs(to.price - from.price);
    out.push({
      from,
      to,
      dir: to.kind === 'high' ? 1 : -1,
      size,
      sizeAtr: size / m.atr[to.i]!,
      bars: to.i - from.i,
    });
  }
  return out;
}
