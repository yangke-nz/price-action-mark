/**
 * Mark verdicts, one small JSON file per symbol under userData.
 *
 * A sibling of settings.ts rather than a field inside it, and for a reason the
 * settings file makes obvious: settings are one object shared by the whole app,
 * while marks are per-instrument. Folding them together would mean every
 * symbol's verdicts travelling in every settings read, and a settings file
 * that grows without bound as the reader marks up more charts.
 *
 * The atomic write is copied from settings.ts deliberately — a killed process
 * must never leave half a file, and this is the only part that actually matters.
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MarkStore } from '../shared/marks/types.ts';
import { coerceStore, emptyStore } from '../shared/marks/types.ts';

/** Symbols contain characters a filesystem will not take: `ES=F`. */
function fileFor(symbol: string): string {
  const safe = symbol.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'series';
  return join(app.getPath('userData'), 'marks', `${safe}.json`);
}

const cache = new Map<string, MarkStore>();

export function load(symbol: string): MarkStore {
  const hit = cache.get(symbol);
  if (hit) return hit;
  let store: MarkStore;
  try {
    store = coerceStore(JSON.parse(readFileSync(fileFor(symbol), 'utf8')), symbol);
  } catch {
    store = emptyStore(symbol);
  }
  cache.set(symbol, store);
  return store;
}

export function save(store: MarkStore, now: string): MarkStore {
  const next = { ...coerceStore(store, store.symbol), updated: now };
  cache.set(next.symbol, next);
  const path = fileFor(next.symbol);
  const tmp = path + '.tmp';
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, path);   // atomic: a killed process never leaves a half file
  } catch (err) {
    console.error('[marks] write failed:', (err as Error).message);
  }
  return next;
}
