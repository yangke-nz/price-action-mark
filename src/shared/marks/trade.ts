/**
 * Turning a signal bar into a trade, and then finding out what happened.
 *
 * Brooks defines the entry mechanically — a stop order one tick beyond the
 * signal bar, protective stop one tick beyond its other end — so the prices
 * are not a judgement call. What the outcome walk does with daily bars is,
 * and three decisions here are the difference between a useful review tool and
 * a flattering one.
 *
 * THE ORDER IS LIVE FOR ONE BAR. A buy stop above yesterday's high is an order
 * for today. If today never reaches it the setup is stale and there is no
 * trade — leaving it working for a week turns every failed setup into a
 * different, later trade that nobody took.
 *
 * A BAR THAT SPANS BOTH STOP AND TARGET IS SCORED AS A LOSS. Daily OHLC cannot
 * say which came first, and the alternative — assuming the good one — is how a
 * backtest talks itself into an edge. `ambiguous` counts them so the number is
 * auditable rather than buried.
 *
 * FILLS TAKE THE GAP. If the bar opens already through the entry, the fill is
 * the open, not the entry price, and R is measured from what was actually
 * paid. Assuming the limit price on a gap is free money.
 */
import type { Ctx } from './rule.ts';

export interface TradePlan {
  readonly dir: 'long' | 'short';
  /** The stop-order price: one tick beyond the signal bar. */
  readonly entry: number;
  /** One tick beyond the signal bar's other end. */
  readonly stop: number;
  readonly target: number;
  /** Planned risk per unit, entry to stop. */
  readonly risk: number;
}

export type Outcome = 'target' | 'stop' | 'open' | 'no fill';

export interface TradeResult {
  readonly outcome: Outcome;
  /** Price actually paid, gap included. Null when it never filled. */
  readonly fill: number | null;
  /** Bar the trade resolved on, or the last bar for one still open. */
  readonly at: number;
  readonly bars: number;
  /** Realised multiple of the risk actually taken. */
  readonly r: number;
  /** The resolving bar contained both stop and target; scored as the stop. */
  readonly ambiguous: boolean;
}

/** Default target when the pattern does not imply a measured move. */
export const DEFAULT_TARGET_R = 2;
/** Sessions the entry order stays live. One: it is an order for the next bar. */
export const FILL_WINDOW = 1;

/**
 * The plan implied by a signal bar. `target` overrides the default 2R where a
 * pattern gives a measured move — a double bottom projects its own height.
 */
export function planFor(
  ctx: Ctx,
  signal: number,
  dir: 'long' | 'short',
  target?: number,
): TradePlan | null {
  const { m, tick } = ctx;
  const high = m.high[signal];
  const low = m.low[signal];
  if (high === undefined || low === undefined) return null;

  const entry = dir === 'long' ? high + tick : low - tick;
  const stop = dir === 'long' ? low - tick : high + tick;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  const fallback = dir === 'long'
    ? entry + DEFAULT_TARGET_R * risk
    : entry - DEFAULT_TARGET_R * risk;
  return { dir, entry, stop, target: target ?? fallback, risk };
}

/**
 * Walk forward from the signal bar and report what the trade did.
 *
 * Lookahead by construction — that is the point of a review — so nothing that
 * decides whether a mark EXISTS may read this. It answers "was that setup any
 * good", which is a question only the past can answer.
 */
export function walkForward(ctx: Ctx, plan: TradePlan, signal: number): TradeResult {
  const { m, data } = ctx;
  const n = m.n;
  const long = plan.dir === 'long';

  let fill: number | null = null;
  let start = signal;
  for (let i = signal + 1; i <= signal + FILL_WINDOW && i < n; i++) {
    const touched = long ? m.high[i]! >= plan.entry : m.low[i]! <= plan.entry;
    if (!touched) continue;
    const open = data.o[i]!;
    // A bar that opened through the order filled at the open, not the limit.
    fill = long ? Math.max(open, plan.entry) : Math.min(open, plan.entry);
    start = i;
    break;
  }
  if (fill === null) {
    return { outcome: 'no fill', fill: null, at: Math.min(signal + FILL_WINDOW, n - 1), bars: 0, r: 0, ambiguous: false };
  }

  const risk = Math.abs(fill - plan.stop);
  const rOf = (price: number): number =>
    risk === 0 ? 0 : ((long ? price - fill! : fill! - price) / risk);

  for (let i = start; i < n; i++) {
    // A contract change is not a price the trade could have been filled at.
    if (i > start && m.isContractStart[i] === 1) {
      return { outcome: 'open', fill, at: i - 1, bars: i - 1 - start, r: rOf(data.c[i - 1]!), ambiguous: false };
    }
    const hitStop = long ? m.low[i]! <= plan.stop : m.high[i]! >= plan.stop;
    const hitTarget = long ? m.high[i]! >= plan.target : m.low[i]! <= plan.target;
    if (hitStop) {
      return { outcome: 'stop', fill, at: i, bars: i - start, r: rOf(plan.stop), ambiguous: hitTarget };
    }
    if (hitTarget) {
      return { outcome: 'target', fill, at: i, bars: i - start, r: rOf(plan.target), ambiguous: false };
    }
  }
  return { outcome: 'open', fill, at: n - 1, bars: n - 1 - start, r: rOf(data.c[n - 1]!), ambiguous: false };
}
