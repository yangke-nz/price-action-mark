<script lang="ts">
  /** Whether the chart is showing intraday bars, which decides one key. Passed
   *  in rather than read from the store: this component has no other reason to
   *  know about `AppState`, and the chart's own interval is the truth here. */
  let { intraday = false }: { intraday?: boolean } = $props();
</script>

<!-- Both bodies are FILLED now, on request, so the legend no longer has a
     shape to lead with — the swatches say the same thing the candles do, which
     is the only rule this component has. Direction rests on the palette's
     LIGHTNESS step (dE 7.8 light / 8.6 dark under protan and deuteran
     simulation, see tokens.css), not on hue alone; what a filled up-candle
     gives up is the redundant channel, and this legend must not claim
     otherwise. -->
<div class="legend">
  <span class="key">
    <svg width="13" height="17" aria-hidden="true">
      <line x1="6.5" y1="0" x2="6.5" y2="17" stroke="var(--up)" stroke-width="1.5" />
      <rect x="1.5" y="4" width="10" height="9" fill="var(--up)" />
    </svg>
    Close &ge; open
  </span>

  <span class="key">
    <svg width="13" height="17" aria-hidden="true">
      <line x1="6.5" y1="0" x2="6.5" y2="17" stroke="var(--down)" stroke-width="1.5" />
      <rect x="1.5" y="4" width="10" height="9" fill="var(--down)" />
    </svg>
    Close &lt; open
  </span>

  <span class="key">
    <svg width="22" height="13" aria-hidden="true">
      <path d="M1 9 C6 9, 6 4, 11 4 S16 2, 21 2" fill="none" stroke="var(--ema)" stroke-width="1" stroke-linecap="round" />
    </svg>
    EMA 20
  </span>

  <span class="key">
    <svg width="11" height="13" aria-hidden="true">
      <path d="M5.5 1 L9 6 H2 Z" fill="var(--muted)" />
    </svg>
    Contract roll
  </span>

  <!-- Intraday only, like the session control and for the same reason: a daily
       bar IS a session, so it has no number within one. -->
  {#if intraday}
    <span class="key">
      <span class="num" aria-hidden="true">3</span>
      Bar of the session
    </span>
  {/if}

  <span class="key hint">Arrow keys step the crosshair</span>
</div>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 22px;
    padding: 11px 16px;
    border-top: 1px solid var(--grid);
    font-size: 12px;
    color: var(--ink-2);
  }

  .key { display: inline-flex; align-items: center; gap: 7px; }
  .key svg { flex: none; display: block; }
  /* The label as the chart draws it: same face, same size, same colour. */
  .num {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    width: 13px;
    text-align: center;
  }
  .hint { margin-left: auto; color: var(--muted); }
</style>
