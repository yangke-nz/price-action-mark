/**
 * Generates the "Marks in view" layout-option artboards.
 *
 * Rule labels, blurbs, counts and the marks-in-view rows are REAL: lifted from
 * the registry and from detect() over data/es_data.json. Colours, type and
 * spacing are the resolved values from src/renderer/styles/tokens.css (dark
 * scope) and from MarkPanel.svelte / MarkList.svelte.
 */
import { writeFileSync, readFileSync } from 'node:fs';

const SCRATCH =
  'C:/Users/yangke/AppData/Local/Temp/claude/c--code-github-price-action-mark/1d7923bc-ae64-4cae-b61f-33a9e73cbe7a/scratchpad';
const RULES = JSON.parse(readFileSync(SCRATCH + '/rules.json', 'utf8'));
const MARKS = JSON.parse(readFileSync(SCRATCH + '/inview.json', 'utf8'));

const COUNTS = {
  'trend-bar': 2260, 'big-bar': 450, 'doji': 1783, 'inside': 777, 'outside': 771,
  'ii': 40, 'ioi': 26, 'reversal-bar': 340, 'shaved': 989, 'pin-bar': 244,
  'climax': 38, 'gap-bar': 42, 'breakout': 349, 'follow-through': 45,
  'two-bar-reversal': 237, 'bull-channel': 99, 'bear-channel': 96,
  'micro-channel': 238, 'spike-and-channel': 80, 'double-top': 112,
  'double-bottom': 79, 'wedge': 132, 'triangle': 144, 'pullback-entry': 808,
  'second-entry': 162, 'dt-short': 112, 'db-long': 79, 'wedge-reversal': 66,
  'bo-pullback': 282, 'failed-bo': 102, 'final-flag': 44,
};
const GROUP_NAME = { bars: 'Special bars', lines: 'Lines they form', entries: 'Entries they set up' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => v.toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [y, m, d] = iso.split('-');
  return Number(d) + ' ' + MON[Number(m) - 1] + ' ' + y;
};

const COL_W = 578;      // the measured side column at a 1700px viewport
const COL_H = 964;      // its measured height: calc(100vh - 36px) at 1000px
const AB_W = 660;
const AB_H = 1232;

// ---------------------------------------------------------------- stylesheet
const HELMET = `<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
  <style>
    :root {
      --plane: #0b0d10; --surface: #15181c; --surface-2: #1b1f24;
      --ink: #f2f5f8; --ink-2: #a8b1bc; --muted: #6d7681;
      --grid: #23282e; --axis: #333a42; --hair: rgb(242 245 248 / 10%);
      --up: #008300; --down: #e66767; --up-text: #0ca30c; --down-text: #e66767;
      --ema: #93a5f4; --focus: #3987e5;
      --sans: "Archivo", "Archivo Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", "Cascadia Mono", monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--plane); color: var(--ink); font-family: var(--sans);
           -webkit-font-smoothing: antialiased; }
    a { color: var(--focus); } a:hover { color: var(--ink); }

    .card { background: var(--surface); border: 1px solid var(--hair); border-radius: 10px;
            overflow: hidden; display: flex; flex-direction: column; }
    .sum { display: flex; align-items: baseline; gap: 12px; padding: 11px 16px; flex: none;
           font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.12em;
           text-transform: uppercase; color: var(--muted); }
    .sum .t { color: var(--ink-2); }
    .sum .c { margin-left: auto; letter-spacing: 0.04em; text-transform: none; }

    .top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; flex: none;
           padding: 12px 16px; border-top: 1px solid var(--grid); }
    .master { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink); }
    .seg { display: flex; gap: 2px; padding: 3px; background: var(--surface-2);
           border: 1px solid var(--hair); border-radius: 8px; }
    .seg span { padding: 4px 10px; border-radius: 5px; font-family: var(--mono);
                font-size: 11px; color: var(--ink-2); }
    .seg span.on { background: var(--surface); color: var(--ink); font-weight: 600; }
    .tally { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--muted); }

    .rules { display: grid; gap: 2px 20px; padding: 0 16px 14px; }
    .rule { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline;
            gap: 3px 8px; padding: 5px 0; font-size: 12.5px; color: var(--ink-2); }
    .rule.dim { opacity: 0.45; }
    .rule .name { font-weight: 500; }
    .rule .n { justify-self: end; font-family: var(--mono); font-size: 11px;
               font-variant-numeric: tabular-nums; color: var(--muted); }
    .rule .blurb { grid-column: 2 / -1; font-size: 11.5px; line-height: 1.4; color: var(--muted); }
    input[type=checkbox] { width: 14px; height: 14px; margin: 0; accent-color: var(--focus); }

    .rules.tight { gap: 0 22px; grid-template-columns: 1fr 1fr; padding-bottom: 10px; }
    .rules.tight .rule { grid-template-columns: auto 1fr auto; padding: 3px 0; font-size: 12px; gap: 8px; }
    .rules.tight .blurb { display: none; }
    .ghead { grid-column: 1 / -1; font-family: var(--mono); font-size: 9.5px; font-weight: 600;
             letter-spacing: 0.13em; text-transform: uppercase; color: var(--muted); padding: 11px 0 3px; }

    .hint { margin: 0; padding: 9px 16px; border-top: 1px solid var(--grid); flex: none;
            font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.04em; color: var(--muted); }
    .tbl { flex: 1 1 auto; overflow: hidden; position: relative; }
    table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    th { text-align: left; padding: 8px 6px; background: var(--surface-2);
         border-bottom: 1px solid var(--grid); font-family: var(--mono); font-size: 10px;
         font-weight: 600; letter-spacing: 0.11em; text-transform: uppercase; color: var(--muted);
         white-space: nowrap; }
    td { padding: 7px 6px; border-bottom: 1px solid var(--grid); color: var(--ink-2);
         vertical-align: top; }
    td.d { font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums;
           white-space: nowrap; color: var(--ink); }
    .lag { display: block; font-size: 10.5px; color: var(--muted); }
    td.lab { font-family: var(--mono); font-weight: 600; white-space: nowrap; color: var(--ink-2); }
    td.lab.bull { color: var(--up-text); }
    td.lab.bear { color: var(--down-text); }
    td.rl { font-family: var(--mono); font-size: 11px; color: var(--muted);
            overflow-wrap: break-word; }
    td.note { font-size: 11.5px; line-height: 1.45; }
    td.vd { white-space: nowrap; }
    .vd i { display: inline-block; padding: 3px 6px; border: 1px solid var(--hair);
            border-radius: 5px; background: var(--surface); color: var(--muted);
            font-family: var(--mono); font-size: 11px; font-style: normal; letter-spacing: 0.05em; }
    .vd i + i { margin-left: 4px; }
    tr.picked td { background: var(--surface-2); }
    tr.picked td.d { box-shadow: inset 3px 0 0 var(--focus); }
    tr.picked td.lab { text-decoration: underline; text-decoration-thickness: 2px; }

    /* the roomier table a column gets once the rules are not sharing it */
    .roomy th, .roomy td { padding-left: 12px; padding-right: 12px; }
    .roomy td.rl { white-space: nowrap; }
    .roomy td.note { min-width: 20ch; }

    .tabs { display: flex; gap: 2px; padding: 0 10px; flex: none; background: var(--surface-2);
            border-top: 1px solid var(--grid); border-bottom: 1px solid var(--grid); }
    .tab { display: flex; align-items: center; gap: 7px; padding: 9px 12px 8px;
           border-bottom: 2px solid transparent; font-family: var(--mono); font-size: 11px;
           letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .tab.on { color: var(--ink); border-bottom-color: var(--focus); font-weight: 600; }
    .tab b { font-weight: 600; letter-spacing: 0; font-variant-numeric: tabular-nums; }

    .frameLabel { display: flex; align-items: baseline; gap: 11px; margin: 0 0 15px; flex: none; }
    .frameLabel h2 { margin: 0; font-size: 15.5px; font-weight: 600; letter-spacing: -0.01em;
                     color: var(--ink); }
    .frameLabel .kicker { font-family: var(--mono); font-size: 10px; font-weight: 600;
                          letter-spacing: 0.14em; text-transform: uppercase; color: var(--focus);
                          white-space: nowrap; }
    .frameLabel .kicker.warn { color: var(--down-text); }
    .foot { display: grid; gap: 8px; margin-top: 17px; flex: none; }
    .foot > div { display: grid; grid-template-columns: 74px 1fr; gap: 11px; font-size: 11.5px;
                  line-height: 1.5; color: var(--ink-2); }
    .foot b { font-family: var(--mono); font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em;
              text-transform: uppercase; color: var(--muted); padding-top: 3px; }
    .foot .cost b { color: var(--down-text); }

    .colwrap { position: relative; flex: none; }
    .sb { position: absolute; right: -10px; width: 5px; border-radius: 3px; background: var(--axis); }
    .fade { position: absolute; left: 1px; right: 1px; bottom: 1px; height: 96px; border-radius: 0 0 10px 10px;
            background: linear-gradient(to bottom, rgb(21 24 28 / 0), rgb(11 13 16 / 0.94) 70%); }
    .cutnote { position: absolute; left: 0; right: 0; bottom: 12px; text-align: center;
               font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; color: var(--down-text); }
  </style>
</helmet>`;

// ------------------------------------------------------------------- pieces
function ruleRow(r, tight) {
  const cls = 'rule' + (r.on ? '' : ' dim');
  const blurb = tight ? '' : `\n          <span class="blurb">${esc(r.blurb)}</span>`;
  return `          <label class="${cls}">
            <input type="checkbox"${r.on ? ' checked' : ''}>
            <span class="name">${esc(r.label)}</span>
            <span class="n">${num(COUNTS[r.id])}</span>${blurb}
          </label>`;
}

function ruleList(tight) {
  if (!tight) return RULES.map((r) => ruleRow(r, false)).join('\n');
  const out = [];
  for (const g of ['bars', 'lines', 'entries']) {
    out.push(`          <div class="ghead">${esc(GROUP_NAME[g])}</div>`);
    for (const r of RULES.filter((x) => x.group === g)) out.push(ruleRow(r, true));
  }
  return out.join('\n');
}

const topStrip = `        <div class="top">
          <label class="master"><input type="checkbox" checked> Show marks</label>
          <div class="seg"><span class="on">All candidates</span><span>Confirmed only</span></div>
          <span class="tally">0 kept · 0 dropped</span>
        </div>`;

function markRows(count, picked) {
  return MARKS.slice(0, count).map((m, i) => {
    const tone = m.tone === 'bull' ? ' bull' : m.tone === 'bear' ? ' bear' : '';
    const lag = m.knownAt !== m.at ? `<span class="lag">confirmed ${day(m.knownAt)}</span>` : '';
    return `              <tr${i === picked ? ' class="picked"' : ''}>
                <td class="d">${day(m.at)}${lag}</td>
                <td class="lab${tone}">${esc(m.label)}</td>
                <td class="rl">${esc(m.rule)}</td>
                <td class="note">${esc(m.note)}</td>
                <td class="vd"><i>Keep</i><i>Drop</i></td>
              </tr>`;
  }).join('\n');
}

function marksTable(count, picked, roomy) {
  return `        <p class="hint">Click a mark to highlight it on the chart.</p>
        <div class="tbl">
          <table${roomy ? ' class="roomy"' : ''}>
            <thead>
              <tr><th>Session</th><th>Mark</th><th>Rule</th><th>Detail</th><th></th></tr>
            </thead>
            <tbody>
${markRows(count, picked)}
            </tbody>
          </table>
        </div>`;
}

function foot(rows) {
  return `  <div class="foot">
${rows.map(([k, v, cost]) => `    <div${cost ? ' class="cost"' : ''}><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('\n')}
  </div>`;
}

function artboard(w, h, kicker, title, body, warn) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
${HELMET}
<div style="width: ${w}px; height: ${h}px; background: var(--plane); padding: 26px 32px 22px;
            display: flex; flex-direction: column; overflow: hidden;">
  <div class="frameLabel">
    <span class="kicker${warn ? ' warn' : ''}">${esc(kicker)}</span>
    <h2>${esc(title)}</h2>
  </div>
${body}
</div>
</x-dc>
</body>
</html>
`;
}

// ------------------------------------------------------------- 1. TODAY
const current = artboard(AB_W, AB_H, 'Today', 'The rules card buries the list', `  <div class="colwrap" style="width: ${COL_W}px; height: ${COL_H}px;">
    <div class="card" style="height: 100%;">
      <div class="sum"><span class="t">Marking</span><span class="c">3,638 marks from 25 rules</span></div>
${topStrip}
        <div class="rules">
${ruleList(false)}
        </div>
    </div>
    <div class="sb" style="top: 0; height: 402px;"></div>
    <div class="fade"></div>
    <div class="cutnote">↓ Marks in view starts 2,217 px down · 1,253 px of scrolling from here</div>
  </div>
${foot([
  ['Problem', 'The rules card is 2,199 px tall in a column that shows 964 px. Marks in view is the card after it, so it opens off-screen and stays there.'],
  ['Frequency', 'Rules are set once and left. Marks in view is where every Keep, Drop and click-to-highlight happens — the position is exactly backwards.'],
  ['Table', '0 px of the marks table is reachable without scrolling past 31 rule rows.', true],
])}`, true);

// -------------------------------------------------- 2. OPTION A — tabs (Main)
const optionA = artboard(AB_W, AB_H, 'Option A', 'One card, two tabs', `  <div class="colwrap" style="width: ${COL_W}px; height: ${COL_H}px;">
    <div class="card" style="height: 100%;">
      <div class="sum"><span class="t">Marking</span><span class="c">3,638 marks from 25 rules</span></div>
${topStrip}
      <div class="tabs">
        <div class="tab on">Marks in view <b>69</b></div>
        <div class="tab">Rules <b>25/31</b></div>
      </div>
${marksTable(14, 0, false)}
    </div>
  </div>
${foot([
  ['Why', 'The three controls you touch constantly — Show marks, All / Confirmed, the kept-dropped tally — stay pinned above the tabs. Below them, one surface at a time, and marks is the one that opens.'],
  ['Table', '~790 px of table, immediately, with no scrolling to reach it.'],
  ['Cost', 'You cannot watch a rule\u2019s count while scanning the list — a tab switch away, not a scroll.', true],
])}`);

// ------------------------------------------- 3. OPTION B — swap and collapse
const optionB = artboard(AB_W, AB_H, 'Option B', 'Swap the order, collapse the rules', `  <div class="colwrap" style="width: ${COL_W}px; height: ${COL_H}px; display: flex; flex-direction: column; gap: 18px;">
    <div class="card" style="flex: 1 1 auto; min-height: 0;">
      <div class="sum"><span class="t">Marks in view</span><span class="c">69</span></div>
${topStrip}
${marksTable(13, 0, false)}
    </div>
    <div class="card" style="flex: none;">
      <div class="sum">
        <span style="color: var(--muted); font-size: 9px; letter-spacing: 0;">▶</span>
        <span class="t">Marking</span><span class="c">25 of 31 rules on</span>
      </div>
    </div>
  </div>
${foot([
  ['Why', 'The smallest change that fixes the reach: two cards, same behaviour, order reversed and the rules card shut by default. Nothing new to learn and nothing to build.'],
  ['Table', '~700 px of table, immediately.'],
  ['Cost', 'Opening the rules still means scrolling 2,199 px of them, and it pushes the list you were reading down the column.', true],
])}`);

// ---------------------------------------------------- 4. OPTION D — split panes
const optionD = artboard(AB_W, AB_H, 'Option D', 'Two panes, both always visible', `  <div class="colwrap" style="width: ${COL_W}px; height: ${COL_H}px; display: flex; flex-direction: column; gap: 18px;">
    <div class="card" style="flex: none; height: 336px; position: relative;">
      <div class="sum"><span class="t">Marking</span><span class="c">25 of 31 on</span></div>
${topStrip}
      <div style="flex: 1 1 auto; overflow: hidden;">
        <div class="rules tight">
${ruleList(true)}
        </div>
      </div>
      <div class="sb" style="top: 96px; height: 150px; right: 5px;"></div>
    </div>
    <div class="card" style="flex: 1 1 auto; min-height: 0;">
      <div class="sum"><span class="t">Marks in view</span><span class="c">69</span></div>
${marksTable(10, 0, false)}
    </div>
  </div>
${foot([
  ['Why', 'No mode to switch. Rules keep a fixed slice of the column with their own scroll, marks take the rest, and a rule count is always in view beside the list it changes.'],
  ['Table', '~560 px of table, immediately.'],
  ['Cost', 'Two nested scrollbars in one column, and the blurbs have to go — they are how you learn what a rule actually means.', true],
])}`);

// -------------------------------------- 5. OPTION C — rules into the toolbar
const C_W = 1240;
const C_COL = 700;
const candles = (() => {
  // A sketch, not a chart: enough to place the popover in context. Deterministic
  // so a re-seed produces the same picture.
  const n = 58, x0 = 14, x1 = 426;
  const step = (x1 - x0) / (n - 1);
  // viewBox is 440x900 and the frame is about 455x935, so this is close to 1:1 —
  // a stretched viewBox turned the same numbers into a near-vertical ramp.
  const at = (i) => 730 - (i / (n - 1)) * 430 + Math.sin(i / 4.5) * 34 + Math.sin(i / 11) * 52;
  const parts = [];
  const mid = [];
  for (let i = 1; i < n; i++) {
    const o = at(i - 1), c = at(i);
    const up = c <= o;
    const col = up ? '#008300' : '#e66767';
    const x = x0 + i * step;
    const wick = 7 + ((i * 7) % 8);
    const top = Math.min(o, c) - wick, bot = Math.max(o, c) + wick;
    const bodyH = Math.max(3, Math.abs(c - o));
    parts.push(`<line x1="${x.toFixed(1)}" y1="${top.toFixed(1)}" x2="${x.toFixed(1)}" y2="${bot.toFixed(1)}" stroke="${col}" stroke-width="1.1"/>`);
    parts.push(`<rect x="${(x - 2.6).toFixed(1)}" y="${Math.min(o, c).toFixed(1)}" width="5.2" height="${bodyH.toFixed(1)}" fill="${up ? 'none' : col}" stroke="${col}" stroke-width="1.1"/>`);
    mid.push([x, (o + c) / 2]);
  }
  // A 20-ish smoothing of the midpoints, standing in for the EMA.
  const ema = [];
  let e = mid[0][1];
  for (const [x, y] of mid) { e += (y - e) * 0.12; ema.push(`${x.toFixed(1)} ${e.toFixed(1)}`); }
  parts.push(`<polyline points="${ema.join(' ')}" fill="none" stroke="#93a5f4" stroke-width="1.6"/>`);
  return parts.join('');
})();

const optionC = artboard(C_W, AB_H, 'Option C', 'Rules move to the toolbar; the column is only the list', `  <div style="flex: none; display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
    <div class="seg" style="border-color: var(--focus);"><span class="on">Rules&nbsp; 25/31&nbsp; ▾</span></div>
    <div class="seg"><span>1M</span><span>3M</span><span class="on">6M</span><span>1Y</span><span>5Y</span><span>MAX</span></div>
    <div class="seg"><span>Auto</span><span>Light</span><span class="on">Dark</span></div>
    <div style="margin-left: auto; display: flex; gap: 16px; font-size: 12.5px; color: var(--ink-2);">
      <label class="master"><input type="checkbox" checked> Contract rolls</label>
      <label class="master"><input type="checkbox" checked> EMA 20</label>
    </div>
  </div>

  <div style="flex: 1 1 auto; min-height: 0; display: flex; gap: 18px; position: relative;">
    <div class="card" style="flex: 1 1 auto; min-width: 0;">
      <div class="sum" style="letter-spacing: 0.04em; text-transform: none; font-size: 11.5px; white-space: nowrap;">
        <span style="color: var(--ink);">27 Aug 2026</span>
        <span style="color: var(--ink);">C 7,720.00</span>
        <span class="c">128 in view</span>
      </div>
      <div style="flex: 1 1 auto; border-top: 1px solid var(--grid); position: relative; overflow: hidden;">
        <svg viewBox="0 0 440 900" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
          <g stroke="#23282e" stroke-width="1">
            <line x1="0" y1="150" x2="440" y2="150"/><line x1="0" y1="300" x2="440" y2="300"/>
            <line x1="0" y1="450" x2="440" y2="450"/><line x1="0" y1="600" x2="440" y2="600"/>
            <line x1="0" y1="750" x2="440" y2="750"/>
          </g>
          <g>${candles}</g>
        </svg>
      </div>
      <div class="hint" style="letter-spacing: 0.02em;">Close ≥ open (hollow) · Close &lt; open (filled) · EMA 20 · Contract roll</div>
    </div>

    <div class="card" style="flex: none; width: ${C_COL}px;">
      <div class="sum"><span class="t">Marks in view</span><span class="c">69 · 0 kept · 0 dropped</span></div>
      <div class="top" style="padding: 10px 16px;">
        <label class="master"><input type="checkbox" checked> Show marks</label>
        <div class="seg"><span class="on">All candidates</span><span>Confirmed only</span></div>
      </div>
${marksTable(13, 0, true)}
    </div>

    <!-- the popover, anchored under the toolbar button -->
    <div style="position: absolute; left: -6px; top: -6px; width: 618px;
                background: var(--surface); border: 1px solid var(--hair); border-radius: 10px;
                box-shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 18px 48px -16px rgb(0 0 0 / 80%);
                overflow: hidden;">
      <div class="sum"><span class="t">Rules</span><span class="c">25 of 31 on · 3,638 marks</span></div>
      <div style="border-top: 1px solid var(--grid);">
        <div class="rules tight" style="padding: 0 16px 12px; grid-template-columns: 1fr 1fr;">
${ruleList(true)}
        </div>
      </div>
      <div class="hint" style="border-top: 1px solid var(--grid); display: flex; gap: 12px; white-space: nowrap;">
        <span>Esc closes</span>
        <span style="margin-left: auto; color: var(--focus);">shown open — not a permanent panel</span>
      </div>
    </div>
  </div>
${foot([
  ['Why', 'Rules are configuration, and a toolbar popover is what configuration looks like. The column then holds one thing, so it can also be wider — which un-cramps the five-column table that currently scrolls sideways at 578 px.'],
  ['Table', '~640 px of table in a 700 px column, with the notes readable.'],
  ['Cost', 'A rule count is no longer glanceable while you work, the popover covers the chart while open, and it is the most to build: positioning, focus trap, Esc, outside-click.', true],
])}`);

// ------------------------------------------------------------------- write
writeFileSync('mocks/Current.dc.html', current);
writeFileSync('mocks/Main.dc.html', optionA);
writeFileSync('mocks/OptionB.dc.html', optionB);
writeFileSync('mocks/OptionD.dc.html', optionD);
writeFileSync('mocks/OptionC.dc.html', optionC);

const canvas = {
  artboards: [
    { file: 'Current.dc.html', title: 'Today — the problem', x: 0, y: 0, w: AB_W, h: AB_H },
    { file: 'Main.dc.html', title: 'Option A — Tabbed inspector', x: AB_W + 110, y: 0, w: AB_W, h: AB_H },
    { file: 'OptionB.dc.html', title: 'Option B — Swap and collapse', x: (AB_W + 110) * 2, y: 0, w: AB_W, h: AB_H },
    { file: 'OptionD.dc.html', title: 'Option D — Split panes', x: (AB_W + 110) * 3, y: 0, w: AB_W, h: AB_H },
    { file: 'OptionC.dc.html', title: 'Option C — Rules in the toolbar', x: 0, y: AB_H + 190, w: C_W, h: AB_H },
  ],
  annotations: [
    {
      id: 'brief',
      x: 0, y: -232, w: 1348,
      text: 'Marks in view — four ways out of the basement\n\n'
        + 'The side column stacks Marking (31 rule rows) above Marks in view. Measured at a 1700x1000 viewport: the column shows 964 px, '
        + 'its content is 2,257 px, and the marks card starts at 2,217 px — so the surface you use on every single mark opens off-screen.\n\n'
        + 'Compare the four on one number: how much marks table you get without scrolling. Every option keeps the same data, the same '
        + 'verdicts and the same click-to-highlight — only the container changes.',
    },
    {
      id: 'pick',
      x: 1458, y: -232, w: 550,
      text: 'Leaning to Option A.\n\n'
        + 'It is the only one that gives the list the whole column without moving rules out of the panel, and the pinned strip keeps '
        + 'Show marks / All-vs-Confirmed reachable from both tabs — those three are what the publish flow needs.\n\n'
        + 'Option C is the better end state if you are willing to build a popover; B is the 20-minute version.',
    },
    {
      id: 'compact-note',
      x: C_W + 110, y: AB_H + 190, w: 500,
      text: 'The compact rule row (name + count, no blurb, two columns) used in C and D is worth having on its own — it takes the rules '
        + 'card from 2,199 px to about 640 px. Dropped blurbs need somewhere to go: title attribute, or a details row on hover.',
    },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('mocks/canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote 5 artboards + canvas.json');
