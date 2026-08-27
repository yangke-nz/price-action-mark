<script lang="ts">
  // No props and no state — but a component with no <script> block cannot be
  // typed by svelte-check, and this project treats its warnings as errors.
</script>

<!-- Shape, not just hue. The hollow/filled distinction is what survives
     red-green colour blindness, greyscale and print, so the legend leads
     with it rather than with the colour swatch. -->
<div class="legend">
  <span class="key">
    <svg width="13" height="17" aria-hidden="true">
      <line x1="6.5" y1="0" x2="6.5" y2="17" stroke="var(--up)" stroke-width="1.5" />
      <rect x="1.5" y="4" width="10" height="9" fill="var(--surface)" stroke="var(--up)" stroke-width="1.5" />
    </svg>
    Close &ge; open <span class="dim">(hollow)</span>
  </span>

  <span class="key">
    <svg width="13" height="17" aria-hidden="true">
      <line x1="6.5" y1="0" x2="6.5" y2="17" stroke="var(--down)" stroke-width="1.5" />
      <rect x="1.5" y="4" width="10" height="9" fill="var(--down)" />
    </svg>
    Close &lt; open <span class="dim">(filled)</span>
  </span>

  <span class="key">
    <svg width="22" height="13" aria-hidden="true">
      <path d="M1 9 C6 9, 6 4, 11 4 S16 2, 21 2" fill="none" stroke="var(--ema)" stroke-width="2" stroke-linecap="round" />
    </svg>
    EMA 20
  </span>

  <span class="key">
    <svg width="11" height="13" aria-hidden="true">
      <path d="M5.5 1 L9 6 H2 Z" fill="var(--muted)" />
    </svg>
    Contract roll
  </span>

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
  .dim { color: var(--muted); }
  .hint { margin-left: auto; color: var(--muted); }
</style>
