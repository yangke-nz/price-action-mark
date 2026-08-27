<script lang="ts">
  import { source } from '$source';
  import { app } from '$lib/state/app.svelte.ts';
  import Masthead from '$lib/components/Masthead.svelte';
  import Controls from '$lib/components/Controls.svelte';
  import NoticeBar from '$lib/components/NoticeBar.svelte';
  import Readout from '$lib/components/Readout.svelte';
  import ChartPanel from '$lib/components/ChartPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';
  import Notes from '$lib/components/Notes.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let panel = $state<ChartPanel | undefined>();

  void app.boot();

  // The OS preference is tracked live so `theme: 'system'` flips without a
  // reload — Electron's nativeTheme and a browser's media query both surface
  // here as the same media match.
  $effect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    app.systemDark = query.matches;
    const onChange = (event: MediaQueryListEvent): void => { app.systemDark = event.matches; };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  // The chart re-reads its colours from the CSS custom properties, so setting
  // this attribute is the whole of theming. Explicit on both branches: leaving
  // it unset would let the media query and the in-app toggle disagree.
  //
  // $effect.pre, not $effect. ChartPanel's theme effect calls getComputedStyle
  // to pick the new palette up, and a plain $effect here is only ordered
  // against the child's by creation order — get it wrong and the chart reads
  // the OLD tokens and stays on the previous theme for good. Pre-effects all
  // flush before any user effect, so the attribute is guaranteed to be in
  // place before anything reads a computed style off it.
  $effect.pre(() => {
    document.documentElement.dataset['theme'] = app.resolvedTheme;
  });

  // The boot refresh lands after the window has already drawn the cached
  // series, so main pushes it here rather than the renderer asking again.
  $effect(() => source.onDatasetUpdate((result) => app.adopt(result)));

  // Native menu items and accelerators arrive here rather than as synthetic
  // DOM events, so the menu and the in-page controls drive one code path.
  $effect(() =>
    source.onCommand((command) => {
      switch (command.kind) {
        case 'refresh':     void app.refresh(); break;
        case 'theme':       app.setTheme(command.value); break;
        case 'range':       app.setRange(command.value); break;
        case 'toggle':      command.value === 'rolls' ? app.toggleRolls() : app.toggleEma(); break;
        case 'export':      void app.exportAs(command.value); break;
        case 'focus-chart': panel?.focus(); break;
      }
    }),
  );
</script>

<div class="wrap">
  <Masthead {app} />
  <Controls {app} />
  <NoticeBar {app} />

  <section class="panel">
    <Readout {app} />
    {#if app.dataset}
      <ChartPanel bind:this={panel} {app} />
    {:else}
      <div class="placeholder">{app.status === 'loading' ? 'Loading sessions…' : 'No data available.'}</div>
    {/if}
    <Legend />
  </section>

  <Notes {app} />
  <DataTable {app} />
  <SiteFooter {app} />
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 28px 20px 56px;
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .placeholder {
    display: grid;
    place-items: center;
    height: clamp(320px, 46vh, 560px);
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .wrap { padding: 20px 13px 40px; }
  }
</style>
