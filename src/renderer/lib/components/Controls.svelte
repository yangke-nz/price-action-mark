<script lang="ts">
  import { RANGES, type AppState } from '$lib/state/app.svelte.ts';
  import type { ThemeChoice } from '$shared/types.ts';

  let { app }: { app: AppState } = $props();

  const THEMES: { id: ThemeChoice; label: string; title: string }[] = [
    { id: 'system', label: 'Auto', title: 'Follow the operating system' },
    { id: 'light', label: 'Light', title: 'Always light' },
    { id: 'dark', label: 'Dark', title: 'Always dark' },
  ];
</script>

<div class="controls">
  <div class="seg" role="group" aria-label="Date range">
    {#each RANGES as range (range.id)}
      <button
        type="button"
        title={range.label}
        aria-pressed={app.settings.range === range.id}
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
