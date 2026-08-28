<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { barLabel, delta, price } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const last = $derived(app.lastBar);
  const move = $derived(last ? app.change(last.i) : null);
</script>

<header class="masthead">
  <div class="ident">
    <div class="eyebrow">
      <span>{app.dataset?.symbol ?? 'ES=F'}</span><span class="dot"></span>
      <span>{app.dataset?.exchange ?? 'CME'}</span><span class="dot"></span>
      <span>{app.dataset?.currency ?? 'USD'}</span><span class="dot"></span>
      <span>$50 &times; index</span>
    </div>
    <!-- The subject of the chart, which includes the bar size: this said "daily
         bars" over five-minute candles until the timeframe switch existed. The
         PRODUCT name lives in <title>, the window title and the footer. -->
    <h1>E-Mini S&amp;P 500 futures, {app.subjectLabel}</h1>
    <p class="sub">
      Front-month continuous series.
      {#if app.intraday}
        Every candle is five minutes of the Globex session, timed in UTC.
      {:else}
        Every candle is one CME session &mdash; open, high, low, settle.
      {/if}
      Scroll to zoom, drag to pan, arrow keys step the crosshair.
    </p>
  </div>

  <div class="quote">
    <div class="last">{last ? price(last.close) : '—'}</div>
    <div class="chg">
      <div class="val" class:pos={(move?.abs ?? 0) >= 0} class:neg={(move?.abs ?? 0) < 0}>
        {move ? delta(move.abs, move.pct) : '—'}
      </div>
      <div class="cap">{last ? barLabel(last.date) : 'last bar'}</div>
    </div>
  </div>
</header>

<style>
  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px 32px;
  }

  .ident { display: flex; flex-direction: column; gap: 5px; min-width: 0; }

  .eyebrow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--axis); flex: none; }

  h1 {
    margin: 0;
    font-size: clamp(23px, 3.1vw, 31px);
    font-weight: 600;
    letter-spacing: -0.021em;
    line-height: 1.14;
    text-wrap: balance;
  }

  .sub { margin: 0; font-size: 13.5px; color: var(--ink-2); max-width: 58ch; }

  .quote { display: flex; align-items: flex-end; gap: 16px; flex: none; }

  .last {
    font-size: clamp(34px, 5.2vw, 46px);
    font-weight: 600;
    letter-spacing: -0.028em;
    line-height: 1;
    font-variant-numeric: proportional-nums;
  }

  .chg { display: flex; flex-direction: column; gap: 3px; padding-bottom: 3px; }

  .val {
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .cap {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
