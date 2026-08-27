# Price Action Mark

Price action charting for daily bars — draw and mark up the tape, then publish
it. Ships with E-Mini S&P 500 futures (CME `ES`) from a free, keyless source;
the data layer is symbol-generic.

One Svelte 5 codebase, **two build targets**:

| Target | Command | Output |
| --- | --- | --- |
| Electron desktop app | `npm run build` | `out/` (packaged with `npm run dist`) |
| Single-file HTML artifact | `npm run artifact` | `dist/price_action_mark.html` (659 KB, self-contained) |

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
| `data` | Yahoo → `data/es_data.json` (`-- --symbol MES=F`) |
| `csv` | Yahoo → CSV, any symbol (`-- --symbol ESZ26.CME --out z26.csv`) |
| `typecheck` | `tsc` over main/preload/scripts, `svelte-check` over the renderer |
| `smoke` / `smoke:app` | load the built output in real Chromium and assert it drew |

## Layout

```
electron.vite.config.ts     target 1 — main + preload + renderer
vite.artifact.config.ts     target 2 — renderer only, everything inlined
scripts/inline-artifact.ts  target 2, second half — fold into one .html + guards

src/shared/                 imported by main, renderer AND the CLI scripts
  yahoo.ts                    fetch + normalise; the only network code
  rolls.ts                    third-Friday quarterly expiry arithmetic
  types.ts  ipc.ts            the dataset shape and the whole IPC contract
  format.ts  csv.ts           one set of formatters for axes, readout and CLI

src/main/                   Electron main
  index.ts                    window, CSP, IPC handlers, save dialogs
  dataset.ts                  network → cache → bundled, in that order
  settings.ts  menu.ts        atomic JSON settings; native menu
  window.ts                   vertical maximize (no Electron API for it)

src/preload/index.ts        the entire privileged surface, sandboxed CJS

src/renderer/
  App.svelte                  layout, theme wiring, menu-command routing
  lib/source/                 the seam: electron.ts | artifact.ts | types.ts
  lib/state/app.svelte.ts     one rune-based store for the window
  lib/chart/candles.ts        every imperative call into lightweight-charts
  lib/components/             Masthead, Controls, Readout, ChartPanel, …
  styles/                     tokens.css (palette), fonts.css, app.css
```

## The data

Yahoo Finance's undocumented v8 chart endpoint, symbol `ES=F`. Free, no API
key, 6,550 daily bars back to 2000-09-18. All of it lives in
[src/shared/yahoo.ts](src/shared/yahoo.ts), which runs unchanged in Node and in
the Electron main process — both have global `fetch`, and neither is subject to
CORS.

Three things that cost real time to discover:

- **`range=max` is broken for this symbol.** It returns ~266 near-monthly bars.
  `range=10y` gives 2,517; an explicit `period1=0` gives the full 6,593. The
  module never sends `range` at all — only explicit epochs.
- **`ES=F` is an unadjusted stitched front-month series, not back-adjusted.** It
  has genuine discontinuities at quarterly expiries — measured: `2024-12-23`
  +2.77%, `2024-03-18` +1.65%, `2023-12-18` +1.62%. A return computed across a
  roll is carry, not a tradable move. The chart marks these;
  [rolls.ts](src/shared/rolls.ts) computes them from the third Friday of
  Mar/Jun/Sep/Dec, stepping forward over holidays to the next real session.
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

No aggregation and no downsampling: all 6,550 sessions are loaded the whole
time and the range buttons only move the viewport.

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
there and does *not* exist in the artifact.

## Licences

- This project — MIT, © 2026 Ke Yang. See [LICENSE](LICENSE).
- lightweight-charts — Apache-2.0, TradingView. Bundled; credited in the page footer.
- Archivo, IBM Plex Mono — SIL OFL 1.1. Bundled as woff2.
- Market data — Yahoo Finance, personal/research use only.
