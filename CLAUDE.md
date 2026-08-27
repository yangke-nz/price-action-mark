# Price Action Mark — working notes

Price action charting for daily bars. **One Svelte 5 codebase, two build targets:**
an Electron 44 desktop app, and a single self-contained HTML file for publishing.
Ships with E-Mini S&P 500 futures (`ES=F`) from Yahoo's keyless v8 endpoint; the
data layer is symbol-generic.

These notes hold what reading the code will *not* tell you. [README.md](README.md)
is the fuller reference — it explains the same decisions with the measurements
behind them. Start here, go there for depth.

---

## Read this before changing dependencies

Two version ceilings are load-bearing. `npm update` or a well-meant "let's get on
the latest" **will break the build**, and the failure is a peer-dependency wall,
not a bug you can patch:

| Package | Pinned at | Why it cannot move |
| --- | --- | --- |
| `vite` | **7.3.6** | `electron-vite@5` peers `^5 \|\| ^6 \|\| ^7`. `vite-plugin-svelte@7` requires Vite **8**. Vite 7 + plugin 6.2 is the only pair satisfying both. Moving to Vite 8 means waiting for `electron-vite@6`. |
| `typescript` | **5.9.3** | `svelte-check@4.7` peers `^5.0.0 \|\| ^6.0.0`. TypeScript 7 (the native Go compiler) is out of range until svelte-check widens it. |

Everything else is current: Electron 44.0.0, Svelte 5.56.10, lightweight-charts
5.2.1, electron-builder 26.15.3.

## Environment

- **Node >= 22.6** — the CLI scripts in `scripts/` are `.ts` and run through
  Node's native type stripping. No `tsx`, no build step, no dependency. This is
  why `tsconfig.node.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions`:
  no enums, no parameter properties, no namespaces, and every relative import
  carries an explicit `.ts` extension.
- **npm 11.16+ does not run dependency install scripts**, and Electron downloads
  its ~120 MB binary from one. A plain `npm install` otherwise leaves you with
  *"Electron failed to install correctly"*. The root package's own lifecycle
  scripts still run, so [scripts/postinstall.ts](scripts/postinstall.ts) invokes
  Electron's installer directly, and only when the binary is absent. If it ever
  fails: `node node_modules/electron/install.js`.
- **`data/` is tracked on purpose.** `.gitignore` covers `node_modules/`, the
  four build outputs and logs — but not `data/`. **`data/es_data.json` must
  travel**: it is the offline seed for the desktop app and the entire dataset for
  the artifact. `data/ES_F_daily.csv` is committed as well, so the export is
  readable from the GitHub UI without cloning; it is generated, so refresh it
  with `npm run csv` rather than editing it.
- **`.gitattributes` pins LF, in the repo *and* in the working tree.** Git for
  Windows sets `core.autocrlf=true` system-wide; without the `eol=lf` rule a
  fresh clone checks out CRLF and every file immediately reads as modified.
  Do not remove it, and do not add a file expecting CRLF.
- **Git may refuse to run here: *"dubious ownership"*.** The working tree is
  owned by the Windows account `yangke` while the shell may run as `keatu`, so
  every git command aborts until
  `git config --global --add safe.directory C:/code/github/price-action-mark`.
  Already applied for `keatu`; a third account, or a fresh profile, hits it again.

## Commands

```bash
npm install            # postinstall fetches the Electron binary
npm run data           # refresh data/es_data.json from Yahoo    (optional)
npm run dev            # desktop app, renderer hot-reloads, main restarts
npm run artifact       # single file -> dist/price_action_mark.html + preview.html
npm run build          # typecheck, then main + preload + renderer -> out/
npm run pack           # unpacked app -> release/   (dist = installer)
npm run typecheck      # tsc over node side, svelte-check over the renderer
npm run smoke          # headless render check of the artifact
npm run smoke:app      # headless render check of the desktop app
```

`npm run typecheck` must be clean before you call anything done — `typecheck:web`
runs with `--threshold warning`, so **warnings fail**. Two justified a11y warnings
on the chart surface are silenced inline with `svelte-ignore` and a reason; do not
add more without one.

---

## The one idea

Everything else follows from this: **the UI is written once, and each build
target declares what it is able to do.**

```
src/renderer/lib/source/
  types.ts        the Source interface + Capabilities
  electron.ts     goes over the preload bridge      (aliased to $source)
  artifact.ts     build-time snapshot + localStorage
```

Each Vite config aliases `$source` to one of the two implementations. The desktop
app can pull live data, save through a native dialog, persist settings and resize
its window; the artifact runs under a CSP with no remote origin and a sandbox that
blocks downloads, so it can do none of those. Components read `source.can.*` and
**do not render a control that would not work**:

```svelte
{#if app.can.refresh}<button …>Refresh</button>{/if}
```

**Never branch on `__TARGET__` outside `lib/source/`.** If a new feature only
works on one target, add a capability flag — do not scatter target checks through
components.

## Invariants

Break one of these and it fails quietly, not loudly.

- **The preload must stay CommonJS with an explicit `.cjs`.** A sandboxed preload
  cannot be an ES module, and `package.json` is `"type": "module"`. The output
  filename is forced in `electron.vite.config.ts`, and `main/index.ts` loads
  `../preload/index.cjs`. Do not "fix" that to `.js`.
- **Theme tokens live in three scopes** in `styles/tokens.css`: bare `:root`, the
  `prefers-color-scheme: dark` media query, *and* `:root[data-theme="dark"]`. Miss
  one and the in-app toggle and the OS setting disagree. Change a colour in all three.
- **The `data-theme` attribute is set in `$effect.pre`, not `$effect`**
  ([App.svelte](src/renderer/App.svelte)). `CandleChart.applyTheme()` calls
  `getComputedStyle` to pick up the new palette, so the attribute must already be
  on `<html>`. Two plain `$effect`s are ordered only by creation order — get it
  wrong and the page turns light while **the chart canvas stays dark permanently**.
  Pre-effects all flush before any user effect; that is the only guarantee that holds.
- **Settings merge field-wise, never `settings = {...settings, ...patch}`**
  ([app.svelte.ts](src/renderer/lib/state/app.svelte.ts) `#merge`). Replacing the
  object invalidates every reader, so toggling one thing re-fires the effect
  watching `settings.range`, which calls `setVisibleRange` and **snaps a panned
  chart back to the preset**.
- **`src/shared/` is imported by main, the renderer AND the CLI scripts.** Keep it
  isomorphic: global `fetch` only, no Node built-ins, no DOM, `import type` for
  types, `.ts` on every relative import.
- **Only the boot refresh broadcasts `dataset:updated`.** A refresh the user asked
  for returns through its own IPC call; pushing that one too would apply the same
  dataset twice and reset the crosshair under them.

## Traps

### Data
- **`range=max` is broken for `ES=F`** — it returns ~266 near-monthly bars.
  `period1=0` returns the full ~6,550. Never send `range`; always explicit epochs.
- **The series is unadjusted front-month, not back-adjusted.** Real price
  discontinuities at quarterly expiries (`2024-12-23` is +2.77%). A return across
  a roll is carry, not a tradable move — and **the EMA runs straight through and
  absorbs it**. The chart marks rolls for exactly this reason.
- **The feed is dirty**: null OHLC on holidays, `volume: 0` sessions, duplicated
  live bars. ~43 dropped per pull. `toRows()` handles it; don't bypass it.

### lightweight-charts v5
- `addSeries(CandlestickSeries, …)` takes the **type object** — v4's
  `addCandlestickSeries()` is gone, as is `series.setMarkers()`
  (now `createSeriesMarkers`).
- **`localization.priceFormatter` is global** and overrides every series. Each
  series carries its own `priceFormat: { type: 'custom', formatter }`.
- **An overlay must share the price scale** (`priceScaleId: 'right'`), or it
  autoscales alone and floats free of the candles.
- **Per-bar colours live on the data points**, not series options — a restyle
  after a theme change needs `setData`, not `applyOptions`.
- **Markers do not thin themselves.** All 104 roll arrows at MAX zoom become a
  picket fence; `#refreshMarkers()` drops them below ~18px separation and the
  readout says so rather than letting them silently vanish.

### Electron / tooling
- **`ELECTRON_RUN_AS_NODE` may be set in your shell.** It makes the Electron
  binary behave as plain Node, so `app` is `undefined` and every Electron script
  dies on `Cannot read properties of undefined`. `scripts/smoke.cjs` detects this
  and re-execs itself once with the variable removed. If you write another
  Electron entry point, copy that guard.
- **`electron <file>` and `electron .` resolve a different app identity.** Given a
  file path, `appPath` is that file's directory — no `package.json` there, so
  `getName()` falls back to `"Electron"`, `getVersion()` returns the *Electron*
  version, and **userData lands in `%APPDATA%/Electron`** instead of
  `%APPDATA%/price-action-mark`. `smoke.cjs` calls `app.setName()` to compensate.
  Do not trust `getVersion()` from a file-path launch; check the packaged build.
- **`asar extract-file <archive> <file> <dest>` ignores `<dest>`** and writes to
  the current working directory. Running it on `package.json` in the project root
  **overwrites your `package.json`** with the trimmed copy from inside the asar —
  scripts and devDependencies gone. Extract into a temp directory. (electron-builder
  itself does not touch the source `package.json`; this was the real culprit once.)
- **Inlining JS into HTML needs two escapes**, both of which appear in minified
  bundles as ordinary string literals — Svelte's runtime carries `"<!---->"`:
  `</script` closes the tag anywhere, and `<!--` puts the tokenizer into
  script-data-escaped state. `inline-artifact.ts` escapes both, then **compiles the
  result with `new Function` (never calling it)** to prove the substitution landed
  inside string literals rather than live code.

## Where things are

```
electron.vite.config.ts        target 1 — main + preload + renderer
vite.artifact.config.ts        target 2 — renderer only, everything inlined
scripts/inline-artifact.ts     target 2, second half — fold into one .html + guards

src/shared/                    imported by main, renderer AND the CLI scripts
  yahoo.ts                       fetch + normalise; the only network code
  rolls.ts                       third-Friday quarterly expiry arithmetic
  indicators.ts                  ema(); pure functions over the close column
  types.ts  ipc.ts               dataset shape; the whole IPC contract
  format.ts  csv.ts              one set of formatters for axes, readout and CLI

src/main/
  index.ts                       window, CSP, IPC handlers, save dialogs
  dataset.ts                     network -> cache -> bundled, in that order
  settings.ts                    atomic JSON in userData, validated field by field
  menu.ts                        native menu; items send Commands to the renderer
  window.ts                      vertical maximize (Electron has no API for it)

src/preload/index.ts           the entire privileged surface, sandboxed CJS

src/renderer/
  App.svelte                     layout, theme wiring, menu-command routing
  lib/source/                    the seam — see "The one idea"
  lib/state/app.svelte.ts        one rune-based store for the window
  lib/chart/candles.ts           every imperative call into lightweight-charts
  lib/components/                Masthead, Controls, Readout, ChartPanel, …
  styles/tokens.css              the palette, in three scopes
```

## Verifying a change

Typecheck is necessary but not sufficient — the failure modes here are visual and
silent. `npm run smoke` / `smoke:app` load the built output in real headless
Chromium and assert: canvas count, a well-formed last price, a dated readout,
populated table rows, a resolved theme, a well-formed EMA value, >=2 loaded font
faces, zero console errors, and that the preload bridge exists in the desktop app
and *not* in the artifact. **`smoke:app` imports the real `out/main/index.js`**, so
the preload and every IPC handler run on their production path.

For anything the smoke cannot see — a resize, a theme repaint, a drawn line —
write a one-off Electron probe under `scripts/_name.cjs`, run it, read the answer,
then delete it. Drive the feature through its real path
(`win.webContents.executeJavaScript('window.desktop.…')`), not by reaching into
the module. `capturePage()` needs `show: true`; it hangs on a hidden window.

**Do not assume persisted state.** Settings and the dataset cache live in
`%APPDATA%/price-action-mark/`, so a probe that expects a default will disagree
with a machine that has run the app. Set the state you are testing explicitly, or
delete that directory first.

## Deliberately absent — do not "fix" these

- **Volume is gone from the chart** (removed on request). The histogram, its pane,
  the toggle, the menu item and the `showVolume` setting are all deleted. Volume
  figures remain in the readout, the data table and the CSV export, because those
  are dataset detail rather than a chart study. Do not reinstate the pane.
- **No symbol picker in the UI.** The data layer is symbol-generic —
  `npm run csv -- --symbol ESZ26.CME` works today — but the app charts whatever
  `data/es_data.json` holds. Adding a picker means an IPC round trip and a cache
  key per symbol; it is a feature, not a gap.
- **No migration from the old `%APPDATA%/es-futures-chart/`.** The project was
  renamed from *E-Mini Daily Tape*; the old userData directory is orphaned and
  holds only a settings file and a dataset cache, both of which regenerate. Safe
  to delete. Do not write migration code for it.
- **The masthead H1 names the instrument, not the product.** *"E-Mini S&P 500
  futures, daily bars"* is the chart's subject; the product name lives in
  `<title>`, the window title and the footer. That is intentional.
- **`--threshold warning` on svelte-check is intentional.** Do not relax it to
  make a warning go away.

## Direction

The name is the brief: **price action chart drawing and marking.** The charting,
data, theming, publishing and packaging are done. **The drawing and marking tools
are not built yet** — that is the next body of work, and the current app is the
canvas it lands on.

When you build them, the things already in place that they should use:

- `CandleChart` ([lib/chart/candles.ts](src/renderer/lib/chart/candles.ts)) owns
  every imperative call into the library and exposes a small method surface.
  Drawing primitives belong behind it, not sprinkled through components.
- lightweight-charts 5.2.1 has a **primitives** API, verified present in
  `dist/typings.d.ts`: `series.attachPrimitive(ISeriesPrimitive)`,
  `pane.attachPrimitive(IPanePrimitive)`, `detachPrimitive`, and
  `addCustomSeries(ICustomSeriesPaneView)`. Attach drawings as primitives on the
  candle series rather than overlaying a second canvas — they then pan, zoom and
  hit-test in price/time coordinates for free. This is the intended path; do not
  hand-roll a canvas on top.
- Persistence already exists: extend `Settings` (or add a sibling store beside it
  in `main/settings.ts`) and the atomic-write helper handles the rest. Drawings
  are per-symbol, so they want their own file, not `settings.json`.
- **The artifact target is the reason to care about serialisation.** A marked-up
  chart that can be published as one self-contained file is the product. Keep
  drawing state in plain JSON that can be inlined at build time, the way the
  dataset is.
- Anything that needs the filesystem, a dialog or the network is **desktop-only** —
  add a capability flag to `Source.can`, do not branch on the target.
