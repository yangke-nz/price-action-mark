<script lang="ts">
  /**
   * The tape in words: one line per session in view, newest first, and clicking
   * a line highlights that bar on the chart.
   *
   * A list of buttons rather than a table, unlike MarkList. A mark row carries
   * five independent fields and a verdict, so it is tabular; a reading is ONE
   * sentence about one session, and the whole sentence is the thing to click.
   * Wrapping a sentence in five cells would give the reader four more tab stops
   * and nothing else.
   *
   * No card of its own: this is a view inside MarkingPane, which owns the
   * chrome and the tab that selects it.
   */
  import { READING_CAP, type AppState } from '$lib/state/app.svelte.ts';
  import { DEFAULT_STRENGTH } from '$shared/marks/structure.ts';
  import { clock, integer } from '$shared/format.ts';
  import Reading from './Reading.svelte';

  let { app }: { app: AppState } = $props();

  const rows = $derived(app.visibleReadings);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * The rail's first line: `27 Aug`, or `13:45` on an intraday bar.
   *
   * Intraday rows lead with the TIME. A 5-minute list is nearly all one
   * session — 223 bars of it — so repeating the date down the rail spends it on
   * the one thing that is not changing. The date moves to the sub-label, where
   * the year sits on a daily list, and prints only when the session turns.
   */
  function short(key: string): string {
    const time = clock(key);
    if (time !== '') return time;
    const [, m, d] = key.split('-');
    return `${d} ${MONTHS[Number(m) - 1] ?? m}`;
  }

  /**
   * The year, only where it changes.
   *
   * The date is a 7ch rail the eye runs down, and a full `27 Aug 2026` widens
   * it to 11ch on every row to repeat a fact that changes once a year. Printed
   * on the first row and at each turn, as a sub-label under the day, the rail
   * stays 7ch and the year is still never missing from a list that spans one.
   *
   * On an intraday list the two swap: the rail is the time and the sub-label is
   * the date. See `short`.
   */
  function yearTurn(i: number): string {
    const at = rows[i]?.at;
    if (at === undefined) return '';
    // Intraday the sub-label is the DAY and turns when the session does; daily
    // it is the year, which turns once a year. Same rule, different unit: print
    // it on the first row and wherever it changes.
    const intraday = clock(at) !== '';
    const unit = (key: string): string =>
      intraday ? key.slice(5, 10).replace('-', '/') : key.slice(0, 4);
    const prev = rows[i - 1]?.at;
    return i === 0 || prev === undefined || unit(prev) !== unit(at) ? unit(at) : '';
  }
</script>

{#if rows.length === 0}
  <p class="empty">No bars in view.</p>
{:else}
  <p class="hint">
    The always-in state and the H/L count are what was readable at that close; a swing pivot
    is the chart as it now stands, confirmed {DEFAULT_STRENGTH} bars later.
    {#if app.readingTruncated}<span class="cap">Newest {integer(READING_CAP)} listed.</span>{/if}
  </p>
  <div class="scroll">
    <ol>
      {#each rows as reading, i (reading.at)}
        <li>
          <button
            type="button"
            class="line"
            aria-pressed={app.selectedBarIndex === reading.i}
            onclick={() => app.selectBar(reading.i)}
          >
            <span class="d">
              {short(reading.at)}{#if yearTurn(i)}<span class="yr">{yearTurn(i)}</span>{/if}
            </span>
            <span class="say"><Reading {reading} /></span>
          </button>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 12px 16px 16px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .hint {
    flex: none;
    margin: 0;
    padding: 9px 16px;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  .cap { color: var(--ink-2); }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    max-height: var(--pane-scroll-max, 420px);
    overflow: auto;
    overscroll-behavior: contain;
    border-top: 1px solid var(--grid);
  }

  ol { margin: 0; padding: 0; list-style: none; }

  /*
   * The date is a RAIL, not a line of its own.
   *
   * The obvious narrow-column answer is to stack the date above the reading,
   * and it costs three rows: measured at the pane's 647px, stacking puts every
   * row on two lines — median 51px, eight visible — while a 7ch rail with the
   * sentence hanging beside it leaves 18 of 24 readings on ONE line, median
   * 34px, eleven visible. The rail is both the thing the eye runs down and the
   * cheaper layout, which is not the trade it looks like.
   */
  .line {
    display: grid;
    grid-template-columns: 7ch minmax(0, 1fr);
    gap: 12px;
    width: 100%;
    padding: 7px 16px;
    border: 0;
    border-bottom: 1px solid var(--grid);
    border-left: 3px solid transparent;
    background: none;
    text-align: left;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
  }

  li:last-child .line { border-bottom: 0; }
  .line:hover { background: var(--surface-2); }
  .line:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  /* The same inset rail the mark list uses for a picked row, in the colour the
     chart draws the band in — one selection colour across both surfaces, so the
     eye moving from the line to the candles is looking for the same thing. */
  .line[aria-pressed="true"] {
    background: var(--surface-2);
    border-left-color: var(--focus);
  }

  .d {
    align-self: start;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .yr { display: block; font-size: 10.5px; color: var(--muted); }

  /* Prose, so the digits inside "1.9x ATR" are not set on the tabular grid the
     date rail needs. */
  .say { min-width: 0; color: var(--ink-2); font-variant-numeric: normal; }

  /* Below roughly a 430px pane even the rail plus a sentence stops working, so
     the date goes back above the reading rather than squeezing the text into a
     dozen characters. */
  @container (max-width: 430px) {
    .line { grid-template-columns: minmax(0, 1fr); gap: 1px; padding: 7px 12px; }
    .d { font-size: 11px; color: var(--muted); }
    .yr { display: inline; font-size: inherit; }
  }
</style>
