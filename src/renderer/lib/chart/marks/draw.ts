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
import { FILL_ALPHA, MARK_ALPHA, type MarkStyle } from './palette.ts';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Shape {
  /** Stroked. */
  readonly lines: readonly (readonly Pt[])[];
  /** Filled at low alpha, then not stroked. */
  readonly fills: readonly (readonly Pt[])[];
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

export function shapeOf(mark: GeometryMark, space: Space): Shape | null {
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
      const x0 = space.xAt(i0);
      const x1 = space.xAt(i1);
      const yEntry = space.y(mark.entry);
      const yStop = space.y(mark.stop);
      const yTarget = space.y(mark.target);
      if (x0 === null || x1 === null || yEntry === null || yStop === null || yTarget === null) {
        return null;
      }
      const box = (yTop: number, yBottom: number): Pt[] => [
        { x: x0, y: yTop }, { x: x1, y: yTop }, { x: x1, y: yBottom }, { x: x0, y: yBottom },
      ];
      return {
        lines: [
          [{ x: x0, y: yEntry }, { x: x1, y: yEntry }],
          [{ x: x0, y: yTarget }, { x: x1, y: yTarget }],
        ],
        fills: [box(yEntry, yStop)],
      };
    }
  }
}

/**
 * Stroke and fill one shape.
 *
 * Coordinates arrive in CSS pixels and are scaled here, because a 1.5px line
 * drawn in media space on a 2x display lands between device pixels and reads
 * as a smudge next to the candles, which the library draws in bitmap space.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  style: MarkStyle,
  hx: number,
  hy: number,
  width = 1.5,
): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = width * hy;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.globalAlpha = FILL_ALPHA;
  for (const poly of shape.fills) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x * hx, poly[0]!.y * hy);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k]!.x * hx, poly[k]!.y * hy);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = MARK_ALPHA;
  ctx.setLineDash(style.dash.map((v) => v * hx));
  for (const poly of shape.lines) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x * hx, poly[0]!.y * hy);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k]!.x * hx, poly[k]!.y * hy);
    ctx.stroke();
  }
  ctx.restore();
}

/** Shortest distance in CSS pixels from a point to any segment in the shape.
 *  The hit test and the renderer therefore agree by construction. */
export function distanceTo(shape: Shape, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const poly of shape.lines) {
    for (let k = 1; k < poly.length; k++) {
      best = Math.min(best, pointToSegment(x, y, poly[k - 1]!, poly[k]!));
    }
  }
  return best;
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
