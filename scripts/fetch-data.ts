/**
 * Refresh the bundled snapshot: Yahoo -> data/es_data.json.
 *
 *   npm run data                       ES=F, full history
 *   npm run data -- --symbol MES=F     Micro E-Mini
 *   npm run data -- --start 2015-01-01
 *
 * Runs straight off Node's type stripping — no build step, no tsx, no
 * dependencies. This is the file that replaced scripts/fetch_data.py.
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, toDataset, toRows } from '../src/shared/yahoo.ts';

const OUT = fileURLToPath(new URL('../data/es_data.json', import.meta.url));

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const symbol = flag('symbol', 'ES=F');
const start = flag('start', '1970-01-01');

process.stdout.write(`fetching ${symbol} daily bars from ${start}…\n`);

const result = await fetchChart({ symbol, start });
const rows = toRows(result);
const dataset = toDataset(result, rows);

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
