/**
 * One line of Brooks-style reading per bar — the tape, in words.
 *
 * The marking layer answers "what patterns are on this chart". This answers a
 * different question, the one a Brooks reader asks walking left to right:
 * *what did this bar say?* Every session gets a line, including the 5,000-odd
 * that carry no mark at all, because "an ordinary bull bar in a trading range"
 * is a reading too and a gap in the list would read as a gap in the market.
 *
 * Four decisions are the whole design.
 *
 * NOTHING HERE RE-DEFINES A PATTERN. The adjectives — trend bar, doji, shaved,
 * big — are tests over the metric columns, and their thresholds are IMPORTED
 * from `rules/bars.ts` rather than restated. The composite patterns (reversal
 * bar, breakout, climax, ii, two-bar reversal) are not re-derived at all: the
 * marks the rules already produced are handed in and named by their rule
 * labels. A second opinion about what a breakout is would drift from the first
 * the day a lookback moved, and the chart would then draw one thing and read
 * another.
 *
 * A MARK ONLY JOINS THE READING IF `knownAt === at`. A double top is not
 * readable on the day of its second peak — it needs bars to its right — and a
 * bar-by-bar reading that names it there is claiming foresight the reader did
 * not have. Patterns needing later confirmation belong to the mark list, which
 * prints their lag. So the pattern clause carries only what the close said.
 *
 * THE CLAUSE THAT WOULD REPEAT A RULE IS DROPPED, NOT THE RULE. `STATED` below
 * names the rules whose meaning an earlier clause already carries: `big-bar`
 * says nothing a leading "big" has not, and a line reading "bull trend bar,
 * shaved top — trend bar, big trend bar, shaved bar" is worse than useless.
 * The rules stay on; only their echo in this one clause goes.
 *
 * PIVOTS ARE THE READING AS OF THE LAST BAR. `Structure.pivots` is not causal
 * — see structure.ts — so "swing high" here means "this is a swing high on the
 * chart as it now stands", and it confirmed `strength` sessions later. `trend`
 * and `pullback` ARE causal and mean what was knowable at that close. The
 * panel and the CLI say so once rather than qualifying 965 lines.
 *
 * Pure, and free of Node, the DOM and Svelte, so the app, the artifact and
 * `npm run marks -- --read` all read the same words.
 */
import type { Mark, RuleId, Tone } from './types.ts';
import type { Ctx, Rule } from './rule.ts';
import { ruleFor } from './registry.ts';
import { BIG_ATR, DOJI_BODY, PIN_TAIL, SHAVED_TAIL, isTrendBar } from './rules/bars.ts';

/**
 * Range in ATRs below which a bar is small enough to say so. Deliberately not
 * the mirror of BIG_ATR: a bar at three-quarters of the average range is
 * ordinary rather than quiet, and only a genuinely inert one earns the word.
 */
const QUIET_ATR = 0.6;
/** Close within this share of one end to be "on its high" / "on its low". */
const CLOSE_EXTREME = 0.9;

/**
 * Rules whose meaning an earlier clause already states, and which are
 * therefore not repeated in the pattern clause.
 *
 * Each one is covered: `trend-bar` and `doji` by the body clause, `big-bar` by
 * the size adjective, `shaved` and `pin-bar` by the extremes clause, `inside`,
 * `outside` and `gap-bar` by the clause about the session before. What is left
 * — reversal bar, ii/ioi, climax, breakout, follow-through, two-bar reversal —
 * is exactly the set of composite patterns this file does not and must not
 * re-derive.
 */
const STATED: ReadonlySet<RuleId> = new Set<RuleId>([
  'trend-bar', 'doji', 'big-bar', 'shaved', 'pin-bar', 'inside', 'outside', 'gap-bar',
]);

export interface BarReading {
  readonly i: number;
  /** The session this line reads. */
  readonly at: string;
  /**
   * For colouring the line. The bar's own direction, except that a doji has
   * none, and a bar whose print cannot be trusted — a suspect close, a
   * contract start — is `caution`, which is what that tone is for.
   */
  readonly tone: Tone;
  /** The bar itself: size, body, extremes, and how it sits against the
   *  session before it. Never empty. */
  readonly bar: string;
  /** Where it sits: always-in state, pullback count, swing pivot. */
  readonly context: string;
  /** Named patterns readable at this close, by their rule labels. */
  readonly patterns: readonly string[];
  /** The three joined — what the CLI prints and what a screen reader is
   *  given. One canonical string, so no consumer can invent a fourth
   *  wording. */
  readonly text: string;
}

/**
 * How a rule names itself inside a sentence.
 *
 * One place, exported, because `--check` has to reverse it to prove that every
 * pattern a reading names is a rule that actually fired on that bar. Two
 * implementations of "what is this pattern called" would let the check pass on
 * a wording the panel never produces.
 */
export function phraseOf(rule: Rule): string {
  return rule.phrase ?? rule.label.charAt(0).toLowerCase() + rule.label.slice(1);
}

/** `1.9x ATR`, or nothing through the ATR warm-up where there is no yardstick. */
function sizeOf(rangeAtr: number): string {
  return Number.isFinite(rangeAtr) ? `${rangeAtr.toFixed(1)}x ATR` : '';
}

/** big / small, or neither. Silent inside the warm-up for the same reason. */
function magnitude(rangeAtr: number): string {
  if (!Number.isFinite(rangeAtr)) return '';
  if (rangeAtr >= BIG_ATR) return 'big ';
  if (rangeAtr <= QUIET_ATR) return 'small ';
  return '';
}

/** The noun: what kind of bar this is. */
function body(ctx: Ctx, i: number): string {
  const { m } = ctx;
  // A doji is a one-bar trading range, so its direction is not worth a word: a
  // two-tick body up says the same thing as a two-tick body down.
  // Reachable, and not only in theory: no daily session in 26 years prints a
  // zero range, but an intraday bar does — the partial bar at the right edge of
  // a 5m chart routinely has one price. "All session" was wrong for a bar that
  // is five minutes long.
  if (m.range[i] === 0) return 'flat bar, a single price';
  if (m.bodyPct[i]! <= DOJI_BODY) return 'doji';
  const dir = m.dir[i]!;
  const way = dir > 0 ? 'bull' : dir < 0 ? 'bear' : 'flat';
  return isTrendBar(m.bodyPct[i]!) ? `${way} trend bar` : `${way} bar`;
}

/**
 * The ends of the bar: a missing tail, an oversized one, and where it closed.
 *
 * The close clause is suppressed at an end already described as shaved.
 * "Shaved top, closing on its high" is one fact told twice, and the line has
 * to stay a line.
 */
function extremes(ctx: Ctx, i: number): string[] {
  const { m } = ctx;
  if (m.range[i] === 0) return [];
  const out: string[] = [];
  const flatTop = m.upperTailPct[i]! <= SHAVED_TAIL;
  const flatBottom = m.lowerTailPct[i]! <= SHAVED_TAIL;

  if (flatTop && flatBottom) out.push('shaved both ends');
  else if (flatTop) out.push('shaved top');
  else if (flatBottom) out.push('shaved bottom');

  if (m.upperTailPct[i]! >= PIN_TAIL) out.push('long upper tail');
  else if (m.lowerTailPct[i]! >= PIN_TAIL) out.push('long lower tail');

  const pos = m.closePos[i]!;
  if (pos >= CLOSE_EXTREME && !flatTop) out.push('closing on its high');
  else if (pos <= 1 - CLOSE_EXTREME && !flatBottom) out.push('closing on its low');

  return out;
}

/**
 * How the bar sits against the session before it.
 *
 * A contract start comes first and is phrased as a warning, because every
 * comparison below it is meaningless across one — which is why `metrics()` has
 * already zeroed `gap` there.
 */
function against(ctx: Ctx, i: number): string[] {
  const { m } = ctx;
  const out: string[] = [];
  if (m.suspect[i] === 1) out.push('suspect print: the close sits outside the printed range');
  if (m.isContractStart[i] === 1) {
    out.push('first session of a new contract, so the change into it is carry');
    return out;
  }
  if (m.isRoll[i] === 1) out.push('quarterly expiry');
  if (i === 0) return out;
  const hi = m.high[i]!;
  const lo = m.low[i]!;
  // "the bar before", not "the session before": on an intraday series the
  // previous bar is five minutes ago, and on a daily one the previous bar IS
  // the previous session, so bar-relative wording is right for both.
  if (hi <= m.high[i - 1]! && lo >= m.low[i - 1]!) out.push('inside the bar before');
  else if (hi > m.high[i - 1]! && lo < m.low[i - 1]!) out.push('outside bar, engulfing it');
  if (m.gap[i] === 1) out.push('gapped up clear of the previous range');
  else if (m.gap[i] === -1) out.push('gapped down clear of the previous range');
  return out;
}

/** Always-in state, pullback count, swing pivot — the two causal ones first,
 *  then the one that is a reading of the finished chart. */
function contextOf(ctx: Ctx, i: number, pivot?: 'high' | 'low'): string {
  const { s } = ctx;
  const out: string[] = [];
  const trend = s.trend[i]!;
  out.push(trend === 1 ? 'always-in long' : trend === -1 ? 'always-in short' : 'trading range');
  const pb = s.pullback[i]!;
  if (pb !== 0) out.push(`${pb > 0 ? 'H' : 'L'}${Math.abs(pb)}`);
  if (pivot) out.push(`swing ${pivot}`);
  return out.join(', ');
}

function toneOf(ctx: Ctx, i: number): Tone {
  const { m } = ctx;
  if (m.suspect[i] === 1 || m.isContractStart[i] === 1) return 'caution';
  if (m.range[i] === 0 || m.bodyPct[i]! <= DOJI_BODY) return 'neutral';
  const dir = m.dir[i]!;
  return dir > 0 ? 'bull' : dir < 0 ? 'bear' : 'neutral';
}

/**
 * The two lookups a reading needs, built once per dataset.
 *
 * Hoisted out of `readings` because the readout asks for ONE bar's reading on
 * every crosshair move. Rebuilding a map over all 8,400 marks per pointer
 * event is 8,400 inserts to answer a question about one session; built once,
 * `readAt` is a pair of map lookups.
 */
export interface ReadingIndex {
  /** Marks anchored at a session AND knowable at its close, by date. */
  readonly known: ReadonlyMap<string, Mark[]>;
  /** Swing pivots, by bar index, as the chart now stands. */
  readonly pivotAt: ReadonlyMap<number, 'high' | 'low'>;
}

export function readingIndex(ctx: Ctx, marks: readonly Mark[]): ReadingIndex {
  const known = new Map<string, Mark[]>();
  for (const mark of marks) {
    // See the header: only what was readable at the close joins the reading.
    if (mark.knownAt !== mark.at) continue;
    const list = known.get(mark.at);
    if (list) list.push(mark);
    else known.set(mark.at, [mark]);
  }
  const pivotAt = new Map<number, 'high' | 'low'>();
  for (const p of ctx.s.pivots) pivotAt.set(p.i, p.kind);
  return { known, pivotAt };
}

/** One bar's reading, against a prepared index. */
export function readAt(ctx: Ctx, index: ReadingIndex, i: number): BarReading {
  return readBar(ctx, i, index.known.get(ctx.data.d[i]!) ?? [], index.pivotAt.get(i));
}

/**
 * Read one bar.
 *
 * NOT exported: `readAt` is the single-bar entry point and `readings` the bulk
 * one, and both go through a prepared `ReadingIndex`. A third door that takes
 * the lookups by hand is a door someone eventually walks through with the
 * wrong ones — the pivot map in particular is a reading of the whole chart,
 * not something a caller should assemble per call.
 */
function readBar(
  ctx: Ctx,
  i: number,
  known: readonly Mark[] = [],
  pivot?: 'high' | 'low',
): BarReading {
  const { m } = ctx;
  // A bar with no range is neither big nor small, and its size is already in
  // the noun: "small flat bar, a single price, 0.0x ATR" says one thing three
  // times.
  const flat = m.range[i] === 0;
  const size = flat ? '' : sizeOf(m.rangeAtr[i]!);
  const bar = [
    `${flat ? '' : magnitude(m.rangeAtr[i]!)}${body(ctx, i)}`,
    ...extremes(ctx, i),
    ...(size === '' ? [] : [size]),
    ...against(ctx, i),
  ].join(', ');

  const patterns: string[] = [];
  for (const mark of known) {
    if (STATED.has(mark.rule)) continue;
    // The rule's own wording — one name per pattern, kept where the rule is.
    const rule = ruleFor(mark.rule);
    const phrase = rule ? phraseOf(rule) : mark.rule;
    if (!patterns.includes(phrase)) patterns.push(phrase);
  }

  const context = contextOf(ctx, i, pivot);
  const text = [bar, context, patterns.join(', ')].filter((part) => part !== '').join(' — ');

  return { i, at: ctx.data.d[i]!, tone: toneOf(ctx, i), bar, context, patterns, text };
}

/**
 * Read an inclusive span of bars, oldest first.
 *
 * `marks` is the UNFILTERED detection output. Filtering it by the reader's
 * rule toggles or verdicts would make the reading of a bar depend on what the
 * reader had chosen to draw, and a bar says what it says either way.
 */
export function readings(
  ctx: Ctx,
  marks: readonly Mark[],
  from: number,
  to: number,
): BarReading[] {
  const lo = Math.max(0, from);
  const hi = Math.min(ctx.m.n - 1, to);
  const index = readingIndex(ctx, marks);
  const out: BarReading[] = [];
  for (let i = lo; i <= hi; i++) out.push(readAt(ctx, index, i));
  return out;
}
