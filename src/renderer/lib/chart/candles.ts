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

/** Quarterly rolls sit about 63 trading days apart. Below this many pixels of
 *  separation the arrows stop reading as annotations and become a fence. */
const MARKER_MIN_PX = 18;
const SESSIONS_PER_QUARTER = 63;

export interface Viewport {
  /** Inclusive bar indices currently on screen. */
  from: number;
  to: number;
  /** True while the roll markers are suppressed for density. */
  rollsHidden: boolean;
}

export interface CandleChartOptions {
  onHover(index: number | null): void;
  onViewport(viewport: Viewport): void;
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
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(container: HTMLElement, data: Dataset, opts: CandleChartOptions) {
    this.#container = container;
    this.#opts = opts;
    this.#data = data;

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
      priceFormat: { type: 'custom', minMove: 0.25, formatter: axisPrice },
    });

    this.#markers = createSeriesMarkers(this.#candles, []);
    this.setData(data);

    this.#chart.subscribeCrosshairMove((param) => {
      const time = param.time as string | undefined;
      const hit = time === undefined ? undefined : this.#indexOf.get(time);
      this.#opts.onHover(hit ?? null);
    });

    // Pan and zoom fire continuously; the table and the marker pass are only
    // worth doing once the gesture settles.
    this.#chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.#settle());
  }

  setData(data: Dataset): void {
    this.#data = data;
    const n = data.d.length;

    const bars: CandlestickData<Time>[] = new Array(n);
    this.#indexOf = new Map();
    for (let i = 0; i < n; i++) {
      const time = data.d[i] as Time;
      bars[i] = { time, open: data.o[i]!, high: data.h[i]!, low: data.l[i]!, close: data.c[i]! };
      this.#indexOf.set(data.d[i]!, i);
    }
    this.#candles.setData(bars);

    this.#rollMarkers = data.rolls
      .filter((i) => i >= 0 && i < n)
      .map((i) => ({
        time: data.d[i] as Time,
        position: 'belowBar' as const,
        shape: 'arrowUp' as const,
        color: readTokens().muted,
        size: 0.6,
        id: `roll-${data.d[i]}`,
      }));

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
      priceFormat: { type: 'custom', minMove: 0.25, formatter: axisPrice },
    });
    this.#ema.setData(this.#emaPoints);
  }

  setRollsVisible(visible: boolean): void {
    this.#showRolls = visible;
    this.#refreshMarkers();
  }

  #refreshMarkers(): void {
    if (!this.#showRolls) {
      this.#rollsHidden = false;
      this.#markers.setMarkers([]);
      return;
    }
    const range = this.#chart.timeScale().getVisibleLogicalRange();
    const width = this.#container.clientWidth;
    const spacing =
      range && width
        ? (width / Math.max(1, range.to - range.from)) * SESSIONS_PER_QUARTER
        : Number.POSITIVE_INFINITY;
    this.#rollsHidden = spacing < MARKER_MIN_PX;
    this.#markers.setMarkers(this.#rollsHidden ? [] : this.#rollMarkers);
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
    if (!range) return { from: 0, to: n - 1, rollsHidden: this.#rollsHidden };
    return {
      from: Math.max(0, Math.ceil(range.from)),
      to: Math.min(n - 1, Math.floor(range.to)),
      rollsHidden: this.#rollsHidden,
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
