/** Settings live in one small JSON file under userData. Deliberately not
 *  electron-store: this is 60 lines, has no dependency, and the atomic write
 *  is the only part that actually matters. */
import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RangeId, Settings, ThemeChoice } from '../shared/types.ts';

const RANGES: RangeId[] = ['1M', '3M', '6M', '1Y', '5Y', 'MAX'];
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

export const DEFAULTS: Settings = {
  theme: 'dark',
  range: '6M',
  showRolls: true,
  showEma: true,
  window: { width: 1320, height: 900, maximized: false },
};

let cache: Settings | null = null;

function file(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** Validate field by field: a settings file from a future version, or one a
 *  user has edited, must degrade to defaults rather than crash the window. */
function coerce(raw: unknown): Settings {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const w = (typeof v['window'] === 'object' && v['window'] !== null ? v['window'] : {}) as Record<string, unknown>;
  const int = (x: unknown, fallback: number, min: number): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= min ? Math.round(x) : fallback;

  const win: Settings['window'] = {
    width: int(w['width'], DEFAULTS.window.width, 640),
    height: int(w['height'], DEFAULTS.window.height, 480),
    maximized: w['maximized'] === true,
  };
  // x/y are optional: absent means "let the OS place it", which is what we
  // want on a first run or when the saved display is gone.
  if (typeof w['x'] === 'number' && Number.isFinite(w['x'])) win.x = Math.round(w['x'] as number);
  if (typeof w['y'] === 'number' && Number.isFinite(w['y'])) win.y = Math.round(w['y'] as number);

  return {
    theme: THEMES.includes(v['theme'] as ThemeChoice) ? (v['theme'] as ThemeChoice) : DEFAULTS.theme,
    range: RANGES.includes(v['range'] as RangeId) ? (v['range'] as RangeId) : DEFAULTS.range,
    showRolls: v['showRolls'] !== false,
    showEma: v['showEma'] !== false,
    window: win,
  };
}

export function load(): Settings {
  if (cache) return cache;
  try {
    cache = coerce(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    cache = { ...DEFAULTS, window: { ...DEFAULTS.window } };
  }
  return cache;
}

export function save(patch: Partial<Settings>): Settings {
  const next = coerce({ ...load(), ...patch });
  cache = next;
  const path = file();
  const tmp = path + '.tmp';
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, path);   // atomic: a killed process never leaves a half file
  } catch (err) {
    console.error('[settings] write failed:', (err as Error).message);
  }
  return next;
}
