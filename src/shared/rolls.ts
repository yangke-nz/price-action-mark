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
