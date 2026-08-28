# Price Action Mark

Price action charting, daily and 5-minute — mark up the tape, then publish it. The
chart reads itself with **29 rules drawn from Al Brooks's price action method**
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
| Single-file HTML artifact | `npm run artifact` | `dist/price_action_mark.html` (701 KB, self-contained) |

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
  session.ts                  RTH/ETH window; the only timezone code
  rolls.ts                    expiry arithmetic + contractStarts()
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
  marks.ts                    verdicts, one atomic JSON per symbol
  window.ts                   vertical maximize (no Electron API for it)

src/preload/index.ts        the entire privileged surface, sandboxed CJS

src/renderer/
  App.svelte                  layout, theme wiring, menu-command routing
  lib/source/                 the seam: electron.ts | artifact.ts | types.ts
  lib/state/app.svelte.ts     one rune-based store for the window
  lib/chart/candles.ts        every imperative call into lightweight-charts
  lib/chart/marks/            ONE primitive for all geometry, not one per mark
  lib/components/             Masthead, Controls, Readout, ChartPanel,
                              MarkPanel, MarkingPane (MarkList | ReadingList), …
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
goes to 2400px, because the rule rows carry a name, a count and a blurb and the
mark table carries five columns, and both were being squeezed on exactly the
screens this layout is for:

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
since the marking pane became a `<section>` with a tablist and a plain flex
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

`MarkPanel` drops its blurbs to the row's `title` and goes to two columns under
a 700px card, with `bars` / `lines` / `entries` headings earning their place
once a row is only a name and a count. That takes the 31 rules from **2,199px**
of card to **498px** of content at two columns, or 895px at one.

The marking pane declares the container both its views read. The reading rows
drop their date rail under a 430px pane; the mark table tightens its five
columns under 780px and again under 660px, which takes the table's minimum
width from **766px to 535px**. That floor is
irreducible without shrinking the three things a reader aims at — the date, the
mark label, and the Keep/Drop pair are ~412px of it — so below roughly a 1700px
viewport the table still scrolls sideways inside its own container: 57px short
at 1500, 147px at 1200. Above it, it fits.

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

No aggregation and no downsampling: every bar the feed has is loaded the whole
time and the range buttons only move the viewport.

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
is holding back. Switching is a re-derive of one pull — no round trip — and the
control is absent on daily, where a bar is already a whole session.

Two operational notes. `data/es_5m.json` is **gitignored** — a 60-day rolling
window is stale in a day and worthless in two months, so the first switch to 5m
needs the network, while `data/es_data.json` stays tracked for exactly the
opposite reason. And every displayed time is **UTC**, stated as such in the
readout: the stored key is UTC and a mark id is built from it, so an
exchange-local clock would show a different time than the one in the data and
spread DST arithmetic across the axis, the readout, both lists and the CSV.

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

Two things persist, in `%APPDATA%/price-action-mark/marks/<symbol>.json`: the
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

Clicking a mark's label in *Marks in view* highlights it on the chart; clicking
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

### Density is the design constraint

`trend-bar` fires on 34.5% of all sessions and `doji` on 27.2%; a chart wearing
every label is strictly less readable than one wearing none. The shipped
defaults are budgeted to **0.56 marks a bar** — measured at 0.54 on a 60-day
5-minute pull, close enough that intraday needed no second budget — and
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
  every failed setup into a different, later trade nobody took.

Measured over 3,000 sessions, the mechanical 2R target **loses** on the pullback
entries: `second-entry` fills 75/75 and wins 28%, where 2R needs better than
33%. The positive rules are the ones whose target is the pattern's own measured
move — `dt-short` at +1.65R average, `db-long` at +1.10R. That number is left
alone on purpose. Moving the default target until the table looked better would
be curve-fitting a review tool.

## Reading the bars

The marking layer answers *what patterns are on this chart*. **Bar reading**
answers the other question a Brooks reader asks, walking left to right: *what
did this bar say?*

It shows up in two places. The **readout** above the candles carries the reading
of whatever session the crosshair is on — the answer to the question nine times
out of ten, without a glance away from the chart. The **marking pane's second
tab** lists every session in the viewport, newest first, and clicking a line
highlights that bar.

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

### Two views of one pane

The reading is a tab beside *Marks in view*, not a card of its own. The wide
layout divides the marking column between exactly two panes at measured heights,
and a reading needs width a third of a column cannot spare; two views cost one
click and no layout.

The row format is where the width is won. The obvious narrow-column answer is to
stack the date above the sentence, and measured at the pane's 647px that puts
every row on two lines — median 51px, **eight visible**. Keeping the date as a
7ch **rail** with the sentence hanging beside it leaves 89 of 128 readings on one
line: median 34px, **eleven visible**. The rail is both the thing the eye runs
down and the cheaper layout, which is not the trade it looks like. The year
prints only where it changes, as a sub-label, so the rail never widens to repeat
a fact that changes once a year.

Two costs, stated plainly. The pane no longer collapses — two views need a real
`role="tablist"`, and tabs inside a `<summary>` would put buttons inside a
button. And *Marks in view* stays the tab that opens, because the readout line
already puts a reading in front of the reader on every load, so the new surface
loses nothing by not claiming the slot the marking loop has always had.

### Clicking a line is a third gesture

The chart now has three: clicking a mark on the canvas means *Keep*, clicking a
mark in the list means *show me where this is*, and clicking a reading means
*show me this bar*. Each has its own state and its own colour.

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
pane now below the rules card, an unbounded rules card pushed the reading tab
**2,059px** down a 935px viewport in the stacked layout; bounding it moved that
to 1,211px, and reaching the pane now leaves the chart **249 of 430px** visible
instead of none.

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
| Down — delta text | `#d03b3b` | `#e66767` |
| EMA 20 | `#4338ca` | `#93a5f4` |

A dark green against a lighter red lets **lightness** carry the separation where
hue cannot: ΔE 7.8 (light) and 8.6 (dark) under simulated protanopia and
deuteranopia. The obvious bright pairing `#0ca30c`/`#d03b3b` fails outright at
ΔE 4.1.

Light mode sits just under the ΔE 8 target, so hue is never the only channel:
**hollow bodies rise, filled bodies fall**, which also survives greyscale and
print.

Marks need 3:1 contrast against the surface but text needs 4.5:1, which is why
delta values use separate `--up-text`/`--down-text` tokens on darker steps —
`#e34948` only reaches 3.85:1 on the light surface.

All four tokens are defined in **three** scopes in
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
you double-click a window's top or bottom edge, but Electron has no API for it,
so [main/window.ts](src/main/window.ts) does the arithmetic against the work
area of whichever display the window is actually on.

It toggles, like the OS gesture. The pre-maximize `y`/`height` are remembered in
a `WeakMap` keyed by window, so a second press puts it back; if there is nothing
remembered (a restored session that opened full-height) it falls back to a
centred 80%. A fully maximized window is un-maximized first — `setBounds` fights
the maximized state, and there is no width worth preserving in it anyway. The
"already full height" test carries a 2px tolerance, because DPI scaling makes
the round-trip through `setBounds` land a pixel or two off.

Unlike every other menu item, this one acts directly in main rather than sending
a command to the renderer and back: window geometry is main's own business. The
button is gated on `source.can.fitWindow`, so the artifact — a page in a tab,
with no window of its own — does not render it.

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
