<script lang="ts">
  import { TABLE_CAP, type AppState } from '$lib/state/app.svelte.ts';
  import { day, delta, integer, price, signedPct, volume } from '$shared/format.ts';
  import Reading from './Reading.svelte';

  let { app }: { app: AppState } = $props();

  const bar = $derived(app.focusBar);
  const move = $derived(bar ? app.change(bar.i) : null);

  /** The status line on the right earns its space by naming the two things the
   *  chart cannot show about itself: how much is off-screen, and whether the
   *  roll markers were suppressed. */
  const status = $derived.by(() => {
    const parts = [`Daily bars · ${integer(app.visibleCount)} in view`];
    if (app.tableTruncated) parts.push(`table capped at ${integer(TABLE_CAP)}`);
    if (app.viewport.rollsHidden) parts.push('rolls too dense to mark');
    // Bar labels vanish below 8px a bar, which from the chart alone is
    // indistinguishable from "this stretch has no marks".
    if (app.viewport.barMarksHidden) parts.push('zoom in for bar marks');
    return parts.join(' · ');
  });
</script>

<div class="readout" aria-live="polite" aria-atomic="true">
  <div class="figures">
    <span class="date">
      {bar ? day(bar.date) : '—'}{#if bar?.isRoll}<span class="rollflag">&nbsp;·&nbsp;ROLL</span>{/if}
    </span>
    <span class="f">O <b>{price(bar?.open)}</b></span>
    <span class="f">H <b>{price(bar?.high)}</b></span>
    <span class="f">L <b>{price(bar?.low)}</b></span>
    <span class="f">C <b>{price(bar?.close)}</b></span>
    <span class="f">CHG
      <b class:pos={(move?.abs ?? 0) >= 0} class:neg={(move?.abs ?? 0) < 0}>
        {move ? delta(move.abs, move.pct) : '—'}
      </b>
    </span>
    {#if app.settings.showEma}
      <span class="f">EMA{app.emaPeriod}
        <b class="ema">{price(app.focusEma)}</b>
        {#if app.focusEmaGap}<span class="gap">{signedPct(app.focusEmaGap.pct)}</span>{/if}
      </span>
    {/if}
    <span class="f">VOL <b>{volume(bar?.volume)}</b></span>
    <span class="gran">{status}</span>
  </div>

  <!-- The bar, in words. The full list lives in the marking pane; this is the
       one line about the session actually under the crosshair, which is the
       reading a reader wants nine times out of ten and the only one that can
       be had without looking away from the candles.

       aria-hidden, and not because it does not matter to a screen reader — it
       matters most. This whole readout is an ATOMIC live region, so every
       crosshair move re-reads all of it; adding the sentence here took that
       announcement from 40 words to 54 (measured). ChartPanel keeps a live
       region built for exactly this, announcing the focused bar as prose, and
       the reading is appended THERE. Hidden here so it is announced once
       rather than twice. -->
  {#if app.focusReading}
    <p class="say" aria-hidden="true"><Reading reading={app.focusReading} /></p>
  {/if}
</div>

<style>
  .readout {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 42px;
    padding: 10px 16px 9px;
    border-bottom: 1px solid var(--grid);
    font-family: var(--mono);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  /* The figures keep the row they always had; the reading gets its own line
     under them rather than joining the wrap, because a sentence flowing in
     among O/H/L/C would be read as another field. */
  .figures {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 5px 20px;
  }

  .say {
    margin: 0;
    line-height: 1.45;
    /* Not tabular: this is prose, and tabular figures inside "1.9x ATR" set
       the digits on a grid the words are not on. */
    font-variant-numeric: normal;
  }

  .date { min-width: 9.5ch; font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }
  .rollflag { color: var(--muted); font-weight: 500; }
  .f { display: inline-flex; gap: 5px; color: var(--muted); }
  .f b { font-weight: 600; color: var(--ink-2); }
  .f b.ema { color: var(--ema); }
  /* Distance from the average, dimmed — it qualifies the number before it
     rather than competing with the session's own change. */
  .gap { color: var(--muted); font-size: 11px; }

  .gran {
    margin-left: auto;
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .readout { font-size: 11.5px; }
    .figures { gap: 4px 14px; }
    .gran { margin-left: 0; width: 100%; }
  }
</style>
