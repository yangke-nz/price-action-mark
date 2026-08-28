/**
 * Line fitting for the shape rules.
 *
 * Channel, wedge and triangle are the same two moves — fit a line through some
 * pivots, then ask something about the result — and differ only in which
 * pivots they feed it and what they demand of the two slopes. Keeping the
 * fitting here means the tolerance, the touch test and the break test have one
 * definition, so tightening a channel cannot silently change what counts as a
 * triangle.
 *
 * Everything works in (bar index, price). Not dates, because a line has to be
 * evaluated between and beyond its anchors; not pixels, because a rule must
 * produce the same answer at every zoom.
 */
import type { Metrics } from './metrics.ts';

export interface Point {
  readonly i: number;
  readonly price: number;
}

export interface Line {
  /** Price per bar. */
  readonly slope: number;
  /** Price at bar 0. */
  readonly intercept: number;
}

export function lineThrough(a: Point, b: Point): Line {
  const slope = a.i === b.i ? 0 : (b.price - a.price) / (b.i - a.i);
  return { slope, intercept: a.price - slope * a.i };
}

/** Ordinary least squares. Returns null for fewer than two distinct bars. */
export function fitLine(points: readonly Point[]): Line | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.i; sy += p.price; }
  const mx = sx / n;
  const my = sy / n;
  let num = 0, den = 0;
  for (const p of points) {
    const dx = p.i - mx;
    num += dx * (p.price - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

export function priceOn(line: Line, i: number): number {
  return line.intercept + line.slope * i;
}

export interface Quality {
  /** Bars whose extreme came within tolerance of the line. */
  readonly touches: number;
  /** Bars that CLOSED decisively on the wrong side of it. */
  readonly breaks: number;
  /** Furthest any bar's extreme reached past the line, in price. */
  readonly excursion: number;
}

/**
 * How well a line describes a stretch of bars.
 *
 * `side` is +1 when the line is a floor tested by lows, -1 when it is a
 * ceiling tested by highs. A break is measured on the CLOSE rather than the
 * extreme: a wick through a trendline is what trendlines are for, and counting
 * those as breaks rejects every real channel on the chart.
 */
export function measure(
  line: Line,
  m: Metrics,
  from: number,
  to: number,
  side: 1 | -1,
  tol: number,
  close: readonly number[],
): Quality {
  let touches = 0;
  let breaks = 0;
  let excursion = 0;
  for (let i = from; i <= to; i++) {
    const at = priceOn(line, i);
    const extreme = side === 1 ? m.low[i]! : m.high[i]!;
    const gap = side === 1 ? extreme - at : at - extreme;   // negative = past it
    if (Math.abs(gap) <= tol) touches++;
    if (gap < -excursion) excursion = -gap;
    const c = close[i]!;
    if (side === 1 ? c < at - tol : c > at + tol) breaks++;
  }
  return { touches, breaks, excursion };
}

/** The parallel that encloses every bar on the other side of `line`. */
export function envelopeOffset(
  line: Line,
  m: Metrics,
  from: number,
  to: number,
  side: 1 | -1,
): number {
  let offset = 0;
  for (let i = from; i <= to; i++) {
    const at = priceOn(line, i);
    const reach = side === 1 ? m.high[i]! - at : m.low[i]! - at;
    if (side === 1 ? reach > offset : reach < offset) offset = reach;
  }
  return offset;
}
