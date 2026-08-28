<script lang="ts">
  import { untrack } from 'svelte';
  import { CandleChart } from '$lib/chart/candles.ts';
  import { RANGES, type AppState } from '$lib/state/app.svelte.ts';
  import type { Dataset, RangeId } from '$shared/types.ts';
  import { barLabel, price } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  let container: HTMLDivElement;
  // Deliberately not $state: the effects below must not re-run merely because
  // the chart instance was assigned. The cost of that choice is that they
  // cannot apply anything before it exists, which is why the creation effect
  // seeds every piece of state rather than leaving it to them.
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
      // Keep is the action you take constantly while marking up; Drop is rarer
      // and stays in the list. The library's click event carries no modifier
      // keys, so there is no second gesture to give it anyway.
      onMarkClick: (id) => app.setVerdict(id, 'confirmed'),
    });
    chart = instance;
    applied = dataset;

    // Seed the initial state HERE, not from the standalone effects below.
    // `chart` is not reactive, so an effect that runs before this one has
    // assigned it does nothing and has no reason to run again — the value it
    // subscribed to never changes afterwards. Every piece of chart state that
    // the effects maintain therefore has to be applied once, here, where the
    // instance is known to exist.
    const settings = untrack(() => app.settings);
    instance.setEmaVisible(settings.showEma);
    instance.setRollsVisible(settings.showRolls);
    instance.showLastDays(daysFor(untrack(() => app.range)));
    instance.setMarks(untrack(() => app.marks));
    instance.setSelected(untrack(() => app.selectedMark?.id ?? null));
    instance.setFocusBar(untrack(() => app.selectedBarDate));

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
    chart.showLastDays(daysFor(untrack(() => app.range)));
  });

  // Each of these reads its reactive value into a local BEFORE touching the
  // chart. `chart?.method(app.thing)` looks equivalent and is not: optional
  // chaining skips argument evaluation, so on any run where `chart` is not yet
  // assigned the effect never reads `app.thing`, never subscribes to it, and
  // never runs again. The chart then silently keeps its initial state forever.
  $effect(() => {
    const marks = app.marks;
    chart?.setMarks(marks);
  });
  // Reads the RESOLVED selection, not the raw id: `app.selectedMark` is null
  // once the mark stops being drawn, so a dropped or filtered-out mark clears
  // its own highlight without this effect knowing the ways that can happen.
  $effect(() => {
    const id = app.selectedMark?.id ?? null;
    chart?.setSelected(id);
  });
  // The line the reader clicked in the bar reading. Reads the resolved DATE,
  // not the index: a refresh clears the selection, but the date is also what
  // the primitive anchors on, so nothing has to translate it at draw time.
  $effect(() => {
    const at = app.selectedBarDate;
    chart?.setFocusBar(at);
  });
  $effect(() => {
    const showEma = app.settings.showEma;
    chart?.setEmaVisible(showEma);
  });
  $effect(() => {
    const showRolls = app.settings.showRolls;
    chart?.setRollsVisible(showRolls);
  });
  $effect(() => {
    const days = daysFor(app.range);
    chart?.showLastDays(days);
  });

  // Reading resolvedTheme is what subscribes this effect; the chart then
  // re-reads the CSS custom properties itself.
  $effect(() => { app.resolvedTheme; chart?.applyTheme(); });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      app.clearKeyboard();
      app.clearMarkSelection();
      app.clearBarSelection();
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
    // The reading is spoken HERE rather than from the readout, which is an
    // atomic live region and would re-read every figure alongside it. This
    // region already exists to describe the focused bar in prose, and a
    // sentence about what the bar did belongs in a sentence.
    const reading = app.focusReading ? ` ${app.focusReading.text}.` : '';
    return `${barLabel(bar.date)}: open ${price(bar.open)}, high ${price(bar.high)}, ` +
      `low ${price(bar.low)}, close ${price(bar.close)}, ` +
      `${move.abs >= 0 ? 'up' : 'down'} ${Math.abs(move.pct).toFixed(2)} percent${gap}` +
      `${bar.isRoll ? '. Contract roll: this change is carry, not a traded move.' : '.'}` +
      reading;
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
  aria-label={`Candlestick chart of E-Mini S&P 500 futures, ${app.subjectLabel}. Left and right arrow keys step through bars and the readout above announces each one. Page Up and Page Down move about a month of bars; Home and End jump to the ends. A full data table is available below the chart.`}
  onkeydown={onKeydown}
  onblur={() => { app.clearKeyboard(); chart?.clearCrosshair(); }}
></div>

<p class="sr-only" aria-live="polite">{spoken}</p>

<style>
  /* --chart-h is set on .wrap in App.svelte, which owns the two-column
     breakpoint; the fallback keeps this component standalone. */
  .chart {
    width: 100%;
    height: var(--chart-h, clamp(320px, 46vh, 560px));
  }

  .chart:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
</style>
