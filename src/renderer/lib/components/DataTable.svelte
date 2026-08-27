<script lang="ts">
  import { TABLE_CAP, type AppState } from '$lib/state/app.svelte.ts';
  import { delta, integer, price } from '$shared/format.ts';

  let { app }: { app: AppState } = $props();
</script>

<details class="tableview">
  <summary>
    Data table &mdash; {integer(app.visibleCount)} session{app.visibleCount === 1 ? '' : 's'} in the current viewport
    {#if app.tableTruncated}<span class="dim">(newest {integer(TABLE_CAP)} listed)</span>{/if}
  </summary>

  <div class="tscroll">
    <table>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Open</th>
          <th scope="col">High</th>
          <th scope="col">Low</th>
          <th scope="col">Close</th>
          <th scope="col">Change</th>
          <th scope="col">Volume</th>
          <th scope="col">Note</th>
        </tr>
      </thead>
      <tbody>
        {#each app.visibleRows as bar (bar.date)}
          {@const move = app.change(bar.i)}
          <tr>
            <td>{bar.date}</td>
            <td>{price(bar.open)}</td>
            <td>{price(bar.high)}</td>
            <td>{price(bar.low)}</td>
            <td>{price(bar.close)}</td>
            <td class:pos={move.abs >= 0} class:neg={move.abs < 0}>{delta(move.abs, move.pct)}</td>
            <td>{bar.volume ? integer(bar.volume) : '—'}</td>
            <td class="rolltag">{bar.isRoll ? 'Contract roll' : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</details>

<style>
  .tableview {
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: 10px;
    overflow: hidden;
  }

  summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-2);
    list-style: none;
  }

  summary::-webkit-details-marker { display: none; }

  summary::before {
    content: "\203A";
    display: inline-block;
    font-size: 16px;
    color: var(--muted);
    transition: transform 0.15s;
  }

  .tableview[open] summary::before { transform: rotate(90deg); }
  summary:hover { color: var(--ink); }
  .dim { color: var(--muted); font-weight: 400; }

  .tscroll { max-height: 400px; overflow: auto; border-top: 1px solid var(--grid); }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  thead th {
    position: sticky;
    top: 0;
    padding: 8px 14px;
    background: var(--surface-2);
    text-align: right;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 1px solid var(--grid);
    white-space: nowrap;
  }

  thead th:first-child { text-align: left; }

  tbody td {
    padding: 6px 14px;
    text-align: right;
    border-bottom: 1px solid var(--grid);
    color: var(--ink-2);
    white-space: nowrap;
  }

  tbody td:first-child { text-align: left; color: var(--ink); font-weight: 500; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--surface-2); }

  .rolltag {
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
