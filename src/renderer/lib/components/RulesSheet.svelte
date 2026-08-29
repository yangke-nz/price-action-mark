<script lang="ts">
  /**
   * The rules sheet: every rule in the registry, with the two decisions the
   * card cannot fit side by side — what shows on the chart, and what the card
   * lists.
   *
   * WHY A MODAL AND NOT A THIRD CARD. This is a set-once decision over
   * thirty-one rows carrying the numbers that justify it. The marking column is
   * divided between two panes at measured heights and has nothing to spare; a
   * dialog costs no layout at all and can be as wide as the decision needs.
   *
   * WHY A NATIVE <dialog>. `showModal()` brings the focus trap, Escape, the
   * inert backdrop and the top layer with it. Hand-rolling those is how a
   * modal ends up leaving focus behind it.
   *
   * IT IS MOUNTED BY App, NOT BY MarkPanel, so the native menu's command can
   * open it without routing through the card that happens to hold the other
   * door.
   */
  import type { AppState } from '$lib/state/app.svelte.ts';
  import type { Rule } from '$shared/marks/rule.ts';
  import type { RuleId } from '$shared/marks/types.ts';
  import { RULES } from '$shared/marks/registry.ts';
  import { integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const GROUPS = [
    { id: 'bars', label: 'Special bars' },
    { id: 'lines', label: 'Lines' },
    { id: 'entries', label: 'Entries' },
  ] as const;

  /** A rule firing on this share of sessions is one to think twice about. */
  const HOT_PCT = 10;

  let dialog = $state<HTMLDialogElement | null>(null);
  let filter = $state('');
  /** `density` sorts by share of bars, which is the question that makes anyone
   *  open this. `registry` is the grouped reading order. */
  let sort = $state<'registry' | 'density'>('registry');

  const marks = $derived(app.settings.marks);
  const query = $derived(filter.trim().toLowerCase());

  function matches(rule: Rule): boolean {
    if (query === '') return true;
    return rule.label.toLowerCase().includes(query)
      || rule.id.includes(query)
      || rule.blurb.toLowerCase().includes(query);
  }

  const countOf = (id: RuleId): number => app.markCounts.get(id) ?? 0;
  /** Share of the sessions on screen, so the figure agrees with the card's
   *  count and with whatever timeframe and session window are loaded. */
  const pctOf = (id: RuleId): number => (app.count === 0 ? 0 : (countOf(id) / app.count) * 100);

  const shown = $derived(RULES.filter(matches));
  const flat = $derived(
    sort === 'density' ? [...shown].sort((a, b) => countOf(b.id) - countOf(a.id)) : [],
  );

  const grouped = $derived(
    GROUPS.map((g) => {
      const rules = shown.filter((r) => r.group === g.id);
      // Only a rule that is OFF can be folded, so a group's bulk action counts
      // exactly those: offering to fold a rule that is on would promise
      // something the invariant then takes back.
      const foldable = rules.filter((r) => !app.enabledRules.has(r.id));
      return {
        ...g,
        rules,
        foldable,
        allFolded: foldable.length > 0 && foldable.every((r) => app.foldedRules.has(r.id)),
      };
    }).filter((g) => g.rules.length > 0),
  );

  /** How many rules the reader has moved off their shipped tier — which is
   *  exactly what gets written to disk. */
  const edits = $derived(Object.keys(marks.folded).length);
  const foldedCount = $derived(app.hiddenRules.size);

  // showModal()/close() are imperative, so the open flag drives them here
  // rather than the markup. Reading `app.rulesOpen` is what subscribes this.
  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (app.rulesOpen && !el.open) el.showModal();
    else if (!app.rulesOpen && el.open) el.close();
  });

  function placeOf(rule: Rule): { text: string; tone: string } {
    const folded = app.foldedRules.has(rule.id);
    if (folded && app.enabledRules.has(rule.id)) return { text: 'on · listed', tone: 'pinned' };
    return app.hiddenRules.has(rule.id)
      ? { text: 'folded', tone: 'away' }
      : { text: 'listed', tone: 'listed' };
  }
</script>

<!-- Escape and the backdrop close the dialog without going through our click
     handlers, so the flag is synced back on the element's own close event.
     Without this the sheet cannot be reopened: the flag would still say open. -->
<dialog bind:this={dialog} class="sheet" onclose={() => app.closeRules()} aria-labelledby="rules-sheet-title">
  <div class="head">
    <h2 id="rules-sheet-title">Marking rules</h2>
    <span class="sub">
      {integer(RULES.length - foldedCount)} listed · {integer(foldedCount)} folded ·
      {integer(RULES.length)} in the registry
    </span>
    <button type="button" class="x" aria-label="Close" onclick={() => app.closeRules()}>✕</button>
  </div>

  <div class="toolbar">
    <input type="search" placeholder="Filter {RULES.length} rules…" bind:value={filter} />
    {#if sort === 'density' && shown.length > 0}
      <!-- Sorted, the groups are gone and so are their bulk actions, so the
           one that remains acts on what the filter and the sort have left. -->
      <button
        type="button" class="bulk"
        onclick={() => app.setRulesFolded(
          shown.filter((r) => !app.enabledRules.has(r.id)).map((r) => r.id), true,
        )}
      >Fold the {shown.filter((r) => !app.enabledRules.has(r.id)).length} off rules here</button>
    {/if}
    <span class="spacer"></span>
    <span class="hint">A rule that is on is always listed</span>
  </div>

  <div class="list">
    <table>
      <thead>
        <tr>
          <th>Rule</th>
          <th class="c">Show</th>
          <th class="c">Fold</th>
          <th class="where">Where</th>
          <th class="n">Marks</th>
          <th
            class="n sortable"
            aria-sort={sort === 'density' ? 'descending' : 'none'}
          >
            <button
              type="button"
              onclick={() => (sort = sort === 'density' ? 'registry' : 'density')}
            >% of bars{#if sort === 'density'}<span class="arrow" aria-hidden="true">▼</span>{/if}</button>
          </th>
        </tr>
      </thead>

      <tbody>
        {#if sort === 'density'}
          {#each flat as rule (rule.id)}
            {@render row(rule)}
          {/each}
        {:else}
          {#each grouped as group (group.id)}
            <tr class="grp">
              <td colspan="6">
                <span>{group.label}</span>
                {#if group.foldable.length > 0}
                  <button
                    type="button" class="bulk"
                    onclick={() => app.setRulesFolded(
                      group.foldable.map((r) => r.id), !group.allFolded,
                    )}
                  >{group.allFolded ? 'list all' : `fold the ${group.foldable.length} off`}</button>
                {/if}
              </td>
            </tr>
            {#each group.rules as rule (rule.id)}
              {@render row(rule)}
            {/each}
          {/each}
        {/if}

        {#if shown.length === 0}
          <tr>
            <td colspan="6" class="empty">
              No rule matches “{filter}”. Clear the filter to see all {RULES.length}.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <div class="foot">
    <span class:edited={edits > 0}>
      {#if edits > 0}
        {integer(edits)} rule{edits === 1 ? '' : 's'} moved off what this build folds — only those are stored
      {:else}
        Nothing stored: every rule is where this build put it
      {/if}
    </span>
    <span class="spacer"></span>
    {#if edits > 0}
      <button type="button" class="btn" onclick={() => app.clearFolds()}>Drop my changes</button>
    {/if}
    <button type="button" class="btn primary" onclick={() => app.closeRules()}>Done</button>
  </div>
</dialog>

{#snippet row(rule: Rule)}
  {@const on = app.enabledRules.has(rule.id)}
  {@const folded = app.foldedRules.has(rule.id)}
  {@const place = placeOf(rule)}
  {@const pct = pctOf(rule.id)}
  <tr class:quiet={folded}>
    <td class="name">
      <span class="label">{rule.label}</span>
      <span class="blurb">{rule.blurb}</span>
    </td>

    <td class="c">
      <label>
        <input
          type="checkbox" checked={on}
          aria-label="Show {rule.label} on the chart"
          onchange={() => app.toggleRule(rule.id)}
        />
      </label>
    </td>

    <!-- Disabled, NOT hidden, while the rule is on. An empty cell reads as
         "this one cannot be folded"; a ticked, disabled box says "it is folded,
         and listed anyway because it is on" — and it keeps the reader's choice,
         so switching the rule off later puts it back where they had it. -->
    <td class="c">
      <label>
        <input
          type="checkbox" checked={folded} disabled={on}
          aria-label="Fold {rule.label} away from the list"
          title={on
            ? 'A rule that is on is always listed — it folds away again when you switch it off'
            : `Fold ${rule.label} away`}
          onchange={(event) => app.setRulesFolded([rule.id], event.currentTarget.checked)}
        />
      </label>
    </td>

    <!-- Two checkboxes have four combinations and only three outcomes, so the
         outcome is stated in words rather than left to be inferred. -->
    <td class="where"><span class="place {place.tone}">{place.text}</span></td>

    <td class="n" class:hot={pct >= HOT_PCT}>{integer(countOf(rule.id))}</td>
    <td class="n" class:hot={pct >= HOT_PCT}>{pct.toFixed(1)}%</td>
  </tr>
{/snippet}

<style>
  /* The dialog is in the top layer, so it is positioned against the viewport
     and not against the marking column it was opened from. container-type
     because the tiers below are about the SHEET's width, not the page's — the
     same seam MarkPanel and the marking pane use. */
  .sheet {
    width: min(760px, calc(100vw - 32px));
    max-width: none;
    max-height: min(78vh, 720px);
    padding: 0;
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-2);
    box-shadow: 0 2px 6px rgb(0 0 0 / 18%), 0 24px 56px -20px rgb(0 0 0 / 45%);
    overflow: hidden;
    container-type: inline-size;
  }

  .sheet:not([open]) { display: none; }
  .sheet[open] { display: flex; flex-direction: column; }
  .sheet::backdrop { background: rgb(0 0 0 / 45%); }

  .head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex: none;
    padding: 15px 18px;
    border-bottom: 1px solid var(--grid);
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.008em;
    color: var(--ink);
  }

  .sub {
    font-family: var(--mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-text);
  }

  .x {
    margin-left: auto;
    padding: 3px 7px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted-text);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover { color: var(--ink); background: var(--surface-2); }
  .x:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    flex: none;
    padding: 12px 18px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--grid);
  }

  input[type="search"] {
    flex: 1 1 180px;
    min-width: 120px;
    padding: 5px 9px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 11.5px;
  }
  input[type="search"]:focus-visible { outline: 2px solid var(--focus); outline-offset: -1px; }

  .hint, .spacer { font-family: var(--mono); font-size: 10.5px; color: var(--muted-text); }
  .spacer { margin-left: auto; }

  .list { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 16px;
    text-align: left;
    background: var(--surface);
    border-bottom: 1px solid var(--grid);
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted-text);
    white-space: nowrap;
  }

  th.c, td.c { text-align: center; width: 62px; }
  th.n, td.n { text-align: right; width: 86px; }
  th.where, td.where { width: 96px; }

  th.sortable { padding: 0; }
  th.sortable button {
    width: 100%;
    padding: 8px 16px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: right;
    cursor: pointer;
  }
  th.sortable button:hover { color: var(--ink); }
  th.sortable button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  th[aria-sort="descending"] { color: var(--ink); }
  .arrow { margin-left: 5px; font-size: 8px; }

  td {
    padding: 5px 16px;
    border-bottom: 1px solid var(--grid);
    vertical-align: middle;
  }

  tr.grp td {
    padding: 13px 16px 4px;
    border-bottom: 1px solid var(--grid);
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  .bulk {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-text);
    text-decoration: underline;
    text-decoration-color: var(--axis);
    text-underline-offset: 3px;
  }
  tr.grp .bulk { float: right; }
  .bulk:hover { color: var(--ink); }
  .bulk:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  td.name .label { color: var(--ink); font-weight: 500; }
  td.name .blurb {
    display: block;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--muted-text);
  }

  /* A folded rule reads quieter here for the same reason it does in the card:
     one signal for "less used", wherever it appears. */
  tr.quiet td.name .label { color: var(--ink-2); font-weight: 400; }

  td.c label { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  input[type="checkbox"] { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--focus); }
  input[type="checkbox"]:disabled { cursor: default; opacity: 0.5; }

  .place {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--muted-text);
  }
  .place.listed { color: var(--ink-2); }
  /* Green, because "on" is the state that overrides the fold — the same thing
     the card says by listing the rule anyway. */
  .place.pinned { color: var(--up-text); }

  td.n {
    font-family: var(--mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-text);
  }
  /* The density warning, in the one place there is room to show it. */
  td.n.hot { color: var(--down-text); }

  td.empty { padding: 20px 16px; color: var(--muted-text); }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    flex: none;
    padding: 12px 18px;
    border-top: 1px solid var(--grid);
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted-text);
  }

  /* What is on disk, said out loud: the record is sparse, and a reader who
     cannot see that has no way to know why "what this build folds" is not what
     they are looking at. */
  .foot .edited { color: var(--ink-2); }

  .btn {
    padding: 5px 11px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
    font: inherit;
  }
  .btn:hover { color: var(--ink); background: var(--surface-2); }
  .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .btn.primary { color: var(--ink); border-color: var(--axis); }

  /* Three tiers, and the ORDER was measured rather than guessed. The failure
     they prevent is not sideways overflow — the table shrinks instead — it is
     ROW HEIGHT: squeeze the name column and every label and blurb wraps, so
     the rows grow and the dialog shows six rules instead of fifteen.

     Measured at a 572px sheet with everything on: name column 163px, median
     row 93px, tallest 143px. Dropping the blurb alone takes a row back to
     ~32px, which is why the blurb goes FIRST and at a generous width, and the
     numbers follow only when the name still cannot hold a label. */
  @container (max-width: 700px) {
    td.name .blurb { display: none; }
  }

  /* Now the evidence goes: the name and the two controls are what the reader
     is here for, and at this width the name needs the numbers' space. */
  @container (max-width: 620px) {
    th.n, td.n { display: none; }
    th, td { padding-left: 12px; padding-right: 12px; }
  }

  @container (max-width: 420px) {
    th.where, td.where { display: none; }
  }
</style>
