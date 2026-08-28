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
                       #   publish flow: mark up, File > Export marks…,
                       #   save over data/marks.json, then run this
npm run build          # typecheck, then main + preload + renderer -> out/
npm run pack           # unpacked app -> release/   (dist = installer)
npm run typecheck      # tsc over node side, svelte-check over the renderer
npm run marks          # metric columns for any span; --check runs invariants
                       #   --rules / --catalogue / --trades for the marking layer
                       #   --structure adds pivots/trend/pullback, --tune sweeps
                       #   --rules / --catalogue / --trades, --golden rewrites the fixture
npm run marks:check    # the marking layer's regression guard; fails on drift
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
- **`Dataset.rolls` holds the EXPIRIES, not the discontinuities — they differ by
  one bar.** A roll index is the first session on/after the third Friday, which
  on 101 of 104 quarters *is* the expiry: the old contract's last session. The
  carry is the session after it — 2024-12-20 settles at 5840.26 and 2024-12-23
  opens at 6001.75. On the 3 quarters where that Friday was a holiday the index
  has already stepped past it and is itself the new contract's first session.
  Anything that means "where the carry is" — the chart arrow, the `ROLL` badge,
  the CSV `roll` column, ATR, `gap` — derives it with **`contractStarts()`**
  ([rolls.ts](src/shared/rolls.ts)). Getting this off by one flags a real move as
  carry and stays silent on the carry; it was wrong in v2.0.0 and is fixed.
  Measured: 34 of the 37 boundary jumps above 1% fall on the bar *after* the roll
  index, and all 3 that fall on it are exactly those holiday quarters.
- **Ten sessions print a close outside their own high/low.** Eight are quarterly
  expiries carrying the final settlement price — they are the only closes in the
  series off the 0.25 tick grid — and 2002-01-31 (by 0.5) and 2008-03-18 (by 40)
  are plain dirt. Untreated they push `closePos` past 1 and would fire `shaved`
  and `reversal-bar` on a bad print. `metrics()` widens the extremes to enclose
  open and close and flags them in `suspect`; **rules read `m.high` / `m.low`,
  never `data.h` / `data.l`**, so the correction cannot be skipped.
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
scripts/mark-report.ts         the text oracle for the marking rules

src/shared/                    imported by main, renderer AND the CLI scripts
  yahoo.ts                       fetch + normalise; the only network code
  rolls.ts                       expiry arithmetic + contractStarts()
  indicators.ts                  ema(), atr(), trueRange(); pure series maths
  marks/metrics.ts               per-bar columns every marking rule reads
  marks/structure.ts             pivots, legs, always-in state, H/L counts
  marks/types.ts                 the Mark union - the serialised shape
  marks/rule.ts                  Ctx + Rule; the usable/comparable guards
  marks/registry.ts              RULES - the one array; push to extend
  marks/rules/bars.ts            the 15 special-bar rules
  marks/rules/lines.ts           channels, spike-and-channel, doubles, wedges, triangles
  marks/fit.ts                   fitLine + touch/break measurement
  marks/rules/entries.ts         pullbacks, pattern entries, breakout fades
  marks/trade.ts                 entry/stop/target + the walk-forward
  instrument.ts                  per-symbol tick size
  types.ts  ipc.ts               dataset shape; the whole IPC contract
  format.ts  csv.ts              one set of formatters for axes, readout and CLI

src/main/
  index.ts                       window, CSP, IPC handlers, save dialogs
  marks.ts                       verdicts, one atomic JSON per symbol
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
  lib/chart/marks/               one primitive for all geometry, not one per mark
    primitive.ts                   ISeriesPrimitive; autoscaleInfo() -> null
    draw.ts                        marks -> polylines -> canvas; hit test shares them
    palette.ts                     tone -> token; caution is dashed, not a 4th hue
  lib/components/                Masthead, Controls, Readout, ChartPanel, …
    MarkPanel.svelte               rule toggles, counts, the publish switch
    MarkList.svelte                what is marked in view; keep / drop
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

A quirk worth knowing before you chase it: the chart does **not** restore a
pixel-identical frame across a range round trip (6M to 3M and back), with or
without marks — most likely the post-font-load `remeasure` shifting the axis
gutter. Compare screenshots at ONE chart state, never across a range change, or
you will attribute that to whatever you are testing.

**Make the probe window invisible with `win.setOpacity(0)`, not by moving it
off-screen.** A shown window steals focus and covers whatever the developer was
reading, and a negative x lands on their second monitor rather than nowhere.
Opacity 0 still lays out, paints, runs every effect and captures at full
fidelity — verified — so nothing a probe can observe changes. Add
`win.setSkipTaskbar(true)` too. `smoke.cjs` does both in `windowForApp()`, since
that path boots the real main and inherits its `ready-to-show` reveal.

**Tune a detector against `npm run marks`, never against the canvas.** A rule
that is subtly too loose looks, on a chart, exactly like a rule that is working.
`--catalogue` prints the hit rate per rule (the density check), `--trades` prints
every entry with its walk-forward outcome, and `--tune` sweeps the structure dials.

**Pick the patterns by eye BEFORE writing the rule that finds them.** It is the
only way a detector is tested against something other than itself. The eight
in `data/marks-golden.json` were read off the 2025 pivot list by hand, and seven
matched the rule's own arithmetic exactly once it existed.

**`npm run marks:check` is the regression guard.** It holds per-rule mark counts,
those hand-picked dates, and the STRUCTURE DIALS, and `--golden` rewrites it —
deliberately a separate command, so drift has to be accepted on purpose. The
dials are recorded separately because every rule reads the same pivots: move
`DEFAULT_STRENGTH` and all 31 counts shift at once, so the check reports
*"structure dials moved: fixture is strength 3 / 1 ATR (965 pivots), this run is
4 / 1 (776)"* and stops, rather than 31 failures with one cause. Counts are compared
only when the dataset fingerprint matches, because `npm run data` legitimately
changes them; the hand-picked dates are history and are checked either way.
Verified to have teeth: loosening `BIG_ATR` from 1.5 to 1.4 reports
*"big-bar: 450 marks in the fixture, 578 now"*, and tightening the double-top
tolerance drops three of the hand-picked patterns.

A probe that clicks the chart must click ONE mark and stop. A channel spans
many x positions, so sweeping across it re-toggles the same verdict and the
result cancels out — which reads exactly like the feature not working. Also:
never return a `hoveredInfo` across `executeJavaScript`; it holds a live
`ISeriesApi` and the non-cloneable result hangs the call.

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

## Marking

- **Structure is built in ONE forward pass, consuming pivots as they confirm.**
  The alternation reduction is streaming, not a global fixed point: doing it
  globally would let a swing in 2012 delete a pivot from 2011, and every `trend`
  value before it would silently become a fact from the future. `--check` proves
  it rather than asserting it — it rebuilds the whole structure from the series
  with its last 500 sessions removed and requires every earlier `trend` and
  `pullback` value to be identical. Currently 0 of 6,050 drift. The positive
  control matters as much as the test: 3,981 non-zero values are compared, and
  a deliberate one-bar misalignment produces 456 differences.
- **`pivots`/`legs` and `trend`/`pullback` can disagree about the recent past,
  and that is correct.** The first pair is the reading as of the last bar; the
  second is the causal per-bar record of what was knowable at the time.
- **Pivot strength 3, min swing 1 ATR — chosen by sweeping, not by taste.**
  `npm run marks -- --tune` prints the grid. Strength 3 gives a pivot every 6.8
  sessions and a median leg of 2.8 ATR over 5 bars, and flips always-in 19 times
  a year. Strength 2 whipsaws twice as often (17.1% of state runs last two bars
  or less, against 9.0%); strength 4's 7-bar legs step over swings worth marking.
  `minSwingAtr` is near-inert above strength 2 and kept for when it is dialled down.
- **Do not re-add a forward-return column to `--tune`.** It was tried and it
  argued the opposite of the truth, convincingly: always-in-SHORT scores the best
  10-session forward return on this series (+0.68% against +0.20% long) because
  short states are drawdowns in a secular-bull index and ES mean-reverts out of
  them. It measures drift, not the detector. `whip%` replaced it.
- **`ChartPanel`'s creation effect must seed every piece of chart state.** `chart`
  is a plain `let`, not `$state`, so an effect that runs before the instance is
  assigned does nothing *and never runs again* — the value it subscribed to does
  not change afterwards. This is a race, not a determinism: three consecutive
  runs applied the marks and the fourth silently did not. Anything the standalone
  effects maintain gets an `instance.x(untrack(() => …))` line in the creation
  effect too. Related: `chart?.method(app.thing)` never even subscribes when
  `chart` is undefined, because optional chaining skips argument evaluation —
  read the reactive value into a local first.
- **The mark primitive draws at `zOrder: 'top'`.** Anything lower and marks
  disappear behind every candle body that overlaps them — an annotation under
  the data it annotates is invisible exactly where it matters most.
- **`paneViews()` must return the SAME ARRAY every call.** The library caches
  pane views on array identity and the typings say so; rebuilding the array each
  frame defeats the cache. `MarkPrimitive` freezes one at construction.
- **`autoscaleInfo()` returns null, always.** A channel projected past the last
  bar, or a stop below the visible low, would otherwise drag the price scale to
  fit an annotation. Tested the only way that is decisive: a segment placed at
  3x the visible price must leave the canvas PIXEL-IDENTICAL to no marks at all.
- **Geometry is computed once and consumed by both the renderer and the hit
  test.** `shapeOf` is pure and returns polylines in CSS pixels; `paint` strokes
  them and `distanceTo` measures against them. A second opinion about where a
  line is would drift from the first the day a projection changed.
- **Rule output is recomputed, never stored.** `detect()` runs every rule once
  per dataset (34 ms over 6,550 bars) and toggling a rule filters the result
  (0.26 ms). Re-detecting per toggle would make a checkbox 130x more expensive.
- **Clicking a mark on the chart toggles Keep.** `subscribeClick` reports
  `hoveredInfo.objectId` (`hoveredObjectId` is deprecated), and `CandleChart`
  checks it against the ids it was given rather than trusting it — markers and
  primitives share that channel. There is no second gesture: the library's click
  event carries no modifier keys, so Drop stays in the mark list.
- **Bar labels need ~24px a bar, not 8.** Three-character labels at 11px mono are
  ~20px wide, so below that adjacent bars' labels overlap into garbage. They
  therefore only appear at 1M, and the readout says *"zoom in for bar marks"*
  everywhere else. Marks stacked on ONE bar are fine — the library offsets those.
- **Density is the design constraint.** `npm run marks -- --catalogue` prints the
  hit rate per rule. The defaults are budgeted to ~0.28 marks per session; a rule
  firing on 10%+ of bars ships `defaultOn: false` (`trend-bar` alone is 34.5%).
  When a rule looks too eager, tighten the rule before hiding it: `reversal-bar`
  went 22% -> 5.2% by requiring it to actually reverse a 10-session extreme.
- **Snapshot anything crossing the preload bridge: `$state.snapshot(x)`.** A
  rune-backed value is a PROXY and a proxy cannot be structured-cloned, so
  `ipcRenderer.invoke` rejects it with *"An object could not be cloned"*. This
  broke **Export CSV and Export JSON in v2.0.0** and nobody noticed, because the
  failure surfaced only as an on-page notice that nothing asserted on; the mark
  verdicts then shipped with the same fault, and the phase-08 smoke missed it by
  calling `window.desktop.saveMarks()` with a hand-made plain object instead of
  the app's own state. Smoke now fails on any notice being present, and
  `#persistMarks` reports the error rather than swallowing it — a catch that
  hides a programming error is how this survived a whole phase.
- **Mark ids must be unique, and a rule can break that without trying.** Two
  breakouts on consecutive sessions find the SAME first pullback, so
  `bo-pullback` emitted two marks carrying one id: two identical rows, one
  verdict covering both, and a keyed `{#each}` that throws outright. It survived
  smoke only because the duplicates fell outside the viewport. Both rules now
  claim their signal bar, `detect()` dedupes as a backstop, and `--check`
  asserts uniqueness PER RULE — checking `detect()`'s output would only prove
  the backstop works.
- **A pattern has ONE definition, and rules that need it import it.**
  `breakoutIndices` lives in `rules/bars.ts`; `findDoubles` and `findWedges` in
  `rules/lines.ts`; the entry rules import all three. An entry rule with its own
  idea of "what is a double bottom" drifts from the shape rule the first time a
  tolerance moves, and the chart then draws one thing and trades another. If you
  add an entry that consumes a shape, export the finder — do not re-derive it,
  and do not re-parse the shape rule's marks either, which couples them through
  their output format instead of their meaning.
- **A ballooning H4 bucket means the pullback counter is not resetting.**
  `--catalogue` shows it: the count has to reset at every new swing extreme, not
  only on an attempt bar, or it runs away through a grinding trend and everything
  piles into the cap. The healthy shape is a geometric decay, currently
  529 / 167 / 70 / 66.
- **A spike is judged as a RUN, not bar by bar.** Requiring every bar in it to
  clear the trend-bar body threshold is a stricter reading than Brooks means and
  finds five in 26 years. `spike-and-channel` takes consecutive same-direction
  bars and tests the run's total travel (1.5 ATR) and AVERAGE body (0.5), which
  lands at 2.4 a year.
- **`final-flag` cannot know it is final, and says so.** Brooks names it for
  what it turns out to be. The rule detects the causal half — a tight flag late
  in a trend (20+ bars in) whose breakout closes back inside within two sessions
  — and leaves "was it the last one" to the outcome column. It is the best of
  the non-measured-move entries at +0.46R.
- **A sliding pivot window emits the same shape several times.** Wedge and
  triangle scan five pivots at a time, so a genuinely coiling stretch satisfies
  the predicate at four consecutive positions. Both keep a claimed-range list
  and skip overlaps; channels do the same, longest run first. Without it the
  count roughly doubles and the chart wears four copies of one triangle.
- **The walk-forward is scored against the trader, deliberately.** A bar
  containing both the stop and the target is a loss — daily OHLC cannot say
  which came first, and assuming the good one is how a backtest talks itself
  into an edge; `ambiguous` counts them so the number stays auditable. A bar
  that gapped through the entry fills at the OPEN, not the order price. And the
  entry order is live for exactly one bar: leaving it working turns every failed
  setup into a different, later trade nobody took.
- **Measured `--trades` over 3,000 sessions: the mechanical 2R target loses.**
  `second-entry` fills 75/75 and wins 28%, which at 2R is -0.085R a trade; a 2R
  exit needs better than 33%. The measured-move rules are the positive ones
  (`dt-short` +1.65R average, `db-long` +1.10R) because their targets are the
  pattern's own projection. **Do not tune `DEFAULT_TARGET_R` until the table
  looks better** — that is curve-fitting a review tool. The number is a finding
  about these setups on daily ES, and it is supposed to be visible.
- **Two rules can contradict on the same bar, and that is not a bug.**
  `failed-bo` and `bo-pullback` fired opposite directions on 2026-07-30: one
  reads the breakout as real, the other as failed. The outcome column
  adjudicates; the tool shows both readings rather than picking one.
- **A trendline break is measured on the CLOSE, not the extreme.** A wick
  through a trendline is what trendlines are for; counting those as breaks
  rejects every real channel on the chart.
- **`settings.marks.rules` is sparse on purpose.** It stores only the ids the
  reader moved off the rule's own `defaultOn`. Persisting all fifteen booleans
  would freeze today's defaults into every settings file, so a later tightening
  would never reach anyone who had already run the app.
- **`marks.show` is sparse for the same reason, and it bit twice.** Publishing
  verdicts is what puts an artifact into confirmed-only mode, so a stored
  `show` has to mean "the viewer chose this", never "this was the default when
  they first loaded". Writing it unconditionally froze `all` into storage the
  first time anyone touched the theme; and `readStored`'s early return for an
  empty key handed a first-time viewer `DEFAULT_SETTINGS`, so they saw every
  candidate instead of the author's marks — the one case the publish path
  exists for.
- **There is no `markSets` capability, deliberately.** Both targets persist
  verdicts (desktop to a per-symbol file, artifact to localStorage over the
  inlined set) and the only difference is writing them out for publishing,
  which `can.export` already covers. A second flag meaning the same thing as an
  existing one is worse than no flag.
- **Tick size comes from `instrument.ts`, not from `Dataset`.** A per-symbol
  table with a 0.25 fallback; dated contracts resolve to their root, so
  `ESZ26.CME` is an `ES` tick. Adding a `tick` field to `Dataset` instead would
  invalidate every cached dataset and the committed snapshot, and `isDataset()`
  would have to keep accepting the old shape anyway. `candles.ts` reads it for
  the price axis too — do not put `minMove: 0.25` back.
- **Verdicts for marks that no longer regenerate are kept, not dropped.** Rule
  thresholds move; a mark that vanishes today comes back when a tolerance is
  loosened. They cost a few bytes and dropping them would silently discard
  decisions the reader made.

## Direction

The name is the brief: **price action chart drawing and marking.** The charting,
data, theming, publishing, packaging and the **marking layer** are done: 23 rules
over three groups (special bars, the lines they form, the entries they set up),
drawn as one canvas primitive, with the reader's keep/drop verdicts persisted
per symbol and publishable into the artifact.

**What is left is DRAWING — marks the reader makes by hand.** Everything that
needs is already in place and was built that way on purpose:

- `Mark` carries `source: 'manual'` and `MarkStore` carries a `manual` array
  that is read on load and never written. Adding hand-drawn marks is therefore
  not a storage-format change, and no file on disk needs migrating.
- `MarkPrimitive.hitTest()` already returns the id of whatever is under the
  cursor, which is the selection half of a drawing tool.
- `shapeOf` is pure and consumed by both the renderer and the hit test, so a
  drag handle placed against one is placed against the other by construction.
- The five geometry kinds (`segment`, `channel`, `level`, `path`, `trade`) draw
  already; a tool only has to produce one, not teach the renderer a new shape.

Two things NOT to do when you build it. Do not add a second canvas over the
chart — attach to the candle series so drawings pan, zoom and hit-test in
price/time for free. Do not persist rule output alongside the manual marks:
it is derived, and storing it is how it goes stale against a refreshed dataset.

