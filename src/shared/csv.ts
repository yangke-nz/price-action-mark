import type { Dataset } from './types.ts';
import { contractStarts } from './rolls.ts';
import { specOf } from './interval.ts';
import type { Row } from './yahoo.ts';

const HEADER = 'date,open,high,low,close,volume';
/** An intraday row's first column is an ISO instant, not a date, and a
 *  spreadsheet that reads `date` will parse it as one and drop the time. */
const HEADER_INTRADAY = 'time,open,high,low,close,volume';

/** The standalone CSV. `intraday` picks the header, because the row's first
 *  field is an ISO instant there rather than a date. */
export function rowsToCsv(rows: Row[], intraday = false): string {
  const out = [intraday ? HEADER_INTRADAY : HEADER];
  for (const r of rows) {
    out.push(`${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
  }
  return out.join('\n') + '\n';
}

/** The desktop export adds a `roll` flag, because the one thing a spreadsheet
 *  cannot recover from this file is which returns cross a contract change.
 *
 *  The flag sits on the first session of the NEW contract, not on the expiry
 *  in `ds.rolls`. That is the row whose change against the row above it is
 *  carry — the expiry's own change is an ordinary same-contract move. */
export function datasetToCsv(ds: Dataset): string {
  const rolls = new Set(contractStarts(ds.d, ds.rolls));
  const out = [(specOf(ds).intraday ? HEADER_INTRADAY : HEADER) + ',roll'];
  for (let i = 0; i < ds.d.length; i++) {
    out.push(
      `${ds.d[i]},${ds.o[i]},${ds.h[i]},${ds.l[i]},${ds.c[i]},${ds.v[i]},${rolls.has(i) ? 1 : 0}`,
    );
  }
  return out.join('\n') + '\n';
}

export function suggestedFilename(symbol: string, ext: 'csv' | 'json', slug = 'daily'): string {
  const safe = symbol.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'series';
  return `${safe}_${slug}.${ext}`;
}
