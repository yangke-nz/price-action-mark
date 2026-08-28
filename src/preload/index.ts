/**
 * The entire privileged surface, and the only thing the renderer can reach.
 * Runs sandboxed, so it is emitted as CommonJS — a sandboxed preload cannot be
 * an ES module. Nothing here forwards an arbitrary channel: each method names
 * one, so a compromised renderer cannot invoke handlers it was not given.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type Command, type DesktopApi } from '../shared/ipc.ts';
import type { Dataset, DatasetResult, Settings } from '../shared/types.ts';
import type { MarkStore } from '../shared/marks/types.ts';

const api: DesktopApi = {
  getDataset: () => ipcRenderer.invoke(CH.datasetGet) as Promise<DatasetResult>,
  refreshDataset: () => ipcRenderer.invoke(CH.datasetRefresh) as Promise<DatasetResult>,

  getSettings: () => ipcRenderer.invoke(CH.settingsGet) as Promise<Settings>,
  patchSettings: (patch) => ipcRenderer.invoke(CH.settingsPatch, patch) as Promise<Settings>,

  exportCsv: (dataset: Dataset) => ipcRenderer.invoke(CH.exportCsv, dataset),
  exportJson: (dataset: Dataset) => ipcRenderer.invoke(CH.exportJson, dataset),
  exportMarks: (store: MarkStore) => ipcRenderer.invoke(CH.exportMarks, store),

  getMarks: (symbol: string) => ipcRenderer.invoke(CH.marksGet, symbol) as Promise<MarkStore>,
  saveMarks: (store: MarkStore) => ipcRenderer.invoke(CH.marksSave, store) as Promise<MarkStore>,

  appInfo: () => ipcRenderer.invoke(CH.appInfo),
  fitHeight: () => ipcRenderer.invoke(CH.fitHeight) as Promise<boolean>,

  onCommand(handler) {
    // The IpcRendererEvent never crosses the bridge — only the payload does.
    const listener = (_event: unknown, command: Command): void => handler(command);
    ipcRenderer.on(CH.command, listener);
    return () => ipcRenderer.off(CH.command, listener);
  },

  onDatasetUpdate(handler) {
    const listener = (_event: unknown, result: DatasetResult): void => handler(result);
    ipcRenderer.on(CH.datasetUpdated, listener);
    return () => ipcRenderer.off(CH.datasetUpdated, listener);
  },
};

contextBridge.exposeInMainWorld('desktop', api);
