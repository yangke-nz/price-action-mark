<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();
</script>

<div class="notes">
  <div class="note">
    <h3>Reading the roll</h3>
    <p>
      The markers sit on the first session of each new contract, where the stitched series
      jumps away from the one that just expired. That jump is <b>carry, not a move</b>
      &mdash; 23 December 2024 opened <b>2.77%</b> above the previous settlement and nobody
      traded it. The 20-session average runs straight through and <b>absorbs the carry</b>,
      so treat a cross within a few sessions of a marker with suspicion.
    </p>
  </div>

  <div class="note">
    <h3>Don't read the hue alone</h3>
    <p>
      Green up / red down is the trading convention and the classic red&ndash;green
      colour-blindness failure, so the steps were picked by measurement: under simulated
      protanopia and deuteranopia the pair still separates by <b>&Delta;E 7.8</b> in light
      mode and 8.6 in dark, because a dark green against a lighter red lets
      <b>lightness</b> carry what hue cannot. Both bodies are filled, so that step is now
      the whole of it &mdash; the bright pairing most charts use closes to &Delta;E 4.1 and
      would be indistinguishable here.
    </p>
  </div>

  <div class="note">
    <h3>All {integer(app.count)} bars, always</h3>
    <p>
      No aggregation and no downsampling &mdash; every bar the feed has is loaded and the
      chart pans across the whole span. The range buttons only move the viewport.
      {#if app.intraday}
        Intraday is a <b>60-day rolling window</b>: that is the entire archive this feed
        keeps, not a page of a longer one.
        {#if app.hiddenBars > 0}
          <b>RTH</b> is showing the 09:30&ndash;16:15 New York session and holding back
          {integer(app.hiddenBars)} overnight bars &mdash; switch to ETH for all of them.
        {/if}
      {/if}
    </p>
  </div>
</div>

<style>
  .notes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(268px, 1fr));
    gap: 14px;
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
  }

  h3 {
    margin: 0;
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  p { margin: 0; font-size: 13px; line-height: 1.52; color: var(--ink-2); }
  b { color: var(--ink); font-weight: 600; }
</style>
