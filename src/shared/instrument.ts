/**
 * Per-instrument facts the marking rules need and the dataset does not carry.
 *
 * Deliberately a lookup here rather than a `tick` field on `Dataset`: adding
 * one would invalidate every cached dataset and the committed snapshot, and
 * `isDataset()` would have to keep accepting the old shape anyway. A table is
 * one file and no migration.
 */

/** Minimum price increment. Entry and stop are defined one tick beyond a
 *  signal bar, so this has to be the real number, not a rounding guess. */
const TICKS: Readonly<Record<string, number>> = {
  'ES=F': 0.25,   // E-mini S&P 500
  'MES=F': 0.25,  // Micro E-mini S&P 500
  'NQ=F': 0.25,   // E-mini Nasdaq 100
  'YM=F': 1,      // E-mini Dow
  'RTY=F': 0.1,   // E-mini Russell 2000
};

export const DEFAULT_TICK = 0.25;

/** Dated contracts share their root's tick: `ESZ26.CME` is an `ES` tick. */
export function tickFor(symbol: string): number {
  const exact = TICKS[symbol];
  if (exact !== undefined) return exact;
  const root = /^([A-Z]{2,3})[FGHJKMNQUVXZ]\d{1,2}\b/.exec(symbol)?.[1];
  return (root === undefined ? undefined : TICKS[`${root}=F`]) ?? DEFAULT_TICK;
}
