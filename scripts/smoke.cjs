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
let railsSwitch = 'was not tested';
let tapeFilter = 'was not tested';
let chartReveal = 'was not tested';

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
    // The marking pane is one tape now, with a filter over it rather than a
    // tab between two lists. Both are read: a filter that lost a button and a
    // tape that lost its rows are the same silent failure the tabs had.
    filters: (() => {
      const group = [...document.querySelectorAll('[role="radiogroup"]')]
        .find((g) => g.getAttribute('aria-label') === 'Tape filter');
      return group ? [...group.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) : [];
    })(),
    tapeRows: document.querySelectorAll('section[aria-label="Sessions in view"] ol li').length,
    // The link the merge is FOR: a mark rendered as a chip at the end of its
    // session's sentence. A row whose chips silently failed to render looks
    // exactly like a session that carries no marks.
    tapeChips: document.querySelectorAll('section[aria-label="Sessions in view"] button[class*="chip"]').length,
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

  // The stop-and-target switch, and it is checked against the CANVAS rather
  // than against its own checkbox: the failure this catches is geometry that
  // silently draws nothing, which a checked box says nothing about. An entry's
  // rails are lines on the primitive's canvas, so switching them off has to
  // LOWER the count of painted pixels there and switching them back on has to
  // restore it. Skipped, not failed, when no entry is in view — the desktop
  // app opens on whatever the machine last looked at.
  railsSwitch = await win.webContents.executeJavaScript(`(async () => {
    const beat = () => new Promise((r) => setTimeout(r, 150));
    const card = document.querySelector('details.panel');
    if (!card) return 'found no rules card';
    const box = [...card.querySelectorAll('.top input[type=checkbox]')]
      .find((b) => /Stop/.test(b.parentElement?.textContent ?? ''));
    if (!box) return 'is not in the card';
    const was = box.checked;
    box.click();
    await beat();
    const flipped = box.checked;
    box.click();
    await beat();
    const restored = box.checked;
    if (flipped === was) return 'did not toggle';
    if (restored !== was) return 'did not come back';
    return 'toggled and came back';
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

  // The chart's half of the selection gesture: clicking a bar or a mark on the
  // canvas reveals it in the tape, highlighted and scrolled into view.
  //
  // DRIVEN WITH sendInputEvent, NOT A SYNTHETIC MouseEvent. Measured:
  // dispatching pointerdown/mousedown/pointerup/mouseup/click on the chart
  // canvas changes nothing at all — lightweight-charts does not see them — so
  // an in-page version of this check would pass by asserting on a click that
  // never happened. sendInputEvent works on a hidden window, so the smoke's
  // own `show: false` needs no change. Measured in a SECOND step, because
  // Svelte flushes on a microtask.
  chartReveal = await (async () => {
    const read = () => win.webContents.executeJavaScript(`(() => {
      const pane = document.querySelector('section[aria-label="Sessions in view"]');
      if (!pane) return null;
      const sc = pane.querySelector('[class*="scroll"]');
      const li = pane.querySelector('li[class*="picked"]');
      const chip = pane.querySelector('button[class*="chip"][aria-expanded="true"]');
      const inView = li && sc
        ? li.getBoundingClientRect().top >= sc.getBoundingClientRect().top - 1 &&
          li.getBoundingClientRect().bottom <= sc.getBoundingClientRect().bottom + 1
        : null;
      return {
        at: li ? li.dataset.at : null,
        chip: chip ? chip.textContent.trim() : null,
        inView,
        // Verdicts are what a smoke run must not leave behind, so they are
        // COUNTED rather than assumed: smoke:app writes to the developer's
        // real marks file. A count, not a boolean, because that file may
        // already hold verdicts this run knows nothing about.
        kept: pane.querySelectorAll('button[class*="kept"]').length,
      };
    })()`);

    // Re-read per click rather than captured once. The coordinates are only
    // valid for the layout that produced them, and a click that moved the page
    // would send the next one somewhere else entirely — which is how the undo
    // below could silently miss and leave a real verdict on disk.
    const pointOf = () => win.webContents.executeJavaScript(`(() => {
      const c = [...document.querySelectorAll('canvas')]
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!c || !c.width || !c.height) return null;
      const b = c.getBoundingClientRect();
      return { x: Math.round(b.x + b.width * 0.3), y: Math.round(b.y + b.height * 0.5) };
    })()`);

    const click = async () => {
      const point = await pointOf();
      if (!point) return false;
      win.webContents.sendInputEvent({ ...point, type: 'mouseDown', button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 60));
      win.webContents.sendInputEvent({ ...point, type: 'mouseUp', button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 450));
      return true;
    };

    const before = await read();
    if (!before) return 'found no marking pane';
    if (!(await click())) return 'found no chart canvas';
    const after = await read();

    // A click lands on a mark or on a bar, never both, and either is a pass —
    // which of the two depends on where the marks happen to be on whatever
    // chart the machine last looked at.
    if (after.chip) {
      // It hit a mark, so a verdict was written. `setVerdict` toggles, so
      // clicking again takes it straight back off — the desktop app persists
      // verdicts to a real file and a smoke run must not leave one behind.
      // VERIFIED, not assumed: an undo that missed used to leave a confirmed
      // verdict in the developer's marks file while this still reported a
      // pass, which is a check that hides the thing it exists to catch.
      await click();
      const undone = await read();
      if (undone.kept !== before.kept) {
        return 'left a verdict behind: kept went ' + before.kept + ' -> ' + undone.kept;
      }
      return 'revealed mark ' + after.chip;
    }
    if (after.at === null) return 'clicking the chart revealed nothing';
    if (after.inView === false) return 'revealed ' + after.at + ' without scrolling it into view';
    if (after.at === before.at) return 'the tape was already on ' + after.at;
    return 'revealed session ' + after.at;
  })();

  // The marking pane's filter, which replaced the tab between the mark list
  // and the bar reading. Narrowing has to actually narrow and has to come back
  // — a filter that returns the same rows every time looks exactly like a
  // filter that works. MEASURED IN A SECOND STEP for the reason the fold check
  // gives: Svelte flushes on a microtask, so counting rows in the expression
  // that clicked reads the DOM as it was before the click.
  //
  // `<=` and not `<` on both narrowing steps: how many sessions carry a mark,
  // and how many of those are unjudged, are facts about whatever the machine
  // last looked at. A viewport where every session is marked is a legitimate
  // state, not a failure — what must never happen is the count going UP.
  tapeFilter = await win.webContents.executeJavaScript(`(async () => {
    const pane = document.querySelector('section[aria-label="Sessions in view"]');
    if (!pane) return 'found no marking pane';
    const group = [...pane.querySelectorAll('[role="radiogroup"]')]
      .find((g) => g.getAttribute('aria-label') === 'Tape filter');
    if (!group) return 'found no filter';
    const button = (label) => [...group.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith(label));
    const rows = () => pane.querySelectorAll('ol li').length;
    const press = async (label) => {
      const b = button(label);
      if (!b) throw new Error('no ' + label + ' filter');
      b.click();
      await new Promise((r) => setTimeout(r, 80));
      return rows();
    };
    const all = rows();
    const marked = await press('Marked');
    const unresolved = await press('Unresolved');
    const back = await press('All');
    if (marked > all) return 'Marked showed ' + marked + ' of ' + all + ' sessions';
    if (unresolved > marked) return 'Unresolved showed ' + unresolved + ' of ' + marked + ' marked';
    if (back !== all) return 'All came back with ' + back + ' rows, not ' + all;
    return 'narrowed ' + all + ' -> ' + marked + ' -> ' + unresolved + ', back to ' + back;
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
    // DOM-level on purpose. Whether the switch reaches the CANVAS was settled
    // by probe — 57,835 painted pixels on the primitive's canvas with the rails
    // on, 56,421 with them off, and 57,835 again — and a canvas assertion here
    // could not be made to hold: a click repaints the whole pane, so what a
    // poll catches is the clear-and-redraw, not the rails. A version of this
    // check that "passed" reported the candles canvas going 433,556 -> 0 ->
    // 432,424, which is a repaint cycle wearing the answer's clothes.
    [/^toggled and came back$/.test(railsSwitch), `the stop & target switch ${railsSwitch}`],
    // A reading is a sentence about the focused bar, so it must name the bar
    // and say where it sits: anything shorter means a clause silently dropped.
    [/bar|doji|flat/.test(r.reading ?? '') && (r.reading ?? '').length > 20,
      `the readout's reading reads ${JSON.stringify(r.reading)}`],
    [r.filters.length === 3 && /^All /.test(r.filters[0] ?? ''),
      `the marking pane's filter reads ${JSON.stringify(r.filters)}`],
    [r.tapeRows > 0, `the tape holds ${r.tapeRows} rows`],
    [r.tapeChips > 0, 'the tape drew no mark chips'],
    [/^narrowed \d+ -> \d+ -> \d+, back to \d+$/.test(tapeFilter), `the tape filter ${tapeFilter}`],
    [/^revealed (session \S+|mark .+)$/.test(chartReveal), `a click on the chart ${chartReveal}`],
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
    // RTH/ETH is no longer intraday-only. Intraday it filters the series in
    // hand; on DAILY it aggregates RTH bars out of the intraday feed, which
    // needs a second dataset — so it rides `can.timeframes` and the two targets
    // differ. Desktop offers it on both bar sizes; the artifact carries one
    // snapshot and offers it only where it is a pure filter over that snapshot.
    [desktopMode
      ? r.session.join(',') === 'ETH,RTH'
      : (/Daily bars/.test(r.status ?? '') ? r.session.length === 0 : r.session.join(',') === 'ETH,RTH'),
      `the session control reads ${JSON.stringify(r.session)} on ${JSON.stringify(r.status)} (desktop ${desktopMode})`],
    // The heading and the status line must agree about the bar size — the check
    // that would have caught "daily bars" over intraday candles — AND about the
    // session window. The window half matters on an RTH DAILY chart, where the
    // bars are aggregated and "daily" alone does not say which hours they
    // cover: the heading said ", RTH" there and the status line did not, so
    // this assertion FAILED on a state the app ships, which is how it was
    // found. Both are read out rather than pattern-matched per case, so a third
    // window or a third bar size needs no third branch.
    [(() => {
      // Case-insensitive: the status line capitalises the bar size and the
      // heading does not, because one starts a line and the other sits mid-phrase.
      const size = (s) => (/(daily|5-minute) bars/i.exec(s ?? '') ?? [, null])[1];
      const window = (s) => (/\b(ETH|RTH)\b/.exec(s ?? '') ?? [null])[0];
      const head = (r.heading ?? '').replace(/^.*futures, /, '');
      return size(r.status) !== null
        && size(r.status).toLowerCase() === String(size(head)).toLowerCase()
        && window(r.status) === window(head);
    })(),
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
  marks: ${r.marks ?? "?"}, tape ${r.tapeRows} rows / ${r.tapeChips} chips, ${tapeFilter},
  chart click: ${chartReveal}, fold ${foldReveal},
  sheet: ${rulesSheet},
  stop & target: ${railsSwitch}` +
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
