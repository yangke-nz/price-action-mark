<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { MARK_LIST_CAP } from '$lib/state/app.svelte.ts';
  import { day, integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const rows = $derived(app.visibleMarks);

  /** A mark that needed later bars to confirm is worth flagging: it says the
   *  chart is showing something that was not readable on the day it points at. */
  function lag(at: string, knownAt: string): string {
    return knownAt === at ? '' : `confirmed ${day(knownAt)}`;
  }
</script>

<!-- open by default. It used to sit below 31 rule rows, so being shut cost
     nothing; now it is the pane the layout is built around, and a reader who
     has to open it every session is back where they started. -->
<details class="panel" open>
  <summary>
    <span class="title">Marks in view</span>
    <span class="count">
      {integer(rows.length)}{#if app.markListTruncated} of many, capped at {integer(MARK_LIST_CAP)}{/if}
    </span>
  </summary>

  {#if rows.length === 0}
    <p class="empty">Nothing marked in this range. Zoom out, or switch on more rules above.</p>
  {:else}
    <p class="hint">Click a mark to highlight it on the chart.</p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Mark</th>
            <th scope="col">Rule</th>
            <th scope="col">Detail</th>
            <th scope="col"><span class="sr-only">Verdict</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as mark (mark.id)}
            <tr class:picked={app.selectedMarkId === mark.id}>
              <td class="d">
                {day(mark.at)}
                {#if lag(mark.at, mark.knownAt)}<span class="lag">{lag(mark.at, mark.knownAt)}</span>{/if}
              </td>
              <td class="label" class:bull={mark.tone === 'bull'} class:bear={mark.tone === 'bear'}>
                <!-- A real button, not a click handler on the <tr>: the row is
                     not an interactive element and making it behave like one
                     costs the keyboard and a screen reader the affordance. The
                     label IS the mark's identity, so it is the thing to click,
                     and aria-pressed carries the highlight state. -->
                <button
                  type="button"
                  class="pick"
                  aria-pressed={app.selectedMarkId === mark.id}
                  title="Highlight this mark on the chart"
                  onclick={() => app.selectMark(mark.id)}
                >{mark.label}</button>
              </td>
              <td class="rule">{mark.rule}</td>
              <td class="note">{mark.note ?? ''}</td>
              <td class="verdict">
                <!-- Clicking the verdict a mark already has clears it, so a
                     misclick costs one more click rather than being sticky. -->
                <button
                  type="button"
                  class="v keep"
                  aria-pressed={app.verdictOf(mark.id) === 'confirmed'}
                  title="Confirm this mark"
                  onclick={() => app.setVerdict(mark.id, 'confirmed')}
                >Keep</button>
                <button
                  type="button"
                  class="v drop"
                  aria-pressed={app.verdictOf(mark.id) === 'dismissed'}
                  title="Dismiss this mark and hide it"
                  onclick={() => app.setVerdict(mark.id, 'dismissed')}
                >Drop</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</details>

<style>
  /* A container, not a media query: this card is full-width in the stacked
     layout and a side column in the wide one, and the table's five columns
     need 766px either way. Keying the trim to the CARD's width means it is
     right wherever App puts it, instead of encoding App's breakpoint here
     where the two would drift apart. */
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
    flex: none;
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

  .empty {
    margin: 0;
    padding: 4px 16px 16px;
    border-top: 1px solid var(--grid);
    font-size: 12.5px;
    color: var(--muted);
  }

  .hint {
    flex: none;
    margin: 0;
    padding: 9px 16px;
    border-top: 1px solid var(--grid);
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  /* 340px keeps this from running to 3,000px when the card sizes to its own
     content. In the wide layout's pane the pane is the cap, so App lifts it by
     setting --marklist-max-h: none on the column — a custom property rather
     than a selector into here, so the two files stay uncoupled. */
  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    max-height: var(--marklist-max-h, 340px);
    overflow: auto;
    overscroll-behavior: contain;
    border-top: 1px solid var(--grid);
  }

  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 8px 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--grid);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }

  td {
    padding: 7px 16px;
    border-bottom: 1px solid var(--grid);
    color: var(--ink-2);
    vertical-align: top;
  }

  tbody tr:last-child td { border-bottom: 0; }

  .d {
    font-family: var(--mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--ink);
  }

  /* A pivot-anchored pattern is not readable on the day it points at, and the
     gap between the two dates is the honest size of that lag. */
  .lag { display: block; font-size: 10.5px; color: var(--muted); }

  .label {
    font-family: var(--mono);
    font-weight: 600;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .label.bull { color: var(--up-text); }
  .label.bear { color: var(--down-text); }

  /* Inherits colour and face from the cell, so the tone stays the label's and
     this stays a button only in behaviour. */
  .pick {
    padding: 1px 5px;
    margin: -1px -5px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    text-align: left;
  }

  .pick:hover { background: var(--surface-2); text-decoration: underline; }
  .pick:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; }

  /* The row, not just the button: the highlight has to be findable while the
     reader's eye is on the chart, and a tinted cell is not. */
  tr.picked td { background: var(--surface-2); }
  tr.picked .d { box-shadow: inset 3px 0 0 var(--focus); }
  tr.picked .pick { text-decoration: underline; text-decoration-thickness: 2px; }

  .rule { font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: nowrap; }

  .verdict { display: flex; gap: 4px; justify-content: flex-end; }

  .v {
    padding: 3px 8px;
    border: 1px solid var(--hair);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.05em;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .v:hover { color: var(--ink); background: var(--surface-2); }
  .v:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .v.keep[aria-pressed="true"] { color: var(--up-text); border-color: var(--up); }
  .v.drop[aria-pressed="true"] { color: var(--down-text); border-color: var(--down); }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .note { font-size: 12px; line-height: 1.45; min-width: 22ch; }

  /* 780px is the card width at which the five columns stop fitting. The 16px
     side padding is five cells' worth — 160px of the 766px total — so most of
     the saving is there rather than in the text. The verdict buttons and the
     dates keep their size: they are the two things the reader aims at. */
  @container (max-width: 780px) {
    th, td { padding-left: 9px; padding-right: 9px; }
    .note { min-width: 12ch; font-size: 11.5px; }
    .rule { font-size: 11px; }
  }

  /* Narrower still — a phone, or the side column below about a 1900px screen.
     The rule id is the one cell that is a lookup key rather than something to
     read across, so it wraps instead of forcing the row wider. Below roughly
     a 480px card the row cannot fit whatever the padding: the date, the label
     and the two verdict buttons are ~390px on their own, and shrinking THOSE
     costs the reader the three things they actually aim at. The container
     scrolls sideways there, which is what it is for. */
  @container (max-width: 660px) {
    th, td { padding-left: 6px; padding-right: 6px; }
    .rule { white-space: normal; overflow-wrap: break-word; }
    .note { min-width: 0; }
    .d, .v { font-size: 11px; }
    .v { padding-left: 6px; padding-right: 6px; }
  }
</style>
