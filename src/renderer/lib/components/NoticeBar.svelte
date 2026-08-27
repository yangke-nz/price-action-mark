<script lang="ts">
  import type { AppState } from '$lib/state/app.svelte.ts';

  let { app }: { app: AppState } = $props();
</script>

{#if app.notice}
  <div class="notice" class:error={app.notice.tone === 'error'} role="status">
    <span>{app.notice.text}</span>
    <button type="button" onclick={() => app.dismissNotice()} aria-label="Dismiss">&times;</button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    border: 1px solid var(--hair);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12.5px;
    color: var(--ink-2);
  }

  /* A failed refresh is the one message that must not be mistaken for chrome:
     it means the prices on screen are older than they look. */
  .notice.error {
    border-color: var(--down);
    color: var(--down-text);
  }

  .notice button {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.6;
  }

  .notice button:hover { opacity: 1; }
</style>
