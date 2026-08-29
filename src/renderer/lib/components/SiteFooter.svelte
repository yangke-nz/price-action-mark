<script lang="ts">
  import { source } from '$source';
  import type { AppInfo } from '$shared/ipc.ts';
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { barLabel, integer, price, relative, stamp } from '$shared/format.ts';
  import { specOf } from '$shared/interval.ts';
  import { sourceIntervalFor } from '$shared/session.ts';

  let { app }: { app: AppState } = $props();

  /**
   * The `interval=` this page's bars were actually requested with.
   *
   * Hard-coded to "daily" until now, which was wrong on a 5-minute chart and
   * wrong twice over on RTH daily — those bars are aggregated here from an
   * `interval=5m` pull, so the endpoint named in this sentence was never asked
   * for daily at all. Same fault the masthead H1 had before the timeframe
   * switch existed, in the one line that names the API. `sourceIntervalFor` is
   * the same answer `boot`, `setSession`, `setInterval` and main's boot refresh
   * use, so this cannot drift from what was fetched.
   */
  const requested = $derived(sourceIntervalFor(app.interval, app.session));

  let info = $state<AppInfo | null>(null);
  $effect(() => { void source.appInfo().then((i) => { info = i; }); });

  /** Which tier the bars on screen came from. A stale cache that looks live is
   *  the one failure mode a price chart cannot show you, so it is stated. */
  const provenance = $derived.by(() => {
    const d = app.dataset;
    if (!d) return 'No dataset loaded.';
    const when = `${stamp(d.fetched)} (${relative(d.fetched)})`;
    switch (app.origin) {
      case 'network': return `Pulled live from Yahoo at ${when}.`;
      case 'cache':   return `From the local cache, snapshot taken ${when}.`;
      case 'bundled': return `From the snapshot shipped with this build, taken ${when}.`;
    }
  });

  const coverage = $derived.by(() => {
    const d = app.dataset;
    if (!d || d.d.length === 0) return '';
    const span = `${integer(d.d.length)} ${specOf(d).intraday ? 'bars' : 'sessions'}, ` +
      `${barLabel(d.d[0]!)} to ${barLabel(d.d[d.d.length - 1]!)}`;
    const band = d.w52l != null && d.w52h != null
      ? ` 52-week range ${price(d.w52l)}–${price(d.w52h)}.`
      : '';
    return `Full series: ${span}.${band}`;
  });
</script>

<footer>
  <div>
    Source: Yahoo Finance <code>v8/finance/chart/{app.dataset?.symbol ?? 'ES=F'}</code>,
    <code>interval={requested}</code>{#if app.aggregated}, aggregated here into
    {app.sessionLabel} daily bars{/if} &mdash; free, no API key. {provenance}
  </div>
  <div>{coverage}</div>
  <div>
    Unadjusted front-month series: a return computed across a roll marker is not a tradable
    return.
  </div>
  <div>
    Rendered with
    <a href="https://github.com/tradingview/lightweight-charts" target="_blank" rel="noreferrer">
      TradingView Lightweight Charts
    </a>
    v{info?.charts ?? '5'}, Apache-2.0.
    {#if info}
      <span class="build">Price Action Mark {info.app} · Electron {info.electron} · Chromium {info.chrome.split('.')[0]} · Node {info.node}</span>
    {:else}
      <span class="build">Price Action Mark &mdash; single-file build, a dated snapshot with no network.</span>
    {/if}
  </div>
</footer>

<style>
  footer {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--muted-text);
  }

  a {
    color: var(--ink-2);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
  }

  a:hover { color: var(--ink); }
  code { font-family: var(--mono); font-size: 11.5px; }
  .build { font-family: var(--mono); font-size: 11px; }
</style>
