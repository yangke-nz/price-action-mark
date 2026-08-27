import {
  app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, session, shell,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CH, type AppInfo, type SaveResult } from '../shared/ipc.ts';
import type { Dataset, Settings } from '../shared/types.ts';
import { datasetToCsv, suggestedFilename } from '../shared/csv.ts';
import { isDataset } from '../shared/yahoo.ts';
import * as datasetStore from './dataset.ts';
import * as settingsStore from './settings.ts';
import { buildMenu } from './menu.ts';
import { toggleVerticalMaximize } from './window.ts';

const dir = fileURLToPath(new URL('.', import.meta.url));
const CHARTS_VERSION = '5.2.1';

// One window only; a second launch just raises the first.
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;

function createWindow(settings: Settings): BrowserWindow {
  const win = new BrowserWindow({
    ...visibleBounds(settings.window),
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#eef2f6' : '#0b0d10',
    title: 'Price Action Mark',
    webPreferences: {
      // Sandboxed preload: the renderer gets window.desktop and nothing else.
      // This is also why the preload is emitted as CommonJS -- sandboxed
      // preloads cannot be ES modules.
      preload: join(dir, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  if (settings.window.maximized) win.maximize();
  // Paint the first frame before showing. A white flash on a dark theme is the
  // most visible thing a chart app can get wrong at launch.
  win.once('ready-to-show', () => win.show());

  // External links open in the OS browser; nothing navigates this window away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (protocolOf(url) === 'https:') void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.on('close', () => persistBounds(win));

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(dir, '../renderer/index.html'));

  return win;
}

function protocolOf(url: string): string {
  try { return new URL(url).protocol; } catch { return ''; }
}

/** A position saved on a monitor that is no longer attached would open the
 *  window off-screen, so drop the offsets when they land nowhere. */
function visibleBounds(w: Settings['window']): { width: number; height: number; x?: number; y?: number } {
  const size = { width: w.width, height: w.height };
  const { x, y } = w;
  if (x === undefined || y === undefined) return size;
  const onSomeDisplay = screen.getAllDisplays().some(({ workArea: a }) =>
    x >= a.x - 40 && y >= a.y - 40 && x < a.x + a.width - 40 && y < a.y + a.height - 40);
  return onSomeDisplay ? { ...size, x, y } : size;
}

function persistBounds(win: BrowserWindow): void {
  // getNormalBounds() is the un-maximized geometry, which is what we restore
  // to when the user un-maximizes on a later run.
  const b = win.getNormalBounds();
  settingsStore.save({
    window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() },
  });
}

async function saveDialog(dataset: Dataset, ext: 'csv' | 'json'): Promise<SaveResult> {
  if (!mainWindow) return { status: 'canceled' };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: ext === 'csv' ? 'Export daily bars as CSV' : 'Export dataset as JSON',
    defaultPath: suggestedFilename(dataset.symbol, ext),
    filters: [
      ext === 'csv'
        ? { name: 'Comma-separated values', extensions: ['csv'] }
        : { name: 'JSON', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { status: 'canceled' };

  const body = ext === 'csv' ? datasetToCsv(dataset) : JSON.stringify(dataset, null, 2);
  await writeFile(filePath, body, 'utf8');
  return { status: 'saved', path: filePath };
}

function registerIpc(): void {
  ipcMain.handle(CH.datasetGet, () => datasetStore.warm());
  ipcMain.handle(CH.datasetRefresh, () => datasetStore.refresh());

  ipcMain.handle(CH.settingsGet, () => settingsStore.load());
  ipcMain.handle(CH.settingsPatch, (_event, patch: Partial<Settings>) => {
    const next = settingsStore.save(patch ?? {});
    nativeTheme.themeSource = next.theme;
    buildMenu(next);                     // keep the radio/checkbox state honest
    return next;
  });

  // The renderer holds the dataset that is actually on screen, so it hands it
  // back for export rather than main guessing which one that is.
  ipcMain.handle(CH.exportCsv, (_event, ds: unknown) =>
    isDataset(ds) ? saveDialog(ds, 'csv') : ({ status: 'canceled' } satisfies SaveResult));
  ipcMain.handle(CH.exportJson, (_event, ds: unknown) =>
    isDataset(ds) ? saveDialog(ds, 'json') : ({ status: 'canceled' } satisfies SaveResult));

  ipcMain.handle(CH.fitHeight, () => (mainWindow ? toggleVerticalMaximize(mainWindow) : false));

  ipcMain.handle(CH.appInfo, (): AppInfo => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    v8: process.versions.v8 ?? '',
    platform: process.platform,
    charts: CHARTS_VERSION,
  }));
}

/** Every asset is local, so the renderer gets a CSP with no remote origin at
 *  all. Skipped in dev, where Vite's HMR client needs eval and a websocket. */
function lockDownCsp(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
          "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ],
      },
    });
  });
}

void app.whenReady().then(() => {
  const settings = settingsStore.load();
  nativeTheme.themeSource = settings.theme;
  lockDownCsp();
  registerIpc();
  buildMenu(settings);

  mainWindow = createWindow(settings);

  // Open on whatever is on disk, then pull live behind it — a cold start
  // offline still draws a chart. The window is already showing the cached
  // series by the time this lands, so the result has to be pushed to it;
  // nothing would ask for it again until the next launch otherwise.
  //
  // Only the boot refresh broadcasts. A refresh the user asked for returns
  // through its own IPC call, and pushing that one too would apply the same
  // dataset twice and reset the crosshair under them.
  void datasetStore
    .warm()
    .then(() => datasetStore.refresh())
    .then((result) => {
      if (result.origin !== 'network') return;   // nothing new arrived
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(CH.datasetUpdated, result);
      }
    })
    .catch(() => undefined);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(settingsStore.load());
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
