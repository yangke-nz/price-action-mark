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

<details class="panel">
  <summary>
    <span class="title">Marks in view</span>
    <span class="count">
      {integer(rows.length)}{#if app.markListTruncated} of many, capped at {integer(MARK_LIST_CAP)}{/if}
    </span>
  </summary>

  {#if rows.length === 0}
    <p class="empty">Nothing marked in this range. Zoom out, or switch on more rules above.</p>
  {:else}
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
            <tr>
              <td class="d">
                {day(mark.at)}
                {#if lag(mark.at, mark.knownAt)}<span class="lag">{lag(mark.at, mark.knownAt)}</span>{/if}
              </td>
              <td class="label" class:bull={mark.tone === 'bull'} class:bear={mark.tone === 'bear'}>
                {mark.label}
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
  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
    overflow: hidden;
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

  .empty {
    margin: 0;
    padding: 4px 16px 16px;
    border-top: 1px solid var(--grid);
    font-size: 12.5px;
    color: var(--muted);
  }

  .scroll { max-height: 340px; overflow: auto; border-top: 1px solid var(--grid); }

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
</style>
