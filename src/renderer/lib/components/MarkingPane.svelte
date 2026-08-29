<script lang="ts">
  /**
   * The second pane of the marking column, holding two views of the same
   * viewport: what the rules found, and what the bars say.
   *
   * WHY A TABLIST AND NOT A THIRD CARD. The wide layout divides this column
   * between exactly two panes at measured heights, and a reading needs width a
   * third of a column cannot spare. Two views in one pane cost one click and
   * no layout; a third card costs both panes their room.
   *
   * WHY THIS IS NOT A `<details>` ANY MORE. Two views need a real `tablist`,
   * and tabs inside a `<summary>` would put buttons inside a button — the
   * summary IS one. So the pane no longer collapses. That is the honest price:
   * it is paid down by the pane being bounded (it can never run away down the
   * page) and by the readout carrying the current bar's reading whether this
   * pane is on the reading tab or not.
   *
   * WHICH TAB OPENS. Marks, which is what this pane has always shown. The
   * reading is the new surface and would otherwise want to claim the slot, but
   * the readout already puts a reading in front of the reader on every load —
   * so defaulting to marks costs the new feature nothing and costs the marking
   * loop nothing either.
   *
   * The selection is NOT reset when the tab changes. A highlighted mark and a
   * highlighted session are different gestures on different state, and hiding
   * one view is not a decision about the other.
   */
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { integer } from '$shared/format.ts';
  import MarkList from './MarkList.svelte';
  import ReadingList from './ReadingList.svelte';

  let { app }: { app: AppState } = $props();

  type View = 'marks' | 'reading';

  const TABS: { id: View; label: string; hint: string }[] = [
    { id: 'marks', label: 'Marks in view', hint: 'Click a mark to highlight it on the chart' },
    { id: 'reading', label: 'Bar reading', hint: 'Click a line to highlight that session' },
  ];

  /** View state, deliberately not a setting. `settings.marks` is sparse on
   *  purpose so a later default can still reach people who have run the app;
   *  persisting a tab would freeze today's answer into every settings file to
   *  save one click. */
  let view = $state<View>('marks');

  const counts = $derived({ marks: app.visibleMarks.length, reading: app.visibleReadings.length });
  const hint = $derived(TABS.find((t) => t.id === view)?.hint ?? '');

  /** Left/right move between tabs, which is what a tablist is expected to do
   *  and the only way to reach the second tab without leaving the keyboard. */
  function onKeydown(event: KeyboardEvent, i: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length]!;
    view = next.id;
    document.getElementById(`tab-${next.id}`)?.focus();
  }
</script>

<section class="panel">
  <div class="bar">
    <div class="tabs" role="tablist" aria-label="Marking pane view">
      {#each TABS as tab, i (tab.id)}
        <button
          type="button"
          role="tab"
          id="tab-{tab.id}"
          aria-controls="panel-{tab.id}"
          aria-selected={view === tab.id}
          tabindex={view === tab.id ? 0 : -1}
          onclick={() => (view = tab.id)}
          onkeydown={(event) => onKeydown(event, i)}
        >
          {tab.label}
          <!-- Both counts, always. The reason to switch is usually that the
               other list has something in it, and a hidden view that cannot
               say so is a view nobody switches to. -->
          <span class="n">{integer(counts[tab.id])}</span>
        </button>
      {/each}
    </div>
    <span class="hint">{hint}</span>
  </div>

  {#each TABS as tab (tab.id)}
    <div
      class="view"
      class:on={view === tab.id}
      role="tabpanel"
      id="panel-{tab.id}"
      aria-labelledby="tab-{tab.id}"
      tabindex="0"
    >
      {#if tab.id === 'marks'}<MarkList {app} />{:else}<ReadingList {app} />{/if}
    </div>
  {/each}
</section>

<style>
  /* container-type: inline-size, so both views key their density off THIS
     box's width — the pane is a narrow column in the wide layout and a
     full-width card when the grid collapses, and the same view has to be right
     in both without either file repeating App's breakpoint. */
  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px 9px 12px;
    border-bottom: 1px solid var(--grid);
  }

  /* The same segmented control the rules card uses for All / Confirmed, so a
     second way of saying "one of these two" does not appear in the same
     column as the first. */
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-radius: var(--radius-sm);
  }

  .tabs button {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    padding: 5px 12px;
    border: 0;
    border-radius: 5px;
    background: none;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--ink-2);
    transition: background 0.12s, color 0.12s;
  }

  .tabs button:hover { background: var(--surface); color: var(--ink); }
  .tabs button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  .tabs button[aria-selected="true"] {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
  }

  .n {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--muted-text);
  }

  /* The active count inverts, so the number the reader is looking at is the
     one that belongs to what they can see. */
  .tabs button[aria-selected="true"] .n { background: var(--focus); color: var(--surface); }

  .hint {
    margin-left: auto;
    text-align: right;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: var(--muted-text);
  }

  /* display: none on the inactive view, not visibility or a height of zero:
     a hidden tabpanel must be out of the tab order and out of the accessibility
     tree, and its table must not report a scroll height to the flex chain. */
  .view { display: none; }

  .view.on {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .view:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  /* Below about 520px of pane the hint and the two tabs stop fitting on one
     row. The hint is the half that goes: both views repeat it in their own
     first line of copy, and the tabs are the control. */
  @container (max-width: 520px) {
    .hint { display: none; }
    .tabs { width: 100%; }
    .tabs button { flex: 1 1 0; justify-content: center; }
  }
</style>
