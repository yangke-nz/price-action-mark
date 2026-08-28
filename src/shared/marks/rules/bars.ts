/**
 * The special bars, as Brooks reads them: fifteen tests over the metric
 * columns, each a handful of lines, none needing market structure.
 *
 * Every threshold is a named constant at the top. They are judgement calls
 * dressed as numbers, and burying them inside the predicates would make them
 * impossible to tune against `npm run marks`.
 *
 * DENSITY IS THE REAL DIFFICULTY HERE. `trend-bar` fires on roughly a third of
 * all sessions and `doji` on another fifth; a chart wearing every label is
 * strictly less readable than one wearing none. So the high-frequency rules
 * ship `defaultOn: false`, and the ones that stay on are the ones that mark
 * something a reader would stop at.
 */
import type { Mark } from '../types.ts';
import type { Ctx, Rule } from '../rule.ts';
import { barMark, comparable, usable } from '../rule.ts';

/** Body at or above this share of the range is a trend bar. */
export const TREND_BODY = 0.6;
/** Body at or below this is a doji — a one-bar trading range. */
export const DOJI_BODY = 0.25;
/** Range in ATRs that makes a trend bar "big". */
export const BIG_ATR = 1.5;
/** Range in ATRs that makes a bar at the end of a run climactic. */
const CLIMAX_ATR = 2;
/** Same-direction bars needed before a large one reads as exhaustion. */
const CLIMAX_RUN = 3;
/** A tail at or below this share of the range is shaved. */
export const SHAVED_TAIL = 0.05;
/** One tail this large, with a small body, is a pin. */
export const PIN_TAIL = 0.6;
/** ...on a bar at least this many ATRs wide. A tail on a quiet session is not
 *  a rejection, and without this the rule fires on one bar in seven. */
const PIN_MIN_ATR = 1;
/** Close inside this share of the range, at the right end, for a reversal. */
const REVERSAL_CLOSE = 2 / 3;
/** ...and the bar must be reversing something: its extreme has to be the
 *  lowest low (or highest high) of this many sessions. Without a context test
 *  the pattern fires on any strong close that dipped first, one session in
 *  six, and stops meaning "a turn". Deliberately a lookback rather than a
 *  swing pivot: a pivot is not confirmable for another three bars, and this
 *  rule promises to be readable at the close. */
const REVERSAL_LOOKBACK = 10;
/** Sessions a breakout has to clear. */
export const BREAKOUT_LOOKBACK = 20;
/** ...on a bar at least this wide. In a trending market the 20-session high
 *  is taken out constantly by bars nobody noticed. */
const BREAKOUT_MIN_ATR = 1;
/** The smaller of two bodies over the larger, for a two-bar reversal. */
const TWO_BAR_MATCH = 0.6;

const isInside = (m: { high: Float64Array; low: Float64Array }, i: number): boolean =>
  i > 0 && m.high[i]! <= m.high[i - 1]! && m.low[i]! >= m.low[i - 1]!;

const isOutside = (m: { high: Float64Array; low: Float64Array }, i: number): boolean =>
  i > 0 && m.high[i]! > m.high[i - 1]! && m.low[i]! < m.low[i - 1]!;

export const isTrendBar = (bodyPct: number): boolean => bodyPct >= TREND_BODY;

/** Is this bar's low the lowest, or its high the highest, of the lookback? */
function isExtreme(
  m: { high: Float64Array; low: Float64Array },
  i: number,
  which: 'high' | 'low',
): boolean {
  const start = Math.max(0, i - REVERSAL_LOOKBACK);
  for (let k = start; k < i; k++) {
    if (which === 'low' ? m.low[k]! <= m.low[i]! : m.high[k]! >= m.high[i]!) return false;
  }
  return true;
}

export const BAR_RULES: readonly Rule[] = [
  {
    id: 'trend-bar',
    group: 'bars',
    label: 'Trend bar',
    blurb: `Body at least ${Math.round(TREND_BODY * 100)}% of the range. Fires on about a third of all sessions, so it ships off.`,
    defaultOn: false,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 0; i < m.n; i++) {
        if (!usable(m, i) || !isTrendBar(m.bodyPct[i]!)) continue;
        const bull = m.dir[i]! > 0;
        out.push(barMark('trend-bar', ctx, i, {
          label: bull ? '▲' : '▼',
          tone: bull ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
  {
    id: 'big-bar',
    group: 'bars',
    label: 'Big trend bar',
    blurb: `A trend bar whose range is at least ${BIG_ATR} x ATR.`,
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 0; i < m.n; i++) {
        if (!usable(m, i) || !isTrendBar(m.bodyPct[i]!)) continue;
        if (!(m.rangeAtr[i]! >= BIG_ATR * ctx.tol)) continue;
        out.push(barMark('big-bar', ctx, i, {
          label: 'BIG',
          tone: m.dir[i]! > 0 ? 'bull' : 'bear',
          note: `${m.rangeAtr[i]!.toFixed(1)} x ATR`,
        }));
      }
      return out;
    },
  },
  {
    id: 'doji',
    group: 'bars',
    label: 'Doji',
    blurb: `Body at most ${Math.round(DOJI_BODY * 100)}% of the range — a one-bar trading range. Common enough to ship off.`,
    defaultOn: false,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 0; i < m.n; i++) {
        if (!usable(m, i) || m.range[i]! === 0 || m.bodyPct[i]! > DOJI_BODY) continue;
        out.push(barMark('doji', ctx, i, { label: '·', tone: 'neutral' }));
      }
      return out;
    },
  },
  {
    id: 'inside',
    group: 'bars',
    label: 'Inside bar',
    blurb: 'High no higher and low no lower than the session before. One session in eight, so it ships off.',
    defaultOn: false,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        // Skipped at a contract start: "inside the previous bar" means nothing
        // when the previous bar is a different contract.
        if (!comparable(m, i) || !isInside(m, i)) continue;
        // The last bar of an ii or iii run is labelled by that rule instead.
        if (isInside(m, i - 1)) continue;
        out.push(barMark('inside', ctx, i, { label: 'ib', tone: 'neutral' }));
      }
      return out;
    },
  },
  {
    id: 'outside',
    group: 'bars',
    label: 'Outside bar',
    blurb: 'Higher high and lower low than the session before. One session in eight, so it ships off.',
    defaultOn: false,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        if (!comparable(m, i) || !isOutside(m, i)) continue;
        out.push(barMark('outside', ctx, i, { label: 'ob', tone: 'neutral' }));
      }
      return out;
    },
  },
  {
    id: 'ii',
    group: 'bars',
    label: 'ii / iii',
    blurb: 'Two, or three, consecutive inside bars. Breakout mode.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 2; i < m.n; i++) {
        if (!comparable(m, i) || !comparable(m, i - 1)) continue;
        if (!isInside(m, i) || !isInside(m, i - 1)) continue;
        // Emit on the last bar of the run, and only once per run.
        if (isInside(m, i + 1)) continue;
        const three = i >= 3 && comparable(m, i - 2) && isInside(m, i - 2);
        out.push(barMark('ii', ctx, i, { label: three ? 'iii' : 'ii', tone: 'neutral' }));
      }
      return out;
    },
  },
  {
    id: 'ioi',
    group: 'bars',
    label: 'ioi',
    blurb: 'Inside, outside, inside — a coiled breakout setup.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 2; i < m.n; i++) {
        if (!comparable(m, i) || !comparable(m, i - 1) || !comparable(m, i - 2)) continue;
        if (isInside(m, i) && isOutside(m, i - 1) && isInside(m, i - 2)) {
          out.push(barMark('ioi', ctx, i, { label: 'ioi', tone: 'neutral' }));
        }
      }
      return out;
    },
  },
  {
    id: 'reversal-bar',
    group: 'bars',
    label: 'Reversal bar',
    blurb: 'Takes out the previous extreme, then closes back through it in the top or bottom third.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        if (!comparable(m, i) || m.range[i]! === 0) continue;
        // A doji that happens to dip below the prior low is not a reversal,
        // and neither is one that closes short of the previous session's
        // close — the point of the pattern is that the sellers who pushed it
        // to a new low ended the day underwater.
        if (m.bodyPct[i]! <= DOJI_BODY) continue;
        const c = ctx.data.c[i]!;
        const cPrev = ctx.data.c[i - 1]!;
        const bull = m.low[i]! < m.low[i - 1]! && m.dir[i]! > 0
          && m.closePos[i]! >= REVERSAL_CLOSE && c > cPrev
          && isExtreme(m, i, 'low');
        const bear = m.high[i]! > m.high[i - 1]! && m.dir[i]! < 0
          && m.closePos[i]! <= 1 - REVERSAL_CLOSE && c < cPrev
          && isExtreme(m, i, 'high');
        if (!bull && !bear) continue;
        out.push(barMark('reversal-bar', ctx, i, {
          label: bull ? 'R▲' : 'R▼',
          tone: bull ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
  {
    id: 'shaved',
    group: 'bars',
    label: 'Shaved bar',
    blurb: 'A trend bar with almost no tail at one end — no pullback inside the session.',
    defaultOn: false,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 0; i < m.n; i++) {
        // A doji with no tail says nothing; only a trend bar's missing tail does.
        if (!usable(m, i) || m.range[i]! === 0 || !isTrendBar(m.bodyPct[i]!)) continue;
        const top = m.upperTailPct[i]! <= SHAVED_TAIL;
        const bottom = m.lowerTailPct[i]! <= SHAVED_TAIL;
        if (!top && !bottom) continue;
        out.push(barMark('shaved', ctx, i, {
          label: top && bottom ? '▮' : top ? '▔' : '▁',
          tone: m.dir[i]! > 0 ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
  {
    id: 'pin-bar',
    group: 'bars',
    label: 'Pin bar',
    blurb: `One tail at least ${Math.round(PIN_TAIL * 100)}% of the range with a small body. Direction is the tail's opposite.`,
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 0; i < m.n; i++) {
        if (!usable(m, i) || m.range[i]! === 0 || m.bodyPct[i]! > DOJI_BODY) continue;
        // A long tail on a bar smaller than the average session is not a
        // rejection of anything; it is a quiet day.
        if (!(m.rangeAtr[i]! >= PIN_MIN_ATR * ctx.tol)) continue;
        const upper = m.upperTailPct[i]! >= PIN_TAIL;
        const lower = m.lowerTailPct[i]! >= PIN_TAIL;
        if (upper === lower) continue;         // neither, or a symmetric doji
        out.push(barMark('pin-bar', ctx, i, {
          label: 'pin',
          // A long tail is rejected price: an upper tail is a bearish pin.
          tone: lower ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
  {
    id: 'climax',
    group: 'bars',
    label: 'Climax',
    blurb: `A bar of at least ${CLIMAX_ATR} x ATR ending a run of ${CLIMAX_RUN} or more in one direction.`,
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = CLIMAX_RUN - 1; i < m.n; i++) {
        if (!usable(m, i) || !(m.rangeAtr[i]! >= CLIMAX_ATR * ctx.tol)) continue;
        const dir = m.dir[i]!;
        if (dir === 0) continue;
        let run = 1;
        // A contract start breaks the run: the bars either side of it are not
        // the same instrument, so they are not one push.
        for (let k = i - 1; k >= 0 && m.dir[k] === dir && m.isContractStart[k + 1] === 0; k--) run++;
        if (run < CLIMAX_RUN) continue;
        out.push(barMark('climax', ctx, i, {
          label: 'CLX',
          tone: dir > 0 ? 'bear' : 'bull',   // exhaustion reads against the run
          note: `${run} bars, ${m.rangeAtr[i]!.toFixed(1)} x ATR`,
        }));
      }
      return out;
    },
  },
  {
    id: 'gap-bar',
    group: 'bars',
    label: 'Gap',
    blurb: 'Opens clear of the previous session’s range. Contract rolls are excluded — that gap is carry.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        // `gap` is already zeroed at contract starts by metrics().
        if (!usable(m, i) || m.gap[i] === 0) continue;
        out.push(barMark('gap-bar', ctx, i, {
          label: 'gap',
          tone: m.gap[i]! > 0 ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },  {
    id: 'breakout',
    group: 'bars',
    label: 'Breakout',
    blurb: `A trend bar closing beyond the previous ${BREAKOUT_LOOKBACK} sessions' extreme.`,
    defaultOn: true,
    detect: (ctx) =>
      breakoutIndices(ctx).map(({ i, dir }) =>
        barMark('breakout', ctx, i, {
          label: 'BO',
          tone: dir > 0 ? 'bull' : 'bear',
          note: `clears the ${BREAKOUT_LOOKBACK}-session ${dir > 0 ? 'high' : 'low'}`,
        }),
      ),
  },
  {
    id: 'follow-through',
    group: 'bars',
    label: 'Follow-through',
    blurb: 'A second trend bar the same way, straight after a breakout. Its absence is the more useful signal.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const breakouts = new Map<number, number>();
      for (const mark of breakoutIndices(ctx)) breakouts.set(mark.i, mark.dir);
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        const dir = breakouts.get(i - 1);
        if (dir === undefined) continue;
        if (!comparable(m, i) || !isTrendBar(m.bodyPct[i]!) || m.dir[i] !== dir) continue;
        out.push(barMark('follow-through', ctx, i, {
          label: 'FT',
          tone: dir > 0 ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
  {
    id: 'two-bar-reversal',
    group: 'bars',
    label: 'Two-bar reversal',
    blurb: 'Opposed trend bars of comparable size, the second undoing the first.',
    defaultOn: true,
    detect: (ctx) => {
      const { m } = ctx;
      const out: Mark[] = [];
      for (let i = 1; i < m.n; i++) {
        if (!comparable(m, i) || !usable(m, i - 1)) continue;
        if (!isTrendBar(m.bodyPct[i]!) || !isTrendBar(m.bodyPct[i - 1]!)) continue;
        const dir = m.dir[i]!;
        if (dir === 0 || m.dir[i - 1] !== -dir) continue;
        const a = m.body[i]!;
        const b = m.body[i - 1]!;
        const larger = a > b ? a : b;
        if (larger === 0 || (a < b ? a : b) / larger < TWO_BAR_MATCH) continue;
        out.push(barMark('two-bar-reversal', ctx, i, {
          label: '2BR',
          tone: dir > 0 ? 'bull' : 'bear',
        }));
      }
      return out;
    },
  },
];

/**
 * Breakout bars as plain indices — the single definition, used by both the
 * `breakout` rule and `follow-through`, which is defined in terms of it.
 *
 * The alternative, re-running the rule and parsing its dates back into
 * indices, would couple the two through their output format rather than their
 * logic, and leave two places to edit when the lookback changes.
 *
 * The window deliberately excludes bar `i`: a bar cannot break out of itself.
 */
export function breakoutIndices(ctx: Ctx): { i: number; dir: number }[] {
  const { m } = ctx;
  const out: { i: number; dir: number }[] = [];
  for (let i = BREAKOUT_LOOKBACK; i < m.n; i++) {
    if (!comparable(m, i) || !isTrendBar(m.bodyPct[i]!)) continue;
    if (!(m.rangeAtr[i]! >= BREAKOUT_MIN_ATR * ctx.tol)) continue;
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let k = i - BREAKOUT_LOOKBACK; k < i; k++) {
      if (m.high[k]! > hi) hi = m.high[k]!;
      if (m.low[k]! < lo) lo = m.low[k]!;
    }
    const close = ctx.data.c[i]!;
    if (close > hi) out.push({ i, dir: 1 });
    else if (close < lo) out.push({ i, dir: -1 });
  }
  return out;
}
