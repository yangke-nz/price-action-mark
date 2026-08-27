/**
 * Dataset supply for the desktop app, in three tiers:
 *
 *   network  live Yahoo pull
 *   cache    the last successful pull, in userData
 *   bundled  data/es_data.json shipped with the app
 *
 * The app opens on whatever is available fastest and refreshes behind it, so a
 * cold start offline still draws a chart. Which tier is on screen is reported
 * to the renderer and printed in the footer — a stale cache that looks live is
 * the one failure mode a price chart cannot show you.
 */
import { app } from 'electron';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Dataset, DatasetResult } from '../shared/types.ts';
import { fetchDataset, isDataset } from '../shared/yahoo.ts';

export const SYMBOL = 'ES=F';

function cacheFile(): string {
  return join(app.getPath('userData'), 'es_data.json');
}

/** Bundled seed. In dev this resolves inside the repo; when packaged it comes
 *  from `extraResources`, hence the two candidates. */
function bundledCandidates(): string[] {
  return [
    join(process.resourcesPath ?? '', 'data', 'es_data.json'),
    join(app.getAppPath(), 'data', 'es_data.json'),
    join(app.getAppPath(), '..', 'data', 'es_data.json'),
  ];
}

async function readDataset(path: string): Promise<Dataset | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isDataset(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readBundled(): Promise<Dataset | null> {
  for (const path of bundledCandidates()) {
    const ds = await readDataset(path);
    if (ds) return ds;
  }
  return null;
}

async function writeCache(ds: Dataset): Promise<void> {
  const path = cacheFile();
  const tmp = path + '.tmp';
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, JSON.stringify(ds), 'utf8');
    await rename(tmp, path);
  } catch (err) {
    console.error('[dataset] cache write failed:', (err as Error).message);
  }
}

let current: DatasetResult | null = null;
let inFlight: Promise<DatasetResult> | null = null;

/** Fastest thing on disk, so the window has something to draw immediately. */
export async function warm(): Promise<DatasetResult> {
  if (current) return current;
  const cached = await readDataset(cacheFile());
  if (cached) return (current = { dataset: cached, origin: 'cache' });
  const bundled = await readBundled();
  if (bundled) return (current = { dataset: bundled, origin: 'bundled' });
  // Nothing on disk at all — the network is the only option left.
  return refresh();
}

/** Live pull. Concurrent callers (boot + a menu click) share one request. */
export function refresh(): Promise<DatasetResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<DatasetResult> => {
    try {
      const dataset = await fetchDataset({ symbol: SYMBOL, start: '1970-01-01' });
      await writeCache(dataset);
      return (current = { dataset, origin: 'network' });
    } catch (err) {
      const message = (err as Error).message;
      console.error('[dataset] refresh failed:', message);
      // Keep serving whatever we already had, but say why it is what it is.
      const fallback = current ?? (await fromDiskOnly());
      if (!fallback) throw err;
      return (current = { ...fallback, error: message });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function fromDiskOnly(): Promise<DatasetResult | null> {
  const cached = await readDataset(cacheFile());
  if (cached) return { dataset: cached, origin: 'cache' };
  const bundled = await readBundled();
  return bundled ? { dataset: bundled, origin: 'bundled' } : null;
}
