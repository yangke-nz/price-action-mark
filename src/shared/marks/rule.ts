/**
 * What a rule is given and what it returns.
 *
 * Every rule is a pure function of one `Ctx`, which is built once per dataset
 * and shared by all of them — 30 rules each recomputing metrics and structure
 * over 6,550 bars would be 30x the work for identical numbers.
 *
 * The two guards below are the part worth reading. Bar rules must decline
 * sessions where the arithmetic is meaningless, and there are two separate
 * reasons a session can be:
 *
 *  - `suspect`: the feed printed a close outside its own high/low, so the
 *    close-relative tests (`reversal-bar`, `shaved`, `pin-bar`) would fire on
 *    a settlement price rather than a traded one. Ten sessions in 6,550.
 *  - `isContractStart`: the previous bar belongs to a DIFFERENT CONTRACT, so
 *    anything comparing against it measures carry. `inside`, `outside`, `gap`
 *    and `breakout` all do. The bar's own geometry is fine, which is why this
 *    is a separate guard rather than the same one.
 */
import type { Dataset } from '../types.ts';
import type { BarMark, Mark, MarkGroup, RuleId, Tone } from './types.ts';
import { markId } from './types.ts';
import { metrics, type Metrics } from './metrics.ts';
import { structure, type Structure, type StructureOptions } from './structure.ts';
import { tickFor } from '../instrument.ts';

export interface Ctx {
  readonly data: Dataset;
  readonly m: Metrics;
  readonly s: Structure;
  /** Minimum price increment for this symbol. */
  readonly tick: number;
  /** Multiplier applied to every ATR tolerance. Above 1 is looser. */
  readonly tol: number;
}

export interface Rule {
  readonly id: RuleId;
  readonly group: MarkGroup;
  /** Shown in the mark panel and the menu. */
  readonly label: string;
  /** One sentence, shown beside the toggle. */
  readonly blurb: string;
  /**
   * The label as it reads INSIDE a sentence, for the bar reading.
   *
   * Only for the labels whose panel form is not a phrase: "Pullback entry
   * (H1-H4 / L1-L4)" names a toggle honestly and reads as a definition
   * mid-sentence. Everything else defaults to the label lower-cased, which is
   * right for 29 of the 31 — so this stays absent rather than restating them.
   */
  readonly phrase?: string;
  /**
   * Rules that fire on a large fraction of sessions ship off. `trend-bar`
   * alone hits about a third of them, and a chart wearing 2,000 labels is
   * less readable than one wearing none.
   */
  readonly defaultOn: boolean;
  /**
   * Rules the panel folds away until the reader asks for them.
   *
   * Absent means core, so a rule opts IN to being quiet and the other
   * twenty-five need no line. This is a USAGE decision, NOT the density one
   * `defaultOn` makes, and the two lists are not the same: `climax` fires once
   * a year and is worth a glance, `shaved` fires 38 times and may never be
   * switched on. Presentation only — nothing in the marking layer reads it, so
   * detection, the counts, the CLI report and `marks:check` are unaffected.
   */
  readonly tier?: 'extra';
  detect(ctx: Ctx): Mark[];
}

export interface CtxOptions extends StructureOptions {
  /** Above 1 loosens every ATR tolerance in every rule. */
  tol?: number;
}

export function buildCtx(data: Dataset, opts: CtxOptions = {}): Ctx {
  const m = metrics(data);
  const { tol = 1, ...structOpts } = opts;
  return { data, m, s: structure(m, structOpts), tick: tickFor(data.symbol), tol };
}

/** The bar's own geometry can be trusted. */
export function usable(m: Metrics, i: number): boolean {
  return m.suspect[i] === 0;
}

/** ...and so can its comparison against the session before it. */
export function comparable(m: Metrics, i: number): boolean {
  return i > 0 && m.suspect[i] === 0 && m.suspect[i - 1] === 0 && m.isContractStart[i] === 0;
}

export interface BarMarkSpec {
  readonly label: string;
  readonly tone: Tone;
  readonly note?: string;
}

/**
 * A bar mark, with `at` and `knownAt` equal.
 *
 * That is not laziness: a single-bar pattern IS knowable at its own close,
 * unlike a swing high, which needs bars to its right. The field exists so a
 * consumer never has to know which kind it is holding.
 */
export function barMark(rule: RuleId, ctx: Ctx, i: number, spec: BarMarkSpec): BarMark {
  const at = ctx.data.d[i]!;
  return {
    id: markId(rule, at),
    rule,
    group: 'bars',
    label: spec.label,
    ...(spec.note === undefined ? {} : { note: spec.note }),
    tone: spec.tone,
    at,
    knownAt: at,
    source: 'rule',
    kind: 'bar',
    // A bullish mark sits under the bar and a bearish one over it, so the
    // label never covers the extreme the reader is looking at.
    placement: spec.tone === 'bull' ? 'below' : 'above',
  };
}
