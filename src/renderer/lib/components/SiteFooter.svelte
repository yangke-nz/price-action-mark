<script lang="ts">
  import { source } from '$source';
  import type { AppInfo } from '$shared/ipc.ts';
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { barLabel, integer, price, relative, stamp } from '$shared/format.ts';
  import { specOf } from '$shared/interval.ts';

  let { app }: { app: AppState } = $props();

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
    Source: Yahoo Finance <code>v8/finance/chart/{app.dataset?.symbol ?? 'ES=F'}</code>, daily
    interval &mdash; free, no API key. {provenance}
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
    color: var(--muted);
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
