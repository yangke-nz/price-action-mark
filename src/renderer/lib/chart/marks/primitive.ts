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
import { distanceTo, paint, paintAnchorBand, paintFocusBand, shapeOf, type Shape, type Space } from './draw.ts';
import { readTokens } from '../tokens.ts';

/** How close the pointer has to get, in CSS pixels, to select a mark. */
const HIT_SLOP = 6;
/** A line-style hit, per the library's own guidance for hitTestPriority. */
const HIT_PRIORITY_LINE = 1;

/** Anchor-band width in CSS pixels when bar spacing cannot be measured, and
 *  the range it is clamped to — one bar at MAX zoom is a fraction of a pixel
 *  and one at 1M is wider than the band should ever be. */
const BAND_FALLBACK_PX = 9;
const BAND_MIN_PX = 5;
const BAND_MAX_PX = 34;

export class MarkPrimitive implements ISeriesPrimitive<Time> {
  #marks: readonly GeometryMark[] = [];
  #chart: IChartApi | null = null;
  #series: ISeriesApi<'Candlestick', Time> | null = null;
  #requestUpdate: (() => void) | null = null;
  #indexOf: ReadonlyMap<string, number> = new Map();
  /** The whole mark, not just its id: the anchor band needs its session and
   *  its tone, and a bar mark has no geometry to look them up from. */
  #selected: Mark | null = null;
  /**
   * The session the reader picked out of the bar-reading list, as a date.
   *
   * A separate field from `#selected`, not a second use of it, because the two
   * are different gestures on different lists and either can be showing while
   * the other is: "highlight this pattern" and "show me this bar". A date
   * rather than a mark — a session has no tone and needs none.
   */
  #focusBar: string | null = null;

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
    this.#selected = null;
    this.#focusBar = null;
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

  /**
   * The mark the reader picked out of the list, or null.
   *
   * Takes the mark rather than its id because the anchor band applies to EVERY
   * kind — including bar marks, which have no geometry here at all, and trade
   * marks that collapsed to zero width. Geometry emphasis still keys off the
   * id; the band keys off `at` and `tone`.
   */
  setSelected(mark: Mark | null): void {
    if (mark?.id === this.#selected?.id) return;
    this.#selected = mark;
    this.#requestUpdate?.();
  }

  /**
   * Highlight one session, or none — the line the reader clicked in the
   * bar-reading list.
   *
   * Deliberately not part of `Shape`, so it is invisible to `hitTest`: the hit
   * test measures against shapes, and a full-height band would make an entire
   * column of the chart report this session as the thing under the cursor.
   */
  setFocusBar(at: string | null): void {
    if (at === this.#focusBar) return;
    this.#focusBar = at;
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

  /** Half a bar's width in CSS pixels, for the anchor band. */
  #bandHalfWidth(space: Space, i: number): number {
    const a = space.xAt(i);
    const b = space.xAt(i + 1);
    const spacing = a === null || b === null ? BAND_FALLBACK_PX : Math.abs(b - a);
    return Math.min(BAND_MAX_PX, Math.max(BAND_MIN_PX, spacing)) / 2;
  }

  #draw(target: CanvasRenderingTarget2D): void {
    const space = this.#space();
    this.#shapes = [];
    if (!space) return;

    // Read the palette once per frame rather than per mark: getComputedStyle
    // is the expensive call here, and every mark of a tone resolves the same.
    const tokens = readTokens();
    for (const mark of this.#marks) {
      const shape = shapeOf(mark, space);
      if (shape) this.#shapes.push({ mark, shape });
    }

    // Resolved before the paint pass so both bands go down FIRST, under every
    // mark: they are pointers into the chart, not something to read.
    const picked = this.#selected;
    const bandIndex = picked ? space.index(picked.at) : undefined;
    const bandX = bandIndex === undefined ? null : space.xAt(bandIndex);
    const focusIndex = this.#focusBar === null ? undefined : space.index(this.#focusBar);
    const focusX = focusIndex === undefined ? null : space.xAt(focusIndex);

    target.useBitmapCoordinateSpace(({ context, mediaSize, horizontalPixelRatio, verticalPixelRatio }) => {
      if (picked && bandIndex !== undefined && bandX !== null) {
        paintAnchorBand(
          context, bandX, this.#bandHalfWidth(space, bandIndex), mediaSize.height,
          styleFor(picked.tone, tokens), horizontalPixelRatio, verticalPixelRatio,
        );
      }

      // After the mark band, so that when the reader has picked a mark and the
      // bar under it, the rails still read as the bar selection.
      if (focusIndex !== undefined && focusX !== null) {
        paintFocusBand(
          context, focusX, this.#bandHalfWidth(space, focusIndex), mediaSize.height,
          tokens.focus, horizontalPixelRatio, verticalPixelRatio,
        );
      }

      // The selected mark is drawn LAST rather than in place. Emphasis it has
      // to share z-order with is not emphasis: a highlighted channel sitting
      // under three ordinary ones is exactly as hard to find as before.
      let selected: { mark: GeometryMark; shape: Shape } | null = null;
      for (const entry of this.#shapes) {
        if (entry.mark.id === picked?.id) { selected = entry; continue; }
        paint(context, entry.shape, styleFor(entry.mark.tone, tokens), horizontalPixelRatio, verticalPixelRatio);
      }
      if (selected) {
        paint(context, selected.shape, styleFor(selected.mark.tone, tokens), horizontalPixelRatio, verticalPixelRatio, true);
      }
    });
  }
}
