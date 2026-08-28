<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { RULES } from '$shared/marks/registry.ts';
  import { integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const marks = $derived(app.settings.marks);
  const shown = $derived(app.marks.length);

  /** The three groups, in the order the marking layer builds them: the special
   *  bars, the lines they form, the entries they set up. Headings earn their
   *  place once the card is narrow enough to drop the blurbs — with only a name
   *  and a count, the group is the remaining clue to what a rule is about. */
  const GROUPS = [
    { id: 'bars', label: 'Special bars' },
    { id: 'lines', label: 'Lines they form' },
    { id: 'entries', label: 'Entries they set up' },
  ] as const;

  const grouped = $derived(
    GROUPS.map((g) => ({ ...g, rules: RULES.filter((r) => r.group === g.id) }))
      .filter((g) => g.rules.length > 0),
  );
</script>

<details class="panel" open={marks.enabled}>
  <summary>
    <span class="title">Marking</span>
    <span class="count">
      {#if marks.enabled}{integer(shown)} marks from {app.enabledRules.size} rules{:else}off{/if}
    </span>
  </summary>

  <div class="body">
    <div class="top">
      <label class="master">
        <input type="checkbox" checked={marks.enabled} onchange={() => app.toggleMarks()} />
        Show marks
      </label>

      <!-- The publishing switch. Everything the rules propose is a candidate
           until it is kept; "Confirmed only" is the state a chart should be in
           before it goes out as an artifact. -->
      <div class="seg" role="group" aria-label="Which marks to show">
        <button
          type="button" aria-pressed={marks.show === 'all'} disabled={!marks.enabled}
          onclick={() => app.setMarkShow('all')}
        >All candidates</button>
        <button
          type="button" aria-pressed={marks.show === 'confirmed'} disabled={!marks.enabled}
          onclick={() => app.setMarkShow('confirmed')}
        >Confirmed only</button>
      </div>

      <span class="tally">
        {integer(app.confirmedCount)} kept · {integer(app.dismissedCount)} dropped
        {#if app.confirmedCount + app.dismissedCount > 0}
          <button type="button" class="reset" onclick={() => app.clearVerdicts()}>Reset</button>
        {/if}
      </span>
    </div>

    <!-- The scroll region is inert until something bounds its height. With no
         constraint it simply grows and never shows a scrollbar; dropped into
         the wide layout's bounded pane it takes the leftover and scrolls. That
         is why there is no media query here — one structure, two behaviours. -->
    <div class="scroll">
      <div class="rules">
        {#each grouped as group (group.id)}
          <h3 class="ghead">{group.label}</h3>
          {#each group.rules as rule (rule.id)}
            <!-- title carries the blurb for the compact layout, where the
                 blurb line is hidden: it is the description a screen reader
                 gets as well, so the text is not simply lost. -->
            <label class="rule" class:dim={!marks.enabled} title={rule.blurb}>
              <input
                type="checkbox"
                checked={app.enabledRules.has(rule.id)}
                disabled={!marks.enabled}
                onchange={() => app.toggleRule(rule.id)}
              />
              <span class="name">{rule.label}</span>
              <span class="n">{integer(app.markCounts.get(rule.id) ?? 0)}</span>
              <span class="blurb">{rule.blurb}</span>
            </label>
          {/each}
        {/each}
      </div>
    </div>
  </div>
</details>

<style>
  /* A flex column so a bounded height reaches the scroll region inside. As a
     <details> the summary is the first flex item, which is also what makes the
     card collapse to just that bar when it is shut.

     container-type is INLINE-SIZE, not size: the compact layout below keys off
     WIDTH. Keying it off height would be closer to the real constraint and is
     not available — `size` containment makes the element ignore its content
     for sizing, which collapses this card in the stacked layout where its
     height is indefinite. */
  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }

  /* ::details-content is the flex item, not `.body`.
     Chromium wraps a <details>'s content in this pseudo-element, so a
     `display: flex` <details> has TWO children: the summary and this. Without
     it in the chain a bounded card height stops here — measured: a 320px card
     held a `.scroll` reporting 498px of content and maxScroll 0, i.e. the rule
     list was CLIPPED and its last rows unreachable, which is the same failure
     the column-wide scroll had. min-height: 0 is the half that matters; a flex
     item will not go below min-content without it. */
  .panel::details-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 11px 16px;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    user-select: none;
  }

  summary:hover { color: var(--ink-2); }
  summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .title { color: var(--ink-2); }
  .count { margin-left: auto; letter-spacing: 0.04em; text-transform: none; }

  /* min-height: 0 is what lets the scroll region shrink below its content;
     without it a flex item refuses to go under min-content and the overflow
     lands on the card instead, which clips rather than scrolls. */
  .body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    border-top: 1px solid var(--grid);
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    flex: none;
    padding: 16px 16px 0;
  }

  /* max-height is the fallback for a browser without ::details-content, where
     the flex chain above cannot bound this. App supplies the value in BOTH
     layouts now: unset, thirty-one rules grow to about 1,300px, and in the
     stacked layout that pushed the marking pane below it 2,059px down the
     page. Unset here still means "grow", which is the honest default for a
     card nothing has bounded. */
  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    max-height: var(--rules-scroll-max, none);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-radius: var(--radius-sm);
  }

  .seg button {
    padding: 4px 10px;
    border: 0;
    border-radius: 5px;
    background: none;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-2);
    transition: background 0.12s, color 0.12s;
  }

  .seg button:hover:not(:disabled) { background: var(--surface); color: var(--ink); }
  .seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); font-weight: 600; }
  .seg button:disabled { opacity: 0.5; cursor: default; }
  .seg button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  .tally {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .reset {
    padding: 3px 8px;
    border: 1px solid var(--hair);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    font: inherit;
  }
  .reset:hover { color: var(--ink); background: var(--surface-2); }
  .reset:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  .master {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--ink);
    cursor: pointer;
    user-select: none;
  }

  .rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(288px, 1fr));
    gap: 2px 20px;
    padding: 12px 16px 16px;
  }

  .ghead {
    grid-column: 1 / -1;
    margin: 0;
    padding: 11px 0 3px;
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .rules > .ghead:first-child { padding-top: 0; }

  .rule {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 3px 8px;
    padding: 5px 0;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--ink-2);
  }

  .rule.dim { opacity: 0.45; cursor: default; }
  .rule:not(.dim):hover .name { color: var(--ink); }

  input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--focus); }
  .rule.dim input { cursor: default; }

  .name { font-weight: 500; }

  /* The count is the density warning: a rule firing on a third of all
     sessions is one the reader should think twice about switching on. */
  .n {
    justify-self: end;
    font-family: var(--mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .blurb {
    grid-column: 2 / -1;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--muted);
  }

  /* Compact rows once the card is too narrow to carry a blurb per rule —
     which is every width the side column hands it. Two columns of name and
     count fit ~15 rules in the space one column of blurbs fits 5, and that is
     the difference between the pane showing a group and showing a fragment.
     The blurb is not deleted, it moves to the row's title.

     A container query, not a media query: this card is full-width in the
     stacked layout and a narrow pane in the wide one, and it is the CARD's
     width that decides whether a blurb fits. Same seam MarkList uses. */
  @container (max-width: 700px) {
    .rules {
      grid-template-columns: repeat(auto-fit, minmax(196px, 1fr));
      gap: 0 22px;
      padding-bottom: 12px;
    }
    .rule {
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      padding: 3px 0;
      font-size: 12px;
    }
    .blurb { display: none; }
  }

  @media (max-width: 720px) {
    .rules { grid-template-columns: 1fr; }
  }
</style>
