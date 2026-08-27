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
import type { AppInfo, Command, SaveResult } from '../../../shared/ipc.ts';
import type { Dataset, DatasetResult, Settings } from '../../../shared/types.ts';

export interface Capabilities {
  /** Can pull fresh bars from the network. */
  refresh: boolean;
  /** Can hand the user a file. */
  export: boolean;
  /** Settings survive a restart. */
  persist: boolean;
  /** There is a real OS window to resize. */
  fitWindow: boolean;
}

export interface Source {
  readonly kind: 'electron' | 'artifact';
  readonly can: Capabilities;

  load(): Promise<DatasetResult>;
  refresh(): Promise<DatasetResult>;

  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;

  exportCsv(dataset: Dataset): Promise<SaveResult>;
  exportJson(dataset: Dataset): Promise<SaveResult>;

  appInfo(): Promise<AppInfo | null>;
  /** Vertical maximize; resolves to the state the window was left in. */
  fitHeight(): Promise<boolean>;
  onCommand(handler: (command: Command) => void): () => void;
  /** A refresh nobody asked for landing behind the window. */
  onDatasetUpdate(handler: (result: DatasetResult) => void): () => void;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  range: '6M',
  showRolls: true,
  showEma: true,
  window: { width: 1320, height: 900, maximized: false },
};
