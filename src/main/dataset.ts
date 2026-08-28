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
import { INTERVALS, intervalOf, type Interval } from '../shared/interval.ts';

export const SYMBOL = 'ES=F';

/** One cache file per bar size. Sharing one would have a 5-minute pull
 *  overwrite 26 years of daily bars, and the app would boot on 60 days of
 *  intraday thinking it was the daily series. */
function cacheFile(interval: Interval): string {
  return join(app.getPath('userData'), `es_${INTERVALS[interval].slug}.json`);
}

/**
 * Bundled seed. In dev this resolves inside the repo; when packaged it comes
 * from `extraResources`, hence the several candidates.
 *
 * DAILY ONLY, deliberately. An intraday snapshot is a 60-day rolling window,
 * so a committed one is stale the moment it is a day old and worthless after
 * two months — it would ship 600 KB to seed a chart nobody should trust. The
 * first switch to an intraday timeframe therefore needs the network, and says
 * so if it cannot have it.
 */
function bundledCandidates(interval: Interval): string[] {
  if (interval !== '1d') return [];
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

async function readBundled(interval: Interval): Promise<Dataset | null> {
  for (const path of bundledCandidates(interval)) {
    const ds = await readDataset(path);
    // A file whose bars are not the size asked for is not a seed for it.
    if (ds && intervalOf(ds) === interval) return ds;
  }
  return null;
}

async function writeCache(ds: Dataset): Promise<void> {
  const path = cacheFile(intervalOf(ds));
  const tmp = path + '.tmp';
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, JSON.stringify(ds), 'utf8');
    await rename(tmp, path);
  } catch (err) {
    console.error('[dataset] cache write failed:', (err as Error).message);
  }
}

/** Per interval: switching timeframe and switching back must not re-fetch. */
const current = new Map<Interval, DatasetResult>();
const inFlight = new Map<Interval, Promise<DatasetResult>>();

/** Fastest thing on disk, so the window has something to draw immediately. */
export async function warm(interval: Interval = '1d'): Promise<DatasetResult> {
  const held = current.get(interval);
  if (held) return held;
  const found = await fromDiskOnly(interval);
  if (found) {
    current.set(interval, found);
    return found;
  }
  // Nothing on disk at all — the network is the only option left. That is the
  // normal path for an intraday timeframe, which ships no seed.
  return refresh(interval);
}

/** Live pull. Concurrent callers (boot + a menu click) share one request. */
export function refresh(interval: Interval = '1d'): Promise<DatasetResult> {
  const running = inFlight.get(interval);
  if (running) return running;
  const task = (async (): Promise<DatasetResult> => {
    try {
      const dataset = await fetchDataset({ symbol: SYMBOL, start: '1970-01-01', interval });
      await writeCache(dataset);
      const result: DatasetResult = { dataset, origin: 'network' };
      current.set(interval, result);
      return result;
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[dataset] ${interval} refresh failed:`, message);
      // Keep serving whatever we already had, but say why it is what it is.
      const fallback = current.get(interval) ?? (await fromDiskOnly(interval));
      if (!fallback) throw err;
      const result: DatasetResult = { ...fallback, error: message };
      current.set(interval, result);
      return result;
    } finally {
      inFlight.delete(interval);
    }
  })();
  inFlight.set(interval, task);
  return task;
}

async function fromDiskOnly(interval: Interval): Promise<DatasetResult | null> {
  const cached = await readDataset(cacheFile(interval));
  if (cached && intervalOf(cached) === interval) return { dataset: cached, origin: 'cache' };
  const bundled = await readBundled(interval);
  return bundled ? { dataset: bundled, origin: 'bundled' } : null;
}
