/**
 * The palette's regression guard: the three-scope invariant, and contrast.
 *
 * Two classes of fault live in tokens.css and NEITHER shows up as an error.
 *
 * SCOPES. Every theme token is declared three times — bare `:root`, the
 * `prefers-color-scheme: dark` media query, and `:root[data-theme="dark"]`.
 * Miss one and the in-app toggle and the OS setting disagree, on that one
 * colour, in one of the three viewer states. Nothing renders wrong in the state
 * the author happened to be in. This was not a hypothetical: adding
 * `--muted-text` put it in the media block TWICE and in the attribute block not
 * at all, because a two-space pattern matched inside a four-space line, and the
 * retry hit the second trap below.
 *
 * CONTRAST. A mark needs 3:1 against what it sits on and text needs 4.5:1 —
 * which is why `--up` / `--up-text`, `--ema` / `--ema-text` and `--muted` /
 * `--muted-text` are three separate splits. A colour that drifts under its bar
 * is legible to whoever picked it and not to everyone else, and no typechecker,
 * linter or smoke test has an opinion about it.
 *
 * THE GROUND MATTERS AS MUCH AS THE COLOUR, which is the part that is easy to
 * get wrong. `--down-text` was 4.68:1 on the card surface and 4.27:1 on the
 * page plane, and the masthead's session-change figure sits on the plane with
 * no card behind it — visible only on a DOWN session, which the shipped
 * snapshot's last bar was not. So each token declares the grounds it actually
 * appears on, and every one is checked.
 *
 * NO TOKEN MAY BE SILENTLY UNCLASSIFIED. A hex token missing from ROLES fails
 * the run, so adding a colour forces the decision "is this text, a mark, or
 * exempt" rather than letting it default to unmeasured.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../src/renderer/styles/tokens.css', import.meta.url));

/**
 * The grounds a colour can sit on.
 *
 * `focus` is one of them, and leaving it out was this script's own blind spot.
 * The model only ever paired a token with the three PAGE grounds, so a token
 * used as a background for something else was never a ground — and the
 * marking pane's selected-tab count chip is 10.5px `--surface` text on a
 * `--focus` fill, which measured 4.30:1 in light while this file reported
 * "every token clears the bar it is used at". Any token that paints a
 * background for text belongs here.
 */
type Ground = 'plane' | 'surface' | 'surface-2' | 'focus';

/** What a token is used AS, which is what decides its threshold. */
type Role =
  | { need: 'text'; on: readonly Ground[] }
  | { need: 'mark'; on: readonly Ground[] }
  | { need: 'exempt'; why: string };

const TEXT = 4.5;
const MARK = 3;

/**
 * Which token is used as what, and against what.
 *
 * Authored, because "is this text" is a fact about the components and not about
 * the CSS file. The grounds were MEASURED rather than guessed: a probe walked
 * every text element in the built artifact, resolved the first ancestor that
 * actually paints, and reported the real pairings in both themes. Re-measure
 * the same way if a component moves onto a new surface.
 */
const ROLES: Readonly<Record<string, Role>> = {
  // --- text ---------------------------------------------------------------
  ink: { need: 'text', on: ['plane', 'surface'] },
  'ink-2': { need: 'text', on: ['plane', 'surface', 'surface-2'] },
  'muted-text': { need: 'text', on: ['plane', 'surface', 'surface-2'] },
  'up-text': { need: 'text', on: ['plane', 'surface'] },
  // The plane is the masthead's change figure, which has no card behind it.
  'down-text': { need: 'text', on: ['plane', 'surface', 'surface-2'] },
  'ema-text': { need: 'text', on: ['surface'] },

  // --- marks: candles, arrows, mark strokes, focus rings ------------------
  up: { need: 'mark', on: ['surface'] },
  down: { need: 'mark', on: ['surface'] },
  ema: { need: 'mark', on: ['surface'] },
  muted: { need: 'mark', on: ['surface'] },
  focus: { need: 'mark', on: ['plane', 'surface'] },

  // A ground almost everywhere, and TEXT on one thing: the marking pane's
  // selected-tab count chip inverts, painting `--surface` on a `--focus` fill.
  // Both roles are real and this is the one that has a threshold.
  surface: { need: 'text', on: ['focus'] },

  // --- deliberately unmeasured -------------------------------------------
  plane: { need: 'exempt', why: 'a ground, not a foreground' },
  'surface-2': { need: 'exempt', why: 'a ground, not a foreground' },
  grid: { need: 'exempt', why: 'the horizontal rules behind the candles — decorative' },
  axis: { need: 'exempt', why: 'hairline borders and the crosshair; ~1.5:1 by design' },
};

// ---- parse ---------------------------------------------------------------

/**
 * Comments FIRST. The header comment names `:root[data-theme="dark"]` in prose,
 * so an indexOf for the selector finds the SENTENCE and reads the light block
 * instead — which silently reports the light palette as the dark one. Two
 * separate scripts fell into this before it was written down.
 */
const css = (await readFile(FILE, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

interface Scope {
  readonly label: string;
  readonly tokens: Readonly<Record<string, string>>;
}

function scopeAt(label: string, anchor: string): Scope {
  const start = css.indexOf(anchor);
  if (start < 0) die(`the ${label} scope is missing: no ${anchor}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start, end < 0 ? css.length : end);
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[m[1]!] = m[2]!.trim();
  }
  return { label, tokens };
}

const failures: string[] = [];
const fail = (message: string): void => { failures.push(message); };

function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

const light = scopeAt(':root', ':root {');
const mediaDark = scopeAt('prefers-color-scheme: dark', ':root:not([data-theme="light"]) {');
const attrDark = scopeAt('[data-theme="dark"]', ':root[data-theme="dark"] {');

// ---- the three-scope invariant -------------------------------------------

const isColour = (v: string): boolean => v.startsWith('#') || v.startsWith('rgb');
const names = (s: Scope): string[] => Object.keys(s.tokens).sort();

// 1. the two dark scopes must be the same set with the same values
for (const name of names(mediaDark)) {
  if (!(name in attrDark.tokens)) fail(`--${name} is in the media query but not in [data-theme="dark"]`);
  else if (attrDark.tokens[name] !== mediaDark.tokens[name]) {
    fail(`--${name} disagrees between the dark scopes: media ${mediaDark.tokens[name]}, attribute ${attrDark.tokens[name]}`);
  }
}
for (const name of names(attrDark)) {
  if (!(name in mediaDark.tokens)) fail(`--${name} is in [data-theme="dark"] but not in the media query`);
}

// 2. nothing may exist only in the dark, or it is undefined in light
for (const name of new Set([...names(mediaDark), ...names(attrDark)])) {
  if (!(name in light.tokens)) fail(`--${name} is defined dark but never in :root, so it is undefined in light`);
}

// 3. every COLOUR in :root must be redefined dark, or the light value carries over
for (const name of names(light)) {
  const value = light.tokens[name]!;
  if (!isColour(value)) continue;
  if (!(name in mediaDark.tokens)) fail(`--${name} is a colour but is never redefined for dark — the light value carries over`);
}

// ---- contrast -------------------------------------------------------------

const hex = (v: string): string | null => (/^#[0-9a-f]{6}$/i.test(v) ? v : null);

const channel = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(colour.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Row {
  readonly token: string;
  readonly need: number;
  readonly ground: Ground;
  readonly ratio: number;
}

function audit(theme: string, scope: Scope): Row[] {
  const worst: Row[] = [];
  for (const name of names(scope)) {
    const value = hex(scope.tokens[name]!);
    if (value === null) continue;                 // rgb() hairlines, shadows, fonts

    const role = ROLES[name];
    if (role === undefined) {
      fail(`--${name} is a colour with no entry in ROLES — classify it as text, a mark, or exempt`);
      continue;
    }
    if (role.need === 'exempt') continue;

    const need = role.need === 'text' ? TEXT : MARK;
    let low: Row | null = null;
    for (const ground of role.on) {
      const bg = hex(scope.tokens[ground] ?? '');
      if (bg === null) { fail(`--${ground} is not a hex colour in the ${theme} scope`); continue; }
      const ratio = contrast(value, bg);
      if (low === null || ratio < low.ratio) low = { token: name, need, ground, ratio };
    }
    if (low === null) continue;
    worst.push(low);
    if (low.ratio < need) {
      fail(
        `${theme}: --${low.token} ${value} is ${low.ratio.toFixed(2)}:1 on --${low.ground} ` +
        `${scope.tokens[low.ground]}, and it is used as ${role.need} which needs ${need}:1`,
      );
    }
  }
  return worst;
}

// ---- report ---------------------------------------------------------------

const colours = names(light).filter((n) => hex(light.tokens[n]!) !== null).length;
process.stdout.write(
  `tokens.css   ${colours} hex tokens, 3 scopes, ` +
  `${Object.values(ROLES).filter((r) => r.need !== 'exempt').length} measured\n\n`,
);

for (const [theme, scope] of [['light', light], ['dark', attrDark]] as const) {
  process.stdout.write(`  ${theme}\n`);
  const rows = audit(theme, scope).sort((a, b) => a.ratio - b.ratio);
  for (const r of rows) {
    const ok = r.ratio >= r.need;
    process.stdout.write(
      `    ${('--' + r.token).padEnd(13)} ${(scope.tokens[r.token] ?? '').padEnd(9)}` +
      `${r.ratio.toFixed(2).padStart(6)}:1 on --${r.ground.padEnd(10)}` +
      `needs ${r.need.toFixed(1)}  ${ok ? 'ok' : 'SHORT'}\n`,
    );
  }
  process.stdout.write('\n');
}

if (failures.length > 0) {
  for (const why of failures) process.stderr.write(`  FAIL ${why}\n`);
  process.stderr.write(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}.\n`);
  process.exit(1);
}
process.stdout.write('  scopes agree, and every token clears the bar it is used at\n');
