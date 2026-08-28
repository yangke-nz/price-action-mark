/**
 * ONE primitive for every geometry mark on the chart, not one per mark.
 *
 * A marked-up 26-year chart carries hundreds of marks. `attachPrimitive` per
 * mark means hundreds of pane views, each asked for a renderer on every pan
 * frame; this draws the lot in a single pass and only over the visible range.
 *
 * Three details are load-bearing:
 *
 *  - `autoscaleInfo()` returns null, always. A channel line projected past the
 *    last bar, or a stop below the visible low, would otherwise drag the price
 *    scale to fit an annotation. Marks follow the candles; the candles never
 *    follow the marks.
 *  - `paneViews()` returns THE SAME ARRAY every call. The library caches on
 *    array identity and rebuilding it each frame defeats that — the typings
 *    say so explicitly.
 *  - The hit test measures against the geometry the renderer drew, from the
 *    same `shapeOf`. Any second opinion about where a line is would drift the
 *    first time a projection changed.
 */
import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { GeometryMark, Mark } from '../../../../shared/marks/types.ts';
import { isGeometry } from '../../../../shared/marks/types.ts';
import { styleFor } from './palette.ts';
import { distanceTo, paint, shapeOf, type Shape, type Space } from './draw.ts';
import { readTokens } from '../tokens.ts';

/** How close the pointer has to get, in CSS pixels, to select a mark. */
const HIT_SLOP = 6;
/** A line-style hit, per the library's own guidance for hitTestPriority. */
const HIT_PRIORITY_LINE = 1;

export class MarkPrimitive implements ISeriesPrimitive<Time> {
  #marks: readonly GeometryMark[] = [];
  #chart: IChartApi | null = null;
  #series: ISeriesApi<'Candlestick', Time> | null = null;
  #requestUpdate: (() => void) | null = null;
  #indexOf: ReadonlyMap<string, number> = new Map();

  /** Rebuilt each draw and reused by the hit test in the same frame. */
  #shapes: { mark: GeometryMark; shape: Shape }[] = [];

  readonly #views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.#draw(target),
    };
    // Frozen and built once: the library caches pane views on array identity.
    this.#views = Object.freeze([
      Object.freeze({
        // Over the candles but under the crosshair, which is where an
        // annotation belongs — beneath it and the marks are invisible on any
        // bar that has a body.
        zOrder: () => 'top' as const,
        renderer: () => renderer,
      }),
    ]);
  }

  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.#chart = param.chart as IChartApi;
    this.#series = param.series;
    this.#requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.#chart = null;
    this.#series = null;
    this.#requestUpdate = null;
    this.#marks = [];
    this.#shapes = [];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.#views;
  }

  /** Marks never move the price scale. See the note at the top. */
  autoscaleInfo(): AutoscaleInfo | null {
    return null;
  }

  /** Date -> bar index, supplied by the chart that owns the dataset. */
  setIndex(indexOf: ReadonlyMap<string, number>): void {
    this.#indexOf = indexOf;
  }

  setMarks(marks: readonly Mark[]): void {
    this.#marks = marks.filter(isGeometry);
    this.#requestUpdate?.();
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    let best: { id: string; distance: number } | null = null;
    for (const { mark, shape } of this.#shapes) {
      const distance = distanceTo(shape, x, y);
      if (distance > HIT_SLOP) continue;
      if (best === null || distance < best.distance) best = { id: mark.id, distance };
    }
    if (best === null) return null;
    return {
      externalId: best.id,
      zOrder: 'top',
      distance: best.distance,
      hitTestPriority: HIT_PRIORITY_LINE,
      cursorStyle: 'pointer',
    };
  }

  #space(): Space | null {
    const chart = this.#chart;
    const series = this.#series;
    if (!chart || !series) return null;
    const scale = chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    const indexOf = this.#indexOf;
    return {
      index: (d) => indexOf.get(d),
      xAt: (logical) => scale.logicalToCoordinate(logical as Logical),
      y: (price) => series.priceToCoordinate(price),
      rightEdge: range ? Math.floor(range.to) : 0,
    };
  }

  #draw(target: CanvasRenderingTarget2D): void {
    const space = this.#space();
    this.#shapes = [];
    if (!space || this.#marks.length === 0) return;

    // Read the palette once per frame rather than per mark: getComputedStyle
    // is the expensive call here, and every mark of a tone resolves the same.
    const tokens = readTokens();
    for (const mark of this.#marks) {
      const shape = shapeOf(mark, space);
      if (shape) this.#shapes.push({ mark, shape });
    }

    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (const { mark, shape } of this.#shapes) {
        paint(context, shape, styleFor(mark.tone, tokens), horizontalPixelRatio, verticalPixelRatio);
      }
    });
  }
}
