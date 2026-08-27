/**
 * Artifact target: one file, no host, no network.
 *
 * The dataset is imported at build time and ends up inside the bundle, which
 * is the whole point of this target — the page is a dated snapshot that works
 * anywhere it is opened, forever, with nothing to fetch. Refresh and export
 * are declared unavailable rather than stubbed to fail: the publish CSP
 * forbids `connect-src` to Yahoo, and the viewer sandbox blocks any download
 * the page starts itself.
 */
import bundled from '$data/es_data.json';
import type { Source } from './types.ts';
import { DEFAULT_SETTINGS } from './types.ts';
import type { Settings } from '../../../shared/types.ts';

const KEY = 'price-action-mark.settings.v1';

/** localStorage throws outright in some embedding contexts (thumbnailers,
 *  previews, browsers set to block site data), so every access is guarded and
 *  a failure degrades to defaults rather than a blank page. */
function readStored(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, window: DEFAULT_SETTINGS.window };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStored(next: Settings): void {
  try {
    const { theme, range, showRolls, showEma } = next;
    localStorage.setItem(KEY, JSON.stringify({ theme, range, showRolls, showEma }));
  } catch {
    /* private window, blocked storage — the setting just does not persist */
  }
}

let settings: Settings = readStored();

const unavailable = (what: string): never => {
  throw new Error(`${what} is not available in the single-file build`);
};

export const source: Source = {
  kind: 'artifact',
  can: { refresh: false, export: false, persist: true, fitWindow: false },

  load: async () => ({ dataset: bundled, origin: 'bundled' }),
  refresh: async () => unavailable('refresh'),

  getSettings: async () => settings,
  patchSettings: async (patch) => {
    settings = { ...settings, ...patch };
    writeStored(settings);
    return settings;
  },

  exportCsv: async () => unavailable('export'),
  exportJson: async () => unavailable('export'),

  appInfo: async () => null,
  // A page in a tab has no window of its own to resize.
  fitHeight: async () => unavailable('vertical maximize'),
  onCommand: () => () => undefined,
  // Nothing can arrive after the build, so this never fires.
  onDatasetUpdate: () => () => undefined,
};
