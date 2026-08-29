/**
 * The text oracle for the marking rules.
 *
 * Detection is visual by nature and that is exactly why it cannot be developed
 * visually: a rule that is subtly too loose looks, on a canvas, like a rule
 * that is working. This prints the same numbers the rules see, for any span of
 * sessions, so a threshold gets chosen against evidence rather than by eye.
 *
 * It works only because everything under src/shared/marks/ is pure and free of
 * Node, the DOM and Svelte — the app, the artifact and this script run byte
 * for byte the same detection code.
 *
 *   npm run marks                                  last 40 sessions, metrics
 *   npm run marks -- --last 120
 *   npm run marks -- --from 2024-12-01 --to 2025-01-31
 *   npm run marks -- --rolls                       only contract-change bars
 *   npm run marks -- --structure                   add pivot / trend / pullback
 *   npm run marks -- --tune                        sweep strength x min-swing
 *   npm run marks -- --read                        the bar-by-bar reading, in words
 *   npm run marks -- --read --rolls                only the contract changes
 *   npm run marks -- --rules                       what every rule detected
 *   npm run marks -- --rules --rule ii,ioi --last 400
 *   npm run marks -- --catalogue                   hit rate per rule, whole series
 *   npm run marks -- --trades                      every entry, with what it did
 *   npm run marks -- --golden                      rewrite the regression fixture
 *   npm run marks -- --check                       invariants; exits non-zero
 *   npm run marks -- --file data/other.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDataset } from '../src/shared/yahoo.ts';
import { metrics } from '../src/shared/marks/metrics.ts';
import { structure, type Structure } from '../src/shared/marks/structure.ts';
import { buildCtx } from '../src/shared/marks/rule.ts';
import { RULES, defaultEnabled, detect } from '../src/shared/marks/registry.ts';
import { phraseOf, readAt, readingIndex, readings } from '../src/shared/marks/reading.ts';
import { intervalOf } from '../src/shared/interval.ts';
import { walkForward, type TradePlan } from '../src/shared/marks/trade.ts';
import type { Dataset } from '../src/shared/types.ts';

const DEFAULT_FILE = fileURLToPath(new URL('../data/es_data.json', import.meta.url));

// ---- arguments ----------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const next = argv[i + 1];
  return next === undefined || next.startsWith('--') ? '' : next;
}

const has = (name: string): boolean => argv.includes(`--${name}`);

function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

// ---- load ---------------------------------------------------------------

const fileFlag = flag('file');
const file = fileFlag
  ? (isAbsolute(fileFlag) ? fileFlag : resolve(process.cwd(), fileFlag))
  : DEFAULT_FILE;

const parsed: unknown = JSON.parse(
  await readFile(file, 'utf8').catch(() => die(`cannot read ${file}`)),
);
if (!isDataset(parsed)) die(`${file} is not a dataset`);
const data: Dataset = parsed;
const m = metrics(data);

const strengthFlag = Number(flag('strength') ?? '') || undefined;
const minSwingFlag = flag('min-swing');
const structOpts = {
  ...(strengthFlag === undefined ? {} : { strength: strengthFlag }),
  ...(minSwingFlag ? { minSwingAtr: Number(minSwingFlag) } : {}),
};
let cached: Structure | null = null;
const struct = (): Structure => (cached ??= structure(m, structOpts));

// ---- formatting ---------------------------------------------------------

const pad = (s: string, w: number): string => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
const padr = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '--');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '--');

function flagsFor(i: number): string {
  const out: string[] = [];
  if (m.isRoll[i] === 1) out.push('ROLL');
  if (m.gap[i] === 1) out.push('GAP+');
  if (m.gap[i] === -1) out.push('GAP-');
  if (m.isContractStart[i] === 1) out.push('NEWC');
  if (m.suspect[i] === 1) out.push('SUSP');
  return out.join(' ');
}

const COLUMNS: { head: string; w: number; of: (i: number) => string }[] = [
  { head: 'date',  w: 10, of: (i) => data.d[i]! },
  { head: 'open',  w: 9,  of: (i) => f2(data.o[i]!) },
  { head: 'high',  w: 9,  of: (i) => f2(m.high[i]!) },
  { head: 'low',   w: 9,  of: (i) => f2(m.low[i]!) },
  { head: 'close', w: 9,  of: (i) => f2(data.c[i]!) },
  { head: 'range', w: 8,  of: (i) => f2(m.range[i]!) },
  { head: 'body%', w: 7,  of: (i) => f3(m.bodyPct[i]!) },
  { head: 'upT%',  w: 7,  of: (i) => f3(m.upperTailPct[i]!) },
  { head: 'lwT%',  w: 7,  of: (i) => f3(m.lowerTailPct[i]!) },
  { head: 'cls@',  w: 7,  of: (i) => f3(m.closePos[i]!) },
  { head: 'dir',   w: 4,  of: (i) => (m.dir[i] === 1 ? 'up' : m.dir[i] === -1 ? 'dn' : '--') },
  { head: 'TR',    w: 8,  of: (i) => f2(m.tr[i]!) },
  { head: 'ATR',   w: 8,  of: (i) => f2(m.atr[i]!) },
  { head: 'r/ATR', w: 7,  of: (i) => f2(m.rangeAtr[i]!) },
];

if (has('structure')) {
  const s = struct();
  const pivotAt = new Map(s.pivots.map((p) => [p.i, p.kind]));
  COLUMNS.push(
    { head: 'piv', w: 4, of: (i) => (pivotAt.get(i) === 'high' ? 'H' : pivotAt.get(i) === 'low' ? 'L' : '') },
    { head: 'trend', w: 6, of: (i) => (s.trend[i] === 1 ? 'long' : s.trend[i] === -1 ? 'short' : 'range') },
    { head: 'pb', w: 4, of: (i) => {
      const v = s.pullback[i]!;
      return v === 0 ? '' : (v > 0 ? 'H' : 'L') + String(Math.abs(v));
    } },
  );
}

function table(rows: number[]): string {
  const head = COLUMNS.map((c) => pad(c.head, c.w)).join(' ') + '  flags';
  const rule = COLUMNS.map((c) => '-'.repeat(c.w)).join(' ') + '  -----';
  const body = rows.map((i) =>
    (COLUMNS.map((c) => pad(c.of(i), c.w)).join(' ') + '  ' + flagsFor(i)).trimEnd(),
  );
  return [head, rule, ...body].join('\n');
}

/** Inclusive index window from --from/--to/--last. A date landing on a
 *  non-session snaps inward to the nearest bar inside the span. */
function window(): [number, number] {
  const n = data.d.length;
  const from = flag('from');
  const to = flag('to');
  if (from || to) {
    let lo = 0;
    let hi = n - 1;
    if (from) while (lo < n && data.d[lo]! < from) lo++;
    if (to) while (hi >= 0 && data.d[hi]! > to) hi--;
    if (lo > hi) die(`no sessions between ${from || data.d[0]} and ${to || data.d[n - 1]}`);
    return [lo, hi];
  }
  const last = Number(flag('last') ?? '') || 40;
  return [Math.max(0, n - last), n - 1];
}

// ---- invariants ---------------------------------------------------------

/** What phase 01 promised. Run over the WHOLE series rather than the printed
 *  window: the roll fallback is the entire point, and there are 104 of them. */
async function check(): Promise<number> {
  const fails: string[] = [];
  const n = data.d.length;
  const at = (i: number): string => `${data.d[i]} (bar ${i})`;

  const columns = [
    m.range, m.body, m.bodyPct, m.upperTail, m.lowerTail, m.upperTailPct,
    m.lowerTailPct, m.closePos, m.tr, m.atr, m.rangeAtr,
  ];
  if (m.n !== n || m.dir.length !== n || columns.some((col) => col.length !== n)) {
    fails.push(`column length disagrees with the ${n}-bar series`);
  }

  let rollBars = 0;
  let startBars = 0;
  let worstCarry = { pct: 0, i: -1 };
  for (let i = 0; i < n; i++) {
    if (m.isRoll[i] === 1) rollBars++;
    if (m.isContractStart[i] !== 1) continue;
    startBars++;
    if (i > 0 && m.tr[i] !== m.range[i]) {
      fails.push(`true range at contract start ${at(i)} is ${m.tr[i]}, not high-low ${m.range[i]}`);
    }
    if (m.gap[i] !== 0) fails.push(`gap flagged at contract start ${at(i)}`);
    // The carry these bars carry, and therefore what suppression is worth.
    if (i > 0) {
      const pct = Math.abs(data.o[i]! / data.c[i - 1]! - 1) * 100;
      if (pct > worstCarry.pct) worstCarry = { pct, i };
    }
  }

  // A contract start is one bar after its roll, except where the expiry fell
  // on a holiday. If that ever inverts, every ATR after it is measuring carry.
  for (let i = 0; i < n; i++) {
    if (m.isContractStart[i] !== 1) continue;
    if (m.isRoll[i] !== 1 && (i === 0 || m.isRoll[i - 1] !== 1)) {
      fails.push(`contract start at ${at(i)} sits at neither a roll nor one bar after one`);
      break;
    }
  }

  const suspects: number[] = [];
  for (let i = 0; i < n; i++) {
    if (m.suspect[i] === 1) suspects.push(i);
    // The correction may only ever widen; a narrowed bar would mean the
    // enclosing logic had inverted somewhere.
    if (m.high[i]! < data.h[i]! || m.low[i]! > data.l[i]!) {
      fails.push(`extremes narrowed rather than widened at ${at(i)}`);
      break;
    }
  }

  const unit = (v: number): boolean => v >= 0 && v <= 1;
  for (let i = 0; i < n; i++) {
    if (!unit(m.bodyPct[i]!) || !unit(m.upperTailPct[i]!) ||
        !unit(m.lowerTailPct[i]!) || !unit(m.closePos[i]!)) {
      fails.push(`ratio outside 0..1 at ${at(i)}`);
      break;
    }
    const parts = m.upperTail[i]! + m.body[i]! + m.lowerTail[i]!;
    if (Math.abs(parts - m.range[i]!) > 1e-9) {
      fails.push(`tails plus body is ${parts}, range is ${m.range[i]} at ${at(i)}`);
      break;
    }
  }

  // ---- marks -----------------------------------------------------------

  // A mark id keys its verdict and keys the mark list's each-block, which
  // throws outright on a duplicate. Checked per rule, not on detect()'s
  // output: detect() dedupes, so testing there would only prove the backstop
  // works and never that a rule is well behaved.
  {
    const ctx = buildCtx(data, structOpts);
    const seen = new Map<string, string>();
    for (const rule of RULES) {
      for (const mark of rule.detect(ctx)) {
        const prior = seen.get(mark.id);
        if (prior !== undefined) {
          fails.push(`duplicate mark id "${mark.id}" from ${prior} and ${mark.rule}`);
          break;
        }
        seen.set(mark.id, mark.rule);
      }
      if (fails.length > 0) break;
    }
  }

  // ---- entries ---------------------------------------------------------

  // An entry mark's note quotes an OUTCOME, and that outcome must be the one
  // an order placed at `knownAt` would have had. The three pivot-anchored
  // rules confirm `strength` (3) bars after their signal, so their order is
  // live two bars LATER than the fill they used to report — they walked
  // forward from the signal anyway. 257 marks quoting a trade nobody could
  // have placed, and an edge (`dt-short` +0.873 R a mark) that was mostly the
  // head start. Re-derive the walk from the mark's own dates and require the
  // note to agree.
  {
    const ctx = buildCtx(data, structOpts);
    const indexOf = new Map(data.d.map((d, i) => [d, i]));
    for (const mark of detect(ctx)) {
      if (mark.kind !== 'trade') continue;
      const order = indexOf.get(mark.knownAt);
      const signal = indexOf.get(mark.at);
      if (order === undefined || signal === undefined) {
        fails.push(`trade mark ${mark.id} names a date the series does not have`);
        break;
      }
      if (order < signal) {
        fails.push(`${mark.id} says it was knowable at ${mark.knownAt}, before its own bar ${mark.at}`);
        break;
      }
      const res = walkForward(ctx, {
        dir: mark.dir, entry: mark.entry, stop: mark.stop, target: mark.target,
        risk: Math.abs(mark.entry - mark.stop),
      }, order);
      const quoted = res.outcome === 'no fill'
        ? 'never filled'
        : `${res.outcome} in ${res.bars} bars, ${res.r >= 0 ? '+' : ''}${res.r.toFixed(2)}R`;
      if (!(mark.note ?? '').includes(quoted)) {
        fails.push(
          `${mark.id} quotes an outcome an order placed at ${mark.knownAt} did not have: ` +
          `expected "${quoted}" in "${mark.note ?? ''}"`,
        );
        break;
      }
    }
  }

  // ---- reading ---------------------------------------------------------

  // The reading is prose, so the things that can go wrong with it are not
  // arithmetic: a missing line, an empty one, a stray newline that would break
  // a single-line row into two, or a pattern clause naming something the close
  // could not have known. All four are silent on a chart.
  {
    const ctx = buildCtx(data, structOpts);
    const marks = detect(ctx);
    const lines = readings(ctx, marks, 0, n - 1);
    if (lines.length !== n) {
      fails.push(`${lines.length} readings for ${n} bars — every session must get a line`);
    }
    const byDate = new Map(marks.map((mk) => [mk.at + '|' + mk.rule, mk]));
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k]!;
      if (line.at !== data.d[k]) {
        fails.push(`reading ${k} names ${line.at}, series has ${data.d[k]}`);
        break;
      }
      if (line.bar === '' || line.text === '') { fails.push(`empty reading at ${line.at}`); break; }
      if (/[\r\n]/.test(line.text)) { fails.push(`reading at ${line.at} spans lines`); break; }
      // A pattern in the reading must be a rule that fired on that bar AND was
      // knowable at its close. This is the foresight check.
      for (const phrase of line.patterns) {
        const rule = RULES.find((r) => phraseOf(r) === phrase);
        if (!rule) { fails.push(`reading at ${line.at} names "${phrase}", which is no rule`); break; }
        const mk = byDate.get(line.at + '|' + rule.id);
        if (!mk) { fails.push(`reading at ${line.at} names ${rule.id}, which did not fire there`); break; }
        if (mk.knownAt !== mk.at) {
          fails.push(`reading at ${line.at} names ${rule.id}, knowable only at ${mk.knownAt}`);
          break;
        }
      }
      if (fails.length > 0) break;
    }
  }

  // ---- structure -------------------------------------------------------

  const st = struct();
  const piv = st.pivots;
  for (let k = 0; k < piv.length; k++) {
    const p = piv[k]!;
    if (p.confirmedAt !== p.i + st.strength) {
      fails.push(`pivot at ${at(p.i)} confirms at ${p.confirmedAt}, expected ${p.i + st.strength}`);
      break;
    }
    const prev = piv[k - 1];
    if (prev === undefined) continue;
    if (prev.i >= p.i) { fails.push(`pivots out of order at ${at(p.i)}`); break; }
    if (prev.kind === p.kind) { fails.push(`two ${p.kind} pivots in a row at ${at(p.i)}`); break; }
  }
  if (st.legs.length !== Math.max(0, piv.length - 1)) {
    fails.push(`${st.legs.length} legs from ${piv.length} pivots`);
  }
  for (const leg of st.legs) {
    if (leg.dir !== (leg.to.kind === 'high' ? 1 : -1)) {
      fails.push(`leg ending ${at(leg.to.i)} has direction ${leg.dir}`);
      break;
    }
  }
  for (let i = 0; i < n; i++) {
    const pb = st.pullback[i]!;
    if (Math.abs(pb) > 4) { fails.push(`pullback ${pb} at ${at(i)} exceeds the cap`); break; }
    if (pb !== 0 && Math.sign(pb) !== st.trend[i]) {
      fails.push(`pullback ${pb} at ${at(i)} against trend ${st.trend[i]}`);
      break;
    }
    const lp = st.lastPivot[i]!;
    // The pivot the bar knows about must already have confirmed by then.
    if (lp >= 0 && lp + st.strength > i) {
      fails.push(`bar ${at(i)} reads a pivot at ${lp} that cannot confirm until ${lp + st.strength}`);
      break;
    }
  }

  // The real no-lookahead test: rebuild the structure from a truncated series
  // and require the overlap to be identical. If anything after bar K could
  // reach back and change what bar K-1 knew, this is where it shows.
  const cut = Math.max(0, n - 500);
  if (cut > 100) {
    const head = <T,>(a: T[]): T[] => a.slice(0, cut);
    const truncated = structure(
      metrics({
        ...data,
        d: head(data.d), o: head(data.o), h: head(data.h),
        l: head(data.l), c: head(data.c), v: head(data.v),
        rolls: data.rolls.filter((r) => r < cut),
      }),
      structOpts,
    );
    let drift = 0;
    for (let i = 0; i < cut; i++) {
      if (truncated.trend[i] !== st.trend[i] || truncated.pullback[i] !== st.pullback[i]) drift++;
    }
    if (drift > 0) {
      fails.push(`${drift} of ${cut} bars change when the last 500 sessions are removed — lookahead`);
    }
  }

  const warm = m.period - 1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(m.atr[i]!) === (i < warm)) {
      fails.push(`ATR presence wrong at ${at(i)}; warm-up is ${warm} bars`);
      break;
    }
  }

  const notes: string[] = [];
  await checkGolden(fails, notes);

  const out = [
    `${n} bars   ${data.d[0]} -> ${data.d[n - 1]}   ATR(${m.period})`,
    `${st.pivots.length} pivots, ${st.legs.length} legs, strength ${st.strength}` +
      `, min swing ${st.minSwingAtr} ATR`,
    `${rollBars} expiries marked, ${startBars} contract starts suppressed` +
      (worstCarry.i >= 0
        ? `   worst carry ${worstCarry.pct.toFixed(2)}% at ${data.d[worstCarry.i]}`
        : ''),
    '',
    `  ${suspects.length} sessions where the printed high/low did not enclose open/close:`,
  ];
  for (const i of suspects) {
    const off = (data.c[i]! * 4) % 1 !== 0;
    out.push(
      `    ${data.d[i]}  high ${f2(data.h[i]!)}  low ${f2(data.l[i]!)}  close ${f2(data.c[i]!)}` +
        `   ${m.isRoll[i] === 1 ? 'expiry' : 'feed dirt'}${off ? ', off-tick close' : ''}`,
    );
  }
  out.push('');
  for (const note of notes) out.push(`  note  ${note}`);
  for (const f of fails) out.push(`  FAIL  ${f}`);
  if (fails.length === 0) out.push('  all invariants hold');
  process.stdout.write(out.join('\n') + '\n');
  return fails.length === 0 ? 0 : 1;
}

// ---- tuning -------------------------------------------------------------

/**
 * `strength` and `minSwingAtr` are the only two dials in structure.ts and both
 * are judgement calls, so they get chosen against the whole 26-year series
 * rather than by eye on one chart. Read the columns as a trade-off: a low
 * strength finds every wiggle, a high one misses the swings a trader would
 * actually mark, and the pullback counts show whether H2 is still a common
 * enough setup to be worth a rule.
 */
function tune(): void {
  const median = (xs: number[]): number =>
    xs.length === 0 ? Number.NaN : xs.slice().sort((a, b) => a - b)[xs.length >> 1]!;

  const head =
    ['str', 'minATR', 'pivots', 'medATR', 'medBars', 'flips', 'medRun', 'whip%',
      'long%', 'short%', 'H1', 'H2', 'H3', 'H4+'].map((h, k) => pad(h, k === 0 ? 4 : 7)).join(' ');
  const lines = [head, '-'.repeat(head.length)];

  for (const strength of [1, 2, 3, 4, 5]) {
    for (const minSwingAtr of [0, 0.5, 1, 1.5, 2]) {
      const s = structure(m, { strength, minSwingAtr });
      const sizes = s.legs.map((g) => g.sizeAtr).filter(Number.isFinite);
      const bars = s.legs.map((g) => g.bars);
      let long = 0, short = 0;
      for (let i = 0; i < s.trend.length; i++) {
        if (s.trend[i] === 1) long++;
        else if (s.trend[i] === -1) short++;
      }
      const pb = [0, 0, 0, 0];
      for (let i = 0; i < s.pullback.length; i++) {
        const v = Math.abs(s.pullback[i]!);
        if (v > 0) pb[v - 1]!++;
      }
      // Whipsaw: how often the state changes, and how long it holds.
      const runs: number[] = [];
      let flips = 0;
      let runStart = 0;
      for (let i = 1; i < s.trend.length; i++) {
        if (s.trend[i] === s.trend[i - 1]) continue;
        flips++;
        runs.push(i - runStart);
        runStart = i;
      }

      // The failure mode worth measuring: a state that flips and flips back
      // inside two sessions never told anyone anything.
      //
      // A forward-return test was tried here and removed. Always-in-SHORT
      // scores the highest 10-session return on this series (+0.68% against
      // +0.20% long) because short states are drawdowns in a secular-bull
      // index and ES mean-reverts out of them. It measures drift, not the
      // detector, and picking parameters by it would optimise for the wrong
      // thing entirely.
      const whip = runs.length === 0
        ? 0
        : (runs.filter((r) => r <= 2).length / runs.length) * 100;

      const pct = (x: number): string => ((x / s.trend.length) * 100).toFixed(1);
      lines.push(
        [pad(String(strength), 4),
          pad(minSwingAtr.toFixed(1), 7),
          pad(String(s.pivots.length), 7),
          pad(median(sizes).toFixed(2), 7),
          pad(median(bars).toFixed(0), 7),
          pad(String(flips), 7),
          pad(median(runs).toFixed(0), 7),
          pad(whip.toFixed(1), 7),
          pad(pct(long), 7),
          pad(pct(short), 7),
          ...pb.map((v) => pad(String(v), 7)),
        ].join(' '),
      );
    }
    lines.push('');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

// ---- rules --------------------------------------------------------------

/** `--rule a,b,c` narrows to those ids; otherwise every rule runs, including
 *  the ones that ship off, because the report is where you look at them. */
function selectedRules(): Set<string> {
  const named = flag('rule');
  if (!named) return new Set(RULES.map((r) => r.id));
  const want = new Set(named.split(',').map((x) => x.trim()).filter(Boolean));
  for (const id of want) {
    if (!RULES.some((r) => r.id === id)) die(`no rule "${id}"`);
  }
  return want;
}

/**
 * Hit rate per rule over the whole series. This is the density check: a rule
 * firing on a third of all sessions cannot ship on by default, and the only
 * way to know which ones do is to count.
 */
function catalogue(): void {
  const ctx = buildCtx(data, structOpts);
  const on = new Set(defaultEnabled());
  const head = [padr('rule', 18), padr('group', 8), pad('marks', 7), pad('per yr', 8),
    pad('% bars', 8), padr('  default', 10)].join(' ');
  const lines = [head, '-'.repeat(head.length)];
  const years = data.d.length / 252;
  let shipped = 0;
  for (const rule of RULES) {
    const n = rule.detect(ctx).length;
    if (on.has(rule.id)) shipped += n;
    lines.push([
      padr(rule.id, 18), padr(rule.group, 8), pad(String(n), 7),
      pad((n / years).toFixed(0), 8),
      pad(((n / data.d.length) * 100).toFixed(1), 8),
      padr(on.has(rule.id) ? '  on' : '  off', 10),
    ].join(' '));
  }
  lines.push('-'.repeat(head.length));
  lines.push(`${padr('shipped on by default', 27)}${pad(String(shipped), 7)}` +
    `${pad((shipped / data.d.length).toFixed(2), 8)}   marks per bar`);
  process.stdout.write(lines.join('\n') + '\n');
}

/** Every detection in the window, one row each. */
function rules(rows: number[]): void {
  const ctx = buildCtx(data, structOpts);
  const want = selectedRules();
  const from = data.d[rows[0]!]!;
  const to = data.d[rows[rows.length - 1]!]!;
  const marks = detect(ctx, want).filter((mk) => mk.at >= from && mk.at <= to);

  const head = [padr('date', 12), padr('rule', 18), padr('label', 7), padr('tone', 9),
    padr('known', 12), 'note'].join(' ');
  const lines = [
    `${marks.length} marks from ${want.size} rules   ${from} -> ${to}`, '', head,
    '-'.repeat(head.length),
  ];
  for (const mk of marks) {
    lines.push([
      padr(mk.at, 12), padr(mk.rule, 18), padr(mk.label, 7), padr(mk.tone, 9),
      padr(mk.knownAt === mk.at ? 'at close' : mk.knownAt, 12), mk.note ?? '',
    ].join(' ').trimEnd());
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * The bar-by-bar reading — the text oracle for the words, not the numbers.
 *
 * The panel in the app renders exactly these strings, so a reading that reads
 * badly, repeats itself, or contradicts the columns is visible here without
 * opening the chart. Oldest first, unlike the panel: read left to right, which
 * is the direction the sentences were written to be read in.
 *
 * The marks are UNFILTERED on purpose, matching the app. `--rule` does not
 * apply: a bar says what it says whatever the reader has switched on.
 */
function read(rows: number[]): void {
  const ctx = buildCtx(data, structOpts);
  // Per ROW, not `readings(from, to)` over the endpoints. `--rolls` filters
  // `rows` down to the contract changes, and reading the span between the first
  // and the last printed 125 sessions where three were asked for — the filter
  // was silently discarded because only `rows[0]` and the last survived.
  const index = readingIndex(ctx, detect(ctx));
  const lines = rows.map((i) => readAt(ctx, index, i));
  const out = [
    `${lines.length} sessions   ${lines[0]?.at} -> ${lines[lines.length - 1]?.at}`,
    `structure at strength ${ctx.s.strength} / ${ctx.s.minSwingAtr} ATR; a swing pivot ` +
    `confirmed ${ctx.s.strength} sessions after the bar it names`,
    '',
  ];
  for (const line of lines) out.push(`${line.at}  ${line.text}`);

  // The two numbers worth watching while tuning the wording: a reading with no
  // clause but the body is thin, and one running past a terminal width has
  // stopped being a line.
  const longest = lines.reduce((w, l) => Math.max(w, l.text.length), 0);
  const bare = lines.filter((l) => l.patterns.length === 0 && !l.bar.includes(',')).length;
  out.push(
    '',
    `${pad(String(longest), 5)}   longest reading, in characters`,
    `${pad(String(bare), 5)}   readings carrying nothing but the bar's own body`,
  );
  process.stdout.write(out.join('\n') + '\n');
}

// ---- trades -------------------------------------------------------------

/**
 * Every entry the rules produced, with the walk-forward outcome.
 *
 * This is where a marking pass earns or loses trust. The plan is reconstructed
 * from the mark and handed back to the SAME `walkForward` the rule used, so
 * the table cannot flatter the rules by scoring them differently — and the
 * ambiguous column is printed rather than hidden, because a bar containing
 * both the stop and the target is the one case daily data cannot resolve.
 */
function trades(rows: number[]): void {
  const ctx = buildCtx(data, structOpts);
  const want = selectedRules();
  const indexOf = new Map(data.d.map((d, i) => [d, i]));
  const from = data.d[rows[0]!]!;
  const to = data.d[rows[rows.length - 1]!]!;

  const marks = detect(ctx, want)
    .filter((mk) => mk.kind === 'trade' && mk.at >= from && mk.at <= to);
  if (marks.length === 0) die('no entries in that range; try --rule second-entry or a wider window');

  const head = [padr('date', 12), padr('rule', 16), padr('dir', 6), pad('entry', 9), pad('stop', 9),
    pad('target', 9), pad('fill', 9), padr('  outcome', 10), pad('bars', 5), pad('R', 7)].join(' ');
  const lines = [`${marks.length} entries   ${from} -> ${to}`, '', head, '-'.repeat(head.length)];

  const byRule = new Map<string, { n: number; filled: number; wins: number; r: number; amb: number }>();
  for (const mk of marks) {
    if (mk.kind !== 'trade') continue;
    const plan: TradePlan = {
      dir: mk.dir, entry: mk.entry, stop: mk.stop, target: mk.target,
      risk: Math.abs(mk.entry - mk.stop),
    };
    // From `knownAt`, not `at`: that is the close at which the order could
    // have been placed, and for the three pivot-anchored rules it is three
    // bars after the signal. Walking from `at` here reproduced the rule's own
    // lookahead and made the table agree with a wrong note.
    const res = walkForward(ctx, plan, indexOf.get(mk.knownAt) ?? indexOf.get(mk.at)!);
    lines.push([
      padr(mk.at, 12), padr(mk.rule, 16), padr(mk.dir, 6),
      pad(f2(mk.entry), 9), pad(f2(mk.stop), 9), pad(f2(mk.target), 9),
      pad(res.fill === null ? '--' : f2(res.fill), 9),
      padr('  ' + res.outcome + (res.ambiguous ? '*' : ''), 10),
      pad(String(res.bars), 5), pad(res.r.toFixed(2), 7),
    ].join(' '));

    const agg = byRule.get(mk.rule) ?? { n: 0, filled: 0, wins: 0, r: 0, amb: 0 };
    agg.n++;
    if (res.outcome !== 'no fill') { agg.filled++; agg.r += res.r; }
    if (res.outcome === 'target') agg.wins++;
    if (res.ambiguous) agg.amb++;
    byRule.set(mk.rule, agg);
  }

  const sHead = [padr('rule', 16), pad('n', 6), pad('filled', 7), pad('target', 7),
    pad('win%', 7), pad('sum R', 8), pad('avg R', 7), pad('ambig', 6)].join(' ');
  lines.push('', sHead, '-'.repeat(sHead.length));
  for (const [rule, a] of [...byRule].sort((x, y) => y[1].n - x[1].n)) {
    lines.push([
      padr(rule, 16), pad(String(a.n), 6), pad(String(a.filled), 7), pad(String(a.wins), 7),
      pad(a.filled ? ((a.wins / a.filled) * 100).toFixed(0) : '--', 7),
      pad(a.r.toFixed(1), 8),
      pad(a.filled ? (a.r / a.filled).toFixed(3) : '--', 7),
      pad(String(a.amb), 6),
    ].join(' '));
  }
  lines.push('', '* the resolving bar contained both the stop and the target; scored as the stop.');
  process.stdout.write(lines.join('\n') + '\n');
}

// ---- regression fixture -------------------------------------------------

const GOLDEN = fileURLToPath(new URL('../data/marks-golden.json', import.meta.url));

interface Golden {
  dataset: { symbol: string; bars: number; last: string };
  /** The structure dials every count depends on. Recorded separately so that
   *  moving one reports itself, instead of surfacing as 31 count failures. */
  structure: { strength: number; minSwingAtr: number; pivots: number };
  counts: Record<string, number>;
  expect: { rule: string; at: string; why: string }[];
}

/**
 * Patterns chosen BY EYE from the pivot list before the rules that find them
 * were written, which is the only way a detector can be tested against
 * something other than itself. These dates are history and do not move, so
 * they are checked whatever dataset is loaded.
 */
const HAND_PICKED: Golden['expect'] = [
  { rule: 'double-top',    at: '2025-01-31', why: 'peaks 14.50 apart, neckline 5948.00' },
  { rule: 'double-top',    at: '2025-08-28', why: 'peaks 14.25 apart, neckline 6362.75' },
  { rule: 'double-bottom', at: '2025-02-03', why: 'troughs 12.50 apart' },
  { rule: 'double-bottom', at: '2025-08-01', why: 'troughs 1.50 apart' },
  { rule: 'wedge',         at: '2025-08-28', why: 'three pushes, +40 then +14' },
  { rule: 'bull-channel',  at: '2025-07-16', why: 'rising lows from April' },
  { rule: 'bear-channel',  at: '2025-04-10', why: 'falling highs from February' },
  { rule: 'triangle',      at: '2025-02-03', why: 'the Jan-Feb coil' },
];

function currentCounts(): Record<string, number> {
  const ctx = buildCtx(data, structOpts);
  const out: Record<string, number> = {};
  for (const rule of RULES) out[rule.id] = rule.detect(ctx).length;
  return out;
}

async function writeGolden(): Promise<void> {
  const n = data.d.length;
  const st = struct();
  const golden: Golden = {
    dataset: { symbol: data.symbol, bars: n, last: data.d[n - 1]! },
    structure: { strength: st.strength, minSwingAtr: st.minSwingAtr, pivots: st.pivots.length },
    counts: currentCounts(),
    expect: HAND_PICKED,
  };
  await writeFile(GOLDEN, JSON.stringify(golden, null, 2) + '\n', 'utf8');
  process.stdout.write(
    `wrote ${GOLDEN}${'\n'}  ${Object.keys(golden.counts).length} rule counts against ` +
    `${n} bars to ${golden.dataset.last}, ${golden.expect.length} hand-picked patterns,${'\n'}` +
    `  structure at strength ${golden.structure.strength} / ${golden.structure.minSwingAtr} ATR ` +
    `-> ${golden.structure.pivots} pivots${'\n'}`,
  );
}

/**
 * Compare against the fixture.
 *
 * Counts are only meaningful against the dataset they were taken from, so a
 * refreshed series reports the drift instead of failing — otherwise
 * `npm run data` would break the build for doing its job. The hand-picked
 * patterns are checked either way: they are historical.
 */
async function checkGolden(fails: string[], notes: string[]): Promise<void> {
  let golden: Golden;
  try {
    golden = JSON.parse(await readFile(GOLDEN, 'utf8')) as Golden;
  } catch {
    notes.push('no fixture yet — run `npm run marks -- --golden` to record one');
    return;
  }

  // The fixture is a DAILY fixture: its hand-picked patterns are dates in the
  // daily series and its counts are counts of daily bars. Run against an
  // intraday file it reported four failures that meant only "this is not that
  // dataset" — so say that instead, the same way a refreshed series reports
  // drift rather than failing.
  if (intervalOf(data) !== '1d') {
    notes.push(
      `fixture not compared: it holds the daily series, this file is ` +
      `${intervalOf(data)} (${data.d.length} bars to ${data.d[data.d.length - 1]})`,
    );
    return;
  }

  const ctx = buildCtx(data, structOpts);
  for (const want of golden.expect) {
    const rule = RULES.find((r) => r.id === want.rule);
    if (!rule) { fails.push(`fixture names rule "${want.rule}", which no longer exists`); continue; }
    if (!rule.detect(ctx).some((mk) => mk.at === want.at)) {
      fails.push(`${want.rule} no longer finds ${want.at} (${want.why})`);
    }
  }

  // Every rule reads the same pivots, so a moved dial shifts every count at
  // once. Saying so once beats 31 failures that all have one cause.
  const st = struct();
  const dials = golden.structure;
  if (dials !== undefined &&
      (dials.strength !== st.strength || dials.minSwingAtr !== st.minSwingAtr)) {
    fails.push(
      `structure dials moved: fixture is strength ${dials.strength} / ${dials.minSwingAtr} ATR ` +
      `(${dials.pivots} pivots), this run is ${st.strength} / ${st.minSwingAtr} ` +
      `(${st.pivots.length}). Every rule count depends on these; re-run --golden if deliberate.`,
    );
    return;
  }

  const n = data.d.length;
  if (golden.dataset.bars !== n || golden.dataset.last !== data.d[n - 1]) {
    notes.push(
      `counts not compared: fixture is ${golden.dataset.bars} bars to ${golden.dataset.last}, ` +
      `this dataset is ${n} to ${data.d[n - 1]}`,
    );
    return;
  }
  const now = currentCounts();
  for (const [id, was] of Object.entries(golden.counts)) {
    const is = now[id];
    if (is === undefined) fails.push(`rule "${id}" is in the fixture but not in the registry`);
    else if (is !== was) fails.push(`${id}: ${was} marks in the fixture, ${is} now`);
  }
  for (const id of Object.keys(now)) {
    if (!(id in golden.counts)) notes.push(`new rule "${id}" is not in the fixture yet`);
  }
}

// ---- run ----------------------------------------------------------------

if (has('golden')) { await writeGolden(); process.exit(0); }
if (has('check')) process.exit(await check());
if (has('tune')) { tune(); process.exit(0); }
if (has('catalogue')) { catalogue(); process.exit(0); }

const [lo, hi] = window();
const rows: number[] = [];
for (let i = lo; i <= hi; i++) {
  if (has('rolls') && m.isRoll[i] !== 1) continue;
  rows.push(i);
}
if (rows.length === 0) die('no sessions match');

if (has('read')) { read(rows); process.exit(0); }
if (has('rules')) { rules(rows); process.exit(0); }
if (has('trades')) { trades(rows); process.exit(0); }

const trend = rows.filter((i) => m.bodyPct[i]! >= 0.6).length;
const doji = rows.filter((i) => m.bodyPct[i]! <= 0.25).length;
const big = rows.filter((i) => m.rangeAtr[i]! >= 1.5).length;
const last = rows[rows.length - 1]!;

process.stdout.write(
  `${data.symbol}  ${data.name}\n` +
  `${rows.length} of ${data.d.length} sessions   ${data.d[rows[0]!]} -> ${data.d[last]}\n\n` +
  table(rows) + '\n\n' +
  `${padr('body >= 0.60', 17)}${pad(String(trend), 5)}   trend bars\n` +
  `${padr('body <= 0.25', 17)}${pad(String(doji), 5)}   doji\n` +
  `${padr('range >= 1.5 ATR', 17)}${pad(String(big), 5)}   big bars\n` +
  `${padr('ATR at close', 17)}${pad(f2(m.atr[last]!), 5)}\n`,
);
