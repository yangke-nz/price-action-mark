<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';
  import { RULES } from '$shared/marks/registry.ts';
  import { integer } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();

  const marks = $derived(app.settings.marks);
  const shown = $derived(app.marks.length);
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

    <div class="rules">
      {#each RULES as rule (rule.id)}
        <label class="rule" class:dim={!marks.enabled}>
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
    </div>
  </div>
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

  .body {
    display: grid;
    gap: 12px;
    padding: 4px 16px 16px;
    border-top: 1px solid var(--grid);
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    padding-top: 12px;
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
  }

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

  @media (max-width: 720px) {
    .rules { grid-template-columns: 1fr; }
  }
</style>
