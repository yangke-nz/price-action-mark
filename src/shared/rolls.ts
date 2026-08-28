/** Quarterly ES contracts expire on the third Friday of Mar/Jun/Sep/Dec. */
export function thirdFriday(year: number, month1to12: number): string {
  const first = Date.UTC(year, month1to12 - 1, 1);
  const dow = new Date(first).getUTCDay();          // 0 Sun .. 6 Sat
  const firstFriday = 1 + ((5 - dow + 7) % 7);      // 5 = Friday
  return isoDay(Date.UTC(year, month1to12 - 1, firstFriday + 14));
}

export function isoDay(msUtc: number): string {
  return new Date(msUtc).toISOString().slice(0, 10);
}

/**
 * Indices of the first session on/after each quarterly expiry — the bars where
 * the stitched front-month series changes contract. The price gap across one of
 * these is carry, not a move anybody could have traded.
 */
export function rollIndices(days: string[]): number[] {
  if (days.length === 0) return [];
  const indexOf = new Map(days.map((d, i) => [d, i]));
  const firstYear = Number(days[0]!.slice(0, 4));
  const lastYear = Number(days[days.length - 1]!.slice(0, 4));

  const out: number[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const month of [3, 6, 9, 12]) {
      const expiry = Date.parse(thirdFriday(year, month) + 'T00:00:00Z');
      // Step forward over weekends and holidays to the next session that exists.
      for (let offset = 0; offset < 6; offset++) {
        const hit = indexOf.get(isoDay(expiry + offset * 86_400_000));
        if (hit !== undefined) { out.push(hit); break; }
      }
    }
  }
  return out;
}

/**
 * Indices of the first session of each NEW contract — the bars whose
 * comparison against the previous session crosses a contract change.
 *
 * Deliberately not the same set as `rollIndices()`, and the difference is a
 * whole bar. A roll index is the first session on or after the expiry, which
 * on 101 of these 104 quarters IS the expiry itself: the expiring contract's
 * last session, settling that afternoon. Its change against the day before is
 * an ordinary same-contract move. The discontinuity is one boundary later —
 * 2024-12-20 settles at 5840.26 and 2024-12-23 opens at 6001.75, and that
 * +2.77% is the carry.
 *
 * On the three quarters where the third Friday was a holiday (Good Friday
 * 2008-03-21, Juneteenth 2026-06-19, and the truncated start of the series)
 * the roll index has already stepped past the expiry and is itself the new
 * contract's first session.
 *
 * Measured over the shipped series: of the 37 boundary jumps above 1%, 34 fall
 * on the bar after the roll index and all 3 that fall on it are exactly those
 * holiday quarters.
 */
export function contractStarts(days: readonly string[], rolls: readonly number[]): number[] {
  const out: number[] = [];
  for (const i of rolls) {
    const day = days[i];
    if (day === undefined) continue;
    const settledThatDay = day === thirdFriday(Number(day.slice(0, 4)), Number(day.slice(5, 7)));
    const start = settledThatDay ? i + 1 : i;
    if (start < days.length) out.push(start);
  }
  return out;
}
