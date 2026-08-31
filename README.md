# Price Action Mark

Price action charting, daily and 5-minute — mark up the tape, then publish it. The
chart reads itself with **31 rules drawn from Al Brooks's price action method**
(special bars, the lines they form, the entries they set up); you keep the marks
you agree with, and the confirmed set travels inside a single self-contained
HTML file. It also **reads the tape in words** — one line of Brooks prose per
session in view, clickable back to the bar it describes. Ships with E-Mini S&P 500 futures (CME `ES`) from a free, keyless
source; the data layer is symbol-generic.

Two timeframes — **daily** back to 2000, and the last 60 days of **5-minute**
bars — from one keyless source.

One Svelte 5 codebase, **two build targets**:

| Target | Command | Output |
| --- | --- | --- |
| Electron desktop app | `npm run build` | `out/` (packaged with `npm run dist`) |
| Single-file HTML artifact | `npm run artifact` | `dist/price_action_mark.html` (~750 KB, self-contained) |

The desktop app ships for **Windows (x64)** and **macOS (Apple Silicon)**.
Intel Macs are not supported: the mac build is arm64-thin, so it will not run
on one. The artifact has no platform — it is a single HTML file.

Both render the same components against the same dataset, the same design
tokens and the same chart controller. They differ in exactly one file —
[src/renderer/lib/source/](src/renderer/lib/source/) — which declares what each
target is *able* to do. The desktop app can pull live data, save files through
a native dialog and persist settings to disk; the artifact runs under a CSP
with no remote origin and a sandbox that blocks downloads, so it carries a
dated snapshot and uses `localStorage`. Components read `source.can.*` and do
not render a control that would not work.

This is a complete rewrite of `../es-chart-v1` in Node and TypeScript. No Python
anywhere: `scripts/fetch_data.py` and `scripts/es_daily_csv.py` became
[fetch-data.ts](scripts/fetch-data.ts) and [export-csv.ts](scripts/export-csv.ts),
which run straight off Node's native type stripping — no build step, no `tsx`,
no dependencies. The port is faithful: against the same endpoint it reproduces
all 6,550 bars and all 104 roll indices byte-for-byte, differing only in the
live session that moved between snapshots.

Picking this up on another machine, or handing it to an agent? Start with
**[CLAUDE.md](CLAUDE.md)** — prerequisites, the version ceilings that must not move,
the invariants, the traps, and what is deliberately absent.

## Stack

| | | Why this version |
| --- | --- | --- |
| Electron | 44.0.0 | ESM main; sandboxed CommonJS preload |
| Svelte | 5.56 | runes — `$state` / `$derived` on plain classes |
| Vite | 7.3.6 | **not 8** — see below |
| electron-vite | 5.0.0 | peers Vite `^5 \|\| ^6 \|\| ^7` |
| @sveltejs/vite-plugin-svelte | 6.2.4 | peers Vite `^6.3 \|\| ^7`; v7 requires Vite 8 |
| TypeScript | 5.9.3 | **not 7** — `svelte-check` peers `^5 \|\| ^6` |
| lightweight-charts | 5.2.1 | TradingView, Apache-2.0 |

Two version ceilings are load-bearing and will bite anyone who runs
`npm update`:

- **Vite stays at 7.** `electron-vite@5` does not accept Vite 8, while
  `vite-plugin-svelte@7` requires it. Vite 7 + plugin 6 is the only pair that
  satisfies both. Moving to Vite 8 means waiting for `electron-vite@6`.
- **TypeScript stays at 5.9.** `svelte-check@4.7` peers `^5.0.0 || ^6.0.0`, so
  the TypeScript 7 native compiler is out of range until svelte-check widens it.

## Quick start

```bash
npm install            # postinstall fetches the Electron binary (see note)
npm run data           # refresh data/es_data.json from Yahoo   (optional)
npm run dev            # the desktop app, with HMR in the renderer
npm run artifact       # the single file -> dist/price_action_mark.html + preview.html
npm run smoke          # headless render check of the artifact
npm run smoke:app      # headless render check of the desktop app
```

> **npm 11.16+ blocks dependency install scripts**, and Electron downloads its
> ~120 MB binary from one, so a plain `npm install` leaves you with
> *"Electron failed to install correctly"*. The root package's own lifecycle
> scripts still run, so [scripts/postinstall.ts](scripts/postinstall.ts) invokes
> Electron's installer directly, and only when the binary is actually absent.

### Installing it on your own Mac

Nothing here is a port. The codebase carries no `win32` branch, and the two
`darwin` branches it does have — `window-all-closed`, and the app menu with
`close` in place of `quit` — are the ones macOS wants. Build it and copy it:

```bash
npm run pack
rm -rf "/Applications/Price Action Mark.app"
cp -R "release/mac-arm64/Price Action Mark.app" /Applications/
```

That is the whole install. **No Apple Developer account, no code signing, no
notarization**, and no need for the dmg that `npm run dist` would produce — a
dmg is a transport format, and nothing is being transported.

The reason is Gatekeeper's trigger. It keys off the `com.apple.quarantine`
attribute, which is written by whatever *downloads* a file: a browser, Mail,
AirDrop. A bundle you built yourself was never downloaded, so it carries no
such attribute and is never assessed. It opens from Finder, the Dock and
Spotlight like any other app. This is why `electron-builder.yml` has no signing
configuration and why the *"skipped macOS application code signing"* line on
every `pack` is noise rather than a warning.

Requires macOS 13, Electron 44's floor — which every Apple Silicon Mac clears.

**This is an Apple Silicon build, and it is arm64-thin rather than universal**:
7 executables and 6 dylibs in the bundle, all arm64, no x86_64 anywhere. It
will not run on an Intel Mac, and it is never running under Rosetta, because
there is no x86_64 code in it to translate. `electron-builder.yml` says
`arch: [arm64]` deliberately; `npm run pack` builds the host architecture and
ignores that list either way, so only `npm run dist` was ever affected.

Menu accelerators are registered as `CmdOrCtrl`, so **every `Ctrl+X` in this
README is `⌘X` on a Mac**. The buttons say it correctly themselves:
[keys.ts](src/renderer/lib/keys.ts) writes each chord in the reader's own
notation and in Apple's modifier order — `⇧⌘M`, not `⌘⇧M`.

Two things make the app exit silently — no window, no error, exit 0 — and they
are easy to mistake for each other:

- **`open` hands the calling shell's environment to the app.** If that shell
  exports `ELECTRON_RUN_AS_NODE=1`, the Electron binary runs as plain Node and
  quits immediately. Finder, the Dock, Spotlight and a normal Terminal are
  unaffected; a shell that has it needs `env -u ELECTRON_RUN_AS_NODE open …`.
- **A leftover `npm run dev` runs under the name `Electron`,** not
  `Price Action Mark`. It holds the single-instance lock, so the installed app
  quits before drawing — and `pkill -f "Price Action Mark"` will not find it.
  Use `pkill -f "node_modules/electron/dist"`.

Settings, the dataset cache and your mark verdicts live in
`~/Library/Application Support/price-action-mark/`. Deleting that directory
resets the app to a first run; nothing in it is precious.

> **If it ever has to leave this machine.** `scp`, a USB stick and `curl` do
> not set the quarantine bit, but a browser, Mail and AirDrop do — and on a
> quarantined install the current build fails the confusing way, reporting
> *"is damaged and can't be opened"*. That is a broken bundle seal, not a
> corrupt download: electron-builder inserts `app.asar` and a new `Info.plist`
> into a bundle still carrying the Electron binary's inherited signature.
> `codesign --force --deep --sign -` repairs the seal for free and turns the
> dialog into the ordinary *"Apple could not verify…"*, which **Open Anyway**
> under System Settings ▸ Privacy & Security clears. Signing with a Developer
> ID but not notarizing is blocked identically, so for public distribution it
> is notarize or don't bother.

## Scripts

| | |
| --- | --- |
| `dev` | electron-vite dev server; renderer hot-reloads, main restarts |
| `build` | typecheck, then build main + preload + renderer into `out/` |
| `dist` / `pack` | electron-builder installer / unpacked directory |
| `artifact` | Vite bundle + [inline-artifact.ts](scripts/inline-artifact.ts) |
| `data` | Yahoo → `data/es_data.json` (`-- --symbol MES=F`, `-- --interval 5m`) |
| `csv` | Yahoo → CSV, any symbol or interval (`-- --interval 5m`) |
| `marks` | the marking layer's text oracle — see [Marking](#marking) |
| `marks -- --read` | the bar-by-bar reading in words — see [Reading the bars](#reading-the-bars) |
| `marks:check` | invariants + the regression fixture; exits non-zero on drift |
| `tokens:check` | the palette's guard: the three scopes agree, contrast holds |
| `icon` | [resources/icon.svg](resources/icon.svg) → `icon.png` + `icon.icns` |
| `typecheck` | `tsc` over main/preload/scripts, `svelte-check` over the renderer |
| `smoke` / `smoke:app` | load the built output in real Chromium and assert it drew |

## Layout

```
electron.vite.config.ts     target 1 — main + preload + renderer
vite.artifact.config.ts     target 2 — renderer only, everything inlined
scripts/inline-artifact.ts  target 2, second half — fold into one .html + guards
scripts/mark-report.ts      the marking layer's text oracle

src/shared/                 imported by main, renderer AND the CLI scripts
  yahoo.ts                    fetch + normalise; the only network code
  interval.ts                 bar size: keys, ranges, feed limits
  session.ts                  RTH/ETH window + trading-day bar numbers
  rolls.ts                    expiry arithmetic + contractStarts()
  aggregate.ts                intraday -> daily bars, for RTH daily
  indicators.ts               ema(), atr(), trueRange()
  instrument.ts               per-symbol tick size
  types.ts  ipc.ts            the dataset shape and the whole IPC contract
  format.ts  csv.ts           one set of formatters for axes, readout and CLI
  marks/                      the marking layer — pure, no Node, no DOM
    metrics.ts                  per-bar columns every rule is written in
    structure.ts                pivots, legs, always-in state, H/L counts
    reading.ts                  one line of Brooks prose per bar
    fit.ts                      fitLine + touch/break measurement
    types.ts  rule.ts           the Mark union; the Ctx/Rule contract
    registry.ts                 RULES — the one array; push to extend
    trade.ts                    entry/stop/target + the walk-forward
    rules/                      bars.ts, lines.ts, entries.ts

src/main/                   Electron main
  index.ts                    window, CSP, IPC handlers, save dialogs
  dataset.ts                  network → cache → bundled, in that order
  settings.ts  menu.ts        atomic JSON settings; native menu
  marks.ts                    verdicts, one atomic JSON per symbol+window
  window.ts                   vertical maximize (no Electron API for it)

src/preload/index.ts        the entire privileged surface, sandboxed CJS

src/renderer/
  App.svelte                  layout, theme wiring, menu-command routing
  lib/source/                 the seam: electron.ts | artifact.ts | types.ts
  lib/state/app.svelte.ts     one rune-based store for the window
  lib/chart/candles.ts        every imperative call into lightweight-charts
  lib/chart/numbers.ts        Brooks bar numbers, as their own primitive
  lib/chart/marks/            ONE primitive for all geometry, not one per mark
  lib/components/             Masthead, Controls, Readout, ChartPanel,
                              MarkPanel, RulesSheet, MarkingPane, Tape, …
  styles/                     tokens.css (palette), fonts.css, app.css
```

## The data

Yahoo Finance's undocumented v8 chart endpoint, symbol `ES=F`. Free, no API
key, 6,550 daily bars back to 2000-09-18 — and, on the intraday timeframe, the
last 60 days of 5-minute bars. All of it lives in
[src/shared/yahoo.ts](src/shared/yahoo.ts), which runs unchanged in Node and in
the Electron main process — both have global `fetch`, and neither is subject to
CORS.

Four things that cost real time to discover:

- **`range=max` is broken for this symbol.** It returns ~266 near-monthly bars.
  `range=10y` gives 2,517; an explicit `period1=0` gives the full 6,593. The
  module never sends `range` at all — only explicit epochs.
- **`ES=F` is an unadjusted stitched front-month series, not back-adjusted.** It
  has genuine discontinuities at quarterly expiries — measured: `2024-12-23`
  +2.77%, `2024-03-18` +1.65%, `2023-12-18` +1.62%. A return computed across a
  roll is carry, not a tradable move. [rolls.ts](src/shared/rolls.ts) computes
  the expiries from the third Friday of Mar/Jun/Sep/Dec, stepping forward over
  holidays to the next real session — and `contractStarts()` turns those into
  the bars the chart actually marks, one session later, where the new front
  month opens and the carry lands.
- **Dirty bars.** Holidays arrive as `close: null`, some sessions carry
  `volume: 0`, and Yahoo occasionally duplicates the live bar. 43 of them in the
  current pull. `toRows()` filters nulls and de-duplicates by date.

To build a properly back-adjusted continuous series, pull the dated contracts
instead — `ESU26.CME`, `ESZ26.CME`, `ESH27.CME` each carry ~5 years of their own
history on the same endpoint — and stitch them with a ratio or Panama
adjustment. `npm run csv -- --symbol ESZ26.CME` will fetch one.

Licence note: yfinance-style access to this endpoint is personal/research use.
Yahoo's terms are not a commercial data licence. For anything customer-facing,
[Databento](https://databento.com/catalog/cme/GLBX.MDP3/futures/ES) is the
cheapest legitimate CME source.

### Intraday is a rolling window, not a shorter page

Measured against the live endpoint rather than read from documentation:

| interval | works | window | pageable backwards |
| --- | --- | --- | --- |
| `1m` | yes | 8 days a request, **~30-day archive** | **yes** |
| `5m` | yes | **60 rolling days**, 14,688 bars | no |
| `15m` / `30m` / `1h` | yes | 60 days | — |

The 60 days is the whole archive. A window covering days 60–120 ago returns
**HTTP 422**, and so does a 15-day window ending 55 days ago — the *entire*
requested range has to sit inside the window, so there is no walking backwards
to build history. `period1=0`, the trick that gets the full daily series, is
rejected outright:

```
422 — 5m data not available for startTime=969249600 …
      The requested range must be within the last 60 days.
```

So `fetchChart` **clamps** `start` for any interval with a `maxDays`, because a
422 and an empty chart look identical to a reader. Coverage where it exists is
good: ~223 non-null bars a session out of a 22.9-hour Globex day, with
`meta.tradingPeriods` present and `includePrePost` making no difference to a
future. Roughly 19% of a 60-day pull is null closes — 2,804 of 14,688 — which is
the weekend and holiday gaps, and `toRows()` drops them.

One thing that gets de-duplicated wrongly if you are not careful: `toRows()`
keys on the **bar**, not the calendar day. Keyed on the day, a 5-minute pull
collapses 275 bars a session into one, and the guard that exists to drop Yahoo's
duplicated live bar quietly becomes a downsampler.

### Where the desktop app gets its bars

[src/main/dataset.ts](src/main/dataset.ts) serves three tiers, in order:

```
network   live Yahoo pull, written back to the cache
cache     the last successful pull, in app.getPath('userData')
bundled   data/es_data.json, shipped beside the app as extraResources
```

The window opens on whatever is available fastest, so a cold start offline
still draws a chart. The live pull runs behind it and, when it lands, main
**pushes** the result down `dataset:updated` — the window is already painted by
then and would otherwise never ask again, leaving the fresh series sitting in
the cache until the next launch. Only the boot refresh broadcasts; a refresh the
user asked for returns through its own IPC call, and pushing that one too would
apply the same dataset twice and reset the crosshair under them.

**Which tier is on screen is stated in the footer**, and a failed refresh raises
a red notice — a stale cache that looks live is the one failure mode a price
chart cannot show you. `npm run smoke:app` asserts this end to end: wipe
userData, launch, and the footer has to read *"Pulled live from Yahoo"* rather
than the bundled snapshot it opened on.

## The window

One `App.svelte` lays out both targets. Above 1200px the chart and the marking
cards sit side by side; below it they stack in the same order they always did.

```
1200px+     [ chart card            ] [ rules pane  ]
            [                       ] [ marks pane  ]
under       [ chart card ]
1200px      [ rules card ]
            [ marks card ]
```

**1200px is where the chart still gets 705px** after the marking column's 420px
floor and the gutters. Narrower than that and the candles are what suffers,
which defeats the point of the second column.

The marking column is fluid — `clamp(420px, 34vw, 820px)` — and the page cap
goes to 2400px, because the rule rows carry a name, a count and a blurb and a
tape row carries a date rail, a sentence and its chips, and both were being
squeezed on exactly the screens this layout is for:

| Viewport | Chart | Marking column |
| --- | --- | --- |
| 1200 | 705 | 420 |
| 1500 | 915 | 510 |
| 1700 | 1047 | 578 |
| 1920 | 1192 | 653 |
| 2200 | 1377 | 748 |
| 2560 | 1520 | 820 |

### Two panes, because one scroller buried the list

The column held two stacked cards and scrolled as a single piece. Measured at
1700×1000: the column showed **964px**, its content was **2,257px**, and *Marks
in view* — the surface used on every keep, drop and highlight — started at
**2,217px**. It opened off-screen and stayed there, while the rule toggles you
set once and leave sat on top of it.

Four layouts were drawn before one was built: a tabbed inspector, this
swap-and-collapse, moving the rules into a toolbar popover, and these two panes.
The panes won on a plain trade: both surfaces stay visible with no mode to
switch, and the cost — two nested scrollbars, and blurbs that have to move to a
`title` — is smaller than the cost of hiding either one.

The rules card takes a bounded slice off the top and scrolls inside it; the
marking pane takes everything left and scrolls inside that. Neither can push the
other out, and the column itself does not scroll:

| Viewport | Column | Chart card | Rules pane | Marks pane |
| --- | --- | --- | --- | --- |
| 1250×900 | 668 | 669 | 254 (733 to scroll) | 396 (4,116 to scroll) |
| 1700×1000 | 768 | 766 | 292 (294 to scroll) | 458 (4,302 to scroll) |
| 1920×1080 | 848 | 846 | 322 (263 to scroll) | 508 (3,898 to scroll) |

Three details are load-bearing, and each was measured wrong first.

**`::details-content` is the flex item, not the card's body.** Chromium wraps a
`<details>`'s content in that pseudo-element, so a `display: flex` `<details>`
has two children: the summary and it. Leave it out of the chain and a bounded
card **clips instead of scrolling** — a 320px card held a scroll region
reporting 498px of content and `maxScroll: 0`, with the last rules unreachable.
Only the rules card needs it now — it is the one `<details>` left in the column,
since the marking pane became a `<section>` with a filter and a plain flex
chain — and both keep a `max-height` fallback so a browser without the
pseudo-element still scrolls rather than clipping.

**The column's height comes from the chart card, by stretching to it.**
`calc(100vh - 36px)` looks right and is not: the column starts 201px down the
page, so a viewport-tall column hangs 165px below the fold, and a reader marking
up never scrolls the page — those rows would be permanently cut. `--chart-h` is
already tuned to fit the fold, so deriving from the chart card holds by
construction.

It derived by *arithmetic* first — `calc(var(--chart-h) + 108px)`, where 108 was
a measured readout and legend — and that broke the day the readout grew a line
for the bar reading: 42px to 81px, and the two columns 16px out. A grid row that
stretches is exact whatever sits above the candles, so the constant is gone
rather than re-measured, and the rules card's slice became a plain `38%` for the
same reason.

**There is no `position: sticky`.** It existed to keep a 2,257px column in view
while it scrolled. There is no such column now, and a sticky one cannot be
fold-height at rest and viewport-height when stuck.

### A card's density is a container query, not a second breakpoint

The same box is full-width when stacked and a narrow pane when not, and it is
the **box's** width that decides what fits — so each measures itself rather than
re-reading the page breakpoint, which is how two files drift apart.

`MarkPanel` is no longer one of them, and the reason is worth keeping. Its one
container query decided the width at which the per-rule blurb line had to go —
and the blurb does not print on the card at any width now. It is the row's
`title`, which is where the narrow layout had always put it and what a screen
reader is handed either way, so a rule is a name and a count everywhere and the
compact grid is simply the layout. `bars` / `lines` / `entries` headings carry
the weight the blurbs used to.

The saving lands in the stacked layout, where the card is wide enough that the
blurbs used to show: 31 rules are **310px** of content in four columns at a
1045px card, against the **2,199px** one column of blurbs measured when that
was the layout. In the side column, at a 647px card, nothing moved — that width
was already below the query's 700px and already compact.

Two columns were not enough on their own, so the card also **folds the rules a
reader rarely reaches for**. Ten carry `tier: 'extra'` — `trend-bar`, `doji`,
`shaved`, `pin-bar`, `gap-bar`, `climax`, `spike-and-channel`, `pullback-entry`,
`failed-bo` and `final-flag` — and each group heading grows a `+6 ▾` chip that
reveals them in place. The chip rides the heading rather than taking a row of
its own, because the heading already spans the list and already carries the
group's name: a `▸ 5 less used` row per group was tried first and spent ~16px
each to say what the heading says for free. Measured on the artifact at a 647px
card, the list goes from **510px to 410px**, and the top row carries one
`Show all 10` for the whole card.

That is a 100px saving, not a fix: at 1904x1015 the list is 410px inside a
211px window, so it still scrolls, and roughly eighteen more folded rules is
what "fits" would cost. **The card is left scrolling on purpose**, and the
alternative was measured rather than argued: the list only fits with the card
at 524px, and in a fold-height column that money comes straight out of the
tape — 470px of rules leaves the tape 3 visible rows, 499px leaves 2, and at
the 524px that finally kills the scrollbar the tape is down to **one**. Letting
the column grow instead makes it the tallest item in the grid row, so the chart
card stretches with it and the marking pane's bottom edge drops from 29px below
the fold to 200px. Scrolling a card the reader visits occasionally is the
cheapest of those.

The fold is **not** a second `defaultOn`, though the two have to move together
for a rule to actually leave the list — a folded rule that is switched on is
promoted back in, so `tier` alone only buys the quieter name. `defaultOn` is
about density: a rule firing on a third of all sessions makes a chart less
readable than no marks at all. `tier` is about how often the reader consults
the toggle. `climax` is where they part company — 38 marks in 6,550 sessions,
nowhere near dense, and shipped off purely because nobody reaches for it.

### Choosing what folds

The shipped set is authored, but it is not the last word: `Choose rules…` in the
card's top row — and Marks ▸ *Choose folded rules…* — opens a modal listing all
31 rules with two boxes each, `Show` and `Fold`, the outcome spelled out in
words, and the marks-and-share figures the card has no room for. Group headings
carry a bulk action, the numeric column sorts by density (which flattens the
groups, because "what is noisiest" does not respect *bars / lines / entries*),
and a filter narrows 31 rows to the one you meant.

`settings.marks.folded` stores **only the ids moved off their authored tier**,
the way `marks.rules` stores only the ids moved off `defaultOn`, and the sheet's
footer says so out loud: *"5 rules moved off what this build folds — only those
are stored"*, or *"Nothing stored: every rule is where this build put it"*. A
fold set written out in full would freeze today's answer into every settings
file, so the merge that applies it has to be able to **delete** — and a fold
taken back is a key going away.

`marks.rules` did not actually hold up its half of that until an audit went
looking. `toggleRule` only ever added, so a rule switched off and back on
stayed pinned to today's default forever — the precise thing sparseness exists
to prevent. It now deletes a key whose value agrees with `defaultOn`, and the
merge deletes what an incoming record leaves out, so both records shrink.

Two details in that dialog were measured rather than assumed. The `Fold` box is
**disabled, not hidden**, while a rule is on (22 of 31 by default): an empty
cell reads as "this cannot be folded", where ticked-and-disabled says "folded,
and listed anyway because it is on" — and it keeps the preference, so switching
the rule off later puts it back where you had it. And its width tiers are about
**row height**, not sideways overflow: the table shrinks instead of scrolling,
so squeezing the name column wraps every label. At a 572px sheet with all six
columns the median row is **93px** and the tallest 143px, which shows six rules
where fifteen fit; the blurb drops at 700px and the numbers at 620px, and from
392px up a row is back to 32px.

One rule the fold cannot break: **a folded rule that is switched on is never
hidden.** It is promoted into the list, keeping the lighter name so "less used"
reads as one signal wherever it appears, with the ticked box saying the rest.
Hiding it would put marks on the chart whose toggle is nowhere on the page —
the mirror of the capability rule that says not to render a control that would
not work. `smoke.cjs` asserts the reveal and the re-fold, in a second
`executeJavaScript` call, because Svelte flushes on a microtask.

The marking pane declares the container the tape reads, and the tape drops its
date rail under a 430px pane. It used to declare one for two views, and the mark
table needed two more tiers of its own — 780px and 660px, tightening five
columns from a 766px minimum to **535px**, still 147px short at a 1200px
viewport and scrolling sideways below about 1700px. Those tiers went with the
table. The tape reaches the same widths without them, because it never had five
columns to fit: see [One tape, not two tabs](#one-tape-not-two-tabs).

## The chart

[lib/chart/candles.ts](src/renderer/lib/chart/candles.ts) is a class rather
than a few lines in a component, because four things about Lightweight Charts
v5 are not obvious:

| Concern | How |
| --- | --- |
| Series | `chart.addSeries(CandlestickSeries, …)` — v5 takes the type object, not v4's `addCandlestickSeries()` |
| Hollow up-candles | `upColor: 'rgba(0,0,0,0)'` + `borderVisible` + `borderUpColor` |
| EMA 20 | `LineSeries` on `priceScaleId: 'right'` — an overlay must share the price scale, never autoscale alone |
| Per-bar colour | on the data points, not series options |
| Roll markers | `createSeriesMarkers(series, markers)` — replaces v4's `series.setMarkers()` |
| Ranges | `timeScale().setVisibleRange()`, `fitContent()` for MAX |
| Keyboard | `setCrosshairPosition(price, time, series)` / `clearCrosshairPosition()` |

- **An overlay series must not get its own price scale.** Left on the default,
  the EMA would autoscale independently and float free of the candles it is
  meant to track. It is pinned to `priceScaleId: 'right'`.
- **The EMA has no value for its first 19 sessions.** Those points are omitted
  from the series rather than sent as zero, so the line begins where the average
  does instead of diving to the axis.
- **`localization.priceFormatter` is global.** It overrides every series, so a
  second series with its own units prints the wrong ones. Each series carries
  its own `priceFormat: { type: 'custom', formatter }` instead.
- **Markers don't thin themselves.** All 104 roll arrows render at MAX zoom and
  become a picket fence, so `#refreshMarkers()` drops them below ~18px of
  separation — and the readout says *"rolls too dense to mark"* rather than
  letting them silently vanish.
- **Per-bar colours only restyle via `setData`.** Candle colours live on the
  data points, not on series options, so a theme change cannot be applied to
  them with `applyOptions` alone.
- **Both axes drag, and the price one turns autoscale off for good.**
  `handleScale.axisPressedMouseMove.price` used to be `false`, on the argument
  that a vertical drag fights the trackpad's pan — but that is a press-and-drag
  *on the axis*, which no two-finger scroll produces, and the pan it was said
  to fight is `handleScroll`. Turning it on is one flag; the trap is that the
  library then leaves the scale manual, so the next range preset frames a
  different slice of time inside a price window chosen by hand. Measured with
  the restore disabled as a control: drag on a 6M chart, press MAX, and 6,550
  candles run from y=160 to the pane's last pixel row, 2,849 lit pixels against
  5,645 — most of 26 years below the bottom edge. `#restoreAutoScale()` fires
  on a range preset and on new data and nowhere else, so a pan, a scroll-zoom
  and a theme change all keep the scale the reader set; a double click on the
  axis is the library's own way back.

**Theming is ordered, and the order is load-bearing.** The chart cannot be
styled with CSS, so `applyTheme()` calls `getComputedStyle` to pick up the new
token values. That means the `data-theme` attribute must already be on
`<html>` when it runs. Two plain `$effect`s reading the same derived are only
ordered against each other by creation order, and if the child wins the chart
reads the OLD palette and stays on the previous theme permanently — page light,
canvas dark. So App.svelte sets the attribute in an **`$effect.pre`**: pre-effects
all flush before any user effect, which is the only guarantee that holds.

Svelte drives the class through `$effect`; nothing inside it knows Svelte
exists. The creation effect reads its dependencies through `untrack`, so a
data refresh calls `setData` instead of tearing the chart down and rebuilding
it.

No downsampling: every bar the series holds is loaded the whole time and the
range buttons only move the viewport. There is exactly one aggregation in the
app, and it is a different thing — RTH daily bars, which the feed does not
supply and which are therefore assembled from the intraday series; see
[RTH on the daily chart](#rth-on-the-daily-chart).

## Two timeframes

Daily, and 5-minute. [interval.ts](src/shared/interval.ts) owns everything that
depends on which, and the feature is small because of one decision.

**`Dataset.d[i]` stays an opaque, sortable string.** A daily bar is
`2026-08-28`; a 5-minute bar is `2026-08-28T13:45:00Z`. Both are ISO 8601, so
`<` and `>` order them, a `Map<string, number>` indexes them, `markId(rule, at)`
keys a verdict on them, and the viewport test `at >= lo && at <= hi` is
unchanged. Everything that treats a bar's date as a *handle* rather than a date
needed no change at all: the whole marking layer, the canvas primitive, the mark
store, the `--read` oracle. `Dataset.interval` is optional and absent means
daily, so no cached file and no committed snapshot had to be migrated — the same
argument that kept `tick` out of `Dataset`.

What genuinely had to learn about time was small:

- **A bar's time is two different types to lightweight-charts, and it fails
  silently.** Daily takes a business-day string, intraday a `UTCTimestamp`
  number. Hand an intraday series the ISO string and it draws **nothing**, with
  no error. One converter, plus a second map from the library's own time value
  back to an index — the crosshair returns whichever type went in.
- **`showLastDays` had to do arithmetic on the instant.** It appended
  `'T00:00:00Z'` to the last key, which intraday produces
  `…13:45:00ZT00:00:00Z`: NaN, and a range request the library ignores.
- **Rolls are a calendar fact.** `rollIndices` finds the first bar *of* the
  expiry day and `contractStarts` steps to the first bar of the next *session*,
  not `i + 1` — five minutes after an expiry is still the expiring contract, and
  the old form put the carry warning ~223 bars early. On a daily series both
  reduce to exactly what they did before, which `npm run marks:check` proves by
  still passing unchanged.
- **Range presets belong to the interval.** `5Y` against a 60-day archive shows
  the same thing as `MAX` while implying history that is not there, so the
  control, the menu and `Ctrl+1..0` all come from `INTERVALS[x].ranges`, and a
  stored range that does not apply falls back to that interval's default rather
  than being stored per interval.

The marking layer runs on 5-minute bars **unchanged**, because none of its dials
say "days": strength 3, `BREAKOUT_LOOKBACK` 20, `ATR_PERIOD` 20. The density
transfers better than expected — a pivot every 6.7 bars against 6.8 on daily —
and `npm run marks -- --check --file data/es_5m.json` passes, including the
no-lookahead test that rebuilds structure from a truncated series. They are
still *inherited* rather than chosen: nobody has swept `--tune` at that scale.
One clause did have to change, and only because intraday reached it: no daily
session in 26 years prints a zero range, but the partial bar at the right edge of
a 5-minute chart routinely does, and it used to read *"one price all session"*.

### Regular against extended hours

Intraday adds an **RTH / ETH** switch. ETH is every bar the feed has — the
near-24-hour Globex session — and RTH is 09:30 to 16:15 New York, the contract's
own regular hours and the session Brooks reads. Measured: 11,609 bars become
**3,402**, at exactly **81 a session, every session** (min = median = max).

[session.ts](src/shared/session.ts) is the only code in the project that knows
about exchange-local time, and that is the point. Everything *displayed* is UTC
because the stored key is UTC and mark ids are built from it. A session *window*
is the opposite case: regular hours are defined in the exchange's own clock,
which is 13:30 UTC in summer and 14:30 in winter, so filtering on a UTC clock
would shift the window by an hour twice a year — twelve bars of the wrong session
at one end and twelve missing at the other. It costs one `Intl` call per session
day rather than per bar: **3 ms against 50 ms**, byte-identical output.

It **filters the dataset** rather than hiding bars on the chart, so the ATR, the
pivots, the rules and the readings all see RTH bars only — an RTH chart whose ATR
was computed over the overnight is not an RTH chart. The consequence is that a
session boundary is now a gap in the series and `gap` fires there, which is
correct and exactly how a daily chart already behaves across a night. `npm run
marks -- --check` passes on the filtered series.

One trap worth naming, because only the *artifact* exposes it: the bar size on
screen is read from the **dataset**, not from the setting. The artifact carries
one snapshot, cannot switch, and so never patches `settings.interval` — an
artifact built from a 5-minute snapshot said **"Daily bars"** over intraday
candles, while the session control (which does read the dataset) correctly
appeared beside it. The range preset is resolved the same way, since the artifact
never runs settings coercion. Build one from `data/es_5m.json` before trusting
that path; a daily smoke cannot see it.

ETH is the default, because it means "every bar the feed has" and this app does
not silently drop 71% of what it pulled; the Notes card reports how many bars RTH
is holding back. Switching is a re-derive of one pull — no round trip — on an
intraday chart. On a daily one it is a load instead, because an RTH daily bar has
to be built rather than filtered for: see below.

Two operational notes. `data/es_5m.json` is **gitignored** — a 60-day rolling
window is stale in a day and worthless in two months, so the first switch to 5m
needs the network, while `data/es_data.json` stays tracked for exactly the
opposite reason. And every displayed time is **UTC**, stated as such in the
readout: the stored key is UTC and a mark id is built from it, so an
exchange-local clock would show a different time than the one in the data and
spread DST arithmetic across the axis, the readout, both lists and the CSV.

### RTH on the daily chart

The feed's daily bar for `ES=F` covers the whole 23-hour Globex day, so an **RTH
daily bar — open 09:30, close 16:15 New York — does not exist to be filtered
for.** It is assembled: the 5-minute series, reduced to the regular session, with
each trading day collapsed into one bar (first open, last close, the extremes
between, volume summed). Intraday the session control is a pure filter over the
series in hand; on daily it is a load, so there it rides `can.timeframes`, and
the artifact offers it only where the filter alone suffices.

**The source is the 5-minute feed, and that is a correctness choice.** Hourly
bars would buy far more history — measured, Yahoo serves 14,560 of them across
the full 730 days against 60 days of 5-minute bars — and they sit on the hour in
New York, so the 09:00 bar straddles the 09:30 open and the 16:00 bar straddles
the 16:15 close. Every candidate window is wrong at both ends, and the open and
the close are exactly what a price-action chart is read on: every bar rule tests
where the close sits in the range. So RTH daily is about **42 sessions**, the
notes card says so on the page, and ETH returns the feed's own 26 years.

Verified against an independent rebuild: for 2026-08-27 the aggregate consumed 81
five-minute bars — the RTH session, exactly — and produced `7,716.25 / 7,755.50 /
7,702.75 / 7,735.25`, matching to the tick.

## Marking

The point of the product: **31 rules that read the tape the way Al Brooks
describes it**, in three groups.
[docs/marking-layer.html](docs/marking-layer.html) is the same material as a
single page, with the full rule catalogue — every threshold, mark count and hit
rate — in one table.

| Group | Rules | What they mark |
| --- | --- | --- |
| `bars` | 15 | Trend bars, doji, `ii`/`iii`/`ioi`, reversal and pin bars, shaved bars, climaxes, gaps, breakouts, follow-through, two-bar reversals |
| `lines` | 8 | Bull and bear channels, micro channels, spike-and-channel, double tops and bottoms, wedges, triangles |
| `entries` | 8 | H1–H4 / L1–L4 pullbacks, the second entry, double-top/bottom trades, wedge reversals, breakout pullbacks, failed breakouts, final flags |

Everything under [src/shared/marks/](src/shared/marks/) is pure and free of
Node, the DOM and Svelte, so the app, the published artifact and the CLI run
byte-for-byte the same detection code. That is not tidiness — it is what makes
the rules testable at all.

### Rules are recomputed, verdicts are stored

Detection is a pure function of `(dataset, ruleConfig)`. Running all 31 over
6,550 bars takes **50 ms cold, 20 ms warm**, once per dataset; toggling a rule
filters the result in **0.22 ms**. Nothing about rule output is ever written to
disk — it would go stale against the candles the moment a session arrived.

Two things persist, in `marks/<symbol>.json` under the app's userData
directory (`~/Library/Application Support/price-action-mark/` on macOS,
`%APPDATA%\price-action-mark\` on Windows): the
reader's **keep / drop verdict** on each candidate, keyed by the mark's stable
id, and (reserved, not yet written) hand-drawn marks.

### Candidates, and the publish path

Rules propose; you dispose. **Click a mark on the chart to keep it**, or use the
Keep / Drop buttons in the mark list. A dropped mark disappears from every view
— keeping it visible-but-faded would mean dismissing a rule's noise never
quietens the chart.

**Publishing verdicts is what puts an artifact into confirmed-only mode.** An
artifact built with an empty `data/marks.json` shows every candidate; one built
with verdicts opens on exactly the marks its author kept, while a viewer who
switches back to all candidates keeps that choice locally.

```
mark up in the desktop app
      ↓   File → Export marks…
data/marks.json                     tracked, like data/es_data.json
      ↓   npm run artifact
dist/price_action_mark.html         one file, no host, marks included
```

### Pointing at one mark

Clicking a mark's chip in the tape highlights it on the chart; clicking
a mark on the **canvas** still toggles Keep. Two gestures, two meanings — "show
me where this is" is not "I stand behind this". The selection is one id, never
persisted, and it is read through a derived value that resolves it against the
marks currently drawn, so dropping a mark or switching its rule off clears the
highlight by construction rather than by a cleanup effect that has to know every
way a mark can leave the chart. The id itself is kept, so switching the rule
back on returns the reader's place.

Emphasis is **weight, never hue** — tone already owns colour. The selected mark
keeps its own colour and gains a halo, extra width and full opacity, and it is
drawn last so it is not sitting under three ordinary ones.

Two things the first attempt got wrong, both found by counting changed pixels
rather than by looking:

- **Raising the fill alpha** to 0.32 turned a selected channel at 1M — one
  channel spanning all 24 visible bars — into a slab over the candles: the exact
  failure `FILL_ALPHA` was tuned to avoid. Emphasis goes on the rails, which
  are a few pixels wide whatever the mark's span, never on an area that grows
  with the zoom.
- **Growing the selected bar mark's series marker** moved the price scale. An
  `aboveBar` marker reserves vertical space, so selecting a mark near the
  visible high re-scaled the pane and shifted every candle — 93,932 changed
  pixels across three canvases, the price axis among them. That is the same
  thing `autoscaleInfo() → null` exists to prevent.

Both are fixed by the same move. A selected mark also gets a faint
one-session vertical band, drawn by the **primitive**, whose `autoscaleInfo()`
is already null and so cannot disturb the scale however tall the band is. It is
the only thing that reaches the marks emphasis cannot: a bar mark is a marker
whose only channel is size, and a `trade` whose trade never filled has
`through === at`, so its box and both its lines collapse to zero width — 
`second-entry` highlighted **0 pixels** before the band existed. The band is
deliberately not part of the mark's `Shape`: the hit test measures against
shapes, and a full-height band would make a whole column of the chart report
that one mark.

Re-measured across all 20 rules with marks in a 6M viewport: 3,285–9,851 changed
pixels each, all on the primitive's canvas, with the price axis untouched
everywhere.

### The clicked session is a tint, not a highlight

Clicking a line in the bar reading paints that session on the chart: a
full-height band in `--focus`, one bar wide, clamped to 5–34px. It used to carry
a one-pixel rail down each edge at 0.85 opacity — by some distance the loudest
thing either band drew — and those are gone. The fill alone is the highlight
now, at 0.22.

The rails were not decoration, so what they bought is recorded rather than
forgotten: at MAX zoom a session is a fraction of a pixel wide, the band clamps
to its five-pixel minimum, and the rails were what let a reader find it there.
If that turns out to be too little, the fix is a wider clamp — not a bright line
back over the candles.

One consequence worth naming: with the rails gone, the selected-mark band and
the clicked-session band became the same drawing with different constants, so
there is one painter for both now. They still read as different things, because
the mark lends its own tone and the session takes the interface blue.

### How solid a fill is

One constant, `FILL_ALPHA`, paints every filled area on the chart: a channel's
band and an entry's band. It is **0.1**, and it has been here before — it was
0.1, went to 0.18 because a trade's box was one bar wide and vanished at that
alpha, and came back when the entry band gained a stroke and stopped needing
its fill to exist. What the fill was always too strong for is the wide case:
measured on the shipped series, one real bull channel covers **36%** of the
pane zoomed in and **13%** with room around it, so a single flat number that
reads well on one of those reads as a slab over the candles on the other. The
same wall is why raising it to 0.32 for the *selected* mark was rejected.

### An entry is a band, and its stop and target are a switch

An entry used to draw three things at once: a filled box from the entry down to
the stop, a line at the entry, and a line at the target. The box and the line
said the same thing twice, and the only clickable parts were the two thin rails.

The box is the **entry** now — a band on the entry price, a quarter of the risk
thick, stroked and filled, and **one bar wide**, sitting on the signal bar. The
thickness is in price rather than pixels, so it means the same thing at every
zoom, and the width is a session because that is what a point of entry is.

It spanned the whole trade for one iteration, and that was wrong for a reason
worth keeping: the box then said what the rails already say — how long the trade
took — and stopped saying the thing it exists to say. The duration belongs to
the rails, which still run out to where the trade resolved. Measured at a 3M
viewport: a 16px band against 13px of bar spacing, beside a 114px rail.

It is deliberately not clamped to a minimum width. The faint band under a
selected mark is clamped, because that one is a pointer into the chart; this is
data, and a box wider than the session it marks would be stating something
untrue at exactly the zoom where a reader cannot check it.

The stop and the target are a second register: **dashed, thinner, and under a
switch** — `Stop & target`, in the marking card's top row beside `Show marks`
and in Marks ▸ *Stop & target*. Dashed rather than a second colour because tone
already means direction here, and shape is the channel this project uses when it
needs a second meaning. The switch is display only: it changes what an entry
draws, never which marks exist, never the outcome column, never a verdict. It is
on by default, and the artifact stores it only when a viewer switches it off.

Two details are load-bearing. The switch reaches the **shape**, not the paint
pass, so rails that are not drawn are also not in the hit test — a line nobody
can see must not still be the thing under the cursor. And a **closed** polyline
counts as a region: a band is about 14px tall at a 6M viewport, so its centre
sits 7px from either edge and would miss the 6px hit slop, which would make the
middle of a box the one place a click did not land. Filled areas are
deliberately not treated the same way — a channel's band spans a hundred bars,
and an interior always beats a nearby line, so one channel would swallow every
click inside it.

### The doubles draw a level, not an M

A double top used to draw as a three-point path — up to the first peak, down to
the neckline, up to the second — which traced what price did and named nothing.
It draws as a single horizontal now: the price that was tested twice and held,
which is the line a reader would draw by hand.

Three details in it. The level sits at the more **extreme** of the two peaks
rather than their mean, because at the mean one peak pokes through its own line
and the whole mark reads as slightly misplaced; the two are within half an ATR
of each other by definition, so it is a small move either way. The span runs
from the first peak to the pattern's **`knownAt`** — three sessions past the
second peak at the default pivot strength — so the line is still under the
candles that test it, and the extension needed no invented constant. And the
mark's id is unchanged, built from the same two dates, so **verdicts already
saved still find their mark** and the regression fixture passes untouched:
counts and dates are geometry-blind.

The neckline is not lost with the zigzag. It is in the mark's note, and the
`dt-short` / `db-long` entries still project their measured move from it.

### Density is the design constraint

`trend-bar` fires on 34.5% of all sessions and `doji` on 27.2%; a chart wearing
every label is strictly less readable than one wearing none. The shipped
defaults are budgeted to **0.71 marks a bar** — measured at 0.71 on a 60-day
5-minute pull too, so intraday needs no second budget — and
`npm run marks -- --catalogue` prints the hit rate per rule so the budget is
checkable rather than felt.

When a rule looks too eager, **tighten the rule before hiding it**.
`reversal-bar` went from 22% of sessions to 5.2% by requiring it to actually
reverse a 10-session extreme; `pin-bar` from 14.2% to 3.7% by requiring the bar
to be worth an ATR. Both gained meaning rather than losing coverage.

Bar labels are a close-up feature. Three-character labels at 11px are ~20px
wide, so below **24px per bar** the labels on adjacent bars overlap into
garbage — they render at 1M and the readout says *"zoom in for bar marks"*
everywhere else. Geometry is not subject to that and draws at every zoom.

### How a detector gets tested

You cannot tune a wedge detector by squinting at a canvas: a rule that is
subtly too loose looks exactly like one that is working.

- **`npm run marks`** prints the same numbers the rules see, for any span —
  `--rules`, `--catalogue`, `--trades`, `--structure`, `--tune`.
- **Patterns are picked by eye before the rule that finds them is written.** The
  eight in `data/marks-golden.json` were read off the 2025 pivot list by hand;
  seven then matched the rule's own arithmetic exactly.
- **`npm run marks:check`** holds per-rule counts and those dates, and fails on
  drift. Counts are compared only when the dataset fingerprint matches, since
  `npm run data` legitimately changes them.
- **The no-lookahead guarantee is tested, not asserted.** The check rebuilds the
  whole structure from the series with its last 500 sessions removed and
  requires every earlier `trend` and `pullback` value to be byte-identical.

### Entries carry what actually happened

Each entry emits the three prices Brooks defines mechanically — a stop order one
tick beyond the signal bar, the protective stop one tick beyond its other end —
and a walk-forward result. Three decisions in that walk are deliberately
scored against the trader:

- a bar containing **both** stop and target is a loss, because daily OHLC cannot
  say which came first and assuming the good one is how a backtest talks itself
  into an edge (`ambiguous` counts them so the number stays auditable);
- a bar that gapped through the entry fills at the **open**, not the order price;
- the entry order is live for exactly **one bar** — leaving it working turns
  every failed setup into a different, later trade nobody took;
- **the order goes in at `knownAt`, not at the signal bar.** Three of the eight
  rules are anchored on a swing *pivot*, which is not readable until it
  confirms three bars later, so the order cannot be placed on the signal bar's
  close. It was anyway, for all 257 of their marks — and almost the whole edge
  those notes showed was that two-session head start. Measured over the full
  series, `dt-short` went from +0.873 R a mark to **+0.114**, `db-long` from
  +0.601 to **+0.079**, and `wedge-reversal` from +0.345 to **−0.160**, which
  changes its sign. `npm run marks -- --check` now re-derives every entry's
  walk from the mark's own dates and fails if the note disagrees.

Measured over 3,000 sessions, the mechanical 2R target **loses** on the pullback
entries: `second-entry` fills 75/75 and wins 28%, where 2R needs better than
33%. Once the pivot-anchored rules have to wait for their own confirmation, the
measured-move rules are only just positive — `dt-short` at +0.21R average,
`db-long` at +0.19R — and `wedge-reversal` is negative at −0.21R. Those numbers
are left alone on purpose. Moving the default target until the table looked
better would be curve-fitting a review tool.

## Reading the bars

The marking layer answers *what patterns are on this chart*. **Bar reading**
answers the other question a Brooks reader asks, walking left to right: *what
did this bar say?*

It shows up in two places. The **readout** above the candles carries the reading
of whatever session the crosshair is on — the answer to the question nine times
out of ten, without a glance away from the chart. The **marking pane's tape** is
a row per session in the viewport, newest first, and clicking a line highlights
that bar.

```
28 Aug 2026  small doji, 0.5x ATR — always-in long
27 Aug 2026  small doji, 0.5x ATR, inside the session before — trading range
20 Aug 2026  bear trend bar, closing on its low, 1.1x ATR — trading range — micro channel
30 Jul 2026  big bull trend bar, shaved bottom, 1.7x ATR, inside the session before
             — trading range — breakout pullback, failed breakout, ioi, two-bar reversal
23 Dec 2024  bull bar, closing on its high, 1.2x ATR, first session of a new
             contract, so the change into it is carry — always-in long, H3
```

Every session gets a line, including the ~5,000 that carry no mark at all,
because *"an ordinary bull bar in a trading range"* is a reading too and a gap in
the list would read as a gap in the market. `npm run marks -- --read` prints the
same strings the panel renders — the words get the same text oracle the numbers
have always had.

### It names no pattern it did not import

A reading is assembled from four clauses: the bar itself, its extremes, how it
sits against the session before, and where it sits in the structure. The
adjectives are tests over the metric columns, and the thresholds are **imported**
from [rules/bars.ts](src/shared/marks/rules/bars.ts) — `BIG_ATR`, `DOJI_BODY`,
`SHAVED_TAIL`, `PIN_TAIL`, `isTrendBar` — never restated.

The composite patterns are not re-derived at all. `readings()` is handed the
marks `detect()` already produced and names them by their own rule labels, so
there is exactly one definition of "breakout" in the product. A second one would
drift the day `BREAKOUT_LOOKBACK` moved, and the chart would then draw one thing
and read another.

Two rules ship a `phrase` because their label is not a phrase: *"Pullback entry
(H1-H4 / L1-L4)"* names a toggle honestly and reads as a definition mid-sentence.
The other 29 lower-case cleanly and say nothing extra.

### A mark joins a reading only if it was knowable at that close

A double top is not readable on the day of its second peak — it needs bars to its
right — so naming it there claims foresight the trade did not have. Only marks
with `knownAt === at` reach the pattern clause; anything confirmation-lagged
stays the mark list's business, which prints the lag next to it.

`npm run marks -- --check` asserts it over all 6,550 sessions rather than
trusting it: every phrase in a reading has to be a rule that actually fired on
that bar **and** was knowable at its close, every session has to get exactly one
line, and no line may contain a newline. It also holds the two numbers that say
whether the wording is still working — the longest reading is **176 characters**
and **8 of 6,550** carry nothing but the bar's own body.

Redundancy is dropped by clause, never by rule. Eight rules say what an earlier
clause has already said, and without that set a line reads *"bull trend bar,
shaved top — trend bar, big trend bar, shaved bar"*. What survives is exactly the
composite set: reversal bar, ii/ioi, climax, breakout, follow-through, two-bar
reversal.

The reading is built from the **unfiltered** marks. A rule toggle changes what is
drawn; it does not change what a bar did, and a reading that lost its "breakout"
clause because the reader hid the arrows would be a lie about the session.

### One tape, not two tabs

The reading and the mark list used to be two tabs of one pane. They were both
newest-first lists over the same viewport, so the tab between them was a switch
the reader paid on every glance — and they overlapped by construction, because a
reading names the patterns knowable at that close and the mark list was listing
those same patterns for the same bar. They are one list now: a row per session,
the reading as the row, its marks hanging off it.

**The pattern clause is rendered as the marks.** The reading's last clause is
left off and the mark chips take its place, so the sentence and the mark list
stop saying the same words twice and the words become clickable:

```
26 Aug  small doji, 0.5x ATR, inside the bar before — trading range — [ib]
24 Aug  small bear bar, 0.6x ATR — trading range, swing low — [bull channel →27 Aug]
06 Aug  small bear bar, 0.5x ATR — trading range — [BO▲]
          bo-pullback · first pullback, 2 bars after the breakout ·
          entry 7771.00, stop 7724.00, target 7865.00 · stop in 7 bars, -1.00R   Keep Drop
30 Jul  big bull trend bar, shaved bottom, 1.7x ATR, inside the bar before
        — trading range — [BO▼] [2BR] [BIG] [ioi] [ib] failed breakout
```

Three cases fall out of that, and all three are meant. A mark the prose does not
name is a chip on its own — either the reading already stated it in an earlier
clause (`ib`, `BIG`) or it was not knowable at that close, like a channel
confirmed three sessions later, which prints `→27 Aug` because the row's date is
not the date it was readable. A pattern the prose names with no mark behind it
stays as **dim text** (`failed breakout` above): that rule is switched off, and
the tape says so rather than papering over it. And a session with neither is one
line of prose, which is a little over half of them.

**The tab became a filter, asking a different question.** It asked *which
list?*; it asks *how much of the tape?* — All / Marked / **Unresolved**. The
third is new and is the marking loop's missing finish line: it counts sessions
holding a mark with no verdict, so it empties as the reader works, and an empty
list under it means done rather than broken. Two caps collapsed into one with
the two lists: `TAPE_CAP` bounds sessions, and the header says plainly that a
mark older than the newest 300 in view has no row to sit on.

**The mark table's 535px floor is gone, and not by trimming anything.** Five
columns — date, label, rule, detail, Keep/Drop — could not be squeezed under
535px, which is 147px short at a 1200px viewport, and the only moves left were
the three things the reader aims at. The tape dissolved the row instead: the
date is the reading's rail, the label is a chip in the sentence, and rule,
detail and the verdict pair render in a strip under whichever chip is selected —
one mark at a time rather than every row at once.

The row format is where the rest of the width is won. The obvious narrow-column
answer is to stack the date above the sentence, and measured at the pane's 647px
that puts every row on two lines — median 51px, **eight visible**. Keeping the
date as a 7ch **rail** with the sentence hanging beside it leaves most readings
on one line: measured on the merged tape at 642px, 127 rows, median 36px, 82 of
them one line, 59 carrying chips. The year prints only where it changes, as a
sub-label, so the rail never widens to repeat a fact that changes once a year.

Two things stayed decided. The pane still does not collapse — that was the price
of the placement when tabs inside a `<summary>` would have put buttons inside a
button, and the same constraint now keeps the mark chips *beside* the
sentence-button rather than inside it. And the sentence is `display:
inline-block`, deliberately not `inline`: a shrink-to-fit box leaves chips on
the sentence's line when there is room and takes the full width when there is
not, so they wrap under it rather than into the middle of it. `inline` would
save about 900px of the 5,751px content height — 16%, and not worth a display
model Safari has never been dependable about.

### Clicking a line is a third gesture

The chart now has three: clicking a mark on the canvas means *Keep*, clicking a
mark's chip means *show me where this is*, and clicking a reading means *show me
this bar*. Each has its own state and its own colour. The chip needed no state
of its own — it opens its detail strip when it is the selected mark, so one
click both highlights it on the chart and opens it.

### And the chart points back

The tape pointed at the chart; nothing pointed back. Now a click on the canvas
**reveals what you clicked in the tape**, highlighted and scrolled into view — a
mark opens its strip with the Keep it just received, a bar highlights its
session. A click reports one or the other, never both: selecting a mark *and*
its session would draw two bands for one click.

Four things were measured with `sendInputEvent` before any of it was written,
because one of them decided whether the feature was worth having:

| Gesture | Result |
| --- | --- |
| A plain click | one event, carrying the bar's own key |
| **A 200px pan** | **no click at all** — this cannot yank the tape on every drag |
| A 3px jitter drag | fires, landing on whatever bar the nudge left under the cursor |
| A click past the last bar | fires with `time` undefined, so "click empty space, nothing happens" is free |

A fifth is a warning for whoever tests this next: **a synthetic `MouseEvent`
does not reach Lightweight Charts at all.** Dispatching
pointerdown/mousedown/pointerup/mouseup/click on the canvas changes nothing, so
an in-page check would pass by asserting on a click that never happened. The
smoke drives `sendInputEvent`, which works on a hidden window.

Two traps were paid for on the way, and both are worth knowing. `scrollIntoView`
**scrolls the document too** — it walks every scrollable ancestor — so in the
stacked layout revealing a row scrolled the page away from the chart just
clicked: measured at 900x900, one click took the page from 0 to 724 and the
candles entirely off screen. The wide layout never showed it, because there the
page does not scroll at all. And the reveal has to happen **before** the
verdict: written the other way round, the widen-the-filter rule asked whether
the tape could show the row after the Keep had already removed it from
*Unresolved*, so every Keep from the chart threw the reader back to the full
tape.

Two details carry the behaviour. All four of `revealBar` / `revealMark` and
`selectBar` / `selectMark` **toggle**: clicking a highlighted bar or mark on the
chart clears the highlight, the same way clicking it in the tape does. The
reveal pair used to *set*, on the argument that the chart's highlight is
somewhere else on screen — true of the tape half of a reveal, false of the half
under the cursor, since the band is drawn on the chart where the click landed.
They are now select-plus-scroll: each calls the toggling one and returns early
when that cleared the selection, because there is no row to scroll to and the
widen-the-filter rule must not fire for a selection that just went away. On a
mark it also completes the gesture — `setVerdict` has always toggled, so a
second click takes the Keep and the highlight back together.
And the reveal **states its target** rather than letting the tape infer it: both
selections are allowed to be live at once, so "the selected mark's session, or
else the selected bar" sent the tape back to a mark clicked earlier whenever the
reader then clicked a bar. The scroll is `block: 'nearest'` — a no-op when the
row is already visible, and never animated.

The bar highlight is a one-session vertical band drawn by the same primitive as
the mark band — whose `autoscaleInfo()` returns null, which is why a full-height
band cannot disturb the price scale — but in `--focus` rather than a tone. The
mark band borrows its mark's hue because a mark has a direction to state; a
session does not, and a green band would say *this bar is bullish* when the
reader only asked where the line was. Both bands can show at once and stay
tellable apart.

`selectedBarIndex` is deliberately not a reuse of the keyboard crosshair. The
keyboard outranks the pointer, so driving the highlight through it would freeze
the readout and stop the chart's own hover from updating it. The readout's
precedence is keyboard → pointer → clicked line → last session: click a line and
the readout follows it, move the pointer back over the candles and it comes
straight back.

### Measured, with both controls

Counting changed pixels on a chart needs two controls here, and without either
one the numbers lie:

- **Poll for the repaint.** A probe window at `setOpacity(0)` is occluded, so
  the chart's frame arrives erratically: a fixed 800 ms wait measured 7,848
  changed pixels on one run and **0** on the next, for identical code.
- **Spend the first interaction on something that already works.** The first
  click of any run moves canvases 0, 2 and 4 — the pane, the price axis and the
  time axis — whatever it is. Clicking the shipped mark list instead reproduces
  `0:2605 1:12860 2:2427 4:951` exactly, so that signature is the app settling
  after boot, not the feature under test.

With both in place: selecting a reading changes **5,814 pixels on the
primitive's canvas and zero on the price axis**, so the band cannot move the
scale; `Escape` on the chart clears both selections.

The same probe caught two layout faults the feature introduced. The readout grew
from 42px to 81px for its new line, which put the two columns **16px out** —
because the column's height was `calc(var(--chart-h) + 108px)`, where 108 was a
measured readout and legend. A grid row that stretches is exact whatever sits
above the candles, so the constant is gone rather than re-measured. And with the
pane now below the rules card, an unbounded rules card pushed the tape
**2,059px** down a 935px viewport in the stacked layout; bounding it moved that
to 1,211px, and reaching the pane now leaves the chart **249 of 430px** visible
instead of none.

## Bar numbers

Brooks refers to bars by their number in the session — "bar 12", "the bar 30
reversal" — so the intraday chart counts them. Every third bar carries its
number under its low, and each session's **first** bar carries the date instead,
two lines, as on a printed Brooks chart. The two never collide: bar 1 is not a
multiple of three.

The count is per **trading day**, which is not the UTC date. For RTH they are
the same thing — 09:30 to 16:15 New York is one UTC day — but on an ETH chart
the UTC date splits every Globex session at 00:00 UTC, 8pm in New York, and the
numbering would restart in the middle of the evening.
[`tradingDayOf()`](src/shared/session.ts) shifts the instant by the cached New
York offset, reads it back with the UTC getters — which *is* reading New York's
wall clock — and rolls to the next day from 18:00, the exchange's own
convention. Measured on a 60-day pull: RTH gives 42 sessions of **exactly 81
bars**; ETH gives 44 with a 275-bar median.

Drawing them is [a primitive of their own](src/renderer/lib/chart/numbers.ts),
not a new kind of mark and not series markers. A marker reserves vertical space
and would move the price scale on every zoom — the same reason a selected mark
gets a band rather than a bigger marker — and these labels have no verdict, no
tone and no hit test, so sharing the mark path would only couple them. Like the
mark primitive, `autoscaleInfo()` returns null: nothing here can disturb the
candles.

Numbers and dates thin themselves **separately**, because their spacing is
different: a label wants `chars × 6px + 7` of clear room at 10px mono, and the
gap between labels is three bars for numbers but a whole session for dates. At
3D on a 5-minute chart — 3.6px a bar — the numbers go and the three date labels
stay, which is the useful half. The readout says so in one clause, *zoom in for
bar marks and numbers*, rather than two.

## Colour

The app **opens dark** (`DEFAULT_SETTINGS.theme = 'dark'` in both
[main/settings.ts](src/main/settings.ts) and
[source/types.ts](src/renderer/lib/source/types.ts)); Auto/Light/Dark is a
segmented control in the header and a radio group under View → Theme. Because
the choice is persisted, an install that already ran will keep whatever it had —
delete `settings.json` under userData to pick up the new default.

Green up / red down, per trading convention. That pair is the classic red–green
colour-blindness failure, so the steps were chosen by measurement rather than by
eye:

| Role | Light | Dark |
| --- | --- | --- |
| Up — marks | `#006300` | `#008300` |
| Down — marks | `#e34948` | `#e66767` |
| Up — delta text | `#006300` | `#0ca30c` |
| Down — delta text | `#cc3131` | `#e66767` |
| EMA 20 — the line | `#4338ca` | `#2962ff` |
| EMA 20 — the figure | `#4338ca` | `#93a5f4` |

A dark green against a lighter red lets **lightness** carry the separation where
hue cannot: ΔE 7.8 (light) and 8.6 (dark) under simulated protanopia and
deuteranopia. The obvious bright pairing `#0ca30c`/`#d03b3b` fails outright at
ΔE 4.1.

Light mode sits just under the ΔE 8 target. Up-candles were **hollow** for that
reason — a transparent body with a coloured border, a second channel that
survives greyscale and print — and both bodies are now **filled**, on request,
to match the reference chart the app is read beside. The distinction still
holds on the lightness step above; what is gone is the redundancy, and the
[Notes](src/renderer/lib/components/Notes.svelte) card and the chart legend both
say so rather than claiming a shape channel that is no longer there.

The **EMA has two steps in dark mode**, and the split is the same one
`--up`/`--up-text` already makes. The drawn line is `#2962ff`, the royal blue of
the reference chart; measured, it sits ΔE 60.8 from up and 41.9 from down
(70.9/47.0 protan, 69.0/63.3 deutan) and ΔE 13.3 from `--focus`, which is the
constraint that chose it — the softer cornflower blues that look closer by eye
measure ΔE 2–5 from `--focus` and would read as a selected control. At 3.63:1 on
the dark surface it clears the 3:1 a mark needs and misses the 4.5:1 a figure
needs, so the readout's EMA value uses `--ema-text` (`#93a5f4`, 7.57:1) instead.
Light mode needs no split: `#4338ca` is 7.69:1 either way.

Marks need 3:1 contrast against the surface but text needs 4.5:1, which is why
delta values use separate `--up-text`/`--down-text` tokens on darker steps —
`#e34948` only reaches 3.85:1 on the light surface. Light `--down-text` is
`#cc3131` rather than `#d03b3b` because the ground matters as much as the
colour: the masthead's session-change figure has no card behind it, and
`#d03b3b` clears 4.5:1 on the card surface but only reaches 4.27:1 on the page
plane.

`--muted` is split the same way, and it is the widest of the three. That one
token drew the roll arrows, the `neutral` and `caution` mark strokes and the
legend glyph — graphics, which clear 3:1 — while also carrying 39 distinct text
roles across 13 components, 558 elements on a page, none larger than 14px and so
none eligible for the large-text relaxation at 24px. As text it was short in
both themes. `--muted-text` (`#676f7a` light, `#7e8792` dark) is the smallest
move along lightness, hue and saturation held, that clears 4.5:1 on the surface,
the second surface and the page plane alike; L\* moves 11.0 and 6.7 against a
21.6/22.6 gap to `--ink-2`, so the quiet register is still quiet and the
annotation layer over the candles never moved.

`npm run tokens:check` is what keeps all of that true. It parses the three
scopes and asserts they agree — the two dark ones must hold the same keys with
the same values, nothing may exist only in the dark, every colour in `:root`
must be redefined for it — then measures each token against the grounds it
actually sits on, 4.5:1 for text and 3:1 for a mark, and refuses to let a new
colour ship unclassified. It earned its place on the first run: `--down-text`
was 4.68:1 on the card surface and only **4.27:1 on the page plane**, which is
where the masthead's session-change figure sits, and that figure only renders in
red on a down session — so nothing anyone could look at would have shown it.

All five tokens are defined in **three** scopes in
[styles/tokens.css](src/renderer/styles/tokens.css): bare `:root`, the
`prefers-color-scheme: dark` media query, and `:root[data-theme="dark"]`. Miss
one and the theme toggle and the OS setting disagree. If you change a colour,
change it in all three.

`--ema` is the one non-directional mark, so it must read as neither up nor
down. Blue is the safe axis — protan and deuteran vision compress red–green but
leave blue–yellow intact — and the two steps were picked the same way as the
rest: they sit **ΔE 40+ from both the up and the down colour** under either
simulation, against the ΔE 8 threshold, at 7.7:1 and 7.6:1 contrast. They are
also held ΔE 13+ from `--focus`, so a moving average never reads as a focused
control.

The average runs continuously across contract rolls, which means it **absorbs
the carry** at each one — the December 2024 roll alone is +2.77% that nobody
traded. Resetting it per contract would be worse (104 restarted warm-ups, and a
discontinuity of its own), so it runs straight through and the chart labels the
rolls instead.

The chart reads those same custom properties through `getComputedStyle`, so no
colour is ever written twice in two languages.

## Fonts

Archivo and IBM Plex Mono, latin subset, **woff2 only**, declared by hand in
[styles/fonts.css](src/renderer/styles/fonts.css) rather than by importing
`@fontsource`'s own stylesheets — those pull every subset (vietnamese,
latin-ext, cyrillic) and a `.woff` fallback beside each `.woff2`, about 130 KB
that neither target can use.

v1 loaded these from Google Fonts, the one external host a published artifact's
CSP admits. Bundling them instead means the desktop app renders correctly
offline and the artifact needs no CSP exception at all. Cost: ~107 KB of base64
in the single file. Both faces are SIL OFL 1.1.

## The single-file target

`dist/price_action_mark.html` is the artifact **body**: it deliberately has no
`<!doctype>`, `<html>`, `<head>` or `<body>` tags, because the artifact host
wraps it in that skeleton at publish time. `dist/preview.html` is the same
content with the skeleton added, so it opens straight off disk.

[scripts/inline-artifact.ts](scripts/inline-artifact.ts) folds the Vite output
into one document, and the guards there are the point of the script. A
published artifact runs under a CSP that admits no remote origin, so anything
left un-inlined does not degrade — it silently fails to load. Every one of
these is a build error instead:

- a sibling file in `dist-artifact/` beyond the expected three (an asset escaped
  `assetsInlineLimit`)
- a wrapper tag surviving into the body
- a `src=`/`<link href=` pointing anywhere but `data:` — anchor `href`s are
  exempt, since those are navigation rather than a fetch
- a `url()` in the stylesheet that is not a `data:` URI
- a missing `#app` mount point

Two byte sequences can close a `<script>` element from the inside, and both
appear in minified bundles as ordinary string literals — Svelte's runtime
carries `"<!---->"` as its comment-anchor marker. `</script` closes the tag
anywhere; `<!--` puts the HTML tokenizer into script-data-escaped state. Both
are escaped, and then **the escaped source is compiled with `new Function` and
never called** — which is what proves the substitution landed inside string
literals rather than in live code.

The dataset is a build-time import (`json: { stringify: true }`, so it lands as
`JSON.parse("…")` rather than a 330 KB object literal, which the engine parses
several times faster).

## Security posture

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- The preload names one channel per method — a compromised renderer cannot
  invoke a handler it was not given. It is emitted as **CommonJS under an
  explicit `.cjs`**, because a sandboxed preload cannot be an ES module and
  `package.json` says `"type": "module"`.
- Every asset is local, so the packaged app serves a CSP with no remote origin
  at all. Skipped in dev, where Vite's HMR client needs `eval` and a websocket.
- `will-navigate` is blocked and `setWindowOpenHandler` denies every popup,
  routing `https:` links to the OS browser instead.
- Window geometry is validated against the attached displays on restore — a
  position saved on a monitor that is gone would otherwise open off-screen.

### Vertical maximize

**Fit height** in the toolbar, or View → Maximize vertically (`Ctrl+Shift+M`),
stretches the window to the full work-area height and leaves its width and
horizontal position exactly where they were. Windows exposes this natively when
you double-click a window's top or bottom edge. Whatever the host OS offers,
Electron exposes no API for it,
so [main/window.ts](src/main/window.ts) does the arithmetic against the work
area of whichever display the window is actually on.

It toggles, like the OS gesture. The pre-maximize `y`/`height` are remembered in
a `WeakMap` keyed by window, so a second press puts it back; if there is nothing
remembered (a restored session that opened full-height) it falls back to a
centred 80%. A fully maximized window is un-maximized first — `setBounds` fights
the maximized state, and there is no width worth preserving in it anyway. The
"already full height" test carries a 2px tolerance, because DPI scaling makes
the round-trip through `setBounds` land a pixel or two off.

**Extend to left edge** (`Ctrl+Shift+L`) is its horizontal counterpart, and
deliberately not a maximize: it moves the **left** edge to the work area's left
and leaves the right edge where the reader put it, widening the chart into empty
desktop without covering whatever is parked beside it. The two compose — a window
can be full-height and extended left — so each remembers its own pre-gesture
geometry in its own `WeakMap`. Measured on a 3440px display: left edge to 0,
right edge unmoved at 1220, y and height untouched, and a second press puts it
back.

Unlike every other menu item, these two act directly in main rather than sending
a command to the renderer and back: window geometry is main's own business. Both
buttons are gated on `source.can.fitWindow`, so the artifact — a page in a tab,
with no window of its own — renders neither.

## Testing

`npm run smoke` and `npm run smoke:app` load the built output in a real
headless Chromium and assert the chart actually drew: canvas count, a
well-formed last price, a dated readout, populated table rows, a resolved
theme, a well-formed EMA 20 value, ≥2 loaded font faces and zero console errors. Desktop mode imports the
real `out/main/index.js`, so the preload bridge and every IPC handler are on
the same path they take in production — the run asserts `window.desktop` exists
there and does *not* exist in the artifact. It also asserts the mark panel is
populated, that the readout carries a **bar reading** and the marking pane has
both tabs with rows behind the second, and — desktop only — that a verdict
written over the real IPC path comes back on a re-read and can be removed again.
Two of those exercise the fold: a heading chip must reveal its less-used rules
and fold them away again, and the **rules sheet** must open from the card's own
door, bring a folded rule back into the list, drop that change and close. Both
click and then measure in a *second* `executeJavaScript` call, because Svelte
flushes on a microtask — counting rows in the same expression reads the DOM as
it was before the click and reports every working fold as broken.
The reading assertions matter because prose fails silently: a dropped clause
renders as a shorter sentence, not as an error.

`npm run marks:check` is the marking layer's own guard, and it checks things a
rendered page cannot show:

- the roll fallback holds at all 104 contract starts, and the ten sessions where
  the feed prints a close outside its own high/low are listed rather than hidden;
- pivots strictly alternate, pullback counts never exceed their cap, and no bar
  reads a pivot that has not confirmed yet;
- **no lookahead** — the structure is rebuilt from the series with its last 500
  sessions removed and every earlier `trend` and `pullback` value must be
  identical (0 of 6,050 drift);
- **no duplicate mark ids**, checked per rule, since an id keys both a verdict
  and a keyed `{#each}` that throws on a collision;
- per-rule mark counts and eight hand-picked pattern dates match
  `data/marks-golden.json`. Counts are compared only when the dataset
  fingerprint matches, because `npm run data` legitimately changes them;
- **every session gets exactly one bar reading**, no reading is empty or spans
  two lines, and every pattern a reading names is a rule that fired on that bar
  *and* was knowable at its close — the foresight check, run over all 6,550.

Anything visual beyond that gets a one-off Electron probe under
`scripts/_name.cjs`, run once and deleted. Make its window invisible with
`win.setOpacity(0)` rather than an off-screen position — the latter lands on a
second monitor, and opacity 0 still captures at full fidelity.

Five ways a green run lies, all five hit while building this:

- **`npm run smoke:app` can print nothing and exit 0**, which reads as a pass
  and means no check ran. `src/main/index.ts` opens with
  `if (!app.requestSingleInstanceLock()) app.quit()`, so a stale `electron`
  process — a leftover `npm run dev`, or a probe killed before `app.exit` —
  makes the imported main quit before the smoke reaches its report or its
  `app.exit(1)`. **Empty output is a failed run.** A healthy one always prints
  `smoke desktop app: N canvas, …` and then `smoke: ok`.
- **A probe that diffs "the canvas" must diff every canvas.** lightweight-charts
  uses several, and marks drawn by the primitive land on a different one than
  series markers do. Sampling only the largest reported **0 changed pixels for
  every channel on the chart** while a screenshot plainly showed them
  highlighted — a conclusion that would have been believed.
- **A pixel diff needs a noise floor and a first-interaction control.** An
  opacity-0 window is occluded, so the repaint lands on an erratic animation
  frame: a fixed 800 ms wait measured 7,848 changed pixels on one run and 0 on
  the next for identical code, so poll until something moves. And the first
  interaction of any run moves the pane, the price axis and the time axis
  whatever it is — spend it on a feature that already ships and compare.
- **A probe that clicks something Svelte renders must measure in a second
  call.** Svelte flushes on a microtask, so a click and a
  `getBoundingClientRect()` in one `executeJavaScript` expression read the DOM
  as it was *before* the click. It does not look like a race: switching to a
  hidden tab and measuring its rows in the same expression returned every row
  `0px` tall and "128 of 128 visible", which reads as a broken layout, and
  reading `aria-selected` that way said a keyboard handler had not fired when it
  had. Click, await a beat, measure.
- **`getImageData` throws `IndexSizeError` on a zero-sized canvas, and
  lightweight-charts keeps one.** The probe then dies with *"Script failed to
  execute, this normally means an error was thrown"* and nothing else — no line,
  no message. Guard on `c.width && c.height`, and have in-page snapshot code
  return its own caught message rather than throwing into the void.

## Licences

- This project — MIT, © 2026 Ke Yang. See [LICENSE](LICENSE).
- lightweight-charts — Apache-2.0, TradingView. Bundled; credited in the page footer.
- Archivo, IBM Plex Mono — SIL OFL 1.1. Bundled as woff2.
- Market data — Yahoo Finance, personal/research use only.
