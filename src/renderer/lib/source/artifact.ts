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
import bundledMarks from '$data/marks.json';
import type { Source } from './types.ts';
import { DEFAULT_SETTINGS } from './types.ts';
import type { Settings } from '../../../shared/types.ts';
import type { MarkStore } from '../../../shared/marks/types.ts';
import { coerceStore } from '../../../shared/marks/types.ts';

const KEY = 'price-action-mark.settings.v1';
const MARKS_KEY = 'price-action-mark.marks.v1';

/** localStorage throws outright in some embedding contexts (thumbnailers,
 *  previews, browsers set to block site data), so every access is guarded and
 *  a failure degrades to defaults rather than a blank page. */
/** What this build wants to open on: whatever its author published. */
const publishedDefault: Settings['marks']['show'] =
  Object.values(coerceStore(bundledMarks, '').verdicts).some((v) => v === 'confirmed')
    ? 'confirmed'
    : 'all';

function readStored(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    // A first-time viewer still gets the mode this build published. Returning
    // DEFAULT_SETTINGS here instead means every fresh visitor sees all
    // candidates rather than the author's marks, which is the one case the
    // whole publish path exists for.
    if (!raw) return { ...DEFAULT_SETTINGS, marks: { ...DEFAULT_SETTINGS.marks, show: publishedDefault } };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Same reason `window` is not taken from storage: a half-written or
      // hand-edited object must not reach the rest of the app malformed.
      marks: {
        enabled: parsed.marks?.enabled !== false,
        // Publishing verdicts is what puts a page into confirmed-only mode. An
        // artifact built with an empty marks.json shows every candidate, as the
        // desktop app does; one built with verdicts opens on exactly the marks
        // its author kept, which is the point of exporting them at all.
        //
        // Absent means "never chosen", NOT "chose all" — see writeStored. Any
        // other reading freezes today's default into storage the first time the
        // viewer touches the theme, and a later republish never reaches them.
        show: parsed.marks?.show ?? publishedDefault,
        // On unless the viewer switched it off, exactly as `enabled` reads: a
        // page stored before this field existed keeps the rails.
        stopTarget: parsed.marks?.stopTarget !== false,
        rules: typeof parsed.marks?.rules === 'object' && parsed.marks.rules !== null
          ? parsed.marks.rules
          : {},
        folded: typeof parsed.marks?.folded === 'object' && parsed.marks.folded !== null
          ? parsed.marks.folded
          : {},
      },
      window: DEFAULT_SETTINGS.window,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStored(next: Settings): void {
  try {
    const { theme, range, showRolls, showEma, marks } = next;
    // `show` is stored only when the viewer moved it off what this build
    // published — the same sparseness `marks.rules` uses, and for the same
    // reason. Writing it unconditionally would mean the first theme click
    // pinned the current default forever.
    // `folded` rides along only when the viewer has actually moved a rule off
    // its shipped tier: an empty record written out would be indistinguishable
    // from a choice, and the fold set is exactly the thing a republish should
    // still be able to change.
    const folds = Object.keys(marks.folded).length > 0 ? { folded: marks.folded } : {};
    // And `stopTarget` only when it is OFF, which is the same rule once more:
    // the rails are on by default, so storing that is storing nothing, and
    // storing nothing is what lets the default still move.
    const { stopTarget, ...rest } = marks;
    const rails = stopTarget ? {} : { stopTarget: false };
    const stored = marks.show === publishedDefault
      ? { enabled: marks.enabled, rules: marks.rules, ...folds, ...rails }
      : { ...rest, ...folds, ...rails };
    localStorage.setItem(KEY, JSON.stringify({ theme, range, showRolls, showEma, marks: stored }));
  } catch {
    /* private window, blocked storage — the setting just does not persist */
  }
}

/**
 * The published page ships with whatever verdicts were exported into
 * `data/marks.json`, and a viewer's own confirmations layer on top in their
 * browser. That overlay never leaves the tab: there is nowhere for it to go,
 * and a page that quietly collected reader annotations would be a surprise.
 *
 * Base first, overlay second, so republishing with new verdicts reaches
 * everyone while a viewer's local decisions still win on the marks they touched.
 */
function readMarks(symbol: string): MarkStore {
  const base = coerceStore(bundledMarks, symbol);
  try {
    const raw = localStorage.getItem(MARKS_KEY);
    if (!raw) return base;
    const overlay = coerceStore(JSON.parse(raw), symbol);
    return { ...base, verdicts: { ...base.verdicts, ...overlay.verdicts } };
  } catch {
    return base;
  }
}

let settings: Settings = readStored();

const unavailable = (what: string): never => {
  throw new Error(`${what} is not available in the single-file build`);
};

export const source: Source = {
  kind: 'artifact',
  can: { refresh: false, export: false, persist: true, fitWindow: false, timeframes: false },

  // The interval is ignored on purpose: there is exactly one snapshot inlined
  // at build time, and whatever bar size it holds is what this artifact is.
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
  exportMarks: async () => unavailable('export'),

  getMarks: async (symbol) => readMarks(symbol),
  saveMarks: async (store) => {
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify({ verdicts: store.verdicts }));
    } catch {
      /* private window, blocked storage — the verdict just does not persist */
    }
    return store;
  },

  appInfo: async () => null,
  // A page in a tab has no window of its own to resize.
  fitHeight: async () => unavailable('vertical maximize'),
  fitLeft: async () => unavailable('window sizing'),
  onCommand: () => () => undefined,
  // Nothing can arrive after the build, so this never fires.
  onDatasetUpdate: () => () => undefined,
  // A page in a tab has no window gestures to report on either.
  onWindowState: () => () => undefined,
};
