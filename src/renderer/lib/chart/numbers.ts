/**
 * Brooks bar numbers: the count of each bar within its own trading session,
 * drawn under the bars it counts, with the session's first bar carrying the
 * date instead of a number.
 *
 * WHY A PRIMITIVE AND NOT SERIES MARKERS. A marker reserves vertical space, and
 * `aboveBar`/`belowBar` markers therefore MOVE THE PRICE SCALE — that is
 * already written down as the reason a selected bar mark gets a band rather
 * than a bigger marker. Hundreds of number labels would re-scale the pane on
 * every zoom. A primitive's `autoscaleInfo()` returns null, so nothing here can
 * disturb the candles.
 *
 * WHY MEDIA COORDINATES. This draws text, and text in bitmap space means
 * scaling the font by the device pixel ratio by hand and getting the baseline
 * arithmetic wrong on a fractional-scaling display. `useMediaCoordinateSpace`
 * hands over CSS pixels, which is what the label geometry is expressed in.
 *
 * INTRADAY ONLY, decided by the caller. A daily bar IS a session, so numbering
 * it would print "1" under all 6,550 of them.
 */
import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { readTokens } from './tokens.ts';

/** Label every third bar, so the eye can count to the one it wants. */
export const NUMBER_STEP = 3;

const FONT_PX = 10;
const LINE_PX = 11;
/**
 * How far under the bar's low a label hangs.
 *
 * Generous on purpose: a `belowBar` mark label sits a few pixels under the same
 * low, and the two are only both on screen when the chart is zoomed in far
 * enough for bar marks to appear at all. 16px clears them.
 */
const DROP_PX = 16;

/**
 * A monospace advance at FONT_PX, and the clear space a label wants beside it.
 *
 * Measured rather than assumed, the way BAR_MARK_MIN_PX was: IBM Plex Mono
 * advances 0.6em, so a character is 6px at 10px and a three-digit number is
 * 18px. Below `chars * CHAR_PX + LABEL_PAD` of room, labels on consecutive
 * labelled bars touch — and touching digits read as a different number, which
 * is worse than no number at all.
 */
const CHAR_PX = 6;
const LABEL_PAD = 7;

export interface BarLabel {
  /** Bar index in the dataset the chart is showing. */
  readonly i: number;
  /** The bar's low: the label hangs beneath it, as on a Brooks chart. */
  readonly low: number;
  /** One line for a number, two for a date: `['12']`, `['28', 'Aug']`. */
  readonly lines: readonly string[];
}

/** What is currently suppressed for density, for the readout to report. */
export interface LabelDensity {
  numbers: boolean;
  dates: boolean;
}

/** The pixels a set of labels needs between one and the next. */
function needsPx(labels: readonly BarLabel[]): number {
  let chars = 0;
  for (const label of labels) {
    for (const line of label.lines) chars = Math.max(chars, line.length);
  }
  return chars * CHAR_PX + LABEL_PAD;
}

export class BarNumberPrimitive implements ISeriesPrimitive<Time> {
  #numbers: readonly BarLabel[] = [];
  #dates: readonly BarLabel[] = [];
  /** Bars between consecutive labels of each kind: the step for numbers, the
   *  shortest session for dates. Density is spacing x this. */
  #gaps = { numbers: NUMBER_STEP, dates: 1 };
  #needs = { numbers: 0, dates: 0 };

  #chart: IChartApi | null = null;
  #series: ISeriesApi<'Candlestick', Time> | null = null;
  #requestUpdate: (() => void) | null = null;

  readonly #views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.#draw(target),
    };
    // Frozen and built once: the library caches pane views on array identity,
    // and rebuilding the array each frame defeats that.
    this.#views = Object.freeze([
      Object.freeze({
        // Under the crosshair, over the candles — the same place the mark
        // primitive draws. A number behind a wick is not a number.
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
    this.#numbers = [];
    this.#dates = [];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.#views;
  }

  /** Numbers never move the price scale. See the note at the top. */
  autoscaleInfo(): AutoscaleInfo | null {
    return null;
  }

  setLabels(numbers: readonly BarLabel[], dates: readonly BarLabel[], barsPerSession: number): void {
    this.#numbers = numbers;
    this.#dates = dates;
    this.#gaps = { numbers: NUMBER_STEP, dates: Math.max(1, barsPerSession) };
    this.#needs = { numbers: needsPx(numbers), dates: needsPx(dates) };
    this.#requestUpdate?.();
  }

  /**
   * Which labels the given bar spacing has no room for.
   *
   * Public because the readout has to say so: labels vanishing for density is
   * indistinguishable, from the chart alone, from a stretch that simply has
   * none. The two kinds are tested separately — a date every 81 bars survives
   * a zoom that numbers every 3 bars cannot.
   */
  density(barSpacing: number): LabelDensity {
    return {
      numbers: this.#numbers.length > 0 && barSpacing * this.#gaps.numbers < this.#needs.numbers,
      dates: this.#dates.length > 0 && barSpacing * this.#gaps.dates < this.#needs.dates,
    };
  }

  #draw(target: CanvasRenderingTarget2D): void {
    const chart = this.#chart;
    const series = this.#series;
    if (!chart || !series || (this.#numbers.length === 0 && this.#dates.length === 0)) return;

    const scale = chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (!range) return;

    const hidden = this.density(scale.options().barSpacing);
    if (hidden.numbers && hidden.dates) return;

    const tokens = readTokens();
    // One bar either side, so a label whose bar is half off-screen still draws
    // rather than popping in.
    const from = range.from - 1;
    const to = range.to + 1;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.font = `${FONT_PX}px ${tokens.mono}`;
      context.textAlign = 'center';
      context.textBaseline = 'top';

      const paint = (labels: readonly BarLabel[], colour: string): void => {
        context.fillStyle = colour;
        for (const label of labels) {
          if (label.i < from || label.i > to) continue;
          const x = scale.logicalToCoordinate(label.i as never);
          const y = series.priceToCoordinate(label.low);
          if (x === null || y === null) continue;
          let top = y + DROP_PX;
          for (const line of label.lines) {
            // Bail rather than draw a label the pane has clipped in half.
            if (top + LINE_PX > mediaSize.height) break;
            context.fillText(line, x, top);
            top += LINE_PX;
          }
        }
      };

      // The date first, so a number is never painted over by it.
      if (!hidden.dates) paint(this.#dates, tokens.ink2);
      if (!hidden.numbers) paint(this.#numbers, tokens.muted);
      context.restore();
    });
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A trading day as the two lines the chart draws: `2026-08-28` -> `['28','Aug']`.
 *
 * Sliced rather than parsed through `Date`: the string is already the trading
 * day in New York — `tradingDayOf` did that arithmetic — and handing it to
 * `new Date()` would convert it a second time, an hour of error either way.
 */
export function dateLines(day: string): string[] {
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  return month === undefined ? [day.slice(8, 10)] : [day.slice(8, 10), month];
}
