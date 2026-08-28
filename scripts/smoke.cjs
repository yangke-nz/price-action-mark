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
let verdictRoundTrip = 'was not tested';
let foldReveal = 'was not tested';
let rulesSheet = 'was not tested';

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
    marks: document.querySelectorAll('details.panel')[0]?.querySelector('[class*="count"]')?.textContent?.trim() ?? null,
    notice: document.querySelector('[class*="notice"]')?.textContent?.trim() ?? null,
    // The bar reading, on both surfaces: the line under the readout figures,
    // and the pane's second tab. Both are prose the rest of the smoke cannot
    // see — an empty reading renders as an empty element, not as an error.
    reading: text('[class*="readout"] p'),
    // The bar size control, and the range presets it decides. Not the switch
    // itself: that needs a second network pull, and a render check should not
    // depend on two. A probe covers the switch.
    status: text('[class*="gran"]'),
    timeframes: (() => {
      const seg = [...document.querySelectorAll('[class*="seg"]')]
        .find((g) => g.getAttribute('aria-label') === 'Bar size');
      return seg ? [...seg.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    })(),
    ranges: (() => {
      const seg = [...document.querySelectorAll('[class*="seg"]')]
        .find((g) => g.getAttribute('aria-label') === 'Date range');
      return seg ? [...seg.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    })(),
    // The masthead names the SUBJECT, bar size included. It said "daily bars"
    // over five-minute candles until the switch existed, and a heading is the
    // one thing on the page nobody re-reads.
    heading: text('h1'),
    session: (() => {
      const seg = [...document.querySelectorAll('[class*="seg"]')]
        .find((g) => g.getAttribute('aria-label') === 'Session');
      return seg ? [...seg.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    })(),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
    readingRows: (() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => /Bar reading/.test(t.textContent));
      if (!tab) return -1;
      tab.click();
      return document.querySelectorAll('[id="panel-reading"] button[class*="line"]').length;
    })(),
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
      // main shows its own window on ready-to-show, which on a developer's
      // desktop means the smoke run steals focus and covers whatever they were
      // reading. Transparent rather than hidden: the renderer still lays out,
      // paints and runs every effect, so nothing the smoke asserts changes,
      // and unlike an off-screen position this cannot land on a second monitor.
      win.setOpacity(0);
      win.setSkipTaskbar(true);
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
  // A verdict has to survive a write and a re-read through the real IPC path,
  // which is the only part of persistence that a rendered page cannot show.
  // Written under a reserved id so it can never collide with a real mark, and
  // removed again so a smoke run does not leave state on the machine.
  if (desktopMode) {
    verdictRoundTrip = await win.webContents.executeJavaScript(`(async () => {
      const id = 'smoke:verdict-round-trip';
      const before = await window.desktop.getMarks('ES=F');
      await window.desktop.saveMarks({ ...before, verdicts: { ...before.verdicts, [id]: 'confirmed' } });
      const after = await window.desktop.getMarks('ES=F');
      const ok = after.verdicts[id] === 'confirmed';
      await window.desktop.saveMarks(before);
      const cleaned = await window.desktop.getMarks('ES=F');
      if (!ok) return 'did not come back';
      return cleaned.verdicts[id] === undefined ? 'survived' : 'could not be removed again';
    })()`);
  }

  // The rules card folds its less-used rules away, and that is presentation,
  // so it applies to both targets: the card must list fewer rules than the
  // registry holds and a chip must reveal the rest. A fold that silently
  // reveals nothing looks exactly like a short list. The click is MEASURED IN
  // A SECOND STEP because Svelte flushes on a microtask — counting rows in the
  // same expression reads the DOM as it was before the click, which reports
  // every fold as broken.
  foldReveal = await win.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('details.panel');
    if (!card) return 'found no rules card';
    const rows = () => card.querySelectorAll('label[class*="rule"]').length;
    const chip = card.querySelector('h3 button[aria-expanded]');
    if (!chip) return 'found no fold';
    const before = rows();
    chip.click();
    await new Promise((r) => setTimeout(r, 80));
    const opened = rows();
    chip.click();
    await new Promise((r) => setTimeout(r, 80));
    const closed = rows();
    if (opened <= before) return 'revealed nothing';
    if (closed !== before) return 'did not fold away again';
    return 'revealed ' + (opened - before) + ' of ' + opened;
  })()`);

  // The rules sheet, driven through its real path: the card's own door, a
  // fold taken back, the card's list following it, and the dialog closing.
  // Every measurement is a SEPARATE await — Svelte flushes on a microtask, so
  // clicking and counting in one expression reads the DOM as it was before.
  //
  // Deliberately UNFOLDS an already-folded rule rather than folding a fresh
  // one: by default every rule that is off is already folded, and unfolding
  // touches only `marks.folded`, which the run then puts back.
  rulesSheet = await win.webContents.executeJavaScript(`(async () => {
    const beat = () => new Promise((r) => setTimeout(r, 150));
    const card = document.querySelector('details.panel');
    const rows = () => card.querySelectorAll('label[class*="rule"]').length;
    const find = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));

    const door = find(card, /Choose rules/);
    if (!door) return 'has no door in the card';
    door.click();
    await beat();

    const sheet = document.querySelector('dialog[class*="sheet"]');
    if (!sheet) return 'is not mounted';
    if (!sheet.open) return 'did not open';
    if (sheet.querySelectorAll('tbody tr').length < 31) return 'listed only ' + sheet.querySelectorAll('tbody tr').length + ' rows';

    const before = rows();
    const box = [...sheet.querySelectorAll('input[type=checkbox][aria-label^="Fold"]')]
      .find((b) => !b.disabled && b.checked);
    if (!box) return 'offered no folded rule to bring back';
    box.click();
    await beat();
    const after = rows();

    const drop = find(sheet, /Drop my changes/);
    if (!drop) return 'never offered to drop the change';
    drop.click();
    await beat();
    const restored = rows();

    find(sheet, /^\s*Done\s*$/).click();
    await beat();

    if (after !== before + 1) return 'unfolding a rule took the card from ' + before + ' to ' + after;
    if (restored !== before) return 'dropping the change left ' + restored + ' rules, not ' + before;
    if (sheet.open) return 'would not close';
    return 'listed ' + before + ', unfolded to ' + after + ', restored and closed';
  })()`);

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
    [/\d+ marks? from \d+ rules?/.test(r.marks ?? ''), `the mark panel reads ${JSON.stringify(r.marks)}`],
    [/^revealed \d+ of \d+$/.test(foldReveal), `the rules card's fold ${foldReveal}`],
    [/^listed \d+, unfolded to \d+, restored and closed$/.test(rulesSheet), `the rules sheet ${rulesSheet}`],
    // A reading is a sentence about the focused bar, so it must name the bar
    // and say where it sits: anything shorter means a clause silently dropped.
    [/bar|doji|flat/.test(r.reading ?? '') && (r.reading ?? '').length > 20,
      `the readout's reading reads ${JSON.stringify(r.reading)}`],
    [r.tabs.length === 2 && /Marks in view/.test(r.tabs[0] ?? ''),
      `the marking pane's tabs read ${JSON.stringify(r.tabs)}`],
    [r.readingRows > 0, `the bar reading tab holds ${r.readingRows} rows`],
    // The status line names the bar size, and said "Daily bars" on a 5-minute
    // chart until it was told to ask.
    [/^(Daily|5-minute) bars · /.test(r.status ?? ''), `the status line reads ${JSON.stringify(r.status)}`],
    // The timeframe control is desktop-only: the artifact carries one snapshot
    // and IS whatever bar size it holds, with no second one to switch to.
    [desktopMode
      ? r.timeframes.join(',') === '1D,5m'
      : r.timeframes.length === 0,
      `the bar size control reads ${JSON.stringify(r.timeframes)}`],
    // Presets follow the interval, so a daily chart must not offer 3D and an
    // intraday one must not offer 5Y.
    [r.ranges.includes('MAX') && !(r.ranges.includes('5Y') && r.ranges.includes('3D')),
      `the range presets read ${JSON.stringify(r.ranges)}`],
    // RTH/ETH is intraday-only: a daily bar IS a whole session, so on a daily
    // chart the control must be absent rather than present and inert. Both
    // targets are built from a daily snapshot, so both are checked the same way.
    [/Daily bars/.test(r.status ?? '') ? r.session.length === 0 : r.session.join(',') === 'ETH,RTH',
      `the session control reads ${JSON.stringify(r.session)} on ${JSON.stringify(r.status)}`],
    // The heading and the status line must agree about the bar size, which is
    // the check that would have caught "daily bars" over intraday candles.
    [/Daily bars/.test(r.status ?? '')
      ? /daily bars$/.test(r.heading ?? '')
      : /5-minute bars, (ETH|RTH)$/.test(r.heading ?? ''),
      `the heading reads ${JSON.stringify(r.heading)} beside ${JSON.stringify(r.status)}`],
    // Errors the app reports to the reader rather than to the console — a
    // failed IPC call surfaces here and nowhere else.
    [r.notice === null, `the page is showing a notice: ${JSON.stringify(r.notice)}`],
    [!desktopMode || verdictRoundTrip === 'survived', `a saved verdict ${verdictRoundTrip}`],
  ];

  const failures = checks.filter(([ok]) => !ok).map(([, why]) => why);

  process.stdout.write(
    `smoke ${desktopMode ? 'desktop app' : path.basename(target)}: ` +
      `${r.canvases} canvas, last ${r.last}, ${r.rows} table rows, ` +
      `theme ${r.theme}, ${r.fonts} font faces, bridge ${r.bridged}, origin ${r.origin ?? "?"}, ema ${r.ema},\n` +
      `  ${r.status ?? "?"}` +
      (r.timeframes.length ? `, timeframes ${r.timeframes.join("/")}` : ', no timeframe control') +
      `
  marks: ${r.marks ?? "?"}, ${r.readingRows} readings, fold ${foldReveal},
  sheet: ${rulesSheet}` +
      (desktopMode ? `, verdict round trip ${verdictRoundTrip}\n` : `\n`),
  );

  if (failures.length > 0) {
    for (const why of failures) process.stderr.write(`  FAIL ${why}\n`);
    app.exit(1);
    return;
  }
  process.stdout.write('smoke: ok\n');
  app.exit(0);
});
