/**
 * Render checks for both build targets.
 *
 *   npm run smoke        the single-file artifact  (dist/preview.html)
 *   npm run smoke:app    the desktop app           (out/, real main process)
 *
 * These are the two things unit tests cannot tell you about this project:
 * whether the chart actually drew, and whether anything failed silently. The
 * artifact's failure mode in particular is invisible — under the publish CSP a
 * blocked resource simply never arrives — so it gets loaded in a real Chromium
 * and the DOM is asked what happened.
 *
 * The desktop mode imports the real out/main/index.js rather than standing up
 * a lookalike window, so the preload bridge and every IPC handler are on the
 * same path they take in production.
 *
 * CommonJS on purpose: this is an Electron main entry, not part of the bundle.
 */
const path = require('node:path');
const electron = require('electron');

// ELECTRON_RUN_AS_NODE makes the same binary behave as plain Node, and some
// toolchains export it globally. There is no main process in that mode, so
// re-exec once with the variable removed rather than failing on `app`.
if (!electron || typeof electron === 'string' || !electron.app) {
  if (process.env.ELECTRON_RUN_AS_NODE) {
    const { spawnSync } = require('node:child_process');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const binary = typeof electron === 'string' ? electron : process.execPath;
    const { status } = spawnSync(binary, [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
    process.exit(status ?? 1);
  }
  process.stderr.write('smoke: this must run under Electron (npm run smoke)\n');
  process.exit(1);
}

const { app, BrowserWindow } = electron;

// Launched by file path, so Electron's appPath is scripts/ — no package.json
// there, which makes getName() fall back to "Electron" and userData land in
// %APPDATA%/Electron. `electron-vite dev` and the packaged app both resolve
// the real name, so without this the smoke run would exercise a different
// cache directory than the app it is meant to be testing.
app.setName(require('../package.json').name);

const args = process.argv.slice(2);
const desktopMode = args.includes('--app');
const target = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'dist/preview.html');
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 3500);

/** "7,720.00" -> true. Cheap, and avoids a regex that has to survive being
 *  copied around. */
const looksLikePrice = (v) =>
  typeof v === 'string' && v.includes('.') && Number(v.split(',').join('')) > 0;

const errors = [];

/** Serialised into the page, so it may not close over anything out here. */
function probe() {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  return {
    title: document.title,
    theme: document.documentElement.dataset.theme ?? null,
    canvases: document.querySelectorAll('canvas').length,
    last: text('[class*="last"]'),
    readout: text('[class*="date"]'),
    footer: text('footer'),
    origin: /(Pulled live from Yahoo|From the local cache|From the snapshot shipped)/.exec(text('footer') ?? '')?.[1] ?? null,
    rows: document.querySelectorAll('tbody tr').length,
    ema: text('.ema'),
    fonts: [...document.fonts].filter((f) => f.status === 'loaded').length,
    bridged: typeof window.desktop === 'object' && window.desktop !== null,
  };
}

function watch(contents) {
  // Rest args keep listener.length at 0, which is how Electron decides not to
  // hand this the deprecated positional signature.
  contents.on('console-message', (...a) => {
    const details = typeof a[0] === 'object' && a[0] !== null ? a[0] : { level: a[1], message: a[2] };
    if (details.level === 'error' || details.level === 3) errors.push(String(details.message));
  });
  contents.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));
  contents.on('did-fail-load', (_e, code, desc) => errors.push(`load failed: ${desc} (${code})`));
  contents.on('preload-error', (_e, file, err) => errors.push(`preload ${file}: ${err.message}`));
}

async function windowForArtifact() {
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000 });
  watch(win.webContents);
  await win.loadFile(target);
  return win;
}

async function windowForApp() {
  // Booting the real main process: it creates the window, wires the menu and
  // registers every IPC handler exactly as it does for a user.
  await import('../out/main/index.js');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      watch(win.webContents);
      if (win.webContents.isLoading()) {
        await new Promise((r) => win.webContents.once('did-finish-load', r));
      }
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the app never opened a window');
}

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  let win;
  try {
    win = desktopMode ? await windowForApp() : await windowForArtifact();
  } catch (err) {
    process.stderr.write(`smoke: ${err.message}\n`);
    app.exit(1);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const r = await win.webContents.executeJavaScript(`(${probe.toString()})()`);

  const checks = [
    [r.title === 'Price Action Mark', `title is ${JSON.stringify(r.title)}`],
    [r.canvases > 0, 'the chart drew no canvas'],
    [looksLikePrice(r.last), `the quote reads ${JSON.stringify(r.last)}`],
    [/\d{4}/.test(r.readout ?? ''), `the readout reads ${JSON.stringify(r.readout)}`],
    [r.rows > 0, 'the data table is empty'],
    [looksLikePrice(r.ema), `the EMA 20 readout reads ${JSON.stringify(r.ema)}`],
    [r.theme === 'light' || r.theme === 'dark', `data-theme is ${JSON.stringify(r.theme)}`],
    [r.fonts >= 2, `only ${r.fonts} bundled font face(s) loaded`],
    [errors.length === 0, `console errors: ${errors.join(' | ')}`],
    // Target-specific: the bridge must exist in one and be absent in the other.
    [r.bridged === desktopMode, desktopMode ? 'window.desktop is missing' : 'the artifact should have no bridge'],
    [!desktopMode || /Electron \d/.test(r.footer ?? ''), 'the footer never received app info over IPC'],
  ];

  const failures = checks.filter(([ok]) => !ok).map(([, why]) => why);

  process.stdout.write(
    `smoke ${desktopMode ? 'desktop app' : path.basename(target)}: ` +
      `${r.canvases} canvas, last ${r.last}, ${r.rows} table rows, ` +
      `theme ${r.theme}, ${r.fonts} font faces, bridge ${r.bridged}, origin ${r.origin ?? "?"}, ema ${r.ema}\n`,
  );

  if (failures.length > 0) {
    for (const why of failures) process.stderr.write(`  FAIL ${why}\n`);
    app.exit(1);
    return;
  }
  process.stdout.write('smoke: ok\n');
  app.exit(0);
});
