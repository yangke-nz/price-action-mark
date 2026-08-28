import type { Dataset } from './types.ts';
import { contractStarts } from './rolls.ts';
import type { Row } from './yahoo.ts';

const HEADER = 'date,open,high,low,close,volume';

export function rowsToCsv(rows: Row[]): string {
  const out = [HEADER];
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
  const out = [HEADER + ',roll'];
  for (let i = 0; i < ds.d.length; i++) {
    out.push(
      `${ds.d[i]},${ds.o[i]},${ds.h[i]},${ds.l[i]},${ds.c[i]},${ds.v[i]},${rolls.has(i) ? 1 : 0}`,
    );
  }
  return out.join('\n') + '\n';
}

export function suggestedFilename(symbol: string, ext: 'csv' | 'json'): string {
  const safe = symbol.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'series';
  return `${safe}_daily.${ext}`;
}
