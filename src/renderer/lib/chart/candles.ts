/**
 * Everything imperative about the chart, in one class. Svelte drives it by
 * calling methods; nothing in here knows Svelte exists.
 *
 * Four things in here were not obvious and are the reason this is a class
 * rather than a few lines in a component:
 *
 *  - Per-bar colour has to live on the DATA POINTS, not on series options.
 *    Series-level colour cannot vary bar to bar, so a restyle after a theme
 *    change means calling setData again, not applyOptions.
 *  - An overlay series must NOT get its own price scale. Left on the default
 *    it would autoscale independently and the moving average would float free
 *    of the candles it is supposed to track; it shares the right scale.
 *  - The EMA is undefined for its first 19 sessions. Those points are omitted
 *    rather than sent as zero, so the line begins where the average does
 *    instead of diving to the axis.
 *  - Markers do not thin themselves. All 104 roll arrows render at MAX zoom
 *    and become a picket fence, so they are dropped below ~18px of separation
 *    and the readout says why.
 *  - A BAR'S TIME IS TWO DIFFERENT TYPES. lightweight-charts takes a business
 *    day STRING for a daily series and a UTCTimestamp NUMBER for an intraday
 *    one, and it is not interchangeable: hand it '2026-08-28T13:45:00Z' and the
 *    series silently draws nothing. `#timeOf` converts the dataset's key once
 *    and `#indexOfTime` maps the library's value back, because the crosshair
 *    hands back whichever type was put in.
 *  - There is ONE marker source and ONE canvas primitive, not one per mark.
 *    Bar labels join the roll arrows in the single marker list so they go
 *    through the same thinning pass, and every line, channel and zone is drawn
 *    by a single MarkPrimitive. Attaching a primitive per mark would mean
 *    hundreds of pane views recomputing on every pan frame.
 */
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type LineData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { Dataset } from '../../../shared/types.ts';
import { axisPrice } from '../../../shared/format.ts';
import { readTokens } from './tokens.ts';
import { EMA_PERIOD, ema } from '../../../shared/indicators.ts';
import { sessionBars } from '../../../shared/session.ts';
import { contractStarts } from '../../../shared/rolls.ts';
import { tickFor } from '../../../shared/instrument.ts';
import { epochOf, specOf } from '../../../shared/interval.ts';
import type { BarMark, Mark } from '../../../shared/marks/types.ts';
import { MarkPrimitive } from './marks/primitive.ts';
import { BarNumberPrimitive, NUMBER_STEP, dateLines, type BarLabel, type LabelDensity } from './numbers.ts';
import { styleFor } from './marks/palette.ts';

/** Below this many pixels of separation the roll arrows stop reading as
 *  annotations and become a fence. */
const MARKER_MIN_PX = 18;
/** Fallback spacing when there are fewer than two rolls to measure: about a
 *  quarter of daily sessions. Derived from the data where possible, because on
 *  a 5-minute series a quarter is ~14,000 bars, not 63, and a constant would
 *  hide every arrow on one interval or none on the other. */
const SESSIONS_PER_QUARTER = 63;
/**
 * Bar labels sit on individual sessions rather than a quarter apart, so they
 * need their own floor. Measured rather than guessed: the longest labels are
 * three characters ('BIG', '2BR', 'ioi') and the chart draws at 11px in the
 * mono face, so a label is about 20px wide before any breathing room. Below
 * roughly this much space per bar, labels on ADJACENT bars overlap each other
 * — which the eye reads as garbage rather than as density. Marks stacked on
 * one bar are fine; the library offsets those vertically.
 */
const BAR_MARK_MIN_PX = 24;


export interface Viewport {
  /** Inclusive bar indices currently on screen. */
  from: number;
  to: number;
  /** True while the roll markers are suppressed for density. */
  rollsHidden: boolean;
  /** True while per-bar mark labels are suppressed for density. */
  barMarksHidden: boolean;
  /** True while the session bar numbers are suppressed for density. Intraday
   *  only — a daily bar is a whole session and carries no number. */
  barNumbersHidden: boolean;
}

/**
 * The bar numbers and session dates for one dataset.
 *
 * Brooks numbers the bars of a session and refers to them by number, so every
 * third bar carries its count and the session's FIRST bar carries the date
 * instead — bar 1 is never a multiple of three, so the two never contend for
 * the same bar.
 *
 * Empty on a daily series: a daily bar is a whole session, and numbering it
 * would print "1" under all 6,550 of them.
 */
function barLabels(data: Dataset): { numbers: BarLabel[]; dates: BarLabel[]; shortestSession: number } {
  const empty = { numbers: [], dates: [], shortestSession: 1 };
  if (!specOf(data).intraday) return empty;

  const { number, starts } = sessionBars(data);
  const numbers: BarLabel[] = [];
  for (let i = 0; i < number.length; i++) {
    const n = number[i]!;
    if (n % NUMBER_STEP === 0) numbers.push({ i, low: data.l[i]!, lines: [String(n)] });
  }
  const dates: BarLabel[] = starts.map(({ i, day }) => ({ i, low: data.l[i]!, lines: dateLines(day) }));

  // The SHORTEST session, not the average: the density test has to hold for
  // the closest pair of dates on the chart, and a 60-day window always has a
  // holiday half-session in it somewhere.
  let shortest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < starts.length; k++) shortest = Math.min(shortest, starts[k]!.i - starts[k - 1]!.i);
  return {
    numbers,
    dates,
    shortestSession: Number.isFinite(shortest) ? shortest : number.length,
  };
}

export interface CandleChartOptions {
  onHover(index: number | null): void;
  onViewport(viewport: Viewport): void;
  /** A mark was clicked on the canvas. Fires for geometry and for bar labels
   *  alike: the primitive's hit test and the marker ids both report a mark id. */
  onMarkClick(id: string): void;
  /**
   * A bar was clicked with no mark under the cursor.
   *
   * Mutually exclusive with `onMarkClick` — a click reports one thing or the
   * other, never both, because selecting the bar AND the mark would draw two
   * bands for one click and leave the reader to work out which was which.
   */
  onBarClick(index: number): void;
}

/** Only the sessions the average is actually defined for. Sending the warm-up
 *  as zeroes would draw a line diving to the axis for the first 19 bars. */
function emaPoints(data: Dataset, timeOf: (key: string) => Time): LineData<Time>[] {
  const values = ema(data.c, EMA_PERIOD);
  const out: LineData<Time>[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value !== null && value !== undefined) out.push({ time: timeOf(data.d[i]!), value });
  }
  return out;
}

export class CandleChart {
  readonly #chart: IChartApi;
  readonly #candles: ISeriesApi<'Candlestick'>;
  readonly #markers: ISeriesMarkersPluginApi<Time>;
  readonly #container: HTMLElement;
  readonly #opts: CandleChartOptions;

  #ema: ISeriesApi<'Line'> | null = null;
  #data: Dataset;
  /** Bar key -> index. What the primitive resolves a mark's anchor against. */
  #indexOf = new Map<string, number>();
  /**
   * The library's own time value -> index, for the crosshair.
   *
   * A second map rather than converting back, because the crosshair hands back
   * whatever type was put in — a string on a daily series and a number on an
   * intraday one — and reconstructing a key from a number means re-deriving a
   * format that has to match `keyOf()` exactly. A map cannot drift.
   */
  #indexOfTime = new Map<string | number, number>();
  /** True while the loaded dataset's bars are shorter than a session. */
  #intraday = false;
  /** Smallest gap in BARS between consecutive roll markers, for the density
   *  test. Measured off the data; falls back where there is nothing to measure. */
  #rollGapBars = SESSIONS_PER_QUARTER;
  #rollMarkers: SeriesMarker<Time>[] = [];
  #emaPoints: LineData<Time>[] = [];
  #showRolls = true;
  #rollsHidden = false;
  /** The instrument's minimum increment, which is what the price axis should
   *  round to. Tracked because `setData` can bring a different symbol. */
  #tick: number;
  readonly #primitive = new MarkPrimitive();
  readonly #numbers = new BarNumberPrimitive();
  #numbersHidden = false;
  #barMarks: readonly BarMark[] = [];
  #barMarkers: SeriesMarker<Time>[] = [];
  #barMarksHidden = false;
  /** Every mark currently on the chart, by id. Keyed rather than a Set of ids
   *  because a click has to be attributed to a mark rather than to whatever
   *  else the library reports as hovered, AND `setSelected` has to resolve an
   *  id to the mark whose session and tone the anchor band needs. */
  #marksById: ReadonlyMap<string, Mark> = new Map();
  /** The mark the reader picked out of the list. View state, never persisted. */
  #selectedMarkId: string | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(container: HTMLElement, data: Dataset, opts: CandleChartOptions) {
    this.#container = container;
    this.#opts = opts;
    this.#data = data;
    this.#tick = tickFor(data.symbol);

    const t = readTokens();
    this.#chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.mutedText,
        fontFamily: t.mono,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: t.grid, separatorHoverColor: t.axis, enableResize: false },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.grid, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: t.grid, rightOffset: 4, minBarSpacing: 0.05 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: t.axis, width: 1, style: LineStyle.Solid, labelBackgroundColor: t.ink },
        horzLine: { color: t.axis, width: 1, style: LineStyle.Solid, labelBackgroundColor: t.ink },
      },
      // Vertical drag on the price axis fights the pan gesture on a trackpad.
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });

    // FILLED up-candles, on request. They were hollow — a transparent body
    // with a coloured border — because the shape is a second channel carrying
    // direction where hue cannot, and it survives greyscale and print. Filled
    // still separates under both colour-blindness simulations, because the
    // palette was picked so LIGHTNESS carries it (dE 7.8 light / 8.6 dark, see
    // tokens.css); what is gone is the redundancy, not the distinction.
    this.#candles = this.#chart.addSeries(CandlestickSeries, {
      upColor: t.up,
      downColor: t.down,
      borderVisible: true,
      borderUpColor: t.up,
      borderDownColor: t.down,
      wickUpColor: t.up,
      wickDownColor: t.down,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', minMove: this.#tick, formatter: axisPrice },
    });

    this.#markers = createSeriesMarkers(this.#candles, []);
    this.#candles.attachPrimitive(this.#primitive);
    // A second primitive rather than another kind inside MarkPrimitive: these
    // labels are not marks. They carry no verdict, no tone and no hit test, and
    // folding them into the mark geometry would put "where is bar 12" and
    // "which pattern is this" in the same code path.
    this.#candles.attachPrimitive(this.#numbers);
    this.setData(data);

    this.#chart.subscribeCrosshairMove((param) => {
      // Keyed on the library's OWN time value, which is a string on a daily
      // series and a number on an intraday one.
      const time = param.time as string | number | undefined;
      const hit = time === undefined ? undefined : this.#indexOfTime.get(time);
      this.#opts.onHover(hit ?? null);
    });

    // Clicking a drawn mark is the fastest way to keep it while reading a
    // chart. `hoveredObjectId` is deprecated in favour of `hoveredInfo`, so
    // read the new field and fall back — and check membership rather than
    // trusting the id, since markers and primitives share this channel and a
    // future one might put something else on it.
    this.#chart.subscribeClick((param) => {
      const info = param as { hoveredInfo?: { objectId?: unknown; objectKind?: string; sourceKind?: string }; hoveredObjectId?: unknown };
      const id = info.hoveredInfo?.objectId ?? info.hoveredObjectId;
      if (typeof id === 'string' && this.#marksById.has(id)) {
        this.#opts.onMarkClick(id);
        return;
      }
      // No mark under the cursor, so the click is about the BAR. Measured on
      // v5.2.1 with sendInputEvent before this was written, because one answer
      // decided whether the feature was worth having: a 200px pan fires NO
      // click at all, so this cannot yank the tape on every drag. A 3px jitter
      // drag does fire one, landing on whatever bar the nudge left under the
      // cursor — the same as any chart, and not worth a guard. A click past
      // the last bar arrives with `time` undefined, which is what makes
      // "click empty space, nothing happens" free rather than a special case.
      const time = param.time as string | number | undefined;
      const hit = time === undefined ? undefined : this.#indexOfTime.get(time);
      if (hit !== undefined) this.#opts.onBarClick(hit);
    });

    // Pan and zoom fire continuously; the table and the marker pass are only
    // worth doing once the gesture settles.
    this.#chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.#settle());
  }

  /**
   * A dataset key as the library's time value.
   *
   * Daily is a business-day string, intraday a UTCTimestamp in SECONDS. Giving
   * an intraday series the ISO string draws an empty chart with no error, which
   * is why this is one function rather than a cast at each of the six call
   * sites it used to be.
   */
  #timeOf = (key: string): Time => (this.#intraday ? (epochOf(key) as unknown as Time) : (key as Time));

  setData(data: Dataset): void {
    this.#data = data;
    this.#intraday = specOf(data).intraday;
    const n = data.d.length;

    // A refresh normally brings the same instrument, but the data layer is
    // symbol-generic and nothing here should assume otherwise.
    const tick = tickFor(data.symbol);
    if (tick !== this.#tick) {
      this.#tick = tick;
      const priceFormat = { type: 'custom' as const, minMove: tick, formatter: axisPrice };
      this.#candles.applyOptions({ priceFormat });
      this.#ema?.applyOptions({ priceFormat });
    }

    const bars: CandlestickData<Time>[] = new Array(n);
    this.#indexOf = new Map();
    this.#indexOfTime = new Map();
    for (let i = 0; i < n; i++) {
      const key = data.d[i]!;
      const time = this.#timeOf(key);
      bars[i] = { time, open: data.o[i]!, high: data.h[i]!, low: data.l[i]!, close: data.c[i]! };
      this.#indexOf.set(key, i);
      this.#indexOfTime.set(time as unknown as string | number, i);
    }
    this.#candles.setData(bars);

    // On the contract START, not on `data.rolls`, which holds the expiries.
    // The arrow exists to say "the change into this bar is carry", and that is
    // true of the session after the expiry, never of the expiry itself.
    const starts = contractStarts(data.d, data.rolls).filter((i) => i >= 0 && i < n);
    this.#rollMarkers = starts.map((i) => ({
      time: this.#timeOf(data.d[i]!),
      position: 'belowBar' as const,
      shape: 'arrowUp' as const,
      color: readTokens().muted,
      size: 0.6,
      id: `roll-${data.d[i]}`,
    }));
    // The density floor, measured rather than assumed: on a daily series
    // consecutive rolls sit ~63 bars apart, on a 5-minute one ~14,000, and a
    // constant would either hide every arrow or never hide any.
    let gap = Number.POSITIVE_INFINITY;
    for (let k = 1; k < starts.length; k++) gap = Math.min(gap, starts[k]! - starts[k - 1]!);
    this.#rollGapBars = Number.isFinite(gap) ? gap : SESSIONS_PER_QUARTER;

    // The primitive anchors marks on keys and the chart is the only thing that
    // knows which bar a key is.
    this.#primitive.setIndex(this.#indexOf);

    const labels = barLabels(data);
    this.#numbers.setLabels(labels.numbers, labels.dates, labels.shortestSession);

    this.#emaPoints = emaPoints(data, this.#timeOf);
    if (this.#ema) this.#ema.setData(this.#emaPoints);
    this.#refreshMarkers();
  }

  setEmaVisible(visible: boolean): void {
    if (visible === (this.#ema !== null)) return;
    if (!visible) {
      if (this.#ema) this.#chart.removeSeries(this.#ema);
      this.#ema = null;
      return;
    }
    this.#ema = this.#chart.addSeries(LineSeries, {
      color: readTokens().ema,
      // One pixel. A 2px average competes with the candles it is drawn over;
      // at this weight it reads as a guide line, which is what it is.
      lineWidth: 1,
      priceScaleId: 'right',          // share the candles' scale, never autoscale alone
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,  // the readout already names the value
      priceFormat: { type: 'custom', minMove: this.#tick, formatter: axisPrice },
    });
    this.#ema.setData(this.#emaPoints);
  }

  setRollsVisible(visible: boolean): void {
    this.#showRolls = visible;
    this.#refreshMarkers();
  }

  /**
   * Everything that is a marker, in one list and one thinning pass.
   *
   * Two floors, because the two kinds sit at different densities: roll arrows
   * are a quarter apart and go when that gap closes below 18px, bar labels are
   * one per session and go when a single bar narrows past 8px. Merging them
   * into a second marker plugin instead would let bar labels bypass this
   * entirely and reproduce the picket fence the roll arrows already taught us
   * about.
   */
  #refreshMarkers(): void {
    const range = this.#chart.timeScale().getVisibleLogicalRange();
    const width = this.#container.clientWidth;
    const pxPerBar =
      range && width
        ? width / Math.max(1, range.to - range.from)
        : Number.POSITIVE_INFINITY;

    // `#rollMarkers.length > 0` is not redundant: a 60-day intraday window can
    // contain no quarterly expiry at all, and without it the readout announced
    // "rolls too dense to mark" about markers that did not exist.
    this.#rollsHidden = this.#showRolls
      && this.#rollMarkers.length > 0
      && pxPerBar * this.#rollGapBars < MARKER_MIN_PX;
    this.#barMarksHidden = this.#barMarkers.length > 0 && pxPerBar < BAR_MARK_MIN_PX;
    // The primitive owns the font, so it owns the arithmetic; this only asks.
    // Dates are reported separately from numbers and deliberately not surfaced:
    // one date every 81 bars survives any zoom a reader uses, and a second
    // "zoom in for..." clause in the readout is noise.
    const density: LabelDensity = this.#numbers.density(this.#chart.timeScale().options().barSpacing);
    this.#numbersHidden = density.numbers;

    const out: SeriesMarker<Time>[] = [];
    if (this.#showRolls && !this.#rollsHidden) out.push(...this.#rollMarkers);
    if (!this.#barMarksHidden) out.push(...this.#barMarkers);
    // The plugin wants them in time order, and merging two sorted lists does
    // not produce one.
    out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    this.#markers.setMarkers(out);
  }

  /**
   * Adopt a set of marks. Bar labels become markers and everything with
   * geometry goes to the primitive; nothing else in the app needs to know
   * which is which.
   */
  setMarks(marks: readonly Mark[]): void {
    this.#marksById = new Map(marks.map((m) => [m.id, m]));
    this.#barMarks = marks.filter((m): m is BarMark => m.kind === 'bar');
    this.#buildBarMarkers();
    this.#primitive.setMarks(marks);
    // Re-resolve the selection against the new list. `setSelected` short-
    // circuits on an unchanged id, so without this a mark set arriving after
    // a selection would leave the primitive holding the OLD mark object — or
    // holding one that is no longer on the chart at all.
    const kept = this.#selectedMarkId;
    this.#selectedMarkId = null;
    this.setSelected(kept !== null && this.#marksById.has(kept) ? kept : null);
    this.#refreshMarkers();
  }

  /**
   * Highlight one mark, or none.
   *
   * The whole selection lives in the primitive — geometry emphasis and the
   * anchor band both — so this resolves the id to a mark and hands it over.
   * Markers are deliberately untouched: they are the one part of the chart
   * that can move the price scale, and see `#buildBarMarkers` for what that
   * cost when the selected label was grown instead.
   */
  setSelected(id: string | null): void {
    if (id === this.#selectedMarkId) return;
    this.#selectedMarkId = id;
    this.#primitive.setSelected(id === null ? null : this.#marksById.get(id) ?? null);
  }

  /**
   * Highlight one session, or none — the line the reader clicked in the
   * bar-reading list.
   *
   * Straight through to the primitive, and deliberately not routed through
   * `setSelected`: a picked mark and a picked session are two gestures on two
   * lists, and either can be showing while the other is. The primitive draws
   * the two bands in different colours for that reason.
   */
  /** The stop and target rails on an entry — a display switch, not a filter:
   *  the entries themselves are on the chart either way. */
  setStopTarget(on: boolean): void {
    this.#primitive.setStopTarget(on);
  }

  setFocusBar(at: string | null): void {
    this.#primitive.setFocusBar(at);
  }

  /** Colour lives on the marker data, not on options, so this runs again on
   *  every theme change — the same reason `#rollMarkers` is rebuilt there. */
  #buildBarMarkers(): void {
    const t = readTokens();
    this.#barMarkers = this.#barMarks
      .filter((m) => this.#indexOf.has(m.at))
      .map((m) => ({
        time: this.#timeOf(m.at),
        position: m.placement === 'above' ? ('aboveBar' as const) : ('belowBar' as const),
        shape: 'circle' as const,
        // Constant. Growing the selected one was tried and an `aboveBar`
        // marker reserves vertical space, so selecting a mark near the visible
        // high RE-SCALED the pane and shifted every candle. The selection is
        // shown by the primitive's anchor band instead, which cannot: see
        // SELECTED_BAND_ALPHA in marks/palette.ts.
        size: 0.3,
        text: m.label,
        color: styleFor(m.tone, t).color,
        id: m.id,
      }));
  }

  #settle(): void {
    if (this.#settleTimer) clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      if (this.#disposed) return;
      this.#refreshMarkers();
      this.#opts.onViewport(this.viewport());
    }, 160);
  }

  viewport(): Viewport {
    const n = this.#data.d.length;
    const range: LogicalRange | null = this.#chart.timeScale().getVisibleLogicalRange();
    const hidden = {
      rollsHidden: this.#rollsHidden,
      barMarksHidden: this.#barMarksHidden,
      barNumbersHidden: this.#numbersHidden,
    };
    if (!range) return { from: 0, to: n - 1, ...hidden };
    return {
      from: Math.max(0, Math.ceil(range.from)),
      to: Math.min(n - 1, Math.floor(range.to)),
      ...hidden,
    };
  }

  /** Range presets move the viewport; they never reload or aggregate. Every
   *  one of the 6,500 sessions is loaded the whole time. */
  showLastDays(days: number): void {
    const n = this.#data.d.length;
    if (n === 0) return;
    if (!Number.isFinite(days)) {
      this.#chart.timeScale().fitContent();
      this.#settle();
      return;
    }
    const last = this.#data.d[n - 1]!;
    // Arithmetic on the INSTANT, not on the string. The old form appended
    // 'T00:00:00Z' to the last key, which for an intraday key produced
    // '2026-08-28T13:45:00ZT00:00:00Z' — NaN, and a range request the library
    // quietly ignores.
    const fromEpoch = epochOf(last) - days * 86_400;
    const from = this.#intraday
      ? (fromEpoch as unknown as Time)
      : (new Date(fromEpoch * 1000).toISOString().slice(0, 10) as Time);
    this.#chart.timeScale().setVisibleRange({ from, to: this.#timeOf(last) });
    this.#settle();
  }

  /** Keyboard crosshair. Arrow keys step one session; the readout announces it. */
  moveCrosshair(index: number): void {
    const d = this.#data;
    const i = Math.min(Math.max(index, 0), d.d.length - 1);
    this.#chart.setCrosshairPosition(d.c[i]!, this.#timeOf(d.d[i]!), this.#candles);
  }

  clearCrosshair(): void {
    this.#chart.clearCrosshairPosition();
  }

  applyTheme(): void {
    const t = readTokens();
    this.#chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.mutedText,
        panes: { separatorColor: t.grid, separatorHoverColor: t.axis },
      },
      grid: { horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.grid },
      timeScale: { borderColor: t.grid },
      crosshair: {
        vertLine: { color: t.axis, labelBackgroundColor: t.ink },
        horzLine: { color: t.axis, labelBackgroundColor: t.ink },
      },
    });
    this.#candles.applyOptions({
      upColor: t.up,
      downColor: t.down,
      borderUpColor: t.up,
      borderDownColor: t.down,
      wickUpColor: t.up,
      wickDownColor: t.down,
    });
    this.#ema?.applyOptions({ color: t.ema });
    this.#rollMarkers = this.#rollMarkers.map((m) => ({ ...m, color: t.muted }));
    // Mark geometry re-reads the tokens itself on the next draw; only the
    // marker colours, which live on the data, have to be reissued here.
    this.#buildBarMarkers();
    this.#refreshMarkers();
  }

  /** Web fonts land after the first paint and the axis labels are measured in
   *  pixels, so the chart has to be told to re-measure once they do. */
  remeasure(): void {
    this.#chart.applyOptions({});
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#settleTimer) clearTimeout(this.#settleTimer);
    this.#chart.remove();
  }
}
