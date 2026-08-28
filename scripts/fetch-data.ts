/**
 * Refresh the bundled snapshot: Yahoo -> data/es_data.json.
 *
 *   npm run data                       ES=F daily, full history
 *   npm run data -- --symbol MES=F     Micro E-Mini
 *   npm run data -- --start 2015-01-01
 *   npm run data -- --interval 5m      the last 60 days of 5-minute bars,
 *                                      written to data/es_5m.json
 *
 * Runs straight off Node's type stripping — no build step, no tsx, no
 * dependencies. This is the file that replaced scripts/fetch_data.py.
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, toDataset, toRows } from '../src/shared/yahoo.ts';
import { INTERVALS, isInterval } from '../src/shared/interval.ts';

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

/**
 * A separate file per interval. The daily snapshot is the artifact's entire
 * dataset and the desktop app's offline seed, so an intraday pull must never
 * land on top of it.
 */
const OUT = fileURLToPath(
  new URL(interval === '1d' ? '../data/es_data.json' : `../data/es_${spec.slug}.json`, import.meta.url),
);

process.stdout.write(
  `fetching ${symbol} ${spec.label.toLowerCase()} bars` +
    (spec.maxDays === null
      ? ` from ${start}`
      : ` (the last ${spec.maxDays} days — the whole archive Yahoo keeps)`) +
    `…\n`,
);

const result = await fetchChart({ symbol, start, interval });
const rows = toRows(result, interval);
const dataset = toDataset(result, interval, rows);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(dataset), 'utf8');

const { size } = await stat(OUT);
const first = dataset.d[0]!;
const last = dataset.d[dataset.d.length - 1]!;
const dropped = (result.timestamp?.length ?? 0) - rows.length;

process.stdout.write(
  `${dataset.d.length} bars  ${first} -> ${last}  (${dataset.rolls.length} rolls` +
    `${dropped > 0 ? `, ${dropped} null/duplicate bars dropped` : ''})\n` +
    `last close ${dataset.c[dataset.c.length - 1]}  ->  ${OUT}  (${Math.round(size / 1024)} KB)\n`,
);
