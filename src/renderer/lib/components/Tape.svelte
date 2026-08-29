<script lang="ts">
  /**
   * The tape: one row per session in view, newest first, carrying what the bar
   * said and what was marked on it.
   *
   * This replaces the tabbed pair of MarkList and ReadingList. They were two
   * newest-first lists over the same viewport, so the tab was a switch the
   * reader paid on every glance — and the two overlapped by construction,
   * because a reading names the patterns that were knowable at that close and
   * the mark list was listing those same patterns for the same bar.
   *
   * THE PATTERN CLAUSE IS RENDERED AS THE MARKS. `Reading` is asked to leave
   * its last clause off and the chips take its place, so the sentence and the
   * mark list stop saying the same words twice and the words become clickable.
   * Three cases fall out of that, and all three are meant:
   *
   *  - a mark the prose does NOT name is a chip on its own. Either the reading
   *    already stated it in an earlier clause (`inside`, `big-bar` — the
   *    `STATED` set in reading.ts) or it was not knowable at that close, like
   *    a channel confirmed three sessions later. The second kind says when it
   *    was confirmed, because the row's date is not the date it was readable.
   *  - a pattern the prose names with NO mark behind it stays as dim text: the
   *    rule is switched off, or its mark was dropped. That is rule state made
   *    visible in the tape rather than a discrepancy to hide.
   *  - a session with neither is one line of prose, which is a little over
   *    half of them at the shipped density.
   *
   * A list of rows rather than a table. A mark row was tabular because it
   * carried five independent fields; here the sentence is the row and the
   * marks hang off it, so the table's Session column is the shared date rail
   * and its Rule and Detail columns are the strip that opens under a selected
   * chip. That is where the mark table's documented ~535px floor went.
   *
   * No card of its own: this is the view inside MarkingPane, which owns the
   * chrome, the container and the filter.
   */
  import { untrack } from 'svelte';
  import { TAPE_CAP, type AppState, type TapeRow } from '$lib/state/app.svelte.ts';
  import { DEFAULT_STRENGTH } from '$shared/marks/structure.ts';
  import { phraseOf } from '$shared/marks/reading.ts';
  import { ruleFor } from '$shared/marks/registry.ts';
  import { barLabel, clock, integer } from '$shared/format.ts';
  import Reading from './Reading.svelte';

  let { app }: { app: AppState } = $props();

  const rows = $derived(app.visibleTape);

  let scroller = $state<HTMLDivElement | undefined>();

  /**
   * Bring a revealed row into view — the chart's half of the gesture.
   *
   * Keyed on `revealNonce`, NOT on the selection. `visibleTape` rebuilds on
   * every viewport settle, so an effect watching the selection alone would
   * re-scroll whenever the reader panned the chart with a selection active,
   * fighting anyone who had scrolled the tape by hand. The nonce fires only on
   * an explicit reveal, which also makes clicking the same bar twice work: the
   * selection is unchanged, so nothing else would say anything had happened.
   *
   * `block: 'nearest'` is the whole of the politeness. It is a no-op when the
   * row is already visible, so this needs no idea of where the reveal came
   * from, and it never animates — which is also why there is no
   * `prefers-reduced-motion` branch to get wrong.
   */
  $effect(() => {
    // `revealNonce` IS THE ONLY TRACKED READ, and everything else is inside
    // `untrack` for one reason: this effect must fire on a reveal and on
    // nothing else. `scroller` used to be read here too, and it is `$state`
    // bound with `bind:this` — so when the tape empties and refills (resolve
    // the last open mark under `Unresolved`, or pan to a viewport with no
    // rows) the `{#if}` swaps `.scroll` for the empty paragraph and back, the
    // binding changes twice, and the effect re-ran and scrolled to a STALE
    // `revealTarget` with no reveal having happened. That is precisely the
    // incidental re-scroll the nonce exists to prevent, arriving through the
    // one door left open.
    if (app.revealNonce === 0) return;
    untrack(() => {
      const box = scroller;
      // `revealTarget`, not "the selected mark's session, or else the selected
      // bar". Both selections are allowed to be live at once, so inferring the
      // target sent the tape back to a mark clicked earlier whenever the reader
      // then clicked a BAR. The reveal states which one it meant.
      const at = app.revealTarget;
      if (!box || at === null) return;
      const row = box.querySelector(`li[data-at="${CSS.escape(at)}"]`);
      if (!row) return;

      // `block: 'nearest'` semantics, computed by hand against THIS container.
      // `scrollIntoView` cannot be used: it scrolls every scrollable ancestor,
      // the DOCUMENT included, so in the stacked layout a chart click scrolled
      // the page away from the chart that was just clicked — measured at
      // 900x900, one click took the page from 0 to 724 and the candles from
      // y 236..592 to y -488..-132, entirely off screen. The wide layout never
      // showed it, because there the page does not scroll at all.
      const r = row.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.top < b.top) box.scrollTop -= b.top - r.top;
      else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
    });
  });

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

  /**
   * Pattern names the prose carries that no chip on this row covers.
   *
   * `phraseOf` is the rule's own wording and is imported rather than restated,
   * for the reason reading.ts gives for exporting it: two ideas of what a
   * pattern is called would let one surface disagree with the other. A mark
   * whose rule is not in the reading's pattern clause at all — `STATED`, or a
   * later confirmation — simply never matches, which is what leaves it a chip
   * with no text to strike out.
   */
  function unnamed(row: TapeRow): string[] {
    if (row.reading.patterns.length === 0) return [];
    const shown = new Set<string>();
    for (const mk of row.marks) {
      const rule = ruleFor(mk.rule);
      shown.add(rule ? phraseOf(rule) : mk.rule);
    }
    return row.reading.patterns.filter((phrase) => !shown.has(phrase));
  }

  /** The selected mark, if it is one of this row's — the strip is per row. */
  function openMark(row: TapeRow) {
    return row.marks.find((mk) => mk.id === app.selectedMarkId);
  }

  /** A mark that needed later bars to confirm is worth flagging: it says the
   *  chart is showing something that was not readable on the day it points at. */
  function lag(at: string, knownAt: string): string {
    return knownAt === at ? '' : `confirmed ${barLabel(knownAt)}`;
  }

  const empty = $derived(
    app.tapeFilter === 'unresolved'
      ? 'Every mark in view has a verdict.'
      : app.tapeFilter === 'marked'
        ? 'Nothing marked in this range. Zoom out, or switch on more rules above.'
        : 'No bars in view.',
  );
</script>

{#if rows.length === 0}
  <p class="empty">{empty}</p>
{:else}
  <p class="hint">
    The always-in state and the H/L count are what was readable at that close; a swing pivot
    is the chart as it now stands, confirmed {DEFAULT_STRENGTH} bars later.
    {#if app.tapeTruncated}<span class="cap">Newest {integer(TAPE_CAP)} sessions listed; an older mark in view is not.</span>{/if}
  </p>
  <div class="scroll" bind:this={scroller}>
    <ol>
      {#each rows as row, i (row.at)}
        {@const open = openMark(row)}
        {@const dim = unnamed(row)}
        <!-- `data-at` is the handle the reveal effect finds this row by. The
             keyed `{#each}` already tracks it, but a keyed block gives no way
             to ASK for one row's element, and holding a Map of 300 bindings to
             answer one query per click is more machinery than a selector. -->
        <li data-at={row.at} class:picked={app.selectedBarIndex === row.i}>
          <!-- A grid, and the sentence is the only button in it. The chips are
               siblings, not children: a button inside a button is the same
               constraint that stopped the tabs going in a <summary>. -->
          <div class="line">
            <span class="d">
              {short(row.at)}{#if yearTurn(i)}<span class="yr">{yearTurn(i)}</span>{/if}
            </span>
            <span class="flow">
              <!-- Clicking the sentence highlights the SESSION. Clicking a chip
                   highlights the MARK. Two gestures, two meanings, and the two
                   bands the primitive draws are already tellable apart. -->
              <button
                type="button"
                class="say"
                aria-pressed={app.selectedBarIndex === row.i}
                title="Highlight this session on the chart"
                onclick={() => app.selectBar(row.i)}
              ><Reading reading={row.reading} patterns={false} /></button
              ><!-- Explicit `{' '}` text nodes, and this is the second time the
                   project has paid for learning it: a space written INSIDE the
                   span is trimmed by the compiler and one written between the
                   tags is collapsed by the same pass, so the clause rendered as
                   "trading range— ib". Nothing warns; it shows up as a word
                   glued to a dash. -->{#if row.marks.length || dim.length}{' '}<span class="dash">—</span>{/if
              }{#each row.marks as mark (mark.id)}{' '}
                <!-- The chip IS the mark's identity, so one click does both
                     things the reader wants from it: highlight it on the chart
                     and open its detail. `selectedMarkId` already toggles on a
                     second click and already clears itself when the mark stops
                     being drawn, so the strip needs no state of its own. -->
                <button
                  type="button"
                  class="chip {mark.tone}"
                  class:kept={app.verdictOf(mark.id) === 'confirmed'}
                  aria-expanded={app.selectedMarkId === mark.id}
                  title={mark.note ?? mark.rule}
                  onclick={() => app.selectMark(mark.id)}
                >{mark.label}{#if mark.knownAt !== mark.at}<span class="when">→{short(mark.knownAt)}</span>{/if}</button
              >{/each}{#if dim.length}{' '}<span
                class="off"
                title="Named by the reading, not marked — that rule is switched off"
              >{dim.join(', ')}</span>{/if}
            </span>
          </div>

          {#if open}
            <!-- The mark table's Rule, Detail and verdict columns, for one mark
                 at a time. Three columns' worth of width recovered from every
                 row that is not the one being judged. -->
            <div class="detail">
              <span class="what">
                <span class="rule">{open.rule}</span>{#if lag(open.at, open.knownAt)}<span class="lag"> · {lag(open.at, open.knownAt)}</span>{/if}{#if open.note}<span class="note"> · {open.note}</span>{/if}
              </span>
              <span class="verdict">
                <!-- Clicking the verdict a mark already has clears it, so a
                     misclick costs one more click rather than being sticky. -->
                <button
                  type="button"
                  class="v keep"
                  aria-pressed={app.verdictOf(open.id) === 'confirmed'}
                  title="Confirm this mark"
                  onclick={() => app.setVerdict(open.id, 'confirmed')}
                >Keep</button>
                <button
                  type="button"
                  class="v drop"
                  aria-pressed={app.verdictOf(open.id) === 'dismissed'}
                  title="Dismiss this mark and hide it"
                  onclick={() => app.setVerdict(open.id, 'dismissed')}
                >Drop</button>
              </span>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  /* A container query, not a media query: this view is a narrow pane in the
     wide layout and a full-width card when the grid collapses. The container
     itself is declared by MarkingPane, which owns the box. */

  .empty {
    margin: 0;
    padding: 12px 16px 16px;
    font-size: 12.5px;
    color: var(--muted-text);
  }

  .hint {
    flex: none;
    margin: 0;
    padding: 9px 16px;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    color: var(--muted-text);
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

  li { border-bottom: 1px solid var(--grid); border-left: 3px solid transparent; }
  li:last-child { border-bottom: 0; }

  /* The same inset rail the mark list used for a picked row, in the colour the
     chart draws the band in — one selection colour across both surfaces, so the
     eye moving from the row to the candles is looking for the same thing. */
  li.picked { background: var(--surface-2); border-left-color: var(--focus); }

  /*
   * The date is a RAIL, not a line of its own.
   *
   * The obvious narrow-column answer is to stack the date above the reading,
   * and it costs three rows: measured at the pane's 647px, stacking puts every
   * row on two lines — median 51px, eight visible — while a 7ch rail with the
   * sentence hanging beside it leaves most readings on ONE line, median 34px,
   * eleven visible. The rail is both the thing the eye runs down and the
   * cheaper layout, which is not the trade it looks like.
   */
  .line {
    display: grid;
    grid-template-columns: 7ch minmax(0, 1fr);
    gap: 12px;
    padding: 7px 16px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
  }

  .d {
    align-self: start;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .yr { display: block; font-size: 10.5px; color: var(--muted-text); }

  /* Prose and chips share one flow, so a chip sits at the end of the sentence
     when there is room and wraps under it when there is not. */
  .flow { min-width: 0; color: var(--ink-2); font-variant-numeric: normal; }

  /* Inline-block, not inline: the sentence keeps a shrink-to-fit box, so short
     readings leave their chips on the same line and long ones take the width
     and let the chips wrap below. `display: inline` would flow the chips into
     the middle of the sentence, and Safari has never been reliable about it. */
  .say {
    display: inline-block;
    max-width: 100%;
    padding: 1px 4px;
    margin: -1px -4px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    cursor: pointer;
  }

  .say:hover { background: var(--surface-2); }
  li.picked .say:hover { background: var(--surface); }
  .say:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; }
  .say[aria-pressed="true"] { text-decoration: underline; text-decoration-thickness: 2px; }

  /* The em dash the pattern clause used to bring with it, kept so the chips
     read as the end of the sentence rather than as a toolbar under it. */
  .dash { color: var(--ink); font-weight: 600; }

  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 0 6px;
    margin: 0 1px;
    border: 1px solid var(--hair);
    border-radius: 5px;
    background: var(--surface-2);
    font: inherit;
    font-weight: 600;
    color: var(--ink-2);
    cursor: pointer;
    vertical-align: baseline;
    transition: background 0.12s, border-color 0.12s;
  }

  /* Tone owns hue here exactly as it does on the canvas, so a chip and the
     mark it points at are the same colour. `caution` takes neither: it is the
     tone with no colour of its own by design. */
  .chip.bull { color: var(--up-text); border-color: color-mix(in srgb, var(--up) 40%, transparent); }
  .chip.bear { color: var(--down-text); border-color: color-mix(in srgb, var(--down) 40%, transparent); }
  .chip.caution { font-style: italic; }

  .chip:hover { background: var(--surface); }
  .chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .chip[aria-expanded="true"] { border-color: var(--focus); box-shadow: inset 0 0 0 1px var(--focus); }

  /* Kept is the only verdict a chip can wear: a dismissed mark leaves `marks`
     entirely, so there is no chip left to strike through. */
  .chip.kept { border-color: var(--up); }

  .when { font-weight: 400; font-size: 0.9em; color: var(--focus); }

  /* A pattern the reading names with no mark behind it — the rule is off, or
     the mark was dropped. Quiet, but present: it is the tape saying what it is
     not showing. */
  .off { color: var(--muted-text); }

  .detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin: 0 16px 8px calc(7ch + 12px);
    padding: 5px 10px;
    border-radius: 6px;
    border-left: 2px solid var(--focus);
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.45;
  }

  li.picked .detail { background: var(--surface); }

  .what { min-width: 0; color: var(--muted-text); }
  .rule { color: var(--ink-2); font-weight: 600; }
  .lag { color: var(--focus); }
  .note { color: var(--muted-text); }

  .verdict { display: flex; gap: 4px; }

  .v {
    padding: 2px 8px;
    border: 1px solid var(--hair);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted-text);
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

  /* Below roughly a 430px pane even the rail plus a sentence stops working, so
     the date goes back above the reading rather than squeezing the text into a
     dozen characters. The strip loses the indent with it. */
  @container (max-width: 430px) {
    .line { grid-template-columns: minmax(0, 1fr); gap: 1px; padding: 7px 12px; }
    .d { font-size: 11px; color: var(--muted-text); }
    .yr { display: inline; font-size: inherit; }
    .detail { margin-left: 12px; margin-right: 12px; }
  }
</style>
