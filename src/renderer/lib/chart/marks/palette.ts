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
 * The band inside a channel, and the band on an entry's price.
 *
 * It was 0.1, then 0.18, and it is 0.1 again — and the round trip is the note
 * worth keeping, because the reason for the middle number no longer exists.
 * 0.1 was raised to 0.18 because a trade's box was one bar wide and simply
 * VANISHED at that alpha, while a channel band spanning dozens of bars read
 * fine. The entry band is stroked as well as filled now (see the `trade` case
 * in draw.ts, and the hit test, which measures `lines` and never a fill), so
 * the narrow mark no longer depends on its fill to exist — and the wide one is
 * what the fill was always too strong for.
 *
 * A channel band covers about a third of the pane at the zoom a reader marks
 * up at, and the whole of it when they zoom in; a fill is annotation over the
 * candles, and at this level the candles under it stay the thing being read.
 * A one-bar entry band is a stroked box that happens to be tinted.
 */
export const FILL_ALPHA = 0.1;

/**
 * The selected mark — the one the reader clicked in the mark list.
 *
 * Emphasis is WEIGHT and OPACITY, not a colour: a selection colour would say
 * something about the mark itself, and tone already owns that channel. So the
 * selected mark keeps its own hue and is drawn heavier, at full strength, with
 * a wide translucent halo underneath. The halo is what makes it findable among
 * a hundred other marks in the same two hues — line width alone is not
 * distinguishable at a glance across a 1,500px chart.
 *
 * The FILL is deliberately left at FILL_ALPHA. Raising it was tried, at 0.32,
 * and a selected channel at 1M — where one channel spans all 24 visible bars —
 * became a green slab over the candles: the exact failure the FILL_ALPHA note
 * above describes, reintroduced. Emphasis goes on the rails, which are one to
 * eight pixels wide whatever the mark's span, never on an area that grows with
 * the zoom.
 */
export const SELECTED_WIDTH = 2.5;
export const SELECTED_HALO_WIDTH = 8;
export const SELECTED_HALO_ALPHA = 0.3;

/**
 * A one-session-wide vertical band at the selected mark's anchor.
 *
 * This is what makes the highlight work for the marks emphasis alone cannot
 * reach. A BAR mark is a series marker, and the only channel a marker offers
 * is its size — growing it was tried and it MOVED THE PRICE SCALE: an
 * `aboveBar` marker reserves vertical space, so selecting a mark near the
 * visible high re-scaled the pane and shifted every candle under the reader.
 * A `trade` mark whose trade never filled has `through === at`, so its box and
 * both its lines collapse to zero width and there is nothing to thicken.
 *
 * The band is drawn by the primitive, whose `autoscaleInfo()` returns null, so
 * it cannot disturb the scale however tall it is. It also answers the question
 * the reader actually asked — *where* is this mark — for a channel spanning a
 * hundred bars, where emphasised rails say "here and here" but not "anchored
 * there". Kept faint: it is a pointer, not a highlight over the candles.
 */
export const SELECTED_BAND_ALPHA = 0.16;

/**
 * The bar the reader clicked in the bar-reading list.
 *
 * Deliberately NOT a tone. The mark band above borrows its mark's hue because
 * the mark has a direction to state; a session does not, and painting the
 * clicked bar green would say "this bar is bullish" when the reader only
 * asked "where is this line". So it draws in `--focus`, the colour every other
 * picked thing in the UI already uses — the mark list's picked row, every
 * focus ring — and the two bands stay tellable apart when both are showing.
 *
 * Slightly stronger than the mark band, and a FILL AND NOTHING ELSE. It had a
 * one-pixel rail down each edge at 0.85, which was the loudest thing either
 * band drew and the reason the highlight read as heavy; asked to take the
 * opacity down, the rails are what came off. What they bought is written down
 * rather than lost: at MAX zoom one session is a fraction of a pixel wide, the
 * band is clamped to BAND_MIN_PX, and the rails were what located it there —
 * so if a five-pixel tint turns out to be too little to find, widen the clamp
 * before putting a 0.85 line back over the candles.
 */
export const FOCUS_BAND_ALPHA = 0.22;

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
