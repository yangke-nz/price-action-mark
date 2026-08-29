/**
 * Marks -> polylines in CSS pixels, and polylines -> canvas.
 *
 * Split in two on purpose. Hit-testing has to agree with what was drawn to the
 * pixel, and the only way to guarantee that is for both to consume the same
 * geometry; a second implementation of "where is this line" drifts from the
 * first the day someone changes a projection. So `shapeOf` is pure, knows
 * nothing about a canvas, and is what both the renderer and the hit test read.
 *
 * Projections work in LOGICAL space, not time. `timeToCoordinate` returns null
 * for anything past the last bar, which is exactly where an extended trendline
 * needs to go, so a date is turned into a bar index once and the line is
 * evaluated against `logicalToCoordinate`.
 */
import type { GeometryMark } from '../../../../shared/marks/types.ts';
import {
  FILL_ALPHA,
  FOCUS_BAND_ALPHA,
  FOCUS_RAIL_ALPHA,
  FOCUS_RAIL_WIDTH,
  MARK_ALPHA,
  SELECTED_BAND_ALPHA,
  SELECTED_HALO_ALPHA,
  SELECTED_HALO_WIDTH,
  SELECTED_WIDTH,
  type MarkStyle,
} from './palette.ts';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Shape {
  /** Stroked. */
  readonly lines: readonly (readonly Pt[])[];
  /** Filled at low alpha, then not stroked. */
  readonly fills: readonly (readonly Pt[])[];
  /**
   * Stroked DASHED whatever the tone says, and measured by the hit test like
   * any other line.
   *
   * One shape, two registers. An entry's band is the mark; its stop and target
   * rails are a second statement about it that the reader can switch off, so
   * they have to be tellable apart from the band at a glance — and shape is
   * the channel this project uses for that, the same argument `caution` makes
   * for being dashed rather than a fourth hue. A caution-toned mark would dash
   * its solid lines too and the two registers would stop being
   * distinguishable; unreachable today, because a trade's tone is its
   * direction.
   */
  readonly dashed?: readonly (readonly Pt[])[];
}

/**
 * How thick an entry's band is, as a share of the trade's risk.
 *
 * The band marks the ENTRY, which is one price — and a line at one price is a
 * line, not a box, so the box needs a thickness that means something. A
 * quarter of the risk is small enough to read as a band on the entry rather
 * than as a second risk box, and it is in PRICE rather than pixels, so it
 * holds that meaning at every zoom instead of swelling into the candles.
 */
const BAND_SHARE = 0.25;

/** A rail is a number the mark is about, not the mark: dashed, and thinner. */
const RAIL_DASH = [5, 4];
const RAIL_WIDTH_SHARE = 0.8;

/** What the reader has switched on, for the shapes that offer a choice. */
export interface ShapeOptions {
  /** Draw an entry's stop and target rails. See `MarkSettings.stopTarget`. */
  readonly stopTarget?: boolean;
}

/** Everything `shapeOf` is allowed to ask the chart. */
export interface Space {
  /** Bar index of a session, or undefined if that date is not one. */
  index(d: string): number | undefined;
  /** Bar index -> x in CSS pixels. Defined beyond the last bar. */
  xAt(logical: number): number | null;
  /** Price -> y in CSS pixels. */
  y(price: number): number | null;
  /** Rightmost visible bar index, where an extended line is cut off. */
  readonly rightEdge: number;
}

function pt(x: number | null, y: number | null): Pt | null {
  return x === null || y === null ? null : { x, y };
}

/** Price at `logical` on the line through the two anchors, extrapolated. */
function priceAt(i0: number, p0: number, i1: number, p1: number, logical: number): number {
  if (i1 === i0) return p1;
  return p0 + ((p1 - p0) / (i1 - i0)) * (logical - i0);
}

export function shapeOf(
  mark: GeometryMark,
  space: Space,
  opts: ShapeOptions = {},
): Shape | null {
  switch (mark.kind) {
    case 'segment':
    case 'channel': {
      const i0 = space.index(mark.from.d);
      const i1 = space.index(mark.to.d);
      if (i0 === undefined || i1 === undefined) return null;
      const end = mark.extend ? Math.max(i1, space.rightEdge) : i1;
      const endPrice = priceAt(i0, mark.from.price, i1, mark.to.price, end);

      const a = pt(space.xAt(i0), space.y(mark.from.price));
      const b = pt(space.xAt(end), space.y(endPrice));
      if (!a || !b) return null;
      if (mark.kind === 'segment') return { lines: [[a, b]], fills: [] };

      const c = pt(space.xAt(i0), space.y(mark.from.price + mark.offset));
      const d = pt(space.xAt(end), space.y(endPrice + mark.offset));
      if (!c || !d) return null;
      // The band is filled and the two rails stroked; a filled band alone
      // loses its edges against the candles at low alpha.
      return { lines: [[a, b], [c, d]], fills: [[a, b, d, c]] };
    }

    case 'level': {
      const i0 = space.index(mark.fromD);
      const i1 = space.index(mark.toD);
      if (i0 === undefined || i1 === undefined) return null;
      const a = pt(space.xAt(i0), space.y(mark.price));
      const b = pt(space.xAt(i1), space.y(mark.price));
      return a && b ? { lines: [[a, b]], fills: [] } : null;
    }

    case 'path': {
      const points: Pt[] = [];
      for (const p of mark.points) {
        const i = space.index(p.d);
        if (i === undefined) return null;
        const q = pt(space.xAt(i), space.y(p.price));
        if (!q) return null;
        points.push(q);
      }
      return points.length >= 2 ? { lines: [points], fills: [] } : null;
    }

    case 'trade': {
      const i0 = space.index(mark.at);
      const i1 = space.index(mark.through);
      if (i0 === undefined || i1 === undefined) return null;
      // Half a bar out at each end, unlike every other shape here, which runs
      // centre to centre. The band says the order was live over these
      // SESSIONS, and a session is a bar wide rather than a point — and 573 of
      // the 1,655 entries in the series resolve on the very next bar, so
      // centre to centre would leave those one bar spacing of thin band.
      //
      // Measured from two integer indices, NOT by asking for `i - 0.5`.
      // `logicalToCoordinate` takes a fractional logical without complaining
      // and answers nonsense for one: every band collapsed to a few pixels at
      // the pane's left edge — 170 lit pixels in canvas column 0 for ten marks
      // that should have covered a thousand. It fails silently, which is the
      // whole reason this note is here.
      const a = space.xAt(i0);
      const b = space.xAt(i1);
      const next = space.xAt(i0 + 1);
      if (a === null || b === null) return null;
      const halfBar = next === null ? 0 : Math.abs(next - a) / 2;
      const x0: number | null = a - halfBar;
      const x1: number | null = b + halfBar;
      const half = Math.abs(mark.entry - mark.stop) * BAND_SHARE * 0.5;
      const yTop = space.y(mark.entry + half);
      const yBottom = space.y(mark.entry - half);
      const yStop = space.y(mark.stop);
      const yTarget = space.y(mark.target);
      if (x0 === null || x1 === null || yTop === null || yBottom === null) return null;

      // The band is BOTH stroked and filled. A one-bar entry is a few pixels
      // of box, where a fill at FILL_ALPHA alone is invisible — and unclickable
      // as well, since the hit test measures `lines` and never a fill.
      const band: Pt[] = [
        { x: x0, y: yTop }, { x: x1, y: yTop },
        { x: x1, y: yBottom }, { x: x0, y: yBottom }, { x: x0, y: yTop },
      ];
      const rails: Pt[][] = [];
      if (opts.stopTarget !== false) {
        // One rail is dropped rather than the whole mark when its price is off
        // the scale: `autoscaleInfo()` returns null on purpose and the
        // measured-move targets reach 21x the risk, so a target below the
        // visible low is ordinary here rather than exceptional.
        if (yStop !== null) rails.push([{ x: x0, y: yStop }, { x: x1, y: yStop }]);
        if (yTarget !== null) rails.push([{ x: x0, y: yTarget }, { x: x1, y: yTarget }]);
      }
      return { lines: [band], fills: [band], dashed: rails };
    }
  }
}

/** Trace one polyline. Shared so the halo pass and the line pass cannot
 *  disagree about the path they are stroking. */
function trace(ctx: CanvasRenderingContext2D, poly: readonly Pt[], hx: number, hy: number): void {
  ctx.beginPath();
  ctx.moveTo(poly[0]!.x * hx, poly[0]!.y * hy);
  for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k]!.x * hx, poly[k]!.y * hy);
}

/**
 * Stroke and fill one shape.
 *
 * Coordinates arrive in CSS pixels and are scaled here, because a 1.5px line
 * drawn in media space on a 2x display lands between device pixels and reads
 * as a smudge next to the candles, which the library draws in bitmap space.
 *
 * `selected` is the mark the reader clicked in the list. It is drawn in the
 * same colour and gains a halo, extra width and full opacity on its LINES only
 * — see the note in palette.ts for why emphasis is weight rather than hue, and
 * why the fill is left alone. The halo is stroked WITHOUT the dash pattern: a
 * dashed halo behind a dashed line reads as two misaligned dashed lines rather
 * than as one emphasised one.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  style: MarkStyle,
  hx: number,
  hy: number,
  selected = false,
): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Not raised for the selection: see the note in palette.ts — a channel's
  // band grows with the zoom, so emphasising it swamps the candles.
  ctx.globalAlpha = FILL_ALPHA;
  for (const poly of shape.fills) {
    if (poly.length < 3) continue;
    trace(ctx, poly, hx, hy);
    ctx.closePath();
    ctx.fill();
  }

  if (selected) {
    ctx.globalAlpha = SELECTED_HALO_ALPHA;
    ctx.lineWidth = SELECTED_HALO_WIDTH * hy;
    ctx.setLineDash([]);
    for (const poly of [...shape.lines, ...(shape.dashed ?? [])]) {
      if (poly.length < 2) continue;
      trace(ctx, poly, hx, hy);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = selected ? 1 : MARK_ALPHA;
  ctx.lineWidth = (selected ? SELECTED_WIDTH : 1.5) * hy;
  ctx.setLineDash(style.dash.map((v) => v * hx));
  for (const poly of shape.lines) {
    if (poly.length < 2) continue;
    trace(ctx, poly, hx, hy);
    ctx.stroke();
  }

  // The second register, drawn after the mark it qualifies.
  if (shape.dashed !== undefined && shape.dashed.length > 0) {
    ctx.setLineDash(RAIL_DASH.map((v) => v * hx));
    ctx.lineWidth = (selected ? SELECTED_WIDTH : 1.5) * RAIL_WIDTH_SHARE * hy;
    for (const poly of shape.dashed) {
      if (poly.length < 2) continue;
      trace(ctx, poly, hx, hy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * The vertical band at the selected mark's anchor session.
 *
 * Deliberately NOT part of `Shape`: the hit test measures against shapes, and
 * a full-height band would make a whole column of the chart report a hit on
 * that one mark. It is decoration for the selection only, so it is painted
 * separately and nothing measures against it.
 */
export function paintAnchorBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  halfWidth: number,
  height: number,
  style: MarkStyle,
  hx: number,
  hy: number,
): void {
  ctx.save();
  ctx.globalAlpha = SELECTED_BAND_ALPHA;
  ctx.fillStyle = style.color;
  ctx.fillRect((x - halfWidth) * hx, 0, halfWidth * 2 * hx, height * hy);
  ctx.restore();
}

/**
 * The session the reader clicked in the bar-reading list.
 *
 * Same geometry as the anchor band and a separate function anyway: this one
 * takes a colour rather than a MarkStyle, because a bar has no tone to lend it
 * (see FOCUS_BAND_ALPHA), and it adds the two rails that make one session
 * findable at a zoom where the fill is a few pixels of near-transparent blue.
 *
 * Full height by construction. The primitive's `autoscaleInfo()` returns null,
 * so nothing this draws can reach the price scale however tall it is — which
 * is exactly why the highlight is a band and not a bigger marker: growing a
 * marker re-scaled the pane and shifted every candle.
 */
export function paintFocusBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  halfWidth: number,
  height: number,
  color: string,
  hx: number,
  hy: number,
): void {
  const left = (x - halfWidth) * hx;
  const width = halfWidth * 2 * hx;
  const bottom = height * hy;
  ctx.save();
  ctx.globalAlpha = FOCUS_BAND_ALPHA;
  ctx.fillStyle = color;
  ctx.fillRect(left, 0, width, bottom);
  ctx.globalAlpha = FOCUS_RAIL_ALPHA;
  ctx.fillRect(left, 0, FOCUS_RAIL_WIDTH * hx, bottom);
  ctx.fillRect(left + width - FOCUS_RAIL_WIDTH * hx, 0, FOCUS_RAIL_WIDTH * hx, bottom);
  ctx.restore();
}

/**
 * Shortest distance in CSS pixels from a point to any segment in the shape.
 * The hit test and the renderer therefore agree by construction — the dashed
 * rails included, because they belong to the mark: clicking an entry's stop
 * should find that entry, and when the reader switches the rails off they are
 * not in the shape to be found. The gaps in a dash are not holes in the hit
 * test either; the polyline is measured whole, which is what someone aiming at
 * a dashed line means by it.
 */
export function distanceTo(shape: Shape, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const poly of [...shape.lines, ...(shape.dashed ?? [])]) {
    // A CLOSED polyline is a region, and its inside counts as a hit. Only an
    // entry's band closes today, and it has to: a band is about 14px tall at a
    // 6M viewport, so its centre — the entry price, the exact thing the reader
    // is aiming at — sits 7px from either edge and would MISS a 6px slop.
    // Deliberately not the same rule for `fills`: a channel's band spans a
    // hundred bars, and an interior at distance 0 always beats a nearby line,
    // so filling that in would make one channel swallow every click inside it.
    if (isClosed(poly) && inside(poly, x, y)) return 0;
    for (let k = 1; k < poly.length; k++) {
      best = Math.min(best, pointToSegment(x, y, poly[k - 1]!, poly[k]!));
    }
  }
  return best;
}

function isClosed(poly: readonly Pt[]): boolean {
  if (poly.length < 4) return false;
  const a = poly[0]!;
  const b = poly[poly.length - 1]!;
  return a.x === b.x && a.y === b.y;
}

/** Even-odd ray cast. The polygons here are rectangles; this is general
 *  because the next closed shape may not be. */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > y) === (b.y > y)) continue;
    if (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function pointToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
