/** Settings live in one small JSON file under userData. Deliberately not
 *  electron-store: this is 60 lines, has no dependency, and the atomic write
 *  is the only part that actually matters. */
import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MarkSettings, RangeId, Settings, ThemeChoice } from '../shared/types.ts';
import { INTERVALS, isInterval, rangeFor } from '../shared/interval.ts';
import { isSession } from '../shared/session.ts';

/** Every preset any interval offers. Which are OFFERED is the renderer's
 *  business; this only has to refuse a value that is not a preset at all. */
const RANGES: RangeId[] = [
  ...new Set(Object.values(INTERVALS).flatMap((spec) => spec.ranges)),
];
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

export const DEFAULTS: Settings = {
  theme: 'dark',
  interval: '1d',
  session: 'eth',
  range: '6M',
  showRolls: true,
  showEma: true,
  marks: { enabled: true, show: 'all', rules: {} },
  window: { width: 1320, height: 900, maximized: false },
};

/** Only booleans, and only for ids that look like rule ids. An entry naming a
 *  rule this build does not have is dropped rather than carried: a settings
 *  file written by a future version must degrade, never accumulate. */
function coerceMarks(raw: unknown): MarkSettings {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const src = (typeof v['rules'] === 'object' && v['rules'] !== null ? v['rules'] : {}) as Record<string, unknown>;
  const rules: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(src)) {
    if (typeof on === 'boolean' && /^[a-z0-9-]{1,40}$/.test(id)) rules[id] = on;
  }
  return {
    enabled: v['enabled'] !== false,
    show: v['show'] === 'confirmed' ? 'confirmed' : 'all',
    rules,
  };
}

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

  // The range is validated against the INTERVAL, not just against the list of
  // presets: one stored range serves every timeframe, so a file written while
  // on daily can hold `5Y`, which is not a preset the 60-day intraday archive
  // offers. `rangeFor` substitutes that interval's own default rather than
  // storing a range per interval — which would freeze today's preset list into
  // every settings file, the argument `marks.rules` makes for being sparse.
  const interval = isInterval(v['interval']) ? v['interval'] : DEFAULTS.interval;
  const stored = RANGES.includes(v['range'] as RangeId) ? (v['range'] as RangeId) : DEFAULTS.range;

  return {
    marks: coerceMarks(v['marks']),
    theme: THEMES.includes(v['theme'] as ThemeChoice) ? (v['theme'] as ThemeChoice) : DEFAULTS.theme,
    interval,
    // ETH by default: it means "every bar the feed has", and this app does not
    // silently drop 71% of what it pulled. RTH is a choice the reader makes.
    session: isSession(v['session']) ? v['session'] : DEFAULTS.session,
    range: rangeFor(interval, stored),
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
