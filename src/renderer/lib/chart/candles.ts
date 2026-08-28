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
import { contractStarts } from '../../../shared/rolls.ts';
import { tickFor } from '../../../shared/instrument.ts';
import type { BarMark, Mark } from '../../../shared/marks/types.ts';
import { MarkPrimitive } from './marks/primitive.ts';
import { styleFor } from './marks/palette.ts';

/** Quarterly rolls sit about 63 trading days apart. Below this many pixels of
 *  separation the arrows stop reading as annotations and become a fence. */
const MARKER_MIN_PX = 18;
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
}

export interface CandleChartOptions {
  onHover(index: number | null): void;
  onViewport(viewport: Viewport): void;
  /** A mark was clicked on the canvas. Fires for geometry and for bar labels
   *  alike: the primitive's hit test and the marker ids both report a mark id. */
  onMarkClick(id: string): void;
}

/** Only the sessions the average is actually defined for. Sending the warm-up
 *  as zeroes would draw a line diving to the axis for the first 19 bars. */
function emaPoints(data: Dataset): LineData<Time>[] {
  const values = ema(data.c, EMA_PERIOD);
  const out: LineData<Time>[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value !== null && value !== undefined) out.push({ time: data.d[i] as Time, value });
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
  #indexOf = new Map<string, number>();
  #rollMarkers: SeriesMarker<Time>[] = [];
  #emaPoints: LineData<Time>[] = [];
  #showRolls = true;
  #rollsHidden = false;
  /** The instrument's minimum increment, which is what the price axis should
   *  round to. Tracked because `setData` can bring a different symbol. */
  #tick: number;
  readonly #primitive = new MarkPrimitive();
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
        textColor: t.muted,
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

    // Hollow up-candles: a transparent body with a coloured border. That shape
    // is the channel that carries direction when the hue cannot -- it survives
    // red-green colour blindness, greyscale and print.
    this.#candles = this.#chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(0,0,0,0)',
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
    this.setData(data);

    this.#chart.subscribeCrosshairMove((param) => {
      const time = param.time as string | undefined;
      const hit = time === undefined ? undefined : this.#indexOf.get(time);
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
      if (typeof id === 'string' && this.#marksById.has(id)) this.#opts.onMarkClick(id);
    });

    // Pan and zoom fire continuously; the table and the marker pass are only
    // worth doing once the gesture settles.
    this.#chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.#settle());
  }

  setData(data: Dataset): void {
    this.#data = data;
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
    for (let i = 0; i < n; i++) {
      const time = data.d[i] as Time;
      bars[i] = { time, open: data.o[i]!, high: data.h[i]!, low: data.l[i]!, close: data.c[i]! };
      this.#indexOf.set(data.d[i]!, i);
    }
    this.#candles.setData(bars);

    // On the contract START, not on `data.rolls`, which holds the expiries.
    // The arrow exists to say "the change into this bar is carry", and that is
    // true of the session after the expiry, never of the expiry itself.
    this.#rollMarkers = contractStarts(data.d, data.rolls)
      .filter((i) => i >= 0 && i < n)
      .map((i) => ({
        time: data.d[i] as Time,
        position: 'belowBar' as const,
        shape: 'arrowUp' as const,
        color: readTokens().muted,
        size: 0.6,
        id: `roll-${data.d[i]}`,
      }));

    // The primitive anchors marks on dates and the chart is the only thing
    // that knows which bar a date is.
    this.#primitive.setIndex(this.#indexOf);

    this.#emaPoints = emaPoints(data);
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
      lineWidth: 2,
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

    this.#rollsHidden = this.#showRolls && pxPerBar * SESSIONS_PER_QUARTER < MARKER_MIN_PX;
    this.#barMarksHidden = this.#barMarkers.length > 0 && pxPerBar < BAR_MARK_MIN_PX;

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

  /** Colour lives on the marker data, not on options, so this runs again on
   *  every theme change — the same reason `#rollMarkers` is rebuilt there. */
  #buildBarMarkers(): void {
    const t = readTokens();
    this.#barMarkers = this.#barMarks
      .filter((m) => this.#indexOf.has(m.at))
      .map((m) => ({
        time: m.at as Time,
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
    const hidden = { rollsHidden: this.#rollsHidden, barMarksHidden: this.#barMarksHidden };
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
    const from = new Date(Date.parse(last + 'T00:00:00Z') - days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    this.#chart.timeScale().setVisibleRange({ from: from as Time, to: last as Time });
    this.#settle();
  }

  /** Keyboard crosshair. Arrow keys step one session; the readout announces it. */
  moveCrosshair(index: number): void {
    const d = this.#data;
    const i = Math.min(Math.max(index, 0), d.d.length - 1);
    this.#chart.setCrosshairPosition(d.c[i]!, d.d[i] as Time, this.#candles);
  }

  clearCrosshair(): void {
    this.#chart.clearCrosshairPosition();
  }

  applyTheme(): void {
    const t = readTokens();
    this.#chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.muted,
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
