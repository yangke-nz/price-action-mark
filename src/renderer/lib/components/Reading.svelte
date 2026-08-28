<script lang="ts">
  /**
   * One reading, rendered. Used by the readout above the chart and by every
   * row of the reading list.
   *
   * A component rather than the same three spans written twice, because the
   * COLOUR GRAMMAR is the thing that has to agree: tone belongs to the bar
   * clause alone, the context is muted, and a pattern name is ink. The context
   * and the patterns describe the market around the bar, and painting them the
   * bar's direction would claim they agreed with it. Two copies of that rule
   * would disagree the first time one moved.
   */
  import type { BarReading } from '$shared/marks/reading.ts';

  let { reading }: { reading: BarReading } = $props();
</script>

<!-- The separators are explicit `{' '}` text nodes. A leading space written
     INSIDE the span is trimmed by the compiler, and the clauses then run
     together as "…the session before— always-in long"; a space between the
     tags is collapsed by the same pass. This is the form that survives. -->
<span class="bar {reading.tone}">{reading.bar}</span
>{#if reading.context}{' '}<span class="ctx">— {reading.context}</span>{/if
}{#if reading.patterns.length}{' '}<span class="pat">— {reading.patterns.join(', ')}</span>{/if}

<style>
  .bar.bull { color: var(--up-text); }
  .bar.bear { color: var(--down-text); }
  .bar.neutral { color: var(--ink-2); }
  /* A suspect print or a contract start: the bar is real but its arithmetic
     cannot be trusted, which is a different thing from a direction. Italic
     rather than a fourth hue, the same argument the mark palette makes. */
  .bar.caution { color: var(--ink); font-style: italic; }
  .ctx { color: var(--muted); }
  .pat { color: var(--ink); font-weight: 600; }
</style>
