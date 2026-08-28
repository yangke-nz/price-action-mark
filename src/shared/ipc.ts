/** The whole main<->renderer contract, in one file both sides import.
 *  The preload exposes exactly `DesktopApi` on `window.desktop`; nothing else
 *  crosses the bridge, and the renderer has no Node access at all. */
import type { Dataset, DatasetResult, Settings } from './types.ts';
import type { MarkStore } from './marks/types.ts';

export const CH = {
  datasetGet: 'dataset:get',
  datasetRefresh: 'dataset:refresh',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  marksGet: 'marks:get',
  marksSave: 'marks:save',
  exportCsv: 'export:csv',
  exportMarks: 'export:marks',
  exportJson: 'export:json',
  appInfo: 'app:info',
  fitHeight: 'window:fit-height',
  /** main -> renderer */
  command: 'menu:command',
  datasetUpdated: 'dataset:updated',
} as const;

/** Menu items and accelerators do not touch the DOM; they send one of these. */
export type Command =
  | { kind: 'refresh' }
  | { kind: 'theme'; value: Settings['theme'] }
  | { kind: 'range'; value: Settings['range'] }
  | { kind: 'toggle'; value: 'rolls' | 'ema' }
  /** A rule id, or '*' for the whole marking layer. */
  | { kind: 'mark'; value: string }
  | { kind: 'export'; value: 'csv' | 'json' | 'marks' }
  | { kind: 'focus-chart' };

export type SaveResult = { status: 'saved'; path: string } | { status: 'canceled' };

export interface AppInfo {
  app: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  /** `process.platform`. Typed as a string because this interface is also
   *  read by the renderer, which has no Node types. */
  platform: string;
  charts: string;
}

export interface DesktopApi {
  getDataset(): Promise<DatasetResult>;
  refreshDataset(): Promise<DatasetResult>;
  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;
  exportCsv(dataset: Dataset): Promise<SaveResult>;
  exportJson(dataset: Dataset): Promise<SaveResult>;
  /** The publish path: this file becomes `data/marks.json`. */
  exportMarks(store: MarkStore): Promise<SaveResult>;

  getMarks(symbol: string): Promise<MarkStore>;
  saveMarks(store: MarkStore): Promise<MarkStore>;
  appInfo(): Promise<AppInfo>;

  /** Vertical maximize — full work-area height, same width and x. Toggles;
   *  resolves to the state the window was left in. */
  fitHeight(): Promise<boolean>;
  /** Returns an unsubscribe function. */
  onCommand(handler: (command: Command) => void): () => void;

  /**
   * Fires when a refresh the user did not ask for lands — the pull kicked off
   * at boot, behind whatever the window opened on. Without this the fresh
   * series would sit in the cache until the next launch.
   *
   * Returns an unsubscribe function.
   */
  onDatasetUpdate(handler: (result: DatasetResult) => void): () => void;
}
