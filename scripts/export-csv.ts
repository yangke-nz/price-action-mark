/**
 * Standalone daily OHLCV downloader — writes a plain CSV, independent of the
 * chart. Useful on its own for pulling a series into pandas, Excel or a
 * backtest. Replaces scripts/es_daily_csv.py.
 *
 *   npm run csv                                    ES=F -> data/ES_F_daily.csv
 *   npm run csv -- --symbol MES=F                  Micro E-Mini
 *   npm run csv -- --symbol ESZ26.CME --out z26.csv   one dated contract
 *
 * Caveat worth repeating: ES=F is an UNADJUSTED stitched front-month series.
 * It carries real price discontinuities at quarterly rolls — 2024-12-23 is
 * +2.77% — so returns computed straight across one are not tradable returns.
 * For a back-adjusted series, pull the dated contracts (ESU26.CME, ESZ26.CME,
 * each carrying ~5 years on the same endpoint) and stitch them yourself.
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, toRows } from '../src/shared/yahoo.ts';
import { rowsToCsv } from '../src/shared/csv.ts';
import { suggestedFilename } from '../src/shared/csv.ts';
import { INTERVALS, isInterval } from '../src/shared/interval.ts';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const symbol = flag('symbol', 'ES=F');
const start = flag('start', '1970-01-01');
const asked = flag('interval', '1d');
if (!isInterval(asked)) {
  process.stderr.write(`error: --interval must be one of ${Object.keys(INTERVALS).join(', ')}\n`);
  process.exit(1);
}
const interval = asked;
const spec = INTERVALS[interval];
const outFlag = flag('out', '');
const out = outFlag
  ? (isAbsolute(outFlag) ? outFlag : resolve(process.cwd(), outFlag))
  : DATA_DIR + suggestedFilename(symbol, 'csv', spec.slug);

process.stdout.write(
  `fetching ${symbol} ${spec.label.toLowerCase()} bars` +
    (spec.maxDays === null
      ? ` from ${start}`
      : ` (the last ${spec.maxDays} days — the whole archive)`) +
    `…\n`,
);

const rows = toRows(await fetchChart({ symbol, start, interval }), interval);
if (rows.length === 0) {
  process.stderr.write(`no usable bars for ${symbol}\n`);
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, rowsToCsv(rows, spec.intraday), 'utf8');

const { size } = await stat(out);
process.stdout.write(
  `${rows.length} rows  ${rows[0]!.date} -> ${rows[rows.length - 1]!.date}` +
    `  ->  ${out}  (${Math.round(size / 1024)} KB)\n`,
);
