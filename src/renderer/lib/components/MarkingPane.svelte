<script lang="ts">
  /**
   * The second pane of the marking column: ONE descending tape of the sessions
   * in view, and a filter deciding how much of it shows.
   *
   * IT USED TO BE A TABLIST OVER TWO LISTS — "Marks in view" and "Bar reading".
   * They were both newest-first over the same viewport, so the tab was a switch
   * the reader paid on every glance, and the two overlapped by construction:
   * a reading names the patterns knowable at that close, which is most of what
   * the mark list showed for the same bar. Merged, that overlap became the
   * link between a sentence and the thing it names — see Tape.svelte.
   *
   * SO THE CONTROL CHANGED QUESTION. It asked "which list?"; it now asks "how
   * much of the tape?" — All / Marked / Unresolved. The third is new and is the
   * marking loop's missing finish line: the tabbed pane could say how many
   * marks were in view but never how many were still waiting on the reader.
   *
   * A `radiogroup`, not a `tablist`. There is one panel now, so there are no
   * tabs to select between — three mutually exclusive settings of one list is
   * what a radio group is. The keyboard contract is nearly the same (arrows
   * move AND select), which is why the handler survived the change.
   *
   * The pane still does not collapse, and that is still the price of the
   * placement: it is bounded so it can never run away down the page, and the
   * readout carries the current bar's reading whatever the filter says.
   *
   * The selection is NOT reset when the filter changes. A highlighted mark and
   * a highlighted session are different gestures on different state, and
   * narrowing the list is not a decision about either.
   */
  import type { AppState, TapeFilter } from '$lib/state/app.svelte.ts';
  import { integer } from '$shared/format.ts';
  import Tape from './Tape.svelte';

  let { app }: { app: AppState } = $props();

  const FILTERS: { id: TapeFilter; label: string; hint: string }[] = [
    { id: 'all', label: 'All', hint: 'Click a line to highlight the session' },
    { id: 'marked', label: 'Marked', hint: 'Sessions carrying a mark' },
    { id: 'unresolved', label: 'Unresolved', hint: 'Marks still waiting on a verdict' },
  ];

  const counts = $derived(app.tapeCounts);
  const hint = $derived(FILTERS.find((f) => f.id === app.tapeFilter)?.hint ?? '');

  /** Left/right move between the filters, which is what a radio group is
   *  expected to do and the only way to reach the others without leaving the
   *  keyboard. */
  function onKeydown(event: KeyboardEvent, i: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = FILTERS[(i + step + FILTERS.length) % FILTERS.length]!;
    app.setTapeFilter(next.id);
    document.getElementById(`tape-${next.id}`)?.focus();
  }
</script>

<section class="panel" aria-label="Sessions in view">
  <div class="bar">
    <div class="tabs" role="radiogroup" aria-label="Tape filter">
      {#each FILTERS as filter, i (filter.id)}
        <button
          type="button"
          role="radio"
          id="tape-{filter.id}"
          aria-checked={app.tapeFilter === filter.id}
          tabindex={app.tapeFilter === filter.id ? 0 : -1}
          onclick={() => app.setTapeFilter(filter.id)}
          onkeydown={(event) => onKeydown(event, i)}
        >
          {filter.label}
          <!-- All three counts, always. The reason to narrow is usually that
               something is waiting in one of the others, and a filter that
               cannot say so is a filter nobody presses. -->
          <span class="n">{integer(counts[filter.id])}</span>
        </button>
      {/each}
    </div>
    <span class="hint">{hint}</span>
  </div>

  <div class="view">
    <Tape {app} />
  </div>
</section>

<style>
  /* container-type: inline-size, so the tape keys its density off THIS box's
     width — the pane is a narrow column in the wide layout and a full-width
     card when the grid collapses, and the same view has to be right in both
     without either file repeating App's breakpoint. */
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
     second way of saying "one of these" does not appear in the same column as
     the first. */
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

  .tabs button[aria-checked="true"] {
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
  .tabs button[aria-checked="true"] .n { background: var(--focus); color: var(--surface); }

  .hint {
    margin-left: auto;
    text-align: right;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: var(--muted-text);
  }

  .view {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Below about 520px of pane the hint and the three filters stop fitting on
     one row. The hint is the half that goes: the tape repeats it in its own
     first line of copy, and the filter is the control. */
  @container (max-width: 520px) {
    .hint { display: none; }
    .tabs { width: 100%; }
    .tabs button { flex: 1 1 0; justify-content: center; }
  }
</style>
