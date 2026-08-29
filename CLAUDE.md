# Price Action Mark — working notes

Price action charting, daily and 5-minute. **One Svelte 5 codebase, two build
targets:**
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
- **Supported platforms: Windows x64 and macOS on APPLE SILICON.** Intel Macs
  are not supported — the mac build is `arch: [arm64]` and arm64-thin, so it
  cannot run on one at all. Linux is in
  [electron-builder.yml](electron-builder.yml) and builds, but nothing
  exercises it; treat it as unexercised rather than as a promise. **The `arch`
  lists in that file are honoured by `npm run dist` and IGNORED by
  `npm run pack`**, which builds the host architecture — so on an Apple Silicon
  Mac `electron-builder --win --dir` quietly makes a *win32/arm64* app, not the
  declared x64 one. Pass the arch explicitly whenever it is the thing under
  test. Windows targets DO cross-build from macOS, verified end to end
  including the icon; only the NSIS installer step is untested here.
- **userData is per platform, and every note here names the macOS path.**
  `~/Library/Application Support/price-action-mark/` on macOS,
  `%APPDATA%\price-action-mark\` on Windows,
  `~/.config/price-action-mark/` on Linux. It holds `settings.json`, one
  dataset cache per interval and `marks/<symbol>.json`. Nothing in it is
  precious — delete the directory to get a first-run state back.
- **WINDOWS ONLY — git may refuse to run: *"dubious ownership"*.** The working
  tree is owned by the account `yangke` while the shell may run as `keatu`, so
  every git command aborts until
  `git config --global --add safe.directory C:/code/github/price-action-mark`.
  Already applied for `keatu`; a third account, or a fresh profile, hits it
  again. Does not arise on macOS or Linux.

## Commands

```bash
npm install            # postinstall fetches the Electron binary
npm run data           # refresh data/es_data.json from Yahoo    (optional)
                       #   --interval 5m -> data/es_5m.json (untracked)
npm run dev            # desktop app, renderer hot-reloads, main restarts
npm run artifact       # single file -> dist/price_action_mark.html + preview.html
                       #   publish flow: mark up, File > Export marks…,
                       #   save over data/marks.json, then run this
npm run build          # typecheck, then main + preload + renderer -> out/
npm run pack           # unpacked app -> release/   (dist = installer)
npm run typecheck      # tsc over node side, svelte-check over the renderer
npm run csv            # Yahoo -> CSV; --interval 5m writes an instant column
npm run marks          # metric columns for any span; --check runs invariants
                       #   --read prints the bar-by-bar reading, in words
                       #   --read --rolls reads only the contract changes
                       #   --rules / --catalogue / --trades for the marking layer
                       #   --structure adds pivots/trend/pullback, --tune sweeps
                       #   --golden rewrites the regression fixture
npm run marks:check    # the marking layer's regression guard; fails on drift
npm run tokens:check   # the palette's guard: three scopes agree, contrast holds
npm run icon           # resources/icon.svg -> icon.png + icon.icns
npm run smoke          # headless render check of the artifact
npm run smoke:app      # headless render check of the desktop app
```

`npm run typecheck` must be clean before you call anything done — `typecheck:web`
runs with `--threshold warning`, so **warnings fail**. Both tsconfigs also set
`noUnusedLocals` and `noUnusedParameters`, so **a dead import or a dead local
fails the build**, in `.ts` and in `.svelte` alike — verified in both paths.
That is a tidy that stays tidy: three had already accumulated where nothing was
looking. Name a genuinely unused parameter `_x` rather than relaxing the flag. Two justified a11y warnings
on the chart surface are silenced inline with `svelte-ignore` and a reason; do not
add more without one.

---

## macOS: local dev and local install

Every command above runs unchanged. The codebase has **no `win32` branch**, and
the two `darwin` branches it does have — `window-all-closed` in
[main/index.ts](src/main/index.ts), the app menu and `close` vs `quit` in
[menu.ts](src/main/menu.ts) — are the correct ones. Verified end to end on
arm64 / Electron 44 / Node 26: typecheck, build, artifact, both smokes,
`marks:check`, `tokens:check`, `pack`, a live Yahoo pull, both window gestures
and the daily-RTH aggregation.

Needs **macOS 13**, Electron 44's floor (`LSMinimumSystemVersion` in the built
`Info.plist`). Every Apple Silicon Mac clears that, so it is not a constraint
worth thinking about here.

**APPLE SILICON ONLY, and the build is arm64-THIN — not universal.** Measured
on the installed bundle: 7 executables and 6 dylibs, every one of them arm64,
and **zero x86_64 files anywhere**. It therefore cannot run on an Intel Mac at
all, and equally cannot be running under Rosetta — Rosetta translates x86_64,
and there is none here to translate. `mac.target.arch` in
[electron-builder.yml](electron-builder.yml) says `[arm64]` for this reason; it
was `[arm64, x64]`, which bought a second ~120 MB Electron download and a
second 123 MB dmg on every `dist` for a machine nobody runs.

The x64 half was invisible until someone ran `dist`, because `pack` ignores
the arch list — see the platform bullet under `## Environment`. Should an Intel
or universal build ever be wanted it is one line (`arch: [x64]` or
`[universal]`), with one trap: `--x64` writes to **`release/mac/`**, no `-x64`
suffix, so a copy step pointed at `release/mac-arm64/` would silently hand over
the wrong architecture.

Every accelerator is registered as `CmdOrCtrl+…`, so **each `Ctrl+X` written in
these notes is `⌘X` on macOS**. The in-page hints say so themselves —
[keys.ts](src/renderer/lib/keys.ts)'s `accel()` renders a chord in the reader's
own notation, and in Apple's modifier order (⌃⌥⇧⌘, so ⌘ lands last: `⇧⌘M`,
never `⌘⇧M`). It reads the platform from `navigator`, not over the preload
bridge, because it is the READER's machine that decides, a `title` needs the
answer synchronously, and the artifact has no bridge to ask yet is read on Macs
too.

### Installing it locally

```bash
npm run pack
rm -rf "/Applications/Price Action Mark.app"
cp -R "release/mac-arm64/Price Action Mark.app" /Applications/
```

**This needs no Apple Developer account and no signing at all.** Gatekeeper
keys off the `com.apple.quarantine` attribute, which is stamped on by whatever
DOWNLOADS a file — a browser, Mail, AirDrop. A bundle you built yourself was
never downloaded, carries no such attribute (`xattr` returns empty) and is
therefore never assessed. It launches from Finder, the Dock and Spotlight like
anything else. That is why [electron-builder.yml](electron-builder.yml) has no
signing config, and why the *"skipped macOS application code signing"* warning
on every `pack` is noise.

It stops being noise the moment the app travels. `scp`, a USB stick and `curl`
do not set the quarantine bit; a browser, Mail and AirDrop do — and on a
quarantined install this build fails the UGLY way, because `spctl --assess`
reports **`code has no resources but signature indicates they must be
present`**. electron-builder inserts `app.asar`, `data/` and a new `Info.plist`
into a bundle that keeps the Electron binary's inherited linker signature
(`Identifier=Electron`, `Sealed Resources=none`), and macOS renders a broken
seal as *"…is damaged and can't be opened"* — which reads as a corrupt
download rather than a policy block. `codesign --force --deep --sign -` repairs
it for free: `Sealed Resources version=2`, the right identifier, and the app
still boots. The dialog then becomes the ordinary *"Apple could not verify…"*
with a working **Open Anyway** under System Settings ▸ Privacy & Security
(macOS 15 removed the Control-click ▸ Open shortcut, so that pane is the only
GUI path). A Developer ID signature WITHOUT notarization buys nothing — it is
blocked identically, so it is notarize or do not bother.

### Two silent-exit traps, and they look identical

Both make the app vanish with no window, no error and exit 0 — the failure this
file already describes for `smoke:app`, seen from macOS.

- **`open` PASSES THE CALLING SHELL'S ENVIRONMENT to the app.** Some toolchains
  export `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary behave as
  plain Node, so `open "…/Price Action Mark.app"` from such a shell starts Node
  and it exits at once. Measured back to back: clean env → 1 process, the same
  command with the variable → 0. It is in no shell profile and not in launchd
  here, so **Finder, the Dock, Spotlight and a plain Terminal.app are
  unaffected**; only a shell that has it needs `env -u ELECTRON_RUN_AS_NODE
  open …`.
- **A leftover `npm run dev` is named `Electron`, NOT `Price Action Mark`.** It
  holds the single-instance lock, so the packaged app quits before it draws,
  and `pkill -f "Price Action Mark"` does not match it. Use `pkill -f
  "node_modules/electron/dist"`, and check
  `~/Library/Application Support/price-action-mark/SingletonLock` if it still
  will not start.

### The icon

`npm run icon` rasterises [resources/icon.svg](resources/icon.svg) into
`icon.png` (1024) and a ten-face `icon.icns`. electron-builder finds both in
`buildResources` on its own — there is no `icon:` line in the config and none
is needed. It draws the SVG into a Chromium canvas and reads a PNG back rather
than adding an image library, then shells out to `sips` and `iconutil`, both of
which ship with macOS; on another platform it writes the PNG and skips the
`.icns`.

**No token name with a leading double hyphen may appear in that file's
comment.** XML forbids `--` inside a comment, so the document stops being well
formed and the only symptom is *"the source image cannot be decoded"* — no
line, no mention of a comment. It cost a build once.

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
app can pull live data, switch timeframe, save through a native dialog, persist
settings and resize its window; the artifact runs under a CSP with no remote
origin and a sandbox that blocks downloads, so it can do none of those. Note
`can.timeframes` needs a SECOND dataset, which is why the artifact lacks it —
while RTH/ETH needs no capability at all, being a pure transform over the
dataset already in hand. Components read `source.can.*` and
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
- **`--ema` is the LINE and `--ema-text` is the FIGURE, and they differ in dark
  mode.** The line is `#2962ff` to match the reference chart: dE 13.3 from
  `--focus`, which is what chose it — the cornflower blues that look closer by
  eye measure dE 2-5 from it and read as a selected control. It is 3.63:1 on
  the dark surface, which clears the 3:1 a mark needs and misses the 4.5:1 a
  figure needs, so the readout's EMA value takes `--ema-text` (`#93a5f4`,
  7.57:1). Exactly the split `--up` / `--up-text` already makes, and the reason
  a "just use --ema" in a text rule is a contrast regression that nothing will
  catch for you.
- **`--muted` is the MARK and `--muted-text` is anything the reader READS**, and
  this is the third and widest of those splits. The one token drew the roll
  arrows, the `neutral` and `caution` strokes and the legend glyph — all
  graphics, all clearing 3:1 — while also carrying 39 distinct TEXT roles across
  13 components, 558 elements on one page, at 8px to 14px. As text it was short
  in both themes: 3.36 / 3.21 / 3.07 light and 3.87 / 3.59 / 4.22 dark on
  surface / surface-2 / plane, against 4.5:1, and the large-text relaxation
  never applies because 14px is the biggest `--muted` text in the app and the
  threshold is 24px. `--muted-text` is `#676f7a` / `#7e8792` — the smallest move
  along LIGHTNESS, hue and saturation held, that clears 4.5:1 on all three
  grounds (4.95 / 4.73 / 4.52 and 4.89 / 4.55 / 5.34). L* moves 11.0 and 6.7
  against a 21.6 / 22.6 gap to `--ink-2`, so the quiet register stays quiet.
  `readTokens()` carries both: `layout.textColor` and the bar numbers take
  `mutedText`, the roll markers and `styleFor`'s neutral/caution keep `muted`.
  The light plane is the one to watch — `--muted` clears the 3:1 graphics bar
  there by 0.07, so a nudge to `--plane` puts the arrows under it.
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
- **INTRADAY IS A ROLLING WINDOW, not a shorter page of the same archive.**
  Measured against the live endpoint, not read from documentation: `5m` serves
  the last **60 days** and 422s on anything older — including a 15-day window
  ending 55 days ago, so the WHOLE request must sit inside the window and there
  is no paging backwards. `period1=0` is rejected outright, which is why
  `fetchChart` CLAMPS `start` for an interval with a `maxDays`: a 422 and an
  empty chart look identical to a reader. For reference, `1m` is different —
  8 days per request over a ~30-day archive, and that one IS pageable. About
  19% of a 60-day 5m pull is null closes (2,804 of 14,688); `toRows()` drops
  them, leaving ~223 bars a session out of a 22.9-hour Globex day.
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
- **Ten DAILY sessions print a close outside their own high/low, and zero
  intraday bars do** — measured on both. The cause is the quarterly settlement
  price being stamped onto a daily bar, which is not a thing that happens to a
  five-minute bar, so the widening in `metrics()` is inert on intraday. Eight are quarterly
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
- **`logicalToCoordinate` TAKES A FRACTIONAL LOGICAL AND ANSWERS NONSENSE.**
  It is typed for a `Logical`, it does not complain, and it does not return
  null — it returns a coordinate at the pane's left edge. An entry's band asked
  for `i - 0.5` and `i + 0.5` to sit half a bar out at each end, and every band
  in the viewport collapsed there: **170 lit pixels in canvas column 0** where
  ten marks should have covered a few thousand, with no error anywhere. Measure
  bar spacing from two INTEGER indices instead — `xAt(i + 1) - xAt(i)` — which
  is what `#bandHalfWidth` in the primitive already does for the anchor band.
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
  version, and **userData lands in the `Electron` directory** instead of the
  `price-action-mark` one — `~/Library/Application Support/Electron` on macOS,
  `%APPDATA%\Electron` on Windows. `smoke.cjs` calls `app.setName()` to
  compensate.
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
  interval.ts                    bar size: keys, ranges, feed limits
  session.ts                     RTH/ETH window + trading-day bar numbers;
                                   the only timezone code
  rolls.ts                       expiry arithmetic + contractStarts()
  aggregate.ts                   intraday -> daily bars, for RTH daily
  indicators.ts                  ema(), atr(), trueRange(); pure series maths
  marks/metrics.ts               per-bar columns every marking rule reads
  marks/structure.ts             pivots, legs, always-in state, H/L counts
  marks/reading.ts               one line of Brooks prose per bar; names no
                                   pattern it did not import
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
  marks.ts                       verdicts, one atomic JSON per symbol+window
  dataset.ts                     network -> cache -> bundled, in that order
  settings.ts                    atomic JSON in userData, validated field by field
  menu.ts                        native menu; items send Commands to the renderer
  window.ts                      vertical maximize + extend-left (no Electron API)

src/preload/index.ts           the entire privileged surface, sandboxed CJS

src/renderer/
  App.svelte                     layout, theme wiring, menu-command routing
  lib/source/                    the seam — see "The one idea"
  lib/state/app.svelte.ts        one rune-based store for the window
  lib/chart/candles.ts           every imperative call into lightweight-charts
  lib/chart/numbers.ts           Brooks bar numbers; a primitive of its own
  lib/chart/marks/               one primitive for all geometry, not one per mark
    primitive.ts                   ISeriesPrimitive; autoscaleInfo() -> null
    draw.ts                        marks -> polylines -> canvas; hit test shares them
    palette.ts                     tone -> token; caution is dashed, not a 4th hue
  lib/components/                Masthead, Controls, Readout, ChartPanel, …
    MarkPanel.svelte               rule toggles, counts, the publish switch
    RulesSheet.svelte              the fold set as a modal; mounted by App
    MarkingPane.svelte             the All/Marked/Unresolved filter; owns the card
    Tape.svelte                    one row per session: the reading, its marks as
                                     chips, keep / drop in the strip a chip opens
    Reading.svelte                 one reading's three clauses; the colour grammar
  styles/tokens.css              the palette, in three scopes
```

## Verifying a change

Typecheck is necessary but not sufficient — the failure modes here are visual and
silent. `npm run smoke` / `smoke:app` load the built output in real headless
Chromium and assert: canvas count, a well-formed last price, a dated readout,
populated table rows, a resolved theme, a well-formed EMA value, >=2 loaded font
faces, zero console errors, and that the preload bridge exists in the desktop app
and *not* in the artifact. **`smoke:app` imports the real `out/main/index.js`**, so
the preload and every IPC handler run on their production path. It also asserts
the readout's **bar reading**, the marking pane's **tape** and the mark **chips**
on it, because prose fails silently — a dropped clause renders as a shorter
sentence, never as an error, an empty reading is an empty element, and a row
whose chips failed to render looks exactly like a session carrying no marks.

It also drives the **fold** on both targets: a heading chip has to reveal its
less-used rules and fold them away again, and the **rules sheet** has to open
from the card's door, bring a folded rule back into the list, drop that change
and close. Both are the same class of silent failure — a fold that reveals
nothing looks exactly like a short list — and both CLICK THEN MEASURE IN A
SECOND `executeJavaScript`, for the reason the probe note below gives.

The **stop & target** switch is driven the same way, and asserted at DOM level
rather than against the canvas — it has to toggle and come back. That is a
deliberate retreat and the marking section says why: a click repaints the whole
pane, so a canvas poll catches the clear-and-redraw rather than the rails, and
a version of the check that "passed" was reporting the candles canvas going
433,556 -> 0 -> 432,424.

**`smoke:app` can print NOTHING and exit 0 — that is a FAILED run, not a pass.**
[main/index.ts](src/main/index.ts) opens with
`if (!app.requestSingleInstanceLock()) app.quit()`, so any stale `electron`
process (a leftover `npm run dev`, or a probe killed before its `app.exit`)
makes `windowForApp()`'s `await import('../out/main/index.js')` quit the app
before `smoke.cjs` reaches its report or its `app.exit(1)` failure path. Every
real failure writes to stderr and exits 1, so silence is the one mode the script
does not anticipate. A healthy run always prints `smoke desktop app: N canvas, …`
then `smoke: ok`. Clear it with
`pkill -f "node_modules/electron/dist"` on macOS or Linux,
`Get-Process electron | Stop-Process -Force` on Windows — and note the dev
process is named **`Electron`**, not `Price Action Mark`, so a pkill on the
product name misses it. Then re-run. (Unrelated but
co-occurring: `ELECTRON_RUN_AS_NODE=1` is exported in some shells here, so every
Electron entry point takes its re-exec guard — that path works and is not the
cause of the silence.)

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

**A probe that clicks something Svelte renders must MEASURE IN A SECOND CALL.**
Svelte flushes on a microtask, so `el.click()` and `getBoundingClientRect()` in
one `executeJavaScript` expression read the DOM as it was BEFORE the click. It
does not look like a race: switching to a hidden tab and measuring its rows in
the same expression returned every row `0px` tall and "128 of 128 visible",
which reads as a broken layout, and reading `aria-selected` the same way said a
keyboard handler had not fired when it had. Click, `await` a beat, then measure.

**`getImageData` throws `IndexSizeError` on a ZERO-SIZED canvas, and the
library keeps one.** The whole probe then dies with *"Script failed to execute,
this normally means an error was thrown"* and nothing else — no line, no
message. Guard with `c.width && c.height` before taking a context, and wrap
in-page snapshot code in a `try/catch` that RETURNS the message, or you get to
diagnose a blank failure.

**A canvas diff needs a noise floor AND a first-interaction control, or it lies
twice — and this has now caught the same wrong conclusion on two different
features.** An opacity-0 window is occluded, so the chart's repaint lands on an
erratic animation frame: a fixed 800ms wait measured 7,848 changed pixels on one
run and **0** on the next for identical code — poll until something moves. And
the FIRST interaction of any run moves canvases 0, 2 and 4 (the pane, the price
axis, the time axis) whatever it is; spending it on a feature that already ships
reproduced `0:2605 1:12860 2:2427 4:951` exactly, so that signature is the app
settling after boot, not the feature under test. Both controls, every time.

**Tune a detector against `npm run marks`, never against the canvas.** A rule
that is subtly too loose looks, on a chart, exactly like a rule that is working.
`--catalogue` prints the hit rate per rule (the density check), `--trades` prints
every entry with its walk-forward outcome, and `--tune` sweeps the structure dials.

**Pick the patterns by eye BEFORE writing the rule that finds them.** It is the
only way a detector is tested against something other than itself. The eight
in `data/marks-golden.json` were read off the 2025 pivot list by hand, and seven
matched the rule's own arithmetic exactly once it existed.

**`npm run tokens:check` is the palette's guard, and it covers the two faults
in `tokens.css` that render as nothing at all.** It asserts the THREE-SCOPE
invariant — the two dark scopes must hold the same keys with the same values,
nothing may exist only in the dark, and every colour in `:root` must be
redefined for it — and then the contrast of every token against the grounds it
actually sits on, 4.5:1 for text and 3:1 for a mark. `ROLES` in the script is
authored, because "is this text" is a fact about the components rather than
about the CSS; the GROUNDS in it were measured by walking every text element in
the built artifact and resolving the first ancestor that paints. **A hex token
with no `ROLES` entry fails the run**, so adding a colour forces the decision
rather than defaulting to unmeasured. Verified to have teeth on all four fault
classes: reverting `--down-text` reports *"4.27:1 on --plane ... needs 4.5:1"*,
dropping a token from one scope reports *"in the media query but not in
[data-theme=\"dark\"]"*, changing one dark scope reports *"disagrees between the
dark scopes"*, and a new `--brand` reports both that it is never redefined dark
and that nobody classified it.
- **The ground matters as much as the colour, and that is what it caught first.**
  `--down-text` was 4.68:1 on the card surface and **4.27:1 on the page plane**,
  and the masthead's session-change figure has no card behind it. It only
  renders on a DOWN session, and the shipped snapshot's last bar closed up — so
  neither the eye nor a screenshot would have found it. Now `#cc3131`.
- **A GROUND IS NOT ONLY ONE OF THE THREE PAGE GROUNDS, and that was this
  script's own blind spot.** It paired every token with `plane` / `surface` /
  `surface-2` and nothing else, so a token painting a background for *text* was
  never a ground and that text was never measured. The marking pane's
  selected-filter count chip inverts — 10.5px `--surface` on a `--focus` fill —
  and measured **4.30:1 in light** while the run printed "every token clears
  the bar it is used at". Even pure white on the old `#2a78d6` is 4.42:1, so
  the fix had to be the blue: `--focus` is now `#2874d0`, the smallest move
  along LIGHTNESS with hue and saturation held (HSL 212.8 / 67.7%, 50.2% ->
  48.6%), which puts the chip at 4.54:1 and improves `--focus` as a MARK from
  3.92:1 to 4.15:1 on the plane. Light only — in dark the chip is near-black on
  bright blue at 4.89:1. `Ground` now includes `focus` and `--surface` is
  classified as text on it; re-derive the pairings the way the note above says
  if a component moves, and **add any token that paints a background for text
  to `Ground`**, not just the page's own.

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

**A probe that diffs "the canvas" must diff EVERY canvas.** The library uses
several (7 in the shipped layout), and marks drawn by the primitive land on a
different one than series markers do. Sampling only the largest reported *0
changed pixels for every channel on the chart* while a screenshot plainly showed
them highlighted — a false negative that reads exactly like a broken feature.
Likewise, watch canvas 2: it is the price axis, and a diff that touches it means
something moved the SCALE rather than drawing on it.

A probe that clicks the chart must click ONE mark and stop. A channel spans
many x positions, so sweeping across it re-toggles the same verdict and the
result cancels out — which reads exactly like the feature not working. Also:
never return a `hoveredInfo` across `executeJavaScript`; it holds a live
`ISeriesApi` and the non-cloneable result hangs the call.

**Do not assume persisted state.** Settings and the dataset cache live in
userData (`~/Library/Application Support/price-action-mark/` on macOS —
see `## Environment` for the other platforms), so a probe that expects a default will disagree
with a machine that has run the app. Set the state you are testing explicitly, or
delete that directory first.

## Window gestures

- **Two of them, and neither is `maximize`.** Vertical takes the full work-area
  height and leaves x and width alone; **extend-left** moves the LEFT edge to the
  work area's left and leaves the RIGHT edge exactly where it is. That asymmetry
  is the feature: it widens the chart into empty desktop without walking over
  whatever is parked beside it.
- **Two WeakMaps, not one record.** The gestures are independent and compose — a
  window can be full-height and extended left at once — so each remembers its own
  pre-gesture geometry. Verified on a 3440px display: left edge to the work area,
  right edge unmoved, y and height unmoved, toggles back, composes with fit height.
- **The Session menu is always enabled, and was greyed out on daily.** It was
  right when RTH meant "filter the intraday bars in hand"; the session window
  now reaches the DAILY chart, where the bars are aggregated instead. The
  in-page control had learned this and the menu had not, so the two disagreed
  about a shipped feature — measured: `MENU Session enabled: false` beside
  `PAGE Session control: ["ETH*","RTH"]` on the same chart. Main is the desktop
  target, where `can.timeframes` is true by construction, so the answer there
  is simply "always". A menu item and a button are supposed to be one code path;
  that is the whole premise of [menu.ts](src/main/menu.ts).
- **They act in main, not through the renderer.** Window geometry is main's own
  business, which is why these two menu items click straight through instead of
  sending a Command. `Ctrl+Shift+M` and `Ctrl+Shift+L`.
- **main PUSHES the state; the buttons do not remember it.** `app.fitted` and
  `app.fittedLeft` exist only to label the two buttons, and they used to be set
  by the buttons alone — which made them wrong the moment anything else moved
  the window. Measured: fit the height, then drag the bottom edge, and the
  button still read *Restore* over a window that was no longer full height, so
  pressing it maximized rather than restored. The accelerators are the worse
  path, because they never touch the renderer at all. `CH.windowState` is
  broadcast on `resize`, `move`, `maximize`, `unmaximize`, `restore` and once
  on `did-finish-load`, debounced 120 ms because a drag fires `resize` every
  frame. The gesture toggles need no push of their own: they move the window
  with `setBounds`, which fires `resize`.

---

## Deliberately absent — do not "fix" these

- **Volume is gone from the chart** (removed on request). The histogram, its pane,
  the toggle, the menu item and the `showVolume` setting are all deleted. Volume
  figures remain in the readout, the data table and the CSV export, because those
  are dataset detail rather than a chart study. Do not reinstate the pane.
- **No symbol picker in the UI.** The data layer is symbol-generic —
  `npm run csv -- --symbol ESZ26.CME` works today — but the app charts whatever
  `data/es_data.json` holds. The argument used to be that a picker needs an IPC
  round trip and a cache key per symbol; the TIMEFRAME switch built exactly that
  plumbing (a parameter on `getDataset`, a cache file per key, a load-before-
  commit setter), so a picker is now mostly a matter of following it. Still a
  feature rather than a gap, but a cheaper one than this note used to claim.
- **No migration from the old `es-futures-chart` userData directory.** The project was
  renamed from *E-Mini Daily Tape*; the old userData directory is orphaned and
  holds only a settings file and a dataset cache, both of which regenerate. Safe
  to delete. Do not write migration code for it.
- **The masthead H1 names the SUBJECT, not the product** — and the bar size is
  part of the subject. *"E-Mini S&P 500 futures, 5-minute bars, RTH"* is what
  the chart is of; the product name lives in `<title>`, the window title and
  the footer. It was hard-coded to *"daily bars"* and said so over five-minute
  candles until the switch existed, which is why the smoke now asserts the
  heading and the status line agree about the bar size.
  **The same fault outlived that fix in two lines nothing asserts on, and both
  are now derived.** The FOOTER named the endpoint as *"`v8/finance/chart/ES=F`,
  daily interval"* on every target — wrong on a 5-minute chart and wrong twice
  over on RTH daily, whose bars come from an `interval=5m` pull; it now prints
  `interval={sourceIntervalFor(app.interval, app.session)}` and says so when
  they were aggregated here. The masthead's sub-line had two branches for three
  cases, so an aggregated RTH daily bar was described as *"one CME session —
  open, high, low, settle"*, which is the one thing it is not. Confirmed on the
  desktop app AND on an artifact built from `data/es_5m.json`: a factual claim
  about the API that travels with the published page.
- **`--threshold warning` on svelte-check is intentional.** Do not relax it to
  make a warning go away.
- **There is no full-width bar-reading card below the chart.** It shipped that
  way for one iteration and was measured against the fold: 12-13px of it visible
  at 1904x1015, none at 1264x735, and **2,508px down the page with the chart
  entirely off-screen** in the stacked layout — the same defect the two-pane
  rework fixed for the mark list. The list lives in the marking pane and the
  focused bar's reading lives in the readout. Re-adding the card would put the
  reading in two places and bring the fold problem back with it.
- **No committed intraday snapshot, and no 1-minute timeframe.** A 5m
  snapshot is a 60-day rolling window — stale in a day, worthless in two months
  — so `data/es_5m.json` is gitignored and the app fetches it. `1m` is a
  different shape again (8 days a request over a ~30-day archive, pageable) and
  would need chunked fetching to be worth anything; it is a feature, not a gap.
- **The pane's filter is not persisted.** `settings.marks` is sparse on
  purpose (see below), and storing All / Marked / Unresolved would freeze
  today's answer into every settings file to save one click. Same argument the
  pane's open TAB was refused on, before the tabs became a filter.

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
- **Rule output is recomputed, never stored.** `detect()` runs all 31 rules once
  per dataset — 50 ms over 6,550 bars cold, 20 ms once the JIT is warm — and
  toggling a rule filters the result in 0.22 ms. Re-detecting per toggle would
  make a checkbox two orders of magnitude more expensive. (Both figures moved
  when the rule count went 15 -> 31; re-measure with a throwaway script under
  `scripts/` rather than trusting the ones written here.)
- **The wide layout is TWO PANES in a fixed-height column, not one scroller.**
  Above 1200px the chart and the marking cards sit side by side, and the column
  gives the rules card a bounded slice off the top and the marking pane
  everything left. It was one scroller first, which put the mark list 2,217px
  down a 964px column: the surface used on every mark opened off-screen. Three
  things are load-bearing and each was measured wrong first:
  - **`::details-content` is the flex item, not `.body`.** Chromium wraps a
    `<details>`'s content in that pseudo-element, so a `display: flex`
    `<details>` has two children: the summary and it. Leave it out of the chain
    and a bounded card CLIPS instead of scrolling — a 320px card held a
    `.scroll` reporting 498px of content and `maxScroll: 0`, with the last
    rules unreachable. **Only the rules card needs this now**: it is the one
    `<details>` left in the column, since the marking pane became a `<section>`
    with a filter and a plain flex chain. Both keep a `max-height` fallback
    (`--rules-scroll-max`, `--pane-scroll-max`) so a browser without the
    pseudo-element still scrolls rather than clipping.
  - **The column's height comes from the CHART CARD, and by stretching to it.**
    The column starts 201px down the page, so a viewport-tall one hangs 165px
    below the fold — and a reader marking up never scrolls the page. `--chart-h`
    is already tuned to the fold, so deriving from the chart card fits by
    construction. It derived by ARITHMETIC first, `calc(var(--chart-h) + 108px)`
    with 108 a measured readout and legend, and that broke the day the readout
    grew a line for the bar reading: 42px to 81px, columns 16px out.
    `align-items: stretch` on the grid row is exact whatever sits above the
    candles. Do not put a constant back.
  - **No `position: sticky` on the column.** It existed to keep a 2,257px
    column in view while it scrolled. A sticky column cannot be fold-height at
    rest and viewport-height when stuck, and with panes there is nothing to
    stick.
  A card's own density is a CONTAINER query on the card, never App's media
  query repeated: the marking pane declares the container the tape reads, and
  the tape drops the date rail under 430px. The same box is full-width when
  stacked and a narrow pane when not, and it is that box's width that decides.
  **The mark table's two tiers went with the table** — 780px and 660px trimmed
  the padding of five columns that no longer exist.
  **MarkPanel used to be the other example and is no longer any example at
  all.** Its one query decided the width at which the per-rule blurb line had
  to go; the blurb does not print on the card at any width now — it is the
  row's `title`, which is where the compact layout had always put it and what a
  screen reader is handed either way — so the compact grid is simply the
  layout, and `container-type` came off with the query. Measured both ways in
  the built artifact before removing it: card, list, scroll window, columns and
  row height are identical with and without, at 1904x1015 (647px card, 2
  columns) and 1100x900 (1045px card, 4). The saving is in the STACKED layout,
  where the card is wide enough that the blurbs used to show: 31 rules are
  310px of content in four columns, against the 2,199px one column of blurbs
  measured when that was the layout.
- **THE MARK TABLE'S ~535px FLOOR IS GONE, and it is worth knowing how.** Five
  columns — date, label, rule, detail, Keep/Drop — could not be squeezed below
  535px, which fits from about a 1700px viewport up and is 147px short at 1200;
  the note here used to say the only remaining move was to shrink the date, the
  label or the verdict pair, which are the three things the reader aims at, so
  it scrolled sideways instead. The tape dissolved the row instead of trimming
  it: the date is the reading's rail, the label is a chip in the sentence, and
  Rule / Detail / Keep / Drop render in the strip under whichever chip is
  selected — one mark at a time rather than every row at once. Nothing was
  made smaller. **If a future row grows a sixth thing, put it in the strip.**
- **Clicking a mark in the LIST highlights it on the chart; clicking one on
  the CANVAS still toggles Keep.** Two gestures, two meanings — "show me where
  this is" is not "I stand behind this". Selection is one id in `AppState`,
  never persisted, and read through `selectedMark`, which resolves it against
  `marks` so a dropped or filtered-out mark stops highlighting without a
  cleanup effect. The id is kept, not cleared, so switching a rule back on
  returns the reader's place.
- **`FILL_ALPHA` WENT BACK TO 0.1, and the round trip is the note.** It was
  0.1, was raised to 0.18 because a trade's box was one bar wide and simply
  vanished at that alpha, and is 0.1 again because that reason no longer
  exists: an entry's band is STROKED as well as filled now, so the narrow mark
  does not depend on its fill to be seen — or to be clicked, since the hit test
  measures `lines` and never a fill. The wide mark is what the fill was always
  too strong for: a channel band covers about a third of the pane at the zoom a
  reader marks up at, and the whole of it when they zoom in. Measured on the
  shipped series before choosing: 433 channel marks drawn by the shipped
  defaults, spanning 4 to 101 bars with a median of 6 — `bull-channel` 99,
  `bear-channel` 96, `micro-channel` 238, and 40 more from
  `spike-and-channel`, which ships off — and one real bull channel covers 36%
  of the pane zoomed in against
  13% with room around it — which is why a single flat number reads well on one
  chart and as a slab on the other. Anything that raises it again has to answer
  for the wide case first.
- **Emphasis for a selected mark is WEIGHT, never a colour, and never the
  fill.** Tone owns hue. Raising the band's fill alpha to 0.32 was tried and a
  selected channel at 1M — one channel spanning all 24 visible bars — became a
  green slab over the candles, which is the failure `FILL_ALPHA` was tuned to
  avoid. Emphasis goes on the rails: halo, width, full opacity.
- **A selected mark also gets a one-session vertical band, drawn by the
  PRIMITIVE.** It is the only thing that works for the marks emphasis cannot
  reach: a bar mark is a series marker whose only channel is size, and growing
  it MOVED THE PRICE SCALE (an `aboveBar` marker reserves vertical space, so
  selecting a mark near the visible high re-scaled the pane and shifted every
  candle); a `trade` whose trade never filled has `through === at`, so its box
  and both lines collapse to zero width and there is nothing to thicken —
  `second-entry` highlighted 0 pixels before the band. The primitive's
  `autoscaleInfo()` is null, so a band cannot disturb the scale however tall
  it is. It is NOT part of `Shape`: the hit test measures against shapes, and a
  full-height band would make a whole column of the chart report that mark.
  Measured across all 20 rules in view: 3,285-9,851 changed pixels each, all on
  the primitive's canvas, with the price axis untouched.
- **Clicking a mark on the chart toggles Keep.** `subscribeClick` reports
  `hoveredInfo.objectId` (`hoveredObjectId` is deprecated), and `CandleChart`
  checks it against the ids it was given rather than trusting it — markers and
  primitives share that channel. There is no second gesture: the library's click
  event carries no modifier keys, so Drop stays in the tape, on the strip a
  chip opens.
- **Bar labels need ~24px a bar, not 8.** Three-character labels at 11px mono are
  ~20px wide, so below that adjacent bars' labels overlap into garbage. The test
  is PIXELS PER BAR, not the name of a range: on daily that works out to the 1M
  preset and nothing wider, but 1M of five-minute bars is 6,320 of them, so
  intraday needs 1D or shorter before a label appears. The readout says *"zoom
  in for bar marks"* the rest of the time, on either timeframe. Marks stacked on ONE bar are fine — the library offsets those.
- **Density is the design constraint, and it TRANSFERS.** `npm run marks --
  --catalogue` prints the hit rate per rule. The defaults budget 0.71 marks a
  bar on daily — and measured 0.71 on a 60-day 5-minute pull as well, so the
  budget still needs no second set of numbers. It was 0.56 until `inside` and
  `outside` were switched on. The DENSEST rules still ship `defaultOn: false`
  (`trend-bar` 34.5%, `doji` 27.2%, `shaved` 15.1%, `pullback-entry` 12.3%),
  and the line now sits just under those two at about 12%.
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
  **It then happened a THIRD time, to SETTINGS.** `#patchMarks` puts
  `settings.marks.rules` and `.folded` — both rune-backed, both proxies —
  straight into the IPC payload, so every marks patch was rejected and
  `patch()`'s bare `catch {}` swallowed it: rule toggles, folds, Show marks and
  Confirmed only all worked for the session and were gone on the next launch,
  with nothing on screen to say so. The artifact was unaffected, because
  `JSON.stringify` walks a proxy quite happily — which is why only one of the
  two targets was broken and neither smoke could see it. `patch()` now
  snapshots at the seam rather than at the four call sites, so a fifth cannot
  reintroduce it, and it REPORTS a failure instead of swallowing it. A bare
  `catch {}` on a persistence path is the actual bug, three times running.
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
- **AN ENTRY IS DRAWN AS A BAND ON THE ENTRY PRICE, and its stop and target
  are a SWITCH.** It used to draw three things at once — a filled box from
  entry to stop, a line at the entry, a line at the target — of which the box
  and the entry line said the same thing twice and nothing was clickable but
  two thin rails. Now the box IS the entry: a band a quarter of the risk thick
  (`BAND_SHARE` in draw.ts), stroked AND filled, ONE BAR WIDE, over the signal
  bar. Five things in it were decided rather than defaulted:
  - **The thickness is in PRICE, not pixels** — a quarter of the risk — so it
    means the same thing at every zoom instead of swelling into the candles
    when the reader zooms out. A band on one price with no thickness is a line,
    which is what this replaced.
  - **The band is ONE BAR and the RAILS carry the duration.** It drew from the
    signal bar to `through` for one iteration, which made the box say the same
    thing the rails already say — how long the trade took — and stopped it
    saying the thing it is for. The point of entry is a session, so the box is
    a session: half a bar either side of the signal bar's centre, and the
    dashed rails run on to where the trade resolved. Measured at 3M: a 16px
    band against 13px bar spacing, beside a 114px rail. Measure that half bar
    from integer indices; see the `logicalToCoordinate` trap above, which cost
    a debugging session.
  - **NOT clamped to a minimum width**, though the anchor band under a selected
    mark is. That one is a pointer into the chart and may be drawn wider than
    the thing it points at; this is data, and a box drawn wider than the
    session it marks would be saying something untrue at exactly the zoom where
    the reader cannot check it.
  - **`Shape.dashed` is a SECOND REGISTER, not a second shape.** The band is
    the mark; the rails are a statement about it the reader can switch off, so
    they are dashed and thinner whatever the tone says. Shape is the channel
    this project uses for that — the same argument `caution` makes for being
    dashed rather than a fourth hue. `distanceTo` measures them too: clicking
    an entry's stop should find that entry, and when the rails are off they are
    not in the shape to be found.
  - **A CLOSED polyline in `lines` is a REGION, and its inside is a hit.** A
    band is about 14px tall at a 6M viewport, so its centre — the entry price,
    the exact thing the reader is aiming at — sits 7px from either edge and
    would miss the 6px `HIT_SLOP` entirely. Deliberately NOT the same rule for
    `fills`: a channel's band spans a hundred bars and an interior at distance
    0 always beats a nearby line, so one channel would swallow every click
    inside it. Verified by probe: hovering the middle of a band gives a pointer
    cursor and a click there took the tally from *0 kept* to *1 kept*, with the
    rails on and again with them off.
  The switch is `settings.marks.stopTarget`, on by default because that is what
  the chart said before it existed. It sits in the marking card's top row next
  to `Show marks` and in Marks ▸ *Stop & target* — display only, so it belongs
  with the master switch rather than with the rules, and it changes nothing
  about detection, the outcome column or the verdicts. It reaches `shapeOf`
  rather than the paint pass on purpose: a rail nobody can see must not still
  be the thing under the cursor. The artifact stores it **only when it is
  off**, the same sparseness `marks.show` and `folded` keep.
  **`smoke.cjs` asserts it at DOM level, and that is a retreat worth
  recording.** Whether the switch reaches the canvas was settled by probe —
  57,835 painted pixels on the primitive's canvas with the rails on, 56,421
  with them off, 57,835 again — but a canvas assertion inside the smoke could
  not be made to hold: a click repaints the whole pane, so what a poll catches
  is the clear-and-redraw rather than the rails. A version that "passed"
  reported the candles canvas going 433,556 -> 0 -> 432,424, which is a repaint
  cycle wearing the answer's clothes. Two lessons that generalise: hold NO
  canvas element references across a layout change (the library replaces them,
  and a stale one reads zero for ever, which looks exactly like a broken
  feature), and a canvas count that changed is not a canvas count that settled.
- **A DOUBLE IS DRAWN AS THE LEVEL, NOT AS THE M.** It was a three-point
  `path` — first peak, neckline pivot, second peak — which traced what price
  did and named nothing; what the pattern is *about* is the one price that was
  tested twice and held. `doubleRule` now emits a `level`, and three things in
  it were decided rather than defaulted. The price is the more EXTREME of the
  two peaks, because at their mean one of the two pokes through its own line
  and reads as a line drawn wrong; they sit within `DT_TOL_ATR` of each other
  by definition, so it moves the line under half an ATR either way. The span
  runs from the first peak to `knownAt` — three sessions past the second at
  the default strength — so the line does not stop before the sessions that
  test it, and no constant had to be invented for it. And the id is still
  built from the same two dates, so **every verdict already on disk still
  finds its mark**; `marks:check` passes untouched because counts and dates
  are geometry-blind. The neckline is not lost: it is in the note, and
  `dt-short` still projects the measured move from it. NOTHING EMITS A `path`
  ANY MORE — see the comment on `PathMark`, which is kept for the drawing
  tool, not left behind by accident.
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
- **THE ORDER GOES IN AT `knownAt`, WHICH IS NOT ALWAYS THE SIGNAL BAR — and
  for a whole release it did not.** `dt-short`, `db-long` and `wedge-reversal`
  anchor on a swing PIVOT, which needs `strength` bars to its right, so their
  own `knownAt` is three sessions after their signal bar; the walk-forward ran
  from the signal anyway. All 257 of their marks quoted the outcome of an order
  nobody could have placed, two sessions early. Almost the entire edge was that
  head start: measured over the whole series, `dt-short` +0.873 R a mark became
  **+0.114**, `db-long` +0.601 became **+0.079**, and `wedge-reversal` +0.345
  became **-0.160**, which changes its sign. `trade()` now takes an `orderAt`
  and `--check` re-derives every entry's walk from the mark's own dates,
  failing if the note disagrees — verified to have teeth: putting the walk back
  on the signal bar reports *"wedge-reversal:2000-11-30 quotes an outcome an
  order placed at 2000-12-05 did not have"*.
- **Measured `--trades` over 3,000 sessions: the mechanical 2R target loses.**
  `second-entry` fills 75/75 and wins 28%, which at 2R is -0.085R a trade; a 2R
  exit needs better than 33%. With the lookahead above gone, the measured-move
  rules are only just positive — `dt-short` +0.21R average, `db-long` +0.19R —
  and `wedge-reversal` is **negative** at -0.21R. **Do not tune
  `DEFAULT_TARGET_R` until the table looks better** — that is curve-fitting a
  review tool. The numbers are a finding about these setups on daily ES, and
  they are supposed to be visible.
- **Two rules can contradict on the same bar, and that is not a bug.**
  `failed-bo` and `bo-pullback` fired opposite directions on 2026-07-30: one
  reads the breakout as real, the other as failed. The outcome column
  adjudicates; the tool shows both readings rather than picking one.
- **A trendline break is measured on the CLOSE, not the extreme.** A wick
  through a trendline is what trendlines are for; counting those as breaks
  rejects every real channel on the chart.
- **The rules card FOLDS its less-used rules, and `Rule.tier` is the only thing
  that decides which.** Nine carry `tier: 'extra'` today — `trend-bar`,
  `doji`, `shaved`, `pin-bar`, `gap-bar`, `spike-and-channel`,
  `pullback-entry`, `failed-bo` and `final-flag`. Absent means core, so a rule
  opts IN to being quiet and the other twenty-two need no line; nothing in the marking layer
  reads it, so detection, the counts, `--catalogue` and `marks:check` are
  untouched. Four things are load-bearing, and each was decided by measuring
  the alternative in a mock first:
  - **The control is a CHIP ON THE GROUP HEADING, not a drawer row per group.**
    The heading already spans the list and already carries the group's name, so
    `+5 ▾` costs no row; a `▸ 5 less used` row per group spent ~16px each to
    say what the heading says for free. Measured on the artifact at the pane's
    647px: 31 rules are 510px of list, 22 are **410px**.
  - **A folded rule the reader has switched ON is never hidden.** It is
    promoted into the list, keeping the quieter name so "less used" stays ONE
    signal rather than two — its ticked box says the rest. Without this the
    chart wears marks whose toggle is nowhere on the page, which is the mirror
    of not rendering a control that would not work.
  - **`tier` is a USAGE decision and `defaultOn` is a DENSITY one, and the two
    lists are not the same.** `climax` fires once a year and is worth a glance;
    `shaved` fires 38 times and may never be switched on. They happen to
    coincide today — every rule that is off is also folded — but no longer
    because density decides both: `gap-bar` fires 42 times and `final-flag` 44,
    and both are off and folded on usage alone.
  - **Open or closed is component `$state`, and the show-all lives in `.top`,
    not the `<summary>`.** A summary IS a button, so a button inside one is a
    button inside a button — the constraint that stopped the marking pane's
    tabs going there, and that now keeps the tape's mark chips OUTSIDE the
    sentence-button beside them. Persisting the open state would freeze today's
    answer into every settings file, the argument the next note makes.
  It does NOT make the card fit, and should not be described as if it does: at
  1904x1015 the list is 410px in a 211px window, and a row measures ~11px, so
  fitting would mean folding roughly eighteen more — most of what is left.
  (An earlier note said eight, from the arithmetic rather than from the rows.) `smoke.cjs` asserts the fold reveals and
  re-folds — measured in a SECOND `executeJavaScript`, because Svelte flushes
  on a microtask and counting rows in the same expression reports every fold as
  broken.
- **The READER can move a rule off its shipped tier, in the rules sheet.**
  [RulesSheet.svelte](src/renderer/lib/components/RulesSheet.svelte) is a
  modal `<dialog>` listing all 31 with a `Show` box, a `Fold` box, the outcome
  in words, and the density figures the card has no room for. Two doors:
  `Choose rules…` in the card's top row, and Marks ▸ *Choose folded rules…*
  (no accelerator — Ctrl+R/E/K/0-9 and Ctrl+Shift+E/M are all taken by things
  used every session). Both verified end to end; the menu one goes over the
  real `{ kind: 'rules' }` command.
  - **`settings.marks.folded` is sparse, and `#merge` DELETES from it.** Every
    other field-wise merge only ever adds, which is fine for `rules`; taking a
    fold back is a key *going away*, so `folded` compares against the incoming
    record and drops what is missing. Without that the reader undoes a fold and
    it comes straight back.
  - **`app.foldedRules` vs `app.hiddenRules`.** The first is the SETTING (what
    is marked less-used, on or off) and gives a rule its quieter name; the
    second is the EFFECT (folded minus enabled) and decides placement. The
    invariant lives in `hiddenRules` and nowhere else — `MarkPanel` and the
    sheet both read it rather than testing `rule.tier`.
  - **The sheet is mounted by `App`, not `MarkPanel`.** The native menu opens
    the same dialog, and routing that through the card would make a component
    with nothing to do with menus own the flag. It is a real `<dialog>` +
    `showModal()`, so the focus trap, Escape, the backdrop and the top layer
    are the platform's. `onclose` syncs `app.rulesOpen` back — without it
    Escape leaves the flag set and the sheet never reopens.
  - **The `Fold` box is DISABLED, not hidden, while a rule is on** (22 of 31
    by default). An empty cell reads as "cannot be folded"; ticked-and-disabled
    says "folded, and listed anyway because it is on", and it keeps the
    preference so switching the rule off later puts it back. The `Where`
    column states the outcome in words, because two checkboxes have four
    combinations and only three outcomes.
  - **The sheet's container tiers are about ROW HEIGHT, not overflow.** The
    table shrinks rather than scrolling sideways, so the failure mode is names
    and blurbs wrapping: measured at a 572px sheet with everything on, the
    name column is 163px and the median row 93px (tallest 143px), which shows
    six rules instead of fifteen. The blurb therefore goes first and early
    (700px), the numeric columns at 620px, `Where` at 420px — after which
    every width from 392px up holds a 32px row.
- **`settings.marks.rules` is sparse on purpose — and it was NOT, for a whole
  release.** It stores only the ids the reader moved off the rule's own
  `defaultOn`, because persisting all thirty-one booleans would freeze today's
  defaults into every settings file and a later tightening would never reach
  anyone who had already run the app. `toggleRule` only ever ADDED, so a rule
  switched off and back on stayed pinned to today's answer forever: the exact
  failure the sparseness exists to prevent. It now DELETES a key whose value
  agrees with `defaultOn`, and `#merge` deletes what an incoming record leaves
  out — the same two halves `folded` has always had. A settings file written
  before this keeps its redundant entries until the reader touches those rules;
  nothing rewrites it, because silently editing someone's file to satisfy an
  invariant is worse than the invariant being late.
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
- **The verdict store is keyed by symbol AND WINDOW, because a daily date names
  two different bars.** A mark id is `rule:date`, and on a daily chart
  `2026-08-28` is the whole 23-hour Globex day in ETH and 09:30-16:15 New York
  in RTH. Measured against the shipped feed: over the 42 sessions the two
  windows share, 23 of the RTH daily chart's 53 marks carry an id an ETH daily
  mark also carries, and ALL 23 name bars whose OHLC differs — so one store for
  both meant a Keep made in one window silently landed on a different bar in
  the other, and a Drop silently hid one. `markScope()` appends the window slug
  for an AGGREGATE only, which is the same distinction `slugFor` makes for an
  export filename: intraday keys carry a time of day, so RTH and ETH there name
  the very same five-minute bar and rightly share a store, and the feed's own
  daily series keeps the bare symbol so every verdict already on disk is still
  found. RTH daily gets `ES_F_rth.json`. `#adoptMarks` reloads on every switch
  that can change it — the store used to be fetched once, at boot, which is how
  the ETH verdicts followed the reader into RTH in the first place.
  **The PUBLISH path is guarded too, at build time.** `data/marks.json` is a
  flat verdict map with no record of which window produced it, so an RTH daily
  export dropped over the ETH daily snapshot published marks the author never
  confirmed onto bars they never saw — verified end to end: three RTH verdicts
  produced a confirmed-only page showing three ETH bars, silently.
  `inline-artifact.ts` now compares the store's `symbol` against
  `markScope(es_data.json)` and refuses the build, which is what that script's
  guards are for. Only a store that CARRIES verdicts is judged, so the shipped
  empty one still builds; and only the scope is compared, so 5-minute verdicts
  over a daily snapshot pass — an intraday id carries a time of day and matches
  nothing, which is harmless.

## Timeframes

Two bar sizes: daily, and 5-minute. [interval.ts](src/shared/interval.ts) owns
everything that depends on which, and the reason the rest of the codebase barely
changed is one decision.

- **`Dataset.d[i]` IS STILL AN OPAQUE SORTABLE STRING.** A daily bar is
  `2026-08-28`, an intraday one `2026-08-28T13:45:00Z`. Both are ISO 8601, so
  `<` and `>` order them, `Map<string, number>` indexes them, `markId(rule, at)`
  keys a verdict on them, and the viewport test `mk.at >= lo && mk.at <= hi` is
  untouched. Every consumer that treats a bar's date as a handle rather than a
  date needed no change at all — the marking layer, the primitive, the mark
  store, `--read`. Do not "improve" this into a numeric timestamp column.
- **`Dataset.interval` is OPTIONAL and absent means daily.** Required would
  invalidate every cached dataset and the committed snapshot, and `isDataset()`
  would have to keep accepting the old shape anyway — the same argument that
  kept `tick` out of `Dataset`. Read it through `intervalOf()`.
- **A BAR'S TIME IS TWO DIFFERENT TYPES TO lightweight-charts**, and it fails
  silently. Daily takes a business-day STRING, intraday a `UTCTimestamp`
  NUMBER; hand an intraday series the ISO string and it draws NOTHING, with no
  error. `candles.ts` converts once in `#timeOf` and keeps a SECOND map,
  `#indexOfTime`, because the crosshair hands back whichever type went in —
  reconstructing a key from a number would mean re-deriving `keyOf()`'s format
  somewhere it could drift.
- **`showLastDays` does arithmetic on the INSTANT, not the string.** It used to
  append `'T00:00:00Z'` to the last key, which for an intraday key produces
  `...13:45:00ZT00:00:00Z` — NaN, and a range request the library ignores.
- **Rolls are a CALENDAR fact, so `rolls.ts` works off the day part.**
  `rollIndices` finds the first bar OF that day and `contractStarts` steps to
  the first bar of the next SESSION, not `i + 1` — five minutes after an expiry
  is still the expiring contract, and the old form put the carry warning ~223
  bars early. On a daily series both reduce to exactly what they did before;
  `marks:check` is what proves that, and it still passes unchanged.
- **The status line names the WINDOW whenever the heading does, which on daily
  means whenever the bars were aggregated.** The two sit inches apart and
  disagreed: the heading said *"daily bars, RTH"* and the readout said *"Daily
  bars · 24 in view"*. Same class of fault as *"Daily bars"* over five-minute
  candles, one field narrower. The smoke's own heading/status cross-check was
  written before the session control reached daily and FAILED on that state —
  it asserted a daily heading must END in "daily bars" — so it now reads the
  bar size and the window out of both strings and compares them, and a third
  window or a third bar size needs no third branch. Run `smoke:app` in all four
  states after touching either line; the machine's stored settings decide which
  one you get.
- **`setInterval` does not reload a series it already holds.** 5-minute RTH to
  daily RTH is a re-derive of the bars on screen — `sourceIntervalFor` returns
  `5m` for both — and it went round the source anyway: an IPC round trip
  carrying 11,600 bars back, and a `#apply` that drops the crosshair and the
  reader's clicked session for nothing. `setSession` always had that guard;
  `setInterval` now has the same one. Measured after: the switch settles inside
  400 ms.
- **Range presets belong to the interval.** `5Y` against a 60-day archive shows
  the same thing as `MAX` while implying history that is not there, so
  `INTERVALS[x].ranges` decides what the control and the menu offer, and
  `rangeFor()` substitutes the interval's default when a stored range does not
  apply. Deliberately NOT a range per interval in settings — that would freeze
  today's preset list into every settings file, the argument `marks.rules`
  makes for being sparse. The menu's `Ctrl+1..0` number by POSITION in the
  offered list, so Ctrl+1 is always the shortest range that exists.
  **This is keyed on the INTERVAL alone, which the RTH daily chart breaks and
  nothing here fixes.** Those bars are aggregated from the 60-day intraday
  archive, so the chart is about 42 sessions — and it offers the daily presets,
  1Y and 5Y and MAX among them, four of which show exactly the same thing. It
  is the argument this note makes against a 5Y button on a 60-day archive,
  applied to a case the rule does not reach. Fixing it means the offered set
  depending on the dataset's SPAN rather than its bar size, which is a product
  decision (what should a 42-session daily chart offer?) rather than a defect
  with one obvious answer, so it is written down rather than guessed at.
- **The daily userData cache MOVED, and the old file is orphaned.** It was
  `es_data.json`; it is now `es_daily.json`, because the name is derived from
  the interval. Every existing install therefore re-fetches once and leaves a
  dead `es_data.json` behind. Deliberately no migration code, for the same
  reason there is none for the old `es-futures-chart` directory: a cache
  regenerates, and the file is safe to delete.
- **One cache file per interval, and NO intraday seed.** Sharing a cache would
  have a 5-minute pull overwrite 26 years of daily bars. `data/es_5m.json` is
  **gitignored**: an intraday snapshot is a 60-day rolling window, stale within
  a day and worthless within two months, so the first switch to 5m needs the
  network and says so if it cannot have it. `data/es_data.json` stays tracked
  for exactly the opposite reason.
- **`setInterval` loads BEFORE it commits the setting.** An intraday timeframe
  can fail (no seed, no network), and committing first would leave the app
  claiming 5-minute bars while showing daily ones. It also verifies the dataset
  it got back is the interval it asked for.
- **`adopt()` drops a push for another interval.** The boot refresh fires for
  whatever timeframe the window opened on, and the reader can switch before it
  lands; without the guard it would swap 60 days of 5-minute bars for 26 years
  of daily ones under them, silently.
- **The rule dials are in BARS and were swept on daily.** Strength 3,
  `BREAKOUT_LOOKBACK` 20, `ATR_PERIOD` 20 — none of them say "days", so they
  run on 5m unchanged, and the density transfers better than expected: a pivot
  every 6.7 bars against 6.8 daily, and `--check` passes on
  `data/es_5m.json` including the no-lookahead test. They are still UNVALIDATED
  at that scale — nobody has swept `--tune` on intraday — so treat the numbers
  as inherited, not chosen. The golden fixture is daily and `--check` now says
  so rather than reporting four failures that mean "wrong dataset".
- **Displayed times are UTC, and the readout says so.** The stored key is UTC
  and a mark id is built from it, so an exchange-local clock would put a
  different time in front of the reader than the one in the data, and spread
  DST arithmetic across the axis, the readout, both lists and the CSV. One
  clock; the `· 12:17 UTC` in the readout is where it is stated.
- **Three things the first pass got wrong, all found by probe, none by the
  typechecker.** The status line said *"Daily bars"* on a 5-minute chart. The
  readout rendered `28 Aug 202612:17 UTC` — a `margin-left` is not a space, and
  that element sits in an `aria-live` region. And the readout announced *"rolls
  too dense to mark"* on a 60-day window containing **no expiry at all**,
  because the density test never asked whether there were any markers.
- **`--interval 5m` writes a DIFFERENT file** (`data/es_5m.json`), and the CSV
  export renames its first column `time`: a spreadsheet reading a column called
  `date` will parse `2026-08-28T13:45:00Z` as a date and drop the time.

### Bar numbers

One line of the intraday chart's furniture, and three decisions in it.

- **Numbering is per TRADING DAY, and `tradingDayOf()` is not `dayOf()`.** The
  UTC date is right for RTH — 09:30 to 16:15 New York is one UTC day — and
  wrong for ETH, where it splits every Globex session at 00:00 UTC, 8pm in New
  York, restarting the count mid-evening. `tradingDayOf` shifts the instant by
  the cached New York offset, reads it with the UTC getters (which IS reading
  New York's wall clock), and rolls to the next day from 18:00, the exchange's
  own convention. Measured: RTH gives 42 sessions of **exactly 81 bars**, ETH
  44 sessions with a 275-bar median. It lives in
  [session.ts](src/shared/session.ts) because that is the only file allowed to
  know about exchange-local time.
- **Every third bar carries its number and the session's FIRST bar carries the
  date instead.** They never contend: bar 1 is not a multiple of three. A daily
  series gets no labels at all — `sessionBars()` correctly makes every daily bar
  number 1 of its own session, which would print "1" under all 6,550 of them.
- **A SECOND primitive, not another kind inside `MarkPrimitive`.** These labels
  carry no verdict, no tone and no hit test; folding them in would put "where is
  bar 12" and "which pattern is this" in one code path. Series markers were
  never an option — a marker reserves vertical space and MOVES THE PRICE SCALE,
  which is already written down as the reason a selected bar mark gets a band
  instead of a bigger marker. `autoscaleInfo()` returns null here too.
- **It draws in MEDIA coordinates.** `useMediaCoordinateSpace` hands over CSS
  pixels; text in bitmap space means scaling the font by the device pixel ratio
  by hand and getting the baseline wrong on a fractional-scaling display.
- **Numbers and dates have SEPARATE density tests, and only the numbers are
  announced.** A label needs `chars * 6px + 7` of clear space at 10px mono, and
  the gap between labels is 3 bars for numbers but a whole session for dates —
  so at 3D (3.6px a bar) the numbers go and the three date labels stay, which is
  exactly what the reader needs. The readout folds both suppressions into ONE
  clause (`zoom in for bar marks and numbers`): two "zoom in for…" phrases in
  that line is noise, and the gesture that fixes them is the same.

### RTH / ETH

- **[session.ts](src/shared/session.ts) is the ONLY code here that knows about
  exchange-local time, and that is deliberate.** Everything DISPLAYED is UTC
  because the stored key is UTC and a mark id is built from it. A session
  WINDOW is the opposite case: "regular hours" is defined by the exchange in
  its own clock — 09:30 to 16:15 New York — which is 13:30 UTC in summer and
  14:30 in winter, so filtering on a UTC clock would shift the window by an
  hour twice a year. On a 5-minute chart that is twelve bars of the wrong
  session at one end and twelve missing at the other.
- **One `Intl` call per SESSION DAY, not per bar.** Measured on a 60-day pull:
  per-bar `formatToParts` is 50 ms, the per-day offset cache is **3 ms**, and
  the output is byte-identical. Intl is the only correct way to get a zone
  offset without shipping a timezone table, and it is slow enough to matter
  11,609 times. Note the shipped window sits entirely inside EDT (-240
  everywhere), so nothing in the current data would catch a hard-coded offset:
  the per-day cache is untested, not proven.
  **And it is keyed on the UTC day, which is coarser than a DST transition.**
  Both US transitions land at 06:00 / 07:00 UTC, so on that one UTC day the
  bars either side of the change would all take the offset the day's FIRST bar
  resolved. It is harmless only because ES is shut across both: the transitions
  fall on a Sunday, and Globex does not reopen until 22:00 / 23:00 UTC that
  evening, after the change. Right by the exchange's calendar, then — not by
  construction. A market that trades through a transition needs the cache keyed
  on the offset's own validity, not on `dayOf(key)`.
- **It FILTERS the dataset; it does not hide bars on the chart.** `applySession`
  returns a new `Dataset`, so metrics, structure, ATR, the rules and the
  readings all see RTH bars only — an RTH chart whose ATR was computed over the
  overnight is not an RTH chart. The consequence is that bar i-1 to bar i
  crosses the overnight at a session boundary and `gap` fires there, which is
  correct and exactly how a daily series already behaves across a night.
  Measured: 11,609 -> 3,402 bars, **81 a session, every session** (min = median
  = max), 41 overnight boundaries, and `--check` passes on the filtered series.
- **`rolls` is REBUILT, not remapped.** The indices are positions in `d` and
  dropping 71% of the bars moves every one of them.
- **`app.interval` READS THE DATASET, NOT THE SETTING — and `app.range` is
  resolved against it.** The setting is a request; the loaded dataset is the
  answer, and they can legitimately differ. The artifact is the case that
  proves it: it carries one snapshot, cannot switch and therefore never patches
  the setting, so an artifact built from a 5-minute snapshot had
  `settings.interval === '1d'` and told the reader **"Daily bars"** over
  intraday candles — while the session control, which derives from the dataset,
  correctly appeared. `range` is resolved the same way, because the artifact
  never runs settings coercion and a stored `6M` would leave every preset
  unpressed. Read `app.interval` / `app.range`; `settings.*` is what is on disk.
  Build an artifact from `data/es_5m.json` before trusting anything here — the
  daily smoke cannot see this class of bug.
- **The AGGREGATE rides `can.timeframes`, and the artifact is why.**
  `settings.interval` is a REQUEST, and only a target that can switch bar size
  is in a position to make one — the artifact carries a single snapshot and IS
  whatever that snapshot holds, so the `1d` it stores is a default that means
  nothing. Without the guard, an artifact built from `data/es_5m.json` matched
  the RTH-daily branch and silently aggregated its own 11,609 five-minute bars
  into 44 daily ones: `Daily bars · ETH · 44 in view` on a page published as a
  5-minute chart. This is the `app.interval` fault below, MOVED rather than
  fixed — reading the dataset stopped the label lying and left the transform in
  place. Build from `data/es_5m.json` and run `npm run smoke` after touching
  `dataset`; the daily artifact cannot show you this.
- **`app.session` READS THE DATASET TOO, and did not, which cost the RTH daily
  chart its restart.** `boot()` asked the source for `settings.interval`, never
  consulting `settings.session` — so a window left on RTH daily reopened
  holding the feed's own 24-hour daily bars, with the session control still
  showing RTH pressed and the heading quietly dropping the `, RTH`. Clicking
  RTH did nothing, because `setSession` compares against the SETTING and the
  setting already said RTH; the only way back was ETH and then RTH again.
  Two halves, and both are needed. `sourceIntervalFor(interval, session)` in
  [session.ts](src/shared/session.ts) is now the one answer to "which series
  does this chart load", used by `boot`, `setSession`, `setInterval` and main's
  boot refresh — which was refreshing `1d` at a renderer holding 5-minute bars,
  so `adopt()` correctly discarded it and an RTH daily window never got a boot
  refresh at all. And `session` derives from `#raw`: a daily series that came
  from the FEED is ETH whatever the setting says, because an RTH daily bar has
  to be aggregated and this is not one. That also makes the offline fallback
  honest — if the intraday pull fails, boot shows the feed's daily bars, says
  so in a notice, and the control reads ETH rather than lying.
- **`AppState.dataset` is DERIVED from `#raw` plus the session.** One pull
  serves both windows, so switching is a re-derive (~70 ms) rather than a round
  trip, and nothing can hold a dataset that disagrees with the setting. Two
  places had to learn the difference: `refresh()` compares the new length
  against `#raw`, not `count`, or an RTH refresh reports having lost 71% of its
  bars; and `adopt()` compares `#raw.fetched`.
- **ETH is the default**, because it means "every bar the feed has" and this app
  does not silently drop 71% of what it pulled — the Notes card says how many
  bars RTH is holding back for the same reason. RTH is the reader's choice.
- **The control is no longer intraday-only, and on DAILY it is a LOAD.** The
  feed's daily bar is the whole 23-hour Globex day, so an RTH daily bar does not
  exist to be filtered for — it is aggregated from the intraday series in
  [aggregate.ts](src/shared/aggregate.ts). That needs a second dataset, so the
  daily case rides `can.timeframes` while the intraday case still needs no
  capability at all; `app.sessionApplies` is that whole sentence, and the
  artifact therefore offers the control only where it is a pure filter over its
  own snapshot.
  - **`RTH_DAILY_SOURCE` is `5m`, and hourly was REJECTED on correctness.**
    Measured: Yahoo serves 14,560 hourly bars over the full 730 days against 60
    days of five-minute ones — and hourly bars sit on the hour in New York, so
    the 09:00 bar straddles the 09:30 open and the 16:00 bar straddles the 16:15
    close. Every window is wrong at both ends, and an open and a close are what
    a price-action chart is read on: every bar rule tests where the close sits
    in the range. 42 correct sessions beat two years of guesses.
  - **`#sourceInterval` is not `interval`.** On an RTH daily chart the raw is
    5-minute and the dataset is daily, so `refresh()` and `adopt()` ask for what
    is actually HELD, while `interval` stays what the chart is OF. Get that
    wrong and a refresh swaps the RTH source for the feed's daily series under
    the reader.
  - **`Dataset.window` says which hours a daily bar covers.** An intraday
    dataset says so in its own keys; a daily key is just a date, so the
    aggregate carries the marker and `slugFor` reads it — otherwise an RTH daily
    export and a 24-hour one leave under the same filename, the exact failure
    the export-naming note warns about. Optional, and never written to a cache,
    so nothing on disk is invalidated.
  - **The Notes card had to stop contradicting itself.** "No aggregation and no
    downsampling" is that card's first sentence, and it sat directly above the
    paragraph explaining the aggregation. Both the heading and that sentence now
    switch on `app.aggregated`.
- **The export filename says which window it holds** (`ES_F_5m_rth.csv`),
  derived from the DATA rather than from settings, so the name stays true if the
  reader switches before the dialog closes. Two exports of one symbol and
  interval otherwise differ by 71% of their rows under the same name.

---

## Bar reading

One line per bar, in words — [reading.ts](src/shared/marks/reading.ts), printed by
`npm run marks -- --read`, and shown in two places: the **readout** carries the
reading of whatever session the crosshair is on, and the **marking pane's tape**
is a row per session in view, newest first, clicking one to highlight that bar.
Every session gets a line — and on the tape the line's last clause is the marks
themselves, as chips. See the tape notes above for that half.

- **It names no pattern it did not import.** The adjectives — trend bar, doji,
  shaved, big — read `BIG_ATR`, `DOJI_BODY`, `SHAVED_TAIL`, `PIN_TAIL` and
  `isTrendBar` straight out of [rules/bars.ts](src/shared/marks/rules/bars.ts),
  and the composite patterns are not re-derived at all: `readings()` takes the
  marks `detect()` already produced and names them by their rule labels. A
  second idea of what a breakout is would drift the day `BREAKOUT_LOOKBACK`
  moved, and the chart would then draw one thing and read another.
- **A mark joins a reading only if `knownAt === at`.** A double top is not
  readable on the day of its second peak, and a bar-by-bar reading that names
  it there claims foresight. Confirmation-lagged patterns stay the TAPE's
  business, where the chip prints `→27 Aug` and its strip the full lag. `--check` asserts it: every phrase in a
  reading has to be a rule that fired on that bar AND was knowable at its close.
  Verified to have teeth: dropping the `knownAt !== at` filter reports
  *"reading at 2000-10-24 names bear-channel, knowable only at 2000-10-27"* and
  exits 1.
- **`STATED` drops the clause, never the rule.** Eight rules say what an
  earlier clause has already said — `big-bar` adds nothing to a leading "big" —
  and without the set a line reads *"bull trend bar, shaved top — trend bar,
  big trend bar, shaved bar"*. What survives is exactly the composite set:
  reversal bar, ii/ioi, climax, breakout, follow-through, two-bar reversal.
- **The reading is built from the UNFILTERED marks.** A rule toggle changes
  what is drawn; it does not change what a bar did. Keying the prose to
  `app.marks` would drop the "breakout" clause the moment the reader hid the
  arrows, which is a lie about the session.
- **`Rule.phrase` exists for two rules.** "Pullback entry (H1-H4 / L1-L4)"
  names a toggle honestly and reads as a definition mid-sentence. The other 29
  labels lower-case cleanly, so `phrase` stays absent rather than restating
  them, and `phraseOf()` is exported because `--check` has to reverse it.
- **Tone colours the BAR clause only.** The context and the pattern names are
  statements about the market around the bar; painting them the bar's direction
  would claim they agreed with it. A suspect print or a contract start is
  `caution` — that is what the tone is for.
- **The readout carries ONE reading; the pane carries the list.** The line
  under the O/H/L/C figures is the reading of the focused bar and the reason the
  feature does not need to be on screen to be useful — nine times out of ten the
  question is about the bar under the crosshair, and that answer should not cost
  a glance away from the candles. It is the same `Reading` component the list
  rows use, so the colour grammar cannot drift between the two surfaces.
- **That line is `aria-hidden`, and the reading is SPOKEN from ChartPanel.**
  The readout is an `aria-live` region with `aria-atomic="true"`, so every
  crosshair move re-reads all of it: adding the sentence there took the
  announcement from 42 words to 54 (measured by cloning the region and stripping
  hidden nodes — `textContent` does not respect `aria-hidden`, so a naive count
  cannot see this). `ChartPanel`'s `sr-only` region already exists to describe
  the focused bar as prose, which is where a sentence belongs, so the reading is
  appended to `spoken` and hidden in the readout. Announced once, and the
  readout is back to the length it was.
  - **Pre-existing, and NOT fixed here: those two live regions duplicate each
    other.** Both read `app.focusBar`, both fire on hover, and together they
    announce 74 words per crosshair move. Dropping `aria-live` from the readout
    would take that to 32 and lose nothing, but it is shipped behaviour outside
    this feature's scope and wants a decision rather than a drive-by.
- **Clicking a line is a THIRD gesture, with its own state.** `selectedBarIndex`
  is not a reuse of `keyIndex`: the keyboard crosshair outranks the pointer, so
  driving the highlight through it would freeze the readout and stop the
  chart's own hover from updating it. `focusIndex` therefore reads
  keyboard → pointer → clicked line → last session, so the readout follows a
  clicked line but the pointer takes it straight back.
- **The highlight is a band drawn by the PRIMITIVE, in `--focus`, not a tone.**
  The mark band borrows its mark's hue because a mark has a direction to state;
  a session does not, and a green band would say "this bar is bullish" when the
  reader only asked where the line was. Both bands can show at once and stay
  tellable apart. Measured with both probe controls: a click changes 5,814
  pixels on the primitive's canvas and **zero on the price axis** — the band
  cannot move the scale, because `autoscaleInfo()` is null.
  **It is a FILL AND NOTHING ELSE now: the two 0.85 rails are gone.** They ran
  down each edge at one pixel and were the loudest thing either band drew, so
  when the highlight had to come down in opacity they are what came off — the
  fill stays at `FOCUS_BAND_ALPHA` 0.22. What they bought is written down in
  palette.ts rather than lost: at MAX zoom a session is a fraction of a pixel,
  the band is clamped to `BAND_MIN_PX`, and the rails were what located it
  there. **If a five-pixel tint proves too little to find, widen that clamp —
  do not put a 0.85 line back over the candles.** With the rails gone the two
  band painters were the same code with two constants, so there is now ONE,
  `paintBand`, taking the colour and the alpha as arguments; two identical
  functions drift the day one of them is edited.
- **A BAR POSITION MUST NOT OUTLIVE THE DATASET IT INDEXES, and bounds-checking
  it is only half the fix.** `keyIndex`, `hoverIndex` and `selectedBarIndex` are
  positions in a dataset that is DERIVED, so it changes length underneath them
  with nothing loaded and `#apply` never called: RTH/ETH intraday is a pure
  re-derive (11,609 bars to 3,402) and so is 5-minute RTH to daily RTH (3,402
  to 42). `focusIndex` bounds-checks all three, which catches the out-of-range
  half — a reading line clicked deep in the intraday list used to leave the
  readout on dashes and `focusReading` naming a bar that does not exist, prose,
  so it printed *"flat bar — trading range, LNaN"* rather than throwing.
  **The other half is an index that stays perfectly IN range and names a
  DIFFERENT session**, and that shipped: measured, clicking the reading line
  for 21 Aug 2026 on the RTH daily chart and switching to 5-minute bars put the
  readout and the highlight on 01 Jul 2026 16:30 UTC, seven weeks from the
  session the reader picked. So:
  - **the reading selection is held as a DATE** (`selectedBarDate`), and
    `selectedBarIndex` is derived by resolving it against the series on screen
    — the same shape `selectedMarkId` → `selectedMark` has, and it clears
    itself by construction when the bar is not there. Verified both ways: the
    daily→5m switch above now falls through to the last session with no line
    pressed, and an RTH 5-minute bar clicked then switched to ETH — where that
    bar still exists — keeps both the readout and the pressed line.
  - **`#dropCrosshair()` forgets `keyIndex` and `hoverIndex` on every path that
    changes the bars**, re-derive as well as load: `#apply`, both branches of
    `setSession`, and `setInterval`'s fast path. **On the LOAD path it is
    `#apply` that calls it, which means AFTER the load succeeded** — a switch
    that fails changed nothing, so it must not move the reader either.
    Measured with the 5-minute feed refused and no 5m cache: with the drop
    hoisted above the `await`, a keyboard crosshair on 18 Sep 2000 landed on
    28 Jul 2026 on a switch that errored and left the chart exactly as it was.
- **`#span` is the one clamped viewport.** The data table and the tape both
  need "what is on screen", and the chart can report a bar past the end
  mid-refresh. Copies of `Math.min(viewport.to, n - 1)` are chances for the two
  to disagree about what is visible. The merge removed one of the three readers
  it used to have, not the reason for it.
- **`buildCtx` is hoisted to `#ctx`.** The reading needs the same metrics and
  structure the rules do. Two calls would walk 6,550 bars twice and, worse,
  could be handed different structure dials and quietly disagree about what a
  pullback was.
- **`readingIndex` is built once per dataset, not per reading.** The readout
  asks for ONE bar's reading on every crosshair move, and `readings()` used to
  build its date map inline — 11,000 map inserts to answer a question about one
  session, per pointer event. `readingIndex()` + `readAt()` make that a pair of
  lookups; `readings()` is now a loop over `readAt`. Measured on the shipped
  series: the index is 1.8 ms once, `readAt` is **0.001 ms** a bar, 300 of them
  (a MAX viewport of rows) is 0.26 ms, and the old `readings()` call it replaced
  was 0.80 ms *every time* — so the hoist is worth about 0.8 ms per pointer
  move. Re-measure with a throwaway under `scripts/` rather than trusting these.
- **Measured over the whole series: the longest reading is 176 characters** and
  8 of 6,550 carry nothing but the bar's own body. `--read` prints both figures,
  because a reading that wraps to two lines has stopped being a line.
- **THE PANE IS ONE TAPE, AND THE TABS ARE GONE.** *Marks in view* and *Bar
  reading* were two newest-first lists over the same viewport, so the tab
  between them was a switch the reader paid on every glance — and the two
  overlapped by construction, because a reading names the patterns knowable at
  that close and the mark list was listing those same patterns for the same
  bar. [Tape.svelte](src/renderer/lib/components/Tape.svelte) is now the single
  view: one row per session, newest first, the reading as the row and its marks
  hanging off it. `MarkList.svelte` and `ReadingList.svelte` are deleted;
  `Reading.svelte` is untouched apart from one prop, because the colour grammar
  is still shared with the readout. The pane still does not collapse, and that
  is still the price of the placement — it is bounded so it can never run away
  down the page, and the readout carries the current bar's reading whatever the
  filter says.
- **THE PATTERN CLAUSE IS RENDERED AS THE MARKS.** `Reading` is asked to leave
  its last clause off (`patterns={false}` — the switch exists for this and only
  this) and the chips take its place, so the sentence and the mark list stop
  saying the same words twice and the words become clickable. Three cases fall
  out of that and all three are meant:
  - **a mark the prose does NOT name is a chip on its own.** Either the reading
    already stated it in an earlier clause — the `STATED` set in reading.ts,
    which is why `inside` and `big-bar` are chips with no text — or it was not
    knowable at that close, like a channel confirmed three sessions later.
    The second kind prints `→27 Aug`, because the row's date is not the date it
    was readable.
  - **a pattern the prose names with NO mark behind it stays as dim text.** The
    rule is switched off, or the mark was dropped. That is rule state made
    visible in the tape rather than a discrepancy papered over; 12 of 127 rows
    carry one on the shipped snapshot. Matching is by `phraseOf`, IMPORTED from
    reading.ts rather than restated — two ideas of what a pattern is called
    would let one surface disagree with the other.
  - **a session with neither is one line of prose,** which at the shipped
    density is a little over half of them.
- **THE TAB BECAME A FILTER, and it asks a different question.** It asked
  "which list?"; it asks "how much of the tape?" — All / Marked / Unresolved,
  a `radiogroup` rather than a `tablist` because there is one panel now and
  three mutually exclusive settings of it. Arrow keys still move and select, so
  the handler survived nearly intact. **`Unresolved` is new and is the marking
  loop's missing finish line**: it counts SESSIONS holding a mark with no
  verdict, so it empties as the reader works and an empty list under it means
  done rather than broken — which is why that filter has its own empty copy.
  All three counts show at all times, for the reason both tabs used to.
- **ONE CAP, because it is one list.** `MARK_LIST_CAP` 200 and `READING_CAP`
  300 bounded two different things; the row IS a session now, so `TAPE_CAP` 300
  bounds sessions. The honest consequence, and the header prints it: **a mark
  anchored older than the newest 300 sessions in view has no row to sit on and
  is not listed.** At 0.71 marks a bar the old 200-mark cap fell about 280
  sessions back anyway, so what changed is which of the two is exact.
- **Two gestures share a row and they stay two.** The sentence selects the
  SESSION (`selectedBarDate`, a `--focus` band); a chip selects the MARK
  (`selectedMarkId`, the mark's own tone). Both bands can show at once and are
  already tellable apart. **The chip needed no state of its own**: it opens its
  detail strip when it is the selected mark, so one click both highlights it on
  the chart and opens it, `selectedMarkId` already toggles on a second click,
  and the strip already clears itself when the mark stops being drawn.
- **The strip is where the mark table's Rule, Detail and verdict columns went,
  and it is what paid off the ~535px floor.** Those three columns now render
  for one mark at a time instead of for every row, and the Session column
  became the rail the reading already had. Nothing was trimmed — that note
  warned against shrinking the date, the label and the Keep/Drop pair, and all
  four are still full size.
- **`.say` is `display: inline-block`, deliberately not `inline`.** A
  shrink-to-fit box leaves the chips on the sentence's line when there is room
  and takes the full width when the sentence is long, so the chips wrap under
  it rather than into the middle of it. `display: inline` would flow them into
  the last line and save about 900px of the 5,751px content height measured at
  the pane's 642px — worth 16%, and not worth a display model Safari has never
  been dependable about. Measured there: 127 rows, median 36px, 82 on one line,
  59 carrying chips.
- **The chips are BUTTONS BESIDE the sentence, never inside it.** The row is a
  grid whose prose cell holds the sentence-button and the chips as siblings. A
  chip inside `.say` is a button inside a button — the same constraint that
  stopped the tabs going in a `<summary>`, which is how the pane lost its
  `<details>` in the first place.
- **The date is a 7ch RAIL, not a line of its own, and that buys three rows.**
  The obvious narrow-column answer is to stack the date above the reading, which
  is what the container-query fallback did. Measured at the pane's 647px:
  stacking puts every row on two lines, median 51px, **8 visible**; a rail with
  the sentence hanging beside it leaves 89 of 128 readings on ONE line, median
  34px, **11 visible**. The rail is both the thing the eye runs down and the
  cheaper layout. The year prints only where it changes, as a sub-label, so the
  rail never widens to 11ch to repeat a fact that changes once a year.
- **Svelte trims the space before an inline clause, and it is silent.**
  `<span class="ctx"> — {context}</span>` renders as `…the session before—
  always-in long`: the leading space inside the element is trimmed by the
  compiler, and a space written between the tags is collapsed by the same pass.
  [Reading.svelte](src/renderer/lib/components/Reading.svelte) emits explicit
  `{' '}` text nodes. Nothing warns about this; it shows up as prose with a word
  glued to a dash. **It caught the tape too, on the very next clause**: the em
  dash before the mark chips rendered as `trading range— ib`, found by
  screenshot rather than by any check, so `Tape.svelte` emits them as well.
- **The rules card is bounded in the STACKED layout too, which it deliberately
  was not.** Unbounded, 31 rules run to about 1,300px, and with the pane now
  below it the tape landed **2,059px** down an 935px viewport. Bounding
  it moved that to 1,211px, and reaching the pane leaves the chart **249 of
  430px** visible instead of 0. The old comment in `MarkPanel` said unbounded
  was "right for the stacked layout" — it was, when that card was the last
  thing in the column.

---

## Direction

The name is the brief: **price action chart drawing and marking.** The charting,
data, theming, publishing, packaging, **two timeframes**, the **marking layer**
and the **bar reading** are done: 31 rules over three groups (special bars, the lines they
form, the entries they set up), drawn as one canvas primitive, with the reader's
keep/drop verdicts persisted per symbol and publishable into the artifact — and
a line of Brooks prose for every session in view, clickable back to the bar.

Shipped since, and equally done: the rules card **folds** its less-used rules
behind a per-group chip, with a modal **rules sheet** letting the reader move
any rule off the tier it ships with; the intraday chart carries **Brooks bar
numbers**, every third bar with the session's first bar dated; the session
window now reaches the **daily** chart, where RTH bars are aggregated from the
5-minute series rather than filtered for; and the marking pane's two tabs
became ONE **tape** — a row per session carrying its reading and its marks as
chips, filtered All / Marked / **Unresolved**.

**What is left is DRAWING — marks the reader makes by hand.** Everything that
needs is already in place and was built that way on purpose:

- `Mark` carries `source: 'manual'` and `MarkStore` carries a `manual` array —
  but **`coerceStore()` returns `manual: []` unconditionally**, on load and on
  save alike, so today the field is reserved rather than round-tripped. The
  serialised SHAPE is already right and no file on disk needs migrating, which
  is the part that matters; the one function that has to change is
  `coerceStore`, and it has to validate what it lets through, since a manual
  mark is the first thing in that file a reader could hand-edit into any shape.
  (This note used to claim the array "is read on load", which it is not.)
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

