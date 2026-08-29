<script lang="ts">
  /** On a daily chart the two windows mean something else: not "which bars are
   *  shown" but "which hours each bar is built from". */
  const DAILY_SESSION_TITLE = {
    eth: 'The whole 23-hour Globex day, as the feed aggregates it — 26 years of it',
    rth: 'Daily bars built from the 09:30-16:15 New York session only, aggregated from the 5-minute feed — about 60 days of it',
  } as const;

  import { type AppState } from '$lib/state/app.svelte.ts';
  import type { ThemeChoice } from '$shared/types.ts';
  import { INTERVAL_IDS, INTERVALS } from '$shared/interval.ts';
  import { SESSIONS, SESSION_IDS } from '$shared/session.ts';

  let { app }: { app: AppState } = $props();

  const THEMES: { id: ThemeChoice; label: string; title: string }[] = [
    { id: 'system', label: 'Auto', title: 'Follow the operating system' },
    { id: 'light', label: 'Light', title: 'Always light' },
    { id: 'dark', label: 'Dark', title: 'Always dark' },
  ];
</script>

<div class="controls">
  <!-- Timeframe first: it decides which range presets exist, so reading left to
       right matches the order the two choices actually depend on. Only a target
       that can fetch a second dataset renders it — the artifact carries one
       snapshot and IS whatever bar size that snapshot holds. -->
  {#if app.can.timeframes}
    <div class="seg" role="group" aria-label="Bar size">
      {#each INTERVAL_IDS as id (id)}
        <button
          type="button"
          title={INTERVALS[id].maxDays === null
            ? `${INTERVALS[id].label} bars, full history`
            : `${INTERVALS[id].label} bars — the last ${INTERVALS[id].maxDays} days, which is all this feed keeps`}
          aria-pressed={app.interval === id}
          disabled={app.status === 'refreshing'}
          onclick={() => app.setInterval(id)}
        >{id === '1d' ? '1D' : id}</button>
      {/each}
    </div>
  {/if}

  <!-- Intraday it is a pure transform over the dataset in hand, so it needs no
       capability and an artifact built from an intraday snapshot offers it too.
       On DAILY it is a load — the feed's daily bar is the whole Globex day, and
       an RTH daily bar has to be aggregated from the intraday series — so there
       it rides `can.timeframes`, the flag that already means "can fetch a
       second dataset". `sessionApplies` is that whole sentence. -->
  {#if app.sessionApplies}
    <div class="seg" role="group" aria-label="Session">
      {#each SESSION_IDS as id (id)}
        <button
          type="button"
          title={app.intraday ? SESSIONS[id].title : DAILY_SESSION_TITLE[id]}
          aria-pressed={app.session === id}
          onclick={() => app.setSession(id)}
        >{SESSIONS[id].label}</button>
      {/each}
    </div>
  {/if}

  <!-- The presets come from the interval, not from a fixed list: a 5-year
       button against a 60-day intraday archive would show the same thing as
       MAX and imply history that is not there. -->
  <div class="seg" role="group" aria-label="Date range">
    {#each app.ranges as range (range.id)}
      <button
        type="button"
        title={range.label}
        aria-pressed={app.range === range.id}
        onclick={() => app.setRange(range.id)}
      >{range.id}</button>
    {/each}
  </div>

  <div class="seg" role="group" aria-label="Colour theme">
    {#each THEMES as theme (theme.id)}
      <button
        type="button"
        title={theme.title}
        aria-pressed={app.settings.theme === theme.id}
        onclick={() => app.setTheme(theme.id)}
      >{theme.label}</button>
    {/each}
  </div>

  <div class="toggles">
    <label class="chk">
      <input type="checkbox" checked={app.settings.showRolls} onchange={() => app.toggleRolls()} />
      Contract rolls
    </label>
    <label class="chk">
      <input type="checkbox" checked={app.settings.showEma} onchange={() => app.toggleEma()} />
      EMA 20
    </label>

    <!-- Only the desktop target can reach the network or write a file, so the
         artifact simply does not render these rather than offering a control
         that would throw. -->
    {#if app.can.refresh}
      <button type="button" class="action" disabled={app.status === 'refreshing'} onclick={() => app.refresh()}>
        {app.status === 'refreshing' ? 'Refreshing…' : 'Refresh'}
      </button>
    {/if}
    {#if app.can.export}
      <button type="button" class="action" onclick={() => app.exportAs('csv')}>Export CSV</button>
    {/if}
    {#if app.can.fitWindow}
      <button
        type="button"
        class="action icon"
        title="Maximize vertically — full screen height, same width and position (Ctrl+Shift+M)"
        onclick={() => app.fitHeight()}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <path d="M6.5 1.2 V11.8 M3.6 3.4 L6.5 0.6 L9.4 3.4 M3.6 9.6 L6.5 12.4 L9.4 9.6"
            fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {app.fitted ? 'Restore' : 'Fit height'}
      </button>
      <!-- The horizontal half. Not "maximize": the RIGHT edge stays where the
           reader put it, so this widens the chart into empty desktop without
           covering whatever is parked beside it. -->
      <button
        type="button"
        class="action icon"
        title="Extend to the left edge of the screen — the right edge stays put (Ctrl+Shift+L)"
        onclick={() => app.fitLeft()}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <path d="M11.8 6.5 H1.2 M3.4 3.6 L0.6 6.5 L3.4 9.4 M11.8 1.8 V11.2"
            fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {app.fittedLeft ? 'Restore' : 'Fit left'}
      </button>
    {/if}
  </div>
</div>

<style>
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; }

  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-radius: var(--radius-sm);
  }

  .seg button {
    padding: 6px 11px;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--ink-2);
    transition: background 0.12s, color 0.12s;
  }

  .seg button:hover { background: var(--surface); color: var(--ink); }

  .seg button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 7%);
  }

  .toggles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-left: auto;
  }

  .chk {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--ink-2);
    user-select: none;
  }

  .chk:hover { color: var(--ink); }
  .chk input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--focus); }

  .action {
    padding: 6px 12px;
    border: 1px solid var(--hair);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.05em;
    transition: background 0.12s, color 0.12s;
  }

  .action:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }

  /* The arrows say "stretch vertically" faster than the label does, and the
     label is what says which direction the toggle will go next. */
  .action.icon { display: inline-flex; align-items: center; gap: 6px; }
  .action.icon svg { flex: none; display: block; }
  .action:disabled { opacity: 0.55; cursor: progress; }

  @media (max-width: 720px) {
    .toggles { margin-left: 0; width: 100%; }
  }
</style>
