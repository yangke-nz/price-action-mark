<script lang="ts">
  import { untrack } from 'svelte';
  import { CandleChart } from '$lib/chart/candles.ts';
  import { RANGES, type AppState } from '$lib/state/app.svelte.ts';
  import type { Dataset, RangeId } from '$shared/types.ts';
  import { day, price } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  let container: HTMLDivElement;
  // Deliberately not $state: the effects below must not re-run merely because
  // the chart instance was assigned.
  let chart: CandleChart | undefined;
  let applied: Dataset | undefined;

  function daysFor(id: RangeId): number {
    return RANGES.find((r) => r.id === id)?.days ?? 183;
  }

  $effect(() => {
    const dataset = untrack(() => app.dataset);
    if (!dataset) return;

    const instance = new CandleChart(container, dataset, {
      onHover: (index) => { app.hoverIndex = index; },
      onViewport: (viewport) => { app.viewport = viewport; },
    });
    chart = instance;
    applied = dataset;

    const settings = untrack(() => app.settings);
    instance.setEmaVisible(settings.showEma);
    instance.setRollsVisible(settings.showRolls);
    instance.showLastDays(daysFor(settings.range));

    // Web fonts land after the first paint, and the axis gutters are measured
    // in pixels, so the chart has to re-measure once they do.
    void document.fonts?.ready.then(() => instance.remeasure());

    return () => {
      chart = undefined;
      instance.dispose();
    };
  });

  // A refresh brings a longer series; re-anchor the viewport, because the
  // preset ranges are all relative to the last session.
  $effect(() => {
    const dataset = app.dataset;
    if (!chart || !dataset || dataset === applied) return;
    applied = dataset;
    chart.setData(dataset);
    chart.showLastDays(daysFor(untrack(() => app.settings.range)));
  });

  $effect(() => { chart?.setEmaVisible(app.settings.showEma); });
  $effect(() => { chart?.setRollsVisible(app.settings.showRolls); });
  $effect(() => { chart?.showLastDays(daysFor(app.settings.range)); });

  // Reading resolvedTheme is what subscribes this effect; the chart then
  // re-reads the CSS custom properties itself.
  $effect(() => { app.resolvedTheme; chart?.applyTheme(); });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      app.clearKeyboard();
      chart?.clearCrosshair();
      return;
    }
    const next = app.stepKeyboard(event.key);
    if (next === null) return;
    event.preventDefault();
    chart?.moveCrosshair(next);
  }

  export function focus(): void {
    container?.focus();
  }

  const spoken = $derived.by(() => {
    const bar = app.focusBar;
    if (!bar) return '';
    const move = app.change(bar.i);
    const gap = app.settings.showEma && app.focusEmaGap
      ? `, ${Math.abs(app.focusEmaGap.pct).toFixed(2)} percent ` +
        `${app.focusEmaGap.abs >= 0 ? 'above' : 'below'} the ${app.emaPeriod}-session average`
      : '';
    return `${day(bar.date)}: open ${price(bar.open)}, high ${price(bar.high)}, ` +
      `low ${price(bar.low)}, close ${price(bar.close)}, ` +
      `${move.abs >= 0 ? 'up' : 'down'} ${Math.abs(move.pct).toFixed(2)} percent${gap}` +
      `${bar.isRoll ? '. Contract roll: this change is carry, not a traded move.' : '.'}`;
  });
</script>

<!-- The chart is a focusable, keyboard-driven surface, which is exactly what
     role="application" describes; Svelte's a11y pass does not recognise it as
     interactive and would otherwise flag the tabindex and the handlers. The
     live region below carries the same information to a screen reader. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={container}
  class="chart"
  tabindex="0"
  role="application"
  aria-label="Candlestick chart of E-Mini S&P 500 futures daily bars. Left and right arrow keys step through sessions and the readout above announces each one. Page Up and Page Down move a month; Home and End jump to the ends. A full data table is available below the chart."
  onkeydown={onKeydown}
  onblur={() => { app.clearKeyboard(); chart?.clearCrosshair(); }}
></div>

<p class="sr-only" aria-live="polite">{spoken}</p>

<style>
  .chart {
    width: 100%;
    height: clamp(320px, 46vh, 560px);
  }

  .chart:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
</style>
