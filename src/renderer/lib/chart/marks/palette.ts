/**
 * Mark tone -> the colour and stroke the renderer uses.
 *
 * No new colour tokens. `--up` and `--down` were already measured to hold
 * dE 7.8 apart under simulated protanopia and to clear 3:1 against both
 * surfaces; a mark reusing them says the same thing as a candle of that
 * direction, which is the point. A fourth hue for `caution` would have to be
 * re-measured against the other three under two simulations to earn its place,
 * so caution draws in the neutral tone and DASHED instead — shape carrying the
 * meaning, the same argument the candle legend makes.
 *
 * Marks are also drawn subordinate to the candles: they are annotation over
 * data, not data. That is one alpha applied by the renderer rather than a set
 * of pre-faded colour tokens, so the palette stays defined once in
 * tokens.css and a theme change needs no second table.
 */
import type { Tone } from '../../../../shared/marks/types.ts';
import { readTokens, type ChartTokens } from '../tokens.ts';

/** Annotation over data. Loud enough to read, quiet enough to look through. */
export const MARK_ALPHA = 0.75;
/**
 * The band inside a channel, and the box between entry and stop.
 *
 * Raised from 0.1 after looking at it: a channel band spans dozens of bars and
 * reads fine that faint, but a trade's risk box is one bar wide and simply
 * vanished against the candles. This is the level at which the narrow one is
 * visible without the wide one turning into a slab.
 */
export const FILL_ALPHA = 0.18;

export interface MarkStyle {
  readonly color: string;
  /** Empty for a solid line; a canvas dash pattern otherwise, in CSS pixels. */
  readonly dash: readonly number[];
}

export function styleFor(tone: Tone, t: ChartTokens = readTokens()): MarkStyle {
  switch (tone) {
    case 'bull':    return { color: t.up, dash: [] };
    case 'bear':    return { color: t.down, dash: [] };
    case 'caution': return { color: t.muted, dash: [5, 4] };
    case 'neutral': return { color: t.muted, dash: [] };
  }
}
