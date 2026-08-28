<script lang="ts">
  import { source } from '$source';
  import { app } from '$lib/state/app.svelte.ts';
  import Masthead from '$lib/components/Masthead.svelte';
  import Controls from '$lib/components/Controls.svelte';
  import NoticeBar from '$lib/components/NoticeBar.svelte';
  import Readout from '$lib/components/Readout.svelte';
  import ChartPanel from '$lib/components/ChartPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';
  import MarkPanel from '$lib/components/MarkPanel.svelte';
  import MarkingPane from '$lib/components/MarkingPane.svelte';
  import Notes from '$lib/components/Notes.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let panel = $state<ChartPanel | undefined>();

  void app.boot();

  // The OS preference is tracked live so `theme: 'system'` flips without a
  // reload — Electron's nativeTheme and a browser's media query both surface
  // here as the same media match.
  $effect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    app.systemDark = query.matches;
    const onChange = (event: MediaQueryListEvent): void => { app.systemDark = event.matches; };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  // The chart re-reads its colours from the CSS custom properties, so setting
  // this attribute is the whole of theming. Explicit on both branches: leaving
  // it unset would let the media query and the in-app toggle disagree.
  //
  // $effect.pre, not $effect. ChartPanel's theme effect calls getComputedStyle
  // to pick the new palette up, and a plain $effect here is only ordered
  // against the child's by creation order — get it wrong and the chart reads
  // the OLD tokens and stays on the previous theme for good. Pre-effects all
  // flush before any user effect, so the attribute is guaranteed to be in
  // place before anything reads a computed style off it.
  $effect.pre(() => {
    document.documentElement.dataset['theme'] = app.resolvedTheme;
  });

  // The boot refresh lands after the window has already drawn the cached
  // series, so main pushes it here rather than the renderer asking again.
  $effect(() => source.onDatasetUpdate((result) => app.adopt(result)));

  // Native menu items and accelerators arrive here rather than as synthetic
  // DOM events, so the menu and the in-page controls drive one code path.
  $effect(() =>
    source.onCommand((command) => {
      switch (command.kind) {
        case 'refresh':     void app.refresh(); break;
        case 'theme':       app.setTheme(command.value); break;
        case 'range':       app.setRange(command.value); break;
        case 'toggle':      command.value === 'rolls' ? app.toggleRolls() : app.toggleEma(); break;
        case 'mark':        command.value === '*' ? app.toggleMarks() : app.toggleRule(command.value); break;
        case 'export':      void app.exportAs(command.value); break;
        case 'focus-chart': panel?.focus(); break;
      }
    }),
  );
</script>

<div class="wrap">
  <Masthead {app} />
  <Controls {app} />
  <NoticeBar {app} />

  <!-- Chart and marking sit side by side once the viewport can give the chart
       ~700px and still fit the cards; below that the grid collapses and they
       stack in the same order as before. -->
  <div class="stage">
    <section class="panel">
      <Readout {app} />
      {#if app.dataset}
        <ChartPanel bind:this={panel} {app} />
      {:else}
        <div class="placeholder">{app.status === 'loading' ? 'Loading sessions…' : 'No data available.'}</div>
      {/if}
      <Legend />
    </section>

    <aside class="side">
      <MarkPanel {app} />
      <MarkingPane {app} />
    </aside>
  </div>

  <Notes {app} />
  <DataTable {app} />
  <SiteFooter {app} />
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 28px 20px 56px;

    /* The chart's height is a token rather than a value in ChartPanel so the
       two-column breakpoint below is the only place that knows about it —
       otherwise the same media query has to be repeated in both files and
       they drift the first time one moves. */
    --chart-h: clamp(320px, 46vh, 560px);
  }

  /* One column by default. `minmax(0, 1fr)` rather than `1fr`: the chart card
     holds a canvas that reports its own width, and an auto-sized track would
     let it wedge the column open instead of shrinking with it. */
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;

    /* The rules card is bounded in the STACKED layout too, which it
       deliberately was not. Unbounded, 31 rules run to about 1,300px and push
       the marking pane 2,059px down the page — measured — which is the defect
       the two-pane rework fixed for the wide layout, reappearing below the
       breakpoint. That choice was made when this card was the last thing in
       the column; it now stands between the chart and the pane the reader
       actually works in. The wide branch overrides this with its own bound. */
    --rules-scroll-max: clamp(150px, 30vh, 340px);
  }


  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .placeholder {
    display: grid;
    place-items: center;
    height: var(--chart-h);
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .wrap { padding: 20px 13px 40px; }
  }

  /* 1200px is where the chart still gets 705px after the column's 420px floor
     and the gutters — narrower than that and the candles are the thing that
     suffers, which defeats the point of a second column. */
  @media (min-width: 1200px) {
    /* Beside the marking column the chart is no longer competing with it for
       vertical space, so it takes the height the viewport can actually show.
       The 340px is everything stacked above the candles — page padding, the
       masthead, the controls, the readout — plus the legend below; measured,
       not guessed. Subtract only the readout and legend and the DATE AXIS
       lands below the fold on a 1000px screen, which is worse than the short
       chart it replaced. The 460px floor is the old height: this may never
       make the chart smaller than the one-column layout gives it. */
    .wrap {
      max-width: 2400px;
      --chart-h: clamp(460px, calc(100vh - 340px), 900px);
    }

    /* The marking column is fluid, not a fixed 400px: the rule rows carry a
       name, a count and a blurb, and the mark table carries five columns, so
       both were being squeezed on exactly the screens this layout is for. The
       floor keeps the chart at 705px at the breakpoint; the 820px ceiling
       is where the mark table stops needing a horizontal scroll of its own,
       past which extra width buys nothing. The pane's two views size their own
       columns off a container query on the pane, so they adapt to whatever
       this hands them rather than reading the breakpoint a second time. */
    .stage { grid-template-columns: minmax(0, 1fr) clamp(420px, 34vw, 820px); }

    /* Two panes, not one scroller.
       ------------------------------------------------------------------
       The column used to scroll as a single piece, which put the mark list
       2,217 px down a 964 px column — the surface used on every mark opened
       off-screen. So the column itself no longer scrolls (`height` and
       `hidden`, not `max-height` and `auto`): the rules card takes a bounded
       slice off the top and scrolls inside it, and the mark list takes
       everything left over and scrolls inside that. Both cards are always
       in view, and neither can push the other out.

       `max-height` rather than `height` on the rules pane, because it is a
       <details>: closed, it must collapse to its summary bar and hand the
       space to the list, and a fixed height would leave an empty box. */
    /* Height comes from the CHART CARD, and now by STRETCHING to it rather
       than by adding up its parts.
       `100vh - 36px` was the obvious choice and it is wrong here: the column
       starts 201 px down the page, so a viewport-tall column hangs 165 px below
       the fold and the last rows of the pane are unreachable until the page is
       scrolled — and a reader marking up never scrolls the page. The chart card
       is readout + --chart-h + legend, and --chart-h is already tuned to fit
       the fold, so deriving from it fits by construction.

       It used to derive by arithmetic — `calc(var(--chart-h) + 108px)`, where
       108 was the measured readout and legend. Then the readout grew a line
       for the bar reading, 42px to 81px, and the columns were 16px out. A
       grid row that stretches is exact whatever the readout does, and the
       constant that has to be re-measured every time something above the
       candles changes is simply gone.

       No `position: sticky` either. It existed to keep a 2,257 px column in
       view while it scrolled; there is no such column now, and a sticky one
       cannot be both fold-height at rest and viewport-height when stuck. */
    .stage { align-items: stretch; }

    .side {
      /* auto, not hidden. Where ::details-content is supported the two panes
         divide the column exactly and there is nothing to scroll; where it is
         not, the cards fall back to their own max-heights and can add up to a
         little more than the column. Then this scrolls by that little, instead
         of clipping something the reader cannot reach. */
      overflow-y: auto;
      overscroll-behavior: contain;

      /* Fallback bounds for the two scroll regions, consumed by the cards
         themselves. Custom properties rather than :global selectors into their
         internals — the seam --chart-h already uses. Deliberately GENEROUS:
         where the flex chain works it computes a smaller height and wins, so
         these only bind in the browser that needs them. */
      --rules-scroll-max: clamp(150px, 24vh, 320px);
      --pane-scroll-max: max(240px, calc(var(--chart-h) - 250px));
    }

    /* Positional :global selectors: App owns the ORDER of these two, which is
       what the layout is. Anything about their insides stays their own.
       38% of the column to the rules: enough for a whole group plus the next
       heading, which is what makes the grouping worth having, and it leaves
       the marking pane — the reason for the rework, and now two views rather
       than one — the clear majority. */
    /* A percentage, not the arithmetic again: the column's height is definite
       because the grid row stretches, so 38% of it is exact and stays exact
       when anything above the candles changes size. */
    .side > :global(*:first-child) {
      flex: none;
      max-height: clamp(200px, 38%, 430px);
    }

    .side > :global(*:last-child) {
      flex: 1 1 auto;
      min-height: 0;
    }
  }
</style>
