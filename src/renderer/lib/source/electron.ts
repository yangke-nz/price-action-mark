/** Desktop target: everything goes over the preload bridge. */
import type { Source } from './types.ts';
import { DEFAULT_SETTINGS } from './types.ts';

function bridge(): NonNullable<Window['desktop']> {
  const api = window.desktop;
  // A missing bridge means the preload failed to load, which is a build fault
  // rather than a runtime condition — fail loudly instead of half-working.
  if (!api) throw new Error('window.desktop is missing: the preload script did not run');
  return api;
}

export const source: Source = {
  kind: 'electron',
  can: { refresh: true, export: true, persist: true, fitWindow: true },

  load: () => bridge().getDataset(),
  refresh: () => bridge().refreshDataset(),

  getSettings: async () => {
    try {
      return await bridge().getSettings();
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  patchSettings: (patch) => bridge().patchSettings(patch),

  exportCsv: (dataset) => bridge().exportCsv(dataset),
  exportJson: (dataset) => bridge().exportJson(dataset),
  exportMarks: (store) => bridge().exportMarks(store),

  getMarks: (symbol) => bridge().getMarks(symbol),
  saveMarks: (store) => bridge().saveMarks(store),

  appInfo: () => bridge().appInfo(),
  fitHeight: () => bridge().fitHeight(),
  onCommand: (handler) => bridge().onCommand(handler),
  onDatasetUpdate: (handler) => bridge().onDatasetUpdate(handler),
};
