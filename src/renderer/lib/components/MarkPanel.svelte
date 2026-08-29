<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import type { Rule } from '$shared/marks/rule.ts';
  import { RULES } from '$shared/marks/registry.ts';
  import { integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const marks = $derived(app.settings.marks);
  const shown = $derived(app.marks.length);

  /** The three groups, in the order the marking layer builds them: the special
   *  bars, the lines they form, the entries they set up. The headings carry
   *  weight now that a row is only a name and a count: the group is the
   *  remaining clue on the card to what a rule is about. */
  const GROUPS = [
    { id: 'bars', label: 'Special bars' },
    { id: 'lines', label: 'Lines they form' },
    { id: 'entries', label: 'Entries they set up' },
  ] as const;

  /**
   * Which drawers are open. Deliberately NOT a setting: `settings.marks` is
   * sparse on purpose so a later default can still reach someone who has run
   * the app, and persisting this would freeze today's answer into every
   * settings file to save one click — the same trade the marking pane's tab
   * declined.
   */
  let open = $state<Record<string, boolean>>({});

  /**
   * Each group split into what the card lists and what it folds away.
   *
   * Both sets come from `app` rather than from `rule.tier` directly, because
   * the reader can now move a rule off its shipped tier in the rules sheet —
   * and the invariant that a folded rule which is ON is never hidden has to
   * have exactly one implementation. `foldedRules` is the setting, so it
   * decides the quieter name; `hiddenRules` is the effect, so it decides
   * placement.
   */
  const grouped = $derived(
    GROUPS.map((g) => {
      const rules = RULES.filter((r) => r.group === g.id);
      return {
        ...g,
        core: rules.filter((r) => !app.hiddenRules.has(r.id)),
        extra: rules.filter((r) => app.hiddenRules.has(r.id)),
      };
    }).filter((g) => g.core.length + g.extra.length > 0),
  );

  const foldedTotal = $derived(grouped.reduce((n, g) => n + g.extra.length, 0));
  const allOpen = $derived(grouped.every((g) => g.extra.length === 0 || open[g.id] === true));

  function toggleAll(): void {
    const next = !allOpen;
    for (const g of grouped) open[g.id] = next;
  }
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

      <!-- The whole-list shortcut, in the LEFT cluster: this row divides into
           what is listed and what is kept, and the tally on the right owns the
           verdicts. It cannot live in the summary — a <summary> IS a button,
           so a button inside one is a button inside a button, the same
           constraint that stopped the marking pane's tabs going there. -->
      {#if foldedTotal > 0}
        <button
          type="button" class="foldall" disabled={!marks.enabled}
          onclick={toggleAll}
        >{allOpen ? 'Collapse' : `Show all ${foldedTotal}`}</button>
      {/if}

      <!-- The door to the rules sheet, beside the fold control it configures.
           A text button rather than an icon: an unlabelled gear in a row of
           words is a guess, and there is no room for a labelled icon. The
           sheet itself is mounted by App, so the native menu can open it
           without going through this card. -->
      <button
        type="button" class="foldall" disabled={!marks.enabled}
        onclick={() => app.openRules()}
      >Choose rules…</button>

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
          <h3 class="ghead">
            <span>{group.label}</span>
            {#if group.extra.length > 0}
              <span class="hair"></span>
              <!-- The fold rides the HEADING rather than taking a row of its
                   own. The heading already spans the list and already carries
                   the group's name, so the count costs nothing: a drawer row
                   per group spent ~16px each to say what this says for free.
                   A button, not a nested <details> — that would put a second
                   ::details-content into the flex chain this card's bounded
                   height depends on. -->
              <button
                type="button" class="chip"
                aria-expanded={open[group.id] === true}
                aria-label="{open[group.id] ? 'Hide' : 'Show'} {group.extra.length} less-used rules in {group.label}"
                disabled={!marks.enabled}
                onclick={() => (open[group.id] = !open[group.id])}
              >
                <span>{open[group.id] ? '−' : '+'}{group.extra.length}</span>
                <span class="caret" aria-hidden="true">▾</span>
              </button>
            {/if}
          </h3>

          {#each group.core as rule (rule.id)}
            {@render row(rule, app.foldedRules.has(rule.id))}
          {/each}

          {#if open[group.id]}
            {#each group.extra as rule (rule.id)}
              {@render row(rule, true)}
            {/each}
          {/if}
        {/each}
      </div>
    </div>
  </div>
</details>

<!-- The blurb is the row's `title` and nothing else. It used to print as a
     second line on a card wider than 700px, which is 31 descriptions nobody
     reads twice and the difference between the pane showing a group and
     showing a fragment; hovering the row says the same thing when the reader
     actually wants it, and the title is what a screen reader is handed too, so
     the text is not lost. `quiet` marks a rule that lives in the folded set,
     whether it is showing because the drawer is open or because it is on. -->
{#snippet row(rule: Rule, quiet: boolean)}
  <label class="rule" class:dim={!marks.enabled} class:quiet title={rule.blurb}>
    <input
      type="checkbox"
      checked={app.enabledRules.has(rule.id)}
      disabled={!marks.enabled}
      onchange={() => app.toggleRule(rule.id)}
    />
    <span class="name">{rule.label}{#if quiet}<span class="sr">, less used</span>{/if}</span>
    <span class="n">{integer(app.markCounts.get(rule.id) ?? 0)}</span>
  </label>
{/snippet}

<style>
  /* A flex column so a bounded height reaches the scroll region inside. As a
     <details> the summary is the first flex item, which is also what makes the
     card collapse to just that bar when it is shut.

     It carried `container-type: inline-size` for one query — the width at
     which the blurb line had to go — and there is no blurb line now, so the
     query and the containment went with it. Measured both ways in the built
     artifact before removing: card, list, scroll window, columns and row
     height are identical with it and without it, at 1904x1015 (a 647px card,
     2 columns) and at 1100x900 (a 1045px card, 4). The marking pane still
     declares its own container; this card no longer needs one. */
  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
    color: var(--muted-text);
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

  /* A text button, not a second segmented control: this row already holds one,
     and two segs an inch apart read as two halves of the same switch when one
     is about which rules are listed and the other about which marks publish. */
  .foldall {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-2);
    text-decoration: underline;
    text-decoration-color: var(--axis);
    text-underline-offset: 3px;
  }
  .foldall:hover:not(:disabled) { color: var(--ink); text-decoration-color: currentColor; }
  .foldall:disabled { opacity: 0.5; cursor: default; }
  .foldall:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  .tally {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted-text);
  }

  .reset {
    padding: 3px 8px;
    border: 1px solid var(--hair);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted-text);
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

  /* Two columns of name and count fit ~15 rules in the space one column of
     blurbs fit 5, and that is the difference between the pane showing a group
     and showing a fragment. This was the compact layout a container query
     switched to under 700px; with the blurb line gone there is nothing left
     for the wide case to do differently, so it is simply the layout. */
  .rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(196px, 1fr));
    gap: 0 22px;
    padding: 12px 16px;
  }

  .ghead {
    grid-column: 1 / -1;
    margin: 0;
    padding: 11px 0 3px;
    display: flex;
    align-items: center;
    gap: 9px;
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .rules > .ghead:first-child { padding-top: 0; }

  /* The rule that gives the heading its span, so the chip sits at the group's
     edge rather than trailing its name. */
  .hair { flex: 1 1 auto; height: 1px; background: var(--grid); }

  /* Neutral chrome on purpose. --ema would read as the moving average and
     --focus as a focused control; a fold is neither, it is furniture. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid var(--hair);
    border-radius: 20px;
    background: var(--surface-2);
    color: var(--muted-text);
    cursor: pointer;
    font: inherit;
    letter-spacing: 0.08em;
    transition: color 0.12s, background 0.12s;
  }

  .chip:hover:not(:disabled) { color: var(--ink); background: var(--surface); }
  .chip:disabled { opacity: 0.5; cursor: default; }
  .chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .chip .caret { font-size: 8px; transition: transform 0.14s; }
  .chip[aria-expanded="true"] .caret { transform: rotate(180deg); }

  .rule {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: 8px;
    padding: 3px 0;
    cursor: pointer;
    font-size: 12px;
    color: var(--ink-2);
  }

  .rule.dim { opacity: 0.45; cursor: default; }
  .rule:not(.dim):hover .name { color: var(--ink); }

  /* A rule from the folded set keeps a lighter name wherever it appears — in
     an open drawer, or promoted into the list because it is on. One signal,
     read the same way in both places; the checkbox says which case it is. */
  .rule.quiet .name { font-weight: 400; color: var(--muted-text); }
  .rule.quiet:not(.dim):hover .name { color: var(--ink-2); }

  input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--focus); }
  .rule.dim input { cursor: default; }

  .name { font-weight: 500; }

  /* The lighter name is a visual signal only, so the same fact is spoken. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* The count is the density warning: a rule firing on a third of all
     sessions is one the reader should think twice about switching on. */
  .n {
    justify-self: end;
    font-family: var(--mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-text);
  }

  @media (max-width: 720px) {
    .rules { grid-template-columns: 1fr; }
  }
</style>
