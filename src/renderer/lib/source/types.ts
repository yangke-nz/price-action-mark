/**
 * The seam between the one Svelte app and its two build targets.
 *
 * The desktop app can pull live data, save files through a native dialog and
 * persist settings to disk. The published artifact runs under a CSP that
 * permits no remote origin and a sandbox that blocks downloads, so it can do
 * none of those — it has a build-time snapshot and localStorage.
 *
 * Rather than branch on the target throughout the UI, each target supplies one
 * of these and declares what it can actually do. Components read
 * `source.can.*` and simply do not render controls that would not work.
 */
import type { AppInfo, Command, SaveResult, WindowState } from '../../../shared/ipc.ts';
import type { Dataset, DatasetResult, Settings } from '../../../shared/types.ts';
import type { Interval } from '../../../shared/interval.ts';
import type { MarkStore } from '../../../shared/marks/types.ts';

export interface Capabilities {
  /** Can pull fresh bars from the network. */
  refresh: boolean;
  /** Can hand the user a file. */
  export: boolean;
  /** Settings survive a restart. */
  persist: boolean;
  /** There is a real OS window to resize. */
  fitWindow: boolean;
  /**
   * Can change the bar size on demand.
   *
   * Not the same thing as `refresh`, even though only a target that can refresh
   * can currently do it — the artifact carries ONE snapshot inlined at build
   * time, so it displays whatever interval that snapshot holds and has no
   * second one to switch to. An artifact built from a 5-minute snapshot is a
   * 5-minute chart; it simply cannot become a daily one.
   */
  timeframes: boolean;
}

// Note there is no `markSets` capability. Both targets persist verdicts — the
// desktop to a per-symbol file, the artifact to localStorage over the set
// inlined at build time — and the only thing that differs is writing them out
// for publishing, which `export` already covers. A second flag meaning the same
// thing as an existing one is worse than no flag at all.

export interface Source {
  readonly kind: 'electron' | 'artifact';
  readonly can: Capabilities;

  /** The bar size to load. A target that cannot switch timeframe ignores it
   *  and returns the snapshot it was built with — see `can.timeframes`. */
  load(interval: Interval): Promise<DatasetResult>;
  refresh(interval: Interval): Promise<DatasetResult>;

  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;

  exportCsv(dataset: Dataset): Promise<SaveResult>;
  exportJson(dataset: Dataset): Promise<SaveResult>;
  /** The publish path: the saved file becomes `data/marks.json`. */
  exportMarks(store: MarkStore): Promise<SaveResult>;

  getMarks(symbol: string): Promise<MarkStore>;
  saveMarks(store: MarkStore): Promise<MarkStore>;

  appInfo(): Promise<AppInfo | null>;
  /** Vertical maximize; resolves to the state the window was left in. */
  fitHeight(): Promise<boolean>;
  /** Extend the left edge to the screen's; same contract. */
  fitLeft(): Promise<boolean>;
  onCommand(handler: (command: Command) => void): () => void;
  /** A refresh nobody asked for landing behind the window. */
  onDatasetUpdate(handler: (result: DatasetResult) => void): () => void;
  /** The window's geometry changed, however it happened. A target with no
   *  window of its own never fires it. */
  onWindowState(handler: (state: WindowState) => void): () => void;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  interval: '1d',
  session: 'eth',
  range: '6M',
  showRolls: true,
  showEma: true,
  marks: { enabled: true, show: 'all', stopTarget: true, rules: {}, folded: {} },
  window: { width: 1320, height: 900, maximized: false },
};
