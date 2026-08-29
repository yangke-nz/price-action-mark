/**
 * Entries: where the other two groups turn into a trade with three prices on it.
 *
 * Each rule finds a SIGNAL BAR and hands it to `planFor`, which applies
 * Brooks's mechanical definition — a stop order one tick beyond the bar, the
 * protective stop one tick beyond its other end. The rules do no arithmetic of
 * their own, so "where is the stop" has one answer across all of them.
 *
 * The signal bar is always the bar BEFORE the entry triggers, and `knownAt` is
 * its close: that is the evening you could have placed the order. A rule that
 * dated itself to the fill would be describing a decision made with the fill
 * already visible.
 *
 * Every pattern these consume is imported rather than re-derived —
 * `breakoutIndices`, `findDoubles`, `findWedges`. An entry rule that
 * re-implemented "what is a double bottom" would drift from the shape rule the
 * first time a tolerance moved, and the chart would draw one and trade another.
 */
import type { Mark, RuleId, TradeMark } from '../types.ts';
import { markId } from '../types.ts';
import type { Ctx, Rule } from '../rule.ts';
import { comparable } from '../rule.ts';
import { planFor, walkForward } from '../trade.ts';
import { breakoutIndices } from './bars.ts';
import { findDoubles, findWedges } from './lines.ts';

/** Sessions after a breakout in which the first pullback still counts. */
const BO_PULLBACK_WINDOW = 5;
/** Sessions a breakout has to close back inside the range to be a failure. */
const FAILED_BO_WINDOW = 2;

/**
 * Build the mark, run the walk-forward, and put the result in the note.
 *
 * The outcome is lookahead and is deliberately confined to `note` and
 * `through`: nothing here lets it decide whether the mark exists. `knownAt`
 * still says when the setup was readable, so the two dates together tell the
 * reader exactly how much of this they could have known at the time.
 *
 * THE ORDER GOES IN AT `knownAt`, WHICH IS NOT ALWAYS THE SIGNAL BAR. The
 * prices come from the signal bar — one tick beyond it, both ends — but a
 * pattern anchored on a swing PIVOT is not readable until that pivot confirms
 * `strength` bars later, and an order cannot be placed before the setup can be
 * seen. Five of the eight rules here sign their signal bar's own close and
 * `orderAt` is simply `signal`; the three pivot-anchored ones (`dt-short`,
 * `db-long`, `wedge-reversal`) pass the confirmation bar.
 *
 * That was the bug. All 257 of their marks reported a fill on the bar after
 * the second peak — TWO SESSIONS before the mark's own `knownAt` — and the
 * edge those notes showed was almost entirely that head start: measured over
 * the whole series, `dt-short` +0.873 R a mark became +0.114, `db-long`
 * +0.601 became +0.079, and `wedge-reversal` +0.345 became -0.160. A review
 * tool that quotes an outcome for an order nobody could have placed is worse
 * than one that quotes nothing. `--check` now asserts it per mark.
 */
function trade(
  ctx: Ctx, rule: RuleId, label: string, signal: number,
  dir: 'long' | 'short', target?: number, extra = '', orderAt = signal,
): TradeMark | null {
  const plan = planFor(ctx, signal, dir, target);
  if (plan === null) return null;
  const r = walkForward(ctx, plan, orderAt);
  const at = ctx.data.d[signal]!;
  const through = ctx.data.d[Math.max(r.at, signal)]!;
  const detail = r.outcome === 'no fill'
    ? 'never filled'
    : `${r.outcome} in ${r.bars} bars, ${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R` +
      (r.ambiguous ? ' (bar spanned both; scored as the stop)' : '');
  return {
    id: markId(rule, at),
    rule, group: 'entries', label,
    note: `${extra}${extra ? ' · ' : ''}entry ${plan.entry.toFixed(2)}, stop ${plan.stop.toFixed(2)}, ` +
      `target ${plan.target.toFixed(2)} · ${detail}`,
    tone: dir === 'long' ? 'bull' : 'bear',
    at, knownAt: ctx.data.d[orderAt]!, source: 'rule',
    kind: 'trade',
    dir, entry: plan.entry, stop: plan.stop, target: plan.target, through,
  };
}

// ---- pullback counts ------------------------------------------------------

/**
 * `s.pullback[i]` is the count on the bar that TRADES through the previous
 * bar's extreme, so the signal bar is `i - 1` and the entry is one tick beyond
 * its high (or low). Those fills are guaranteed by construction: the count
 * only increments on a bar that already exceeded that extreme.
 */
function pullbackEntries(ctx: Ctx, rule: RuleId, only?: number): Mark[] {
  const out: Mark[] = [];
  const pb = ctx.s.pullback;
  for (let i = 1; i < ctx.m.n; i++) {
    const count = pb[i]!;
    if (count === 0) continue;
    const n = Math.abs(count);
    if (only !== undefined && n !== only) continue;
    const signal = i - 1;
    if (!comparable(ctx.m, i)) continue;
    const long = count > 0;
    const mark = trade(ctx, rule, `${long ? 'H' : 'L'}${n}`, signal, long ? 'long' : 'short',
      undefined, `${long ? 'H' : 'L'}${n} in a ${long ? 'bull' : 'bear'} leg`);
    if (mark) out.push(mark);
  }
  return out;
}

export const PULLBACK_ENTRY: Rule = {
  id: 'pullback-entry',
  group: 'entries',
  label: 'Pullback entry (H1-H4 / L1-L4)',
  phrase: 'pullback entry',
  blurb: 'Every counted attempt to resume the trend. Around 1,600 over the series, so it ships off; second-entry is the subset worth watching.',
  defaultOn: false,
  tier: 'extra',
  detect: (ctx) => pullbackEntries(ctx, 'pullback-entry'),
};

export const SECOND_ENTRY: Rule = {
  id: 'second-entry',
  group: 'entries',
  label: 'Second entry (H2 / L2)',
  phrase: 'second entry',
  blurb: 'The second attempt to resume the trend, which Brooks treats as the highest-probability with-trend entry.',
  defaultOn: true,
  detect: (ctx) => pullbackEntries(ctx, 'second-entry', 2),
};

// ---- pattern entries ------------------------------------------------------

function doubleEntry(id: RuleId, kind: 'high' | 'low'): Rule {
  const top = kind === 'high';
  return {
    id,
    group: 'entries',
    label: top ? 'Double top short' : 'Double bottom long',
    blurb: top
      ? 'Short the bar that turns the second peak. Target is the measured move: the pattern height projected down from the neckline.'
      : 'Long the bar that turns the second trough. Target is the measured move: the pattern height projected up from the neckline.',
    defaultOn: true,
    detect: (ctx) => {
      const out: Mark[] = [];
      for (const { middle, b } of findDoubles(ctx, kind)) {
        // The second peak IS the signal bar: it is the swing extreme, so the
        // order sits one tick the other side of it. Readable only once that
        // pivot confirms — which is both what `knownAt` says and, since the
        // order cannot go in before the setup can be seen, the bar the
        // walk-forward starts from.
        const confirmed = Math.min(b.confirmedAt, ctx.m.n - 1);
        const height = Math.abs(b.price - middle.price);
        const target = top ? middle.price - height : middle.price + height;
        const mark = trade(ctx, id, top ? 'DT' : 'DB', b.i, top ? 'short' : 'long', target,
          `measured move ${height.toFixed(0)} from ${middle.price.toFixed(2)}`, confirmed);
        if (mark) out.push(mark);
      }
      return out;
    },
  };
}

export const DOUBLE_TOP_SHORT = doubleEntry('dt-short', 'high');
export const DOUBLE_BOTTOM_LONG = doubleEntry('db-long', 'low');

export const WEDGE_REVERSAL: Rule = {
  id: 'wedge-reversal',
  group: 'entries',
  label: 'Wedge reversal',
  blurb: 'Trade against the third push of a wedge. Target is the start of the wedge, which is where Brooks expects it to unwind to.',
  defaultOn: true,
  detect: (ctx) => {
    const out: Mark[] = [];
    for (const w of findWedges(ctx)) {
      const third = w.pushes[2]!;
      // The third push is a pivot, so it is not readable — and the order is
      // not placeable — until it confirms. See `trade`.
      const confirmed = Math.min(third.confirmedAt, ctx.m.n - 1);
      // A wedge usually unwinds to where it began, which is a longer target
      // than 2R and the reason the setup is worth taking at all.
      const target = w.window[0]!.price;
      const mark = trade(ctx, 'wedge-reversal', w.up ? 'W▼' : 'W▲', third.i,
        w.up ? 'short' : 'long', target, `third push, back to ${target.toFixed(2)}`, confirmed);
      if (mark) out.push(mark);
    }
    return out;
  },
};

export const BO_PULLBACK: Rule = {
  id: 'bo-pullback',
  group: 'entries',
  label: 'Breakout pullback',
  blurb: `The first bar to pull back against a breakout within ${BO_PULLBACK_WINDOW} sessions, entered in the breakout's direction.`,
  defaultOn: true,
  detect: (ctx) => {
    const { m } = ctx;
    const out: Mark[] = [];
    // Breakouts on consecutive sessions find the SAME first pullback, which
    // without this emits two marks on one bar carrying one id — duplicate keys
    // in the list, two identical rows, and one verdict covering both.
    const claimed = new Set<number>();
    for (const { i, dir } of breakoutIndices(ctx)) {
      for (let k = i + 1; k <= i + BO_PULLBACK_WINDOW && k < m.n; k++) {
        if (!comparable(m, k)) break;
        // The first bar that gives ground is the signal; the entry order goes
        // one tick beyond it, back in the breakout's direction.
        const pulled = dir > 0 ? m.high[k]! < m.high[k - 1]! : m.low[k]! > m.low[k - 1]!;
        if (!pulled) continue;
        if (claimed.has(k)) break;
        claimed.add(k);
        const mark = trade(ctx, 'bo-pullback', dir > 0 ? 'BO▲' : 'BO▼', k,
          dir > 0 ? 'long' : 'short', undefined, `first pullback, ${k - i} bars after the breakout`);
        if (mark) out.push(mark);
        break;
      }
    }
    return out;
  },
};

export const FAILED_BO: Rule = {
  id: 'failed-bo',
  group: 'entries',
  label: 'Failed breakout',
  blurb: `A breakout that closes back inside the prior range within ${FAILED_BO_WINDOW} sessions. Faded the other way.`,
  defaultOn: true,
  detect: (ctx) => {
    const { m, data } = ctx;
    const out: Mark[] = [];
    const claimed = new Set<number>();
    for (const { i, dir } of breakoutIndices(ctx)) {
      // The level it broke: the extreme of the window it cleared.
      let level = dir > 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      for (let k = Math.max(0, i - 20); k < i; k++) {
        const v = dir > 0 ? m.high[k]! : m.low[k]!;
        if (dir > 0 ? v > level : v < level) level = v;
      }
      for (let k = i + 1; k <= i + FAILED_BO_WINDOW && k < m.n; k++) {
        if (!comparable(m, k)) break;
        const backInside = dir > 0 ? data.c[k]! < level : data.c[k]! > level;
        if (!backInside) continue;
        if (claimed.has(k)) break;
        claimed.add(k);
        const mark = trade(ctx, 'failed-bo', dir > 0 ? 'FBO▼' : 'FBO▲', k,
          dir > 0 ? 'short' : 'long', undefined,
          `closed back under ${level.toFixed(2)} ${k - i} bars after breaking it`);
        if (mark) out.push(mark);
        break;
      }
    }
    return out;
  },
};

/** Sessions a flag may span. */
const FLAG_MIN_BARS = 3;
const FLAG_MAX_BARS = 10;
/** The whole flag has to fit inside this many ATRs, or it is a leg not a flag. */
const FLAG_MAX_ATR = 2;
/** Bars the trend must already have run for the flag to be a late one. */
const FLAG_TREND_BARS = 20;
/** Sessions the breakout has to close back inside the flag. */
const FLAG_FAIL_WINDOW = 2;

/**
 * The final flag: a late, tight consolidation whose breakout fails, faded.
 *
 * Brooks names it for what it turns out to be — the LAST flag of the trend —
 * and that is only knowable afterwards. A rule that used it would be reading
 * the future, so this detects the causal half: in a trend that has already run
 * twenty bars, a tight flag breaks out with the trend and closes back inside
 * within two sessions. Whether it turned out to be the final one is something
 * the outcome column answers, not the rule.
 */
export const FINAL_FLAG: Rule = {
  id: 'final-flag',
  group: 'entries',
  label: 'Final flag',
  blurb: `A tight ${FLAG_MIN_BARS}-${FLAG_MAX_BARS} bar flag late in a trend whose breakout closes back inside within ${FLAG_FAIL_WINDOW} sessions. Faded. "Final" is retrospective — the rule only sees a failed late-trend flag.`,
  defaultOn: true,
  detect: (ctx) => {
    const { m, s, data } = ctx;
    const out: Mark[] = [];

    // How long the current always-in state has already run, per bar.
    const age = new Int32Array(m.n);
    for (let i = 1; i < m.n; i++) {
      age[i] = s.trend[i] !== 0 && s.trend[i] === s.trend[i - 1] ? age[i - 1]! + 1 : 0;
    }

    const claimed = new Set<number>();
    for (let start = 1; start < m.n - FLAG_MIN_BARS; start++) {
      const dir = s.trend[start]!;
      if (dir === 0 || age[start]! < FLAG_TREND_BARS) continue;
      const atr = m.atr[start]!;
      if (!Number.isFinite(atr)) continue;

      // Grow the flag while it stays tight.
      let hi = m.high[start]!;
      let lo = m.low[start]!;
      let end = start;
      while (end + 1 < m.n && end - start + 1 < FLAG_MAX_BARS && m.isContractStart[end + 1] === 0) {
        const nextHi = Math.max(hi, m.high[end + 1]!);
        const nextLo = Math.min(lo, m.low[end + 1]!);
        if (nextHi - nextLo > FLAG_MAX_ATR * atr * ctx.tol) break;
        hi = nextHi; lo = nextLo; end++;
      }
      if (end - start + 1 < FLAG_MIN_BARS) continue;

      // A breakout with the trend, then a close back inside within the window.
      for (let k = end + 1; k < m.n && k <= end + 1 + FLAG_FAIL_WINDOW; k++) {
        if (!comparable(m, k)) break;
        const broke = dir > 0 ? data.c[k]! > hi : data.c[k]! < lo;
        if (!broke) break;
        for (let f = k + 1; f < m.n && f <= k + FLAG_FAIL_WINDOW; f++) {
          if (!comparable(m, f)) break;
          const backInside = dir > 0 ? data.c[f]! < hi : data.c[f]! > lo;
          if (!backInside) continue;
          if (claimed.has(f)) break;
          claimed.add(f);
          const mark = trade(ctx, 'final-flag', dir > 0 ? 'FF▼' : 'FF▲', f,
            dir > 0 ? 'short' : 'long', undefined,
            `${end - start + 1}-bar flag ${age[start]} bars into the trend, breakout failed`);
          if (mark) out.push(mark);
          break;
        }
        break;
      }
    }
    return out;
  },
};

export const ENTRY_RULES: readonly Rule[] = [
  PULLBACK_ENTRY, SECOND_ENTRY,
  DOUBLE_TOP_SHORT, DOUBLE_BOTTOM_LONG,
  WEDGE_REVERSAL, BO_PULLBACK, FAILED_BO, FINAL_FLAG,
];
