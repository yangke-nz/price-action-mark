import {
  app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, session, shell,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CH, type AppInfo, type SaveResult, type WindowState } from '../shared/ipc.ts';
import type { Dataset, Settings } from '../shared/types.ts';
import type { MarkStore } from '../shared/marks/types.ts';
import { coerceStore } from '../shared/marks/types.ts';
import { datasetToCsv, suggestedFilename } from '../shared/csv.ts';
import { isDataset } from '../shared/yahoo.ts';
import { isInterval, specOf } from '../shared/interval.ts';
import { SESSIONS, inRth, sourceIntervalFor } from '../shared/session.ts';
import * as datasetStore from './dataset.ts';
import * as settingsStore from './settings.ts';
import * as markStore from './marks.ts';
import { buildMenu } from './menu.ts';
import { isLeftMaximized, isVerticallyMaximized, toggleLeftMaximize, toggleVerticalMaximize } from './window.ts';

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
  // `close` fires first and still has bounds to persist; `closed` fires after
  // destruction. Without this the module reference outlives the window, and a
  // truthy check passes on a destroyed wrapper -- every call on it then throws
  // `Object has been destroyed`. On macOS the app stays alive with no window,
  // so that stale state is a normal state, not an edge case.
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // The two gesture buttons label themselves from a renderer flag, and main is
  // the only thing that knows the truth: the accelerators act here without
  // telling the renderer, and a drag or an OS snap tells nobody. So the state
  // is pushed on every geometry change, and once when the page has loaded.
  // Listed one by one rather than looped: `BrowserWindow.on` is typed as a
  // union of per-event overloads, so a loop variable does not resolve to one.
  const report = (): void => pushWindowState(win);
  win.on('resize', report);
  win.on('move', report);
  win.on('maximize', report);
  win.on('unmaximize', report);
  win.on('restore', report);
  win.webContents.on('did-finish-load', report);

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(dir, '../renderer/index.html'));

  return win;
}

/**
 * Raise the window, opening one if there is none.
 *
 * Both callers can arrive with every window closed, because `window-all-closed`
 * deliberately does not quit on macOS: clicking the Dock icon (`activate`), and
 * a second launch of the app (`second-instance`), which the single-instance
 * lock turns into a request to show the instance already running.
 */
function showWindow(): void {
  // `second-instance` is registered before `whenReady`, and a BrowserWindow
  // constructed before the app is ready throws.
  if (!app.isReady()) return;
  if (!mainWindow) {
    mainWindow = createWindow(settingsStore.load());
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
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

/** A drag fires `resize` every frame, and the label only has to be right once
 *  the gesture stops. */
let statePush: ReturnType<typeof setTimeout> | null = null;

function pushWindowState(win: BrowserWindow): void {
  if (statePush) clearTimeout(statePush);
  statePush = setTimeout(() => {
    statePush = null;
    // Both guards: this fires on a timer, so the window can go away between
    // the last resize and the push — and an uncaught throw in a main-process
    // timer takes the whole app with it, which is a steep price for a button
    // label.
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(CH.windowState, {
      fitted: isVerticallyMaximized(win),
      fittedLeft: isLeftMaximized(win),
    } satisfies WindowState);
  }, 120);
}

function persistBounds(win: BrowserWindow): void {
  // getNormalBounds() is the un-maximized geometry, which is what we restore
  // to when the user un-maximizes on a later run.
  const b = win.getNormalBounds();
  settingsStore.save({
    window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() },
  });
}

/**
 * The publish path. A marked-up chart that travels as one self-contained file
 * is what the artifact target exists for, and this is the hand-off: save the
 * verdicts, drop them in `data/marks.json`, run `npm run artifact`.
 */
async function saveMarksDialog(store: MarkStore): Promise<SaveResult> {
  if (!mainWindow) return { status: 'canceled' };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export marks for publishing',
    defaultPath: 'marks.json',
    filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { status: 'canceled' };
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
  return { status: 'saved', path: filePath };
}

/**
 * `5m_rth` rather than `5m`, when that is what the file holds.
 *
 * The dataset handed over is the one on screen, already session filtered, so two
 * exports of the same symbol and interval can differ by 71% of their rows.
 * Derived from the DATA rather than from settings, so the name stays true to the
 * file even if the reader switches timeframe before the dialog closes.
 */
function slugFor(dataset: Dataset): string {
  // A daily series aggregated from intraday bars carries its window, because
  // its keys no longer can: two exports of one symbol and interval would
  // otherwise differ by a whole session's worth of hours under the same name.
  if (dataset.window !== undefined) {
    return `${specOf(dataset).slug}_${SESSIONS[dataset.window].slug}`;
  }
  const spec = specOf(dataset);
  if (!spec.intraday) return spec.slug;
  const everyBarIsRth = dataset.d.every((key) => inRth(key));
  return `${spec.slug}_${everyBarIsRth ? SESSIONS.rth.slug : SESSIONS.eth.slug}`;
}

async function saveDialog(dataset: Dataset, ext: 'csv' | 'json'): Promise<SaveResult> {
  if (!mainWindow) return { status: 'canceled' };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: ext === 'csv' ? 'Export bars as CSV' : 'Export dataset as JSON',
    defaultPath: suggestedFilename(dataset.symbol, ext, slugFor(dataset)),
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
  // The interval arrives from the renderer and is validated here rather than
  // trusted: everything over the bridge is untrusted input, and an unknown
  // value would index INTERVALS with undefined.
  ipcMain.handle(CH.datasetGet, (_e, interval: unknown) =>
    datasetStore.warm(isInterval(interval) ? interval : '1d'));
  ipcMain.handle(CH.datasetRefresh, (_e, interval: unknown) =>
    datasetStore.refresh(isInterval(interval) ? interval : '1d'));

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

  ipcMain.handle(CH.marksGet, (_event, symbol: unknown) =>
    markStore.load(typeof symbol === 'string' && symbol ? symbol : 'series'));
  ipcMain.handle(CH.marksSave, (_event, store: unknown) =>
    markStore.save(coerceStore(store, 'series'), new Date().toISOString()));
  ipcMain.handle(CH.exportMarks, (_event, store: unknown) =>
    saveMarksDialog(coerceStore(store, 'series')));

  ipcMain.handle(CH.fitHeight, () => (mainWindow ? toggleVerticalMaximize(mainWindow) : false));
  ipcMain.handle(CH.fitLeft, () => (mainWindow ? toggleLeftMaximize(mainWindow) : false));

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
  // On whatever timeframe the window opened, which is the one the reader left
  // it on. Refreshing daily while they are looking at 5-minute bars would push
  // a dataset the renderer has to discard.
  // ...and on the series that timeframe actually LOADS, which for RTH daily is
  // the intraday one those bars are aggregated from. Refreshing `interval` here
  // pushed a daily dataset at a renderer holding 5-minute bars, which `adopt()`
  // correctly discards — so an RTH daily window silently never got its boot
  // refresh at all.
  const stored = settingsStore.load();
  const booted = sourceIntervalFor(stored.interval, stored.session);
  void datasetStore
    .warm(booted)
    .then(() => datasetStore.refresh(booted))
    .then((result) => {
      if (result.origin !== 'network') return;   // nothing new arrived
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(CH.datasetUpdated, result);
      }
    })
    .catch(() => undefined);

  app.on('activate', showWindow);
});

app.on('second-instance', showWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
