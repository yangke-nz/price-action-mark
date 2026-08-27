/** The chart is the one thing on the page that cannot be styled with CSS, so
 *  it reads the same custom properties everything else does. The palette stays
 *  defined once, in styles/tokens.css, and is never restated in JavaScript. */

export interface ChartTokens {
  up: string;
  down: string;
  ema: string;
  grid: string;
  axis: string;
  muted: string;
  ink: string;
  ink2: string;
  surface: string;
  mono: string;
}

export function readTokens(root: HTMLElement = document.documentElement): ChartTokens {
  const cs = getComputedStyle(root);
  const g = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    up: g('--up'),
    down: g('--down'),
    ema: g('--ema'),
    grid: g('--grid'),
    axis: g('--axis'),
    muted: g('--muted'),
    ink: g('--ink'),
    ink2: g('--ink-2'),
    surface: g('--surface'),
    mono: g('--mono') || 'ui-monospace, monospace',
  };
}
