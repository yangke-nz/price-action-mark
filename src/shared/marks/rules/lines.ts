/**
 * The shapes: channels, double tops and bottoms, wedges and triangles.
 *
 * All of them read `ctx.s.pivots` rather than raw bars, and all of them are
 * `fitLine` plus one predicate — see fit.ts. What differs is which pivots go
 * in and what is asked of the slopes.
 *
 * `knownAt` matters more here than anywhere else. Every one of these patterns
 * is anchored on swing pivots, and a pivot is not confirmable until `strength`
 * bars after it printed. A double top completed on a Friday is not readable
 * until the following Wednesday, and drawing it on the Friday would claim
 * foresight. So `knownAt` is the confirmation date of the LAST pivot the
 * pattern depends on, never the date of the pattern's own last point.
 */
import type { ChannelMark, LevelMark, Mark, SegmentMark, Tone } from '../types.ts';
import { markId } from '../types.ts';
import type { Ctx, Rule } from '../rule.ts';
import type { Pivot } from '../structure.ts';
import { envelopeOffset, fitLine, lineThrough, measure, priceOn, type Line } from '../fit.ts';

/** Two peaks this close, in ATRs, are the same level. */
const DT_TOL_ATR = 0.5;
/** Closer than this and it is one swing, not two. */
const DT_MIN_BARS = 4;
/** Further apart and they are two unrelated visits to a level. */
const DT_MAX_BARS = 40;
/** The trough between them has to be this deep, in ATRs, or there is no M. */
const DT_TROUGH_ATR = 1.5;

/** A bar extreme this close to a trendline, in ATRs, counts as a touch. */
const CHANNEL_TOL_ATR = 0.4;
/** Fewer touches than this and the line is drawn through nothing. */
const CHANNEL_MIN_TOUCHES = 3;
/** Closes beyond the line before it stops being a channel. */
const CHANNEL_MAX_BREAKS = 1;
/** Consecutive bars, each higher-high and higher-low, for a micro channel. */
const MICRO_MIN_BARS = 5;
/** Each push in a wedge must be at most this share of the one before. */
const WEDGE_SHRINK = 0.85;

/**
 * A spike is a RUN, judged as a run.
 *
 * Requiring every bar in it to clear the trend-bar body threshold is a
 * stricter reading than Brooks means and finds almost nothing: over 26 years
 * it yields five. What makes a spike is that the market went one way without
 * pausing, so the run is consecutive same-direction bars, and the quality test
 * is on the run's AVERAGE body and its total travel. That lands at 2.4 a year.
 */
const SPIKE_MIN_BARS = 3;
/** ...covering at least this much ground, in ATRs. */
const SPIKE_MIN_ATR = 1.5;
/** ...with bodies averaging at least this share of their ranges. */
const SPIKE_MEAN_BODY = 0.5;
/** The channel after it has to be genuinely shallower than the spike. */
const SPIKE_SLOPE_RATIO = 0.6;
/** Sessions after the spike in which to look for that channel. */
const SPIKE_CHANNEL_WINDOW = 60;

interface Point2 { readonly i: number; readonly price: number }

/** The last session on which every pivot in the set has confirmed. */
function knownAt(ctx: Ctx, pivots: readonly Pivot[]): string {
  let last = 0;
  for (const p of pivots) if (p.confirmedAt > last) last = p.confirmedAt;
  return ctx.data.d[Math.min(last, ctx.data.d.length - 1)]!;
}

const at = (ctx: Ctx, i: number): string => ctx.data.d[i]!;

function segment(
  ctx: Ctx, rule: string, tone: Tone, label: string, note: string,
  a: Point2, b: Point2, pivots: readonly Pivot[], suffix: string,
): SegmentMark {
  return {
    id: markId(rule, at(ctx, a.i), at(ctx, b.i), suffix),
    rule, group: 'lines', label, note, tone,
    at: at(ctx, b.i), knownAt: knownAt(ctx, pivots), source: 'rule',
    kind: 'segment',
    from: { d: at(ctx, a.i), price: a.price },
    to: { d: at(ctx, b.i), price: b.price },
    extend: false,
  };
}

/**
 * Runs of same-kind pivots moving consistently one way — the skeleton of a
 * channel: rising lows for a bull, falling highs for a bear. Longest first, so
 * a five-touch channel is preferred over the three-touch one nested inside it.
 */
function runs(pivots: readonly Pivot[], kind: 'high' | 'low', dir: 1 | -1): Pivot[][] {
  const same = pivots.filter((p) => p.kind === kind);
  const out: Pivot[][] = [];
  let run: Pivot[] = [];
  for (const p of same) {
    const prev = run[run.length - 1];
    if (prev === undefined || (dir === 1 ? p.price > prev.price : p.price < prev.price)) {
      run.push(p);
      continue;
    }
    if (run.length >= 2) out.push(run);
    run = [p];          // the break starts the next run
  }
  if (run.length >= 2) out.push(run);
  return out.sort((a, b) => b.length - a.length);
}

function channelRule(id: string, dir: 1 | -1): Rule {
  const bull = dir === 1;
  return {
    id,
    group: 'lines',
    label: bull ? 'Bull channel' : 'Bear channel',
    blurb: bull
      ? `A trendline through rising lows with a parallel above it, ${CHANNEL_MIN_TOUCHES}+ touches within ${CHANNEL_TOL_ATR} ATR.`
      : `A trendline through falling highs with a parallel below it, ${CHANNEL_MIN_TOUCHES}+ touches within ${CHANNEL_TOL_ATR} ATR.`,
    defaultOn: true,
    detect: (ctx) => {
      const { m, s } = ctx;
      const side: 1 | -1 = bull ? 1 : -1;
      const out: Mark[] = [];
      const claimed: [number, number][] = [];
      for (const run of runs(s.pivots, bull ? 'low' : 'high', dir)) {
        const first = run[0]!;
        const last = run[run.length - 1]!;
        // Longest-first, so anything overlapping an accepted channel is that
        // same channel seen through fewer of its touches.
        if (claimed.some(([a, b]) => first.i <= b && last.i >= a)) continue;

        const line = fitLine(run.map((p) => ({ i: p.i, price: p.price })));
        if (!line) continue;
        const atr = m.atr[last.i]!;
        if (!Number.isFinite(atr)) continue;
        const tol = atr * CHANNEL_TOL_ATR * ctx.tol;
        const q = measure(line, m, first.i, last.i, side, tol, ctx.data.c);
        if (q.touches < CHANNEL_MIN_TOUCHES || q.breaks > CHANNEL_MAX_BREAKS) continue;

        claimed.push([first.i, last.i]);
        out.push({
          id: markId(id, at(ctx, first.i), at(ctx, last.i)),
          rule: id, group: 'lines',
          label: bull ? 'bull channel' : 'bear channel',
          note: `${q.touches} touches over ${last.i - first.i} sessions`,
          tone: bull ? 'bull' : 'bear',
          at: at(ctx, last.i), knownAt: knownAt(ctx, run), source: 'rule',
          kind: 'channel',
          from: { d: at(ctx, first.i), price: priceOn(line, first.i) },
          to: { d: at(ctx, last.i), price: priceOn(line, last.i) },
          offset: envelopeOffset(line, m, first.i, last.i, side),
          extend: false,
        } satisfies ChannelMark);
      }
      return out;
    },
  };
}

export const BULL_CHANNEL = channelRule('bull-channel', 1);
export const BEAR_CHANNEL = channelRule('bear-channel', -1);

export const MICRO_CHANNEL: Rule = {
  id: 'micro-channel',
  group: 'lines',
  label: 'Micro channel',
  blurb: `${MICRO_MIN_BARS}+ consecutive bars each with a higher high and higher low, or the mirror. The strongest kind, and the one that offers no pullback entry.`,
  defaultOn: true,
  detect: (ctx) => {
    const { m } = ctx;
    const out: Mark[] = [];
    for (let start = 1; start < m.n; ) {
      const up = m.high[start]! > m.high[start - 1]! && m.low[start]! > m.low[start - 1]!;
      const down = m.high[start]! < m.high[start - 1]! && m.low[start]! < m.low[start - 1]!;
      if (!up && !down) { start++; continue; }
      const dir: 1 | -1 = up ? 1 : -1;
      let end = start;
      while (
        end + 1 < m.n && m.isContractStart[end + 1] === 0 &&
        (dir === 1
          ? m.high[end + 1]! > m.high[end]! && m.low[end + 1]! > m.low[end]!
          : m.high[end + 1]! < m.high[end]! && m.low[end + 1]! < m.low[end]!)
      ) end++;

      const a = start - 1;
      const bars = end - a + 1;
      if (bars >= MICRO_MIN_BARS) {
        const line = dir === 1
          ? lineThrough({ i: a, price: m.low[a]! }, { i: end, price: m.low[end]! })
          : lineThrough({ i: a, price: m.high[a]! }, { i: end, price: m.high[end]! });
        out.push({
          id: markId('micro-channel', at(ctx, a), at(ctx, end)),
          rule: 'micro-channel', group: 'lines',
          label: dir === 1 ? 'micro channel up' : 'micro channel down',
          note: `${bars} bars, no overlap`,
          tone: dir === 1 ? 'bull' : 'bear',
          at: at(ctx, end),
          // Every bar in the run is readable at its own close, so unlike the
          // pivot-based shapes this one is known the day it completes.
          knownAt: at(ctx, end), source: 'rule',
          kind: 'channel',
          from: { d: at(ctx, a), price: priceOn(line, a) },
          to: { d: at(ctx, end), price: priceOn(line, end) },
          offset: envelopeOffset(line, m, a, end, dir),
          extend: false,
        } satisfies ChannelMark);
      }
      start = end + 1;
    }
    return out;
  },
};

// ---- double top and bottom ------------------------------------------------

export interface Double {
  readonly a: Pivot;
  /** The retracement between the two, and the neckline price. */
  readonly middle: Pivot;
  readonly b: Pivot;
}

/**
 * The one definition of a double top or bottom, shared by the shape rule and
 * by the entry rule that trades it. Duplicating the search in entries.ts would
 * couple the two through their thresholds rather than their meaning, and leave
 * two places to edit when the tolerance moves.
 */
export function findDoubles(ctx: Ctx, kind: 'high' | 'low'): Double[] {
  const { m, s } = ctx;
  const top = kind === 'high';
  const out: Double[] = [];
  const peaks = s.pivots.filter((p) => p.kind === kind);
  for (let k = 1; k < peaks.length; k++) {
    const a = peaks[k - 1]!;
    const b = peaks[k]!;
    const span = b.i - a.i;
    if (span < DT_MIN_BARS || span > DT_MAX_BARS) continue;

    const atr = m.atr[b.i]!;
    if (!Number.isFinite(atr)) continue;
    if (Math.abs(b.price - a.price) > DT_TOL_ATR * atr * ctx.tol) continue;

    // The pivot between them is the neckline, and it has to be a real
    // retracement — without this every pause at a level is a double top.
    const middle = s.pivots.find((p) => p.i > a.i && p.i < b.i && p.kind !== kind);
    if (middle === undefined) continue;
    const depth = top ? Math.min(a.price, b.price) - middle.price
                      : middle.price - Math.max(a.price, b.price);
    if (depth < DT_TROUGH_ATR * atr * ctx.tol) continue;
    out.push({ a, middle, b });
  }
  return out;
}

function doubleRule(id: string, kind: 'high' | 'low'): Rule {
  const top = kind === 'high';
  return {
    id,
    group: 'lines',
    label: top ? 'Double top' : 'Double bottom',
    blurb: `Two ${top ? 'highs' : 'lows'} within ${DT_TOL_ATR} ATR, ${DT_MIN_BARS}-${DT_MAX_BARS} sessions apart, with a ${DT_TROUGH_ATR} ATR ${top ? 'trough' : 'peak'} between them.`,
    defaultOn: true,
    detect: (ctx) => {
      const out: Mark[] = [];
      for (const { a, middle, b } of findDoubles(ctx, kind)) {
        // Drawn as the LEVEL, not as the M. The three-point zigzag through the
        // first peak, the neckline and the second traced what price did and
        // named nothing; what a double top IS about is the one price that was
        // tested twice and held, so that is what gets a line. The neckline is
        // not lost — it is in the note, and `dt-short` still projects the
        // measured move from it.
        //
        // The price is the more EXTREME of the two peaks, not their mean. At
        // the mean one of the two peaks pokes through its own line, which
        // reads as a line drawn slightly wrong; at the extreme the line is a
        // ceiling nothing in the pattern breaches. They sit within DT_TOL_ATR
        // of each other by definition, so the choice moves it under half an
        // ATR either way.
        //
        // The span runs from the first peak to `knownAt`, the bar the pattern
        // became readable — three sessions past the second peak at the default
        // strength. Ending at the second peak would stop the line before the
        // sessions that test it; any other extension would be a constant with
        // nothing behind it.
        const known = knownAt(ctx, [a, middle, b]);
        out.push({
          id: markId(id, at(ctx, a.i), at(ctx, b.i)),
          rule: id, group: 'lines',
          label: top ? 'double top' : 'double bottom',
          note: `${Math.abs(b.price - a.price).toFixed(2)} apart, neckline ${middle.price.toFixed(2)}`,
          tone: top ? 'bear' : 'bull',
          at: at(ctx, b.i), knownAt: known, source: 'rule',
          kind: 'level',
          price: top ? Math.max(a.price, b.price) : Math.min(a.price, b.price),
          fromD: at(ctx, a.i),
          toD: known,
        } satisfies LevelMark);
      }
      return out;
    },
  };
}

export const DOUBLE_TOP = doubleRule('double-top', 'high');
export const DOUBLE_BOTTOM = doubleRule('double-bottom', 'low');

// ---- wedge and triangle ---------------------------------------------------

/**
 * Both are read from the same window of five alternating pivots — three
 * pushes one way with two pullbacks between them — and differ only in what
 * they ask of the two boundary lines.
 *
 * A WEDGE is three pushes the same direction, each smaller than the last, with
 * the push line and the pullback line converging while both still slope the
 * same way. Price is still making progress; it is just running out of it.
 *
 * A TRIANGLE has the two lines sloping in OPPOSITE directions — lower highs
 * against higher lows. Price is going nowhere and the range is closing.
 *
 * Each emits two segments, the upper and lower boundary, rather than one
 * zigzag: the zigzag through the pivots is identical for both shapes, and the
 * whole distinction lives in where the boundaries are heading.
 */
interface Boundaries {
  readonly pushes: readonly Pivot[];
  readonly pulls: readonly Pivot[];
  readonly pushLine: Line;
  readonly pullLine: Line;
}

function boundaries(window: readonly Pivot[]): Boundaries | null {
  const first = window[0]!;
  const pushes = window.filter((p) => p.kind === first.kind);
  const pulls = window.filter((p) => p.kind !== first.kind);
  if (pushes.length !== 3 || pulls.length !== 2) return null;
  const pushLine = fitLine(pushes.map((p) => ({ i: p.i, price: p.price })));
  const pullLine = fitLine(pulls.map((p) => ({ i: p.i, price: p.price })));
  if (!pushLine || !pullLine) return null;
  return { pushes, pulls, pushLine, pullLine };
}

/**
 * A sliding five-pivot window means a genuinely coiling stretch satisfies the
 * predicate at several consecutive positions, and emits the same shape four or
 * five times. Ranges already claimed by an accepted shape are skipped, which
 * keeps the earliest complete reading — the one a trader would have drawn
 * first — rather than every re-statement of it.
 */
function overlaps(claimed: readonly [number, number][], a: number, b: number): boolean {
  return claimed.some(([x, y]) => a <= y && b >= x);
}

function shapeMarks(
  ctx: Ctx, rule: string, label: string, tone: Tone, note: string,
  window: readonly Pivot[], pushes: readonly Pivot[], pulls: readonly Pivot[],
): Mark[] {
  const line = (ps: readonly Pivot[], suffix: string): SegmentMark => {
    const a = ps[0]!;
    const b = ps[ps.length - 1]!;
    return segment(ctx, rule, tone, label, note,
      { i: a.i, price: a.price }, { i: b.i, price: b.price }, window, suffix);
  };
  return [line(pushes, 'push'), line(pulls, 'pull')];
}

export const WEDGE: Rule = {
  id: 'wedge',
  group: 'lines',
  label: 'Wedge',
  blurb: `Three pushes one way, each at most ${Math.round(WEDGE_SHRINK * 100)}% of the one before, with the boundaries converging.`,
  defaultOn: true,
  detect: (ctx) => {
    const out: Mark[] = [];
    for (const w of findWedges(ctx)) {
      out.push(...shapeMarks(ctx, 'wedge', w.up ? 'wedge top' : 'wedge bottom',
        w.up ? 'bear' : 'bull',
        `3 pushes, ${Math.abs(w.legs[0]).toFixed(0)} then ${Math.abs(w.legs[1]).toFixed(0)}`,
        w.window, w.pushes, w.pulls));
    }
    return out;
  },
};

export interface Wedge {
  readonly window: readonly Pivot[];
  readonly pushes: readonly Pivot[];
  readonly pulls: readonly Pivot[];
  /** True for a wedge TOP — three pushes up, traded short. */
  readonly up: boolean;
  /** The two push sizes, second smaller than the first. */
  readonly legs: readonly [number, number];
}

/** The one definition of a wedge, shared by the shape rule and the reversal
 *  entry that trades its third push. */
export function findWedges(ctx: Ctx): Wedge[] {
  const out: Wedge[] = [];
  const claimed: [number, number][] = [];
  const p = ctx.s.pivots;
  for (let k = 0; k + 4 < p.length; k++) {
    const window = p.slice(k, k + 5);
    if (overlaps(claimed, window[0]!.i, window[4]!.i)) continue;
    const parts = boundaries(window);
    if (!parts) continue;
    const { pushes, pulls, pushLine, pullLine } = parts;
    const up = pushes[0]!.kind === 'high';

    // Three pushes the same way, each smaller than the last.
    const legs: [number, number] = [
      pushes[1]!.price - pushes[0]!.price,
      pushes[2]!.price - pushes[1]!.price,
    ];
    const forward = up ? legs.every((v) => v > 0) : legs.every((v) => v < 0);
    if (!forward) continue;
    if (Math.abs(legs[1]) > Math.abs(legs[0]) * WEDGE_SHRINK) continue;

    // Both boundaries lean the same way, and the gap between them closes.
    if (Math.sign(pushLine.slope) !== Math.sign(pullLine.slope)) continue;
    const startGap = Math.abs(priceOn(pushLine, window[0]!.i) - priceOn(pullLine, window[0]!.i));
    const endGap = Math.abs(priceOn(pushLine, window[4]!.i) - priceOn(pullLine, window[4]!.i));
    if (endGap >= startGap) continue;

    claimed.push([window[0]!.i, window[4]!.i]);
    out.push({ window, pushes, pulls, up, legs });
  }
  return out;
}

export const TRIANGLE: Rule = {
  id: 'triangle',
  group: 'lines',
  label: 'Triangle',
  blurb: 'Lower highs against higher lows: the two boundaries slope opposite ways and the range closes.',
  defaultOn: true,
  detect: (ctx) => {
    const out: Mark[] = [];
    const claimed: [number, number][] = [];
    const p = ctx.s.pivots;
    for (let k = 0; k + 4 < p.length; k++) {
      const window = p.slice(k, k + 5);
      if (overlaps(claimed, window[0]!.i, window[4]!.i)) continue;
      const parts = boundaries(window);
      if (!parts) continue;
      const { pushes, pulls, pushLine, pullLine } = parts;

      // Opposite slopes is the whole definition; a flat side is not a triangle.
      if (pushLine.slope === 0 || pullLine.slope === 0) continue;
      if (Math.sign(pushLine.slope) === Math.sign(pullLine.slope)) continue;

      const highs = pushes[0]!.kind === 'high' ? pushLine : pullLine;
      const lows = pushes[0]!.kind === 'high' ? pullLine : pushLine;
      if (highs.slope >= 0 || lows.slope <= 0) continue;   // contracting only

      const startGap = priceOn(highs, window[0]!.i) - priceOn(lows, window[0]!.i);
      const endGap = priceOn(highs, window[4]!.i) - priceOn(lows, window[4]!.i);
      if (endGap <= 0 || endGap >= startGap) continue;

      claimed.push([window[0]!.i, window[4]!.i]);
      out.push(...shapeMarks(ctx, 'triangle', 'triangle', 'neutral',
        `range closes from ${startGap.toFixed(0)} to ${endGap.toFixed(0)}`,
        window, pushes, pulls));
    }
    return out;
  },
};

/**
 * Spike and channel: a run of big same-direction trend bars, then a channel of
 * distinctly shallower slope out of its end.
 *
 * The only composite shape here — it needs a bar-level notion (a spike is trend
 * bars, from `bars.ts`) as well as a fit — and it is the one that names the
 * session where a trend changed character. Brooks reads the two phases very
 * differently: nothing pulls back during the spike, and the channel is where
 * with-trend entries start to exist.
 *
 * Emitted as two marks, the steep segment and the shallow channel, because a
 * single shape would hide the very thing worth seeing: the change in slope.
 */
export const SPIKE_AND_CHANNEL: Rule = {
  id: 'spike-and-channel',
  group: 'lines',
  label: 'Spike and channel',
  blurb: `${SPIKE_MIN_BARS}+ trend bars covering ${SPIKE_MIN_ATR} ATR, then a channel of at most ${SPIKE_SLOPE_RATIO}x that slope. Marks where the trend stopped being one-way.`,
  defaultOn: false,
  tier: 'extra',
  detect: (ctx) => {
    const { m, s, data } = ctx;
    const out: Mark[] = [];
    let i = 1;
    while (i < m.n) {
      const dir = m.dir[i]!;
      if (dir === 0) { i++; continue; }

      // Consecutive same-direction bars, broken by a contract change: bars
      // either side of one are not the same instrument.
      let end = i;
      while (end + 1 < m.n && m.dir[end + 1] === dir && m.isContractStart[end + 1] === 0) end++;

      const bars = end - i + 1;
      const travel = Math.abs(data.c[end]! - data.o[i]!);
      const atr = m.atr[end]!;
      let meanBody = 0;
      for (let k = i; k <= end; k++) meanBody += m.bodyPct[k]!;
      meanBody /= bars;
      if (
        bars < SPIKE_MIN_BARS || !Number.isFinite(atr) ||
        travel < SPIKE_MIN_ATR * atr * ctx.tol || meanBody < SPIKE_MEAN_BODY
      ) {
        i = end + 1;
        continue;
      }
      const spikeSlope = (data.c[end]! - data.o[i]!) / bars;

      // The channel: same-side pivots after the spike, leaning the same way but
      // markedly less steeply. Fewer than two and there is no line to fit.
      const kind = dir > 0 ? 'low' : 'high';
      const after = s.pivots.filter(
        (p) => p.kind === kind && p.i > end && p.i <= end + SPIKE_CHANNEL_WINDOW,
      );
      if (after.length >= 2) {
        const line = fitLine(after.map((p) => ({ i: p.i, price: p.price })));
        const last = after[after.length - 1]!;
        const shallower = line !== null &&
          Math.sign(line.slope) === Math.sign(spikeSlope) &&
          Math.abs(line.slope) < Math.abs(spikeSlope) * SPIKE_SLOPE_RATIO;
        if (line && shallower) {
          const side: 1 | -1 = dir > 0 ? 1 : -1;
          const tol = atr * CHANNEL_TOL_ATR * ctx.tol;
          const q = measure(line, m, end, last.i, side, tol, data.c);
          if (q.touches >= CHANNEL_MIN_TOUCHES && q.breaks <= CHANNEL_MAX_BREAKS) {
            const tone: Tone = dir > 0 ? 'bull' : 'bear';
            const note = `${bars}-bar spike of ${travel.toFixed(0)} ` +
              `(${(travel / atr).toFixed(1)} ATR), then a channel ` +
              `${(Math.abs(line.slope / spikeSlope) * 100).toFixed(0)}% as steep`;
            out.push(segment(ctx, 'spike-and-channel', tone, 'spike', note,
              { i, price: data.o[i]! }, { i: end, price: data.c[end]! }, after, 'spike'));
            out.push({
              id: markId('spike-and-channel', at(ctx, end), at(ctx, last.i), 'channel'),
              rule: 'spike-and-channel', group: 'lines',
              label: dir > 0 ? 'channel after spike' : 'channel after spike',
              note, tone,
              at: at(ctx, last.i), knownAt: knownAt(ctx, after), source: 'rule',
              kind: 'channel',
              from: { d: at(ctx, end), price: priceOn(line, end) },
              to: { d: at(ctx, last.i), price: priceOn(line, last.i) },
              offset: envelopeOffset(line, m, end, last.i, side),
              extend: false,
            } satisfies ChannelMark);
            i = last.i + 1;
            continue;
          }
        }
      }
      i = end + 1;
    }
    return out;
  },
};

export const LINE_RULES: readonly Rule[] = [
  BULL_CHANNEL, BEAR_CHANNEL, MICRO_CHANNEL, SPIKE_AND_CHANNEL,
  DOUBLE_TOP, DOUBLE_BOTTOM, WEDGE, TRIANGLE,
];
