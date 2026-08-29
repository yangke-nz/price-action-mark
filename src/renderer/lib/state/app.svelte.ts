/**
 * One store for the whole window. Components read from it and call its
 * methods; none of them talk to the source, the chart or each other directly.
 *
 * Runes rather than the old store contract: `$state` fields on a class give
 * deep reactivity with no subscribe/unsubscribe ceremony, and `$derived`
 * recomputes only what actually changed when a 6,500-bar dataset swaps in.
 */
import { source } from '$source';
import type { Bar, Dataset, DatasetOrigin, DatasetResult, MarkSettings, RangeId, Settings, ThemeChoice } from '$shared/types.ts';
import type { WindowState } from '$shared/ipc.ts';
import type { Viewport } from '$lib/chart/candles.ts';
import { EMA_PERIOD, ema } from '$shared/indicators.ts';
import { DEFAULT_SETTINGS } from '$lib/source/types.ts';
import { contractStarts } from '$shared/rolls.ts';
import type { Mark, MarkStore, RuleId, Verdict } from '$shared/marks/types.ts';
import { emptyStore } from '$shared/marks/types.ts';
import { buildCtx, type Ctx } from '$shared/marks/rule.ts';
import { RULES, detect, ruleFor } from '$shared/marks/registry.ts';
import { readAt, readingIndex, type BarReading } from '$shared/marks/reading.ts';
import { INTERVALS, intervalOf, rangeFor, specOf, type Interval } from '$shared/interval.ts';
import { SESSIONS, applySession, markScope, sourceIntervalFor, type Session } from '$shared/session.ts';
import { dailyFrom } from '$shared/aggregate.ts';

/** The table is viewport-scoped, but a MAX viewport is 6,550 rows on daily and
 *  11,600 on a 60-day 5-minute pull, and nobody scrolls either. Show the newest
 *  slice and say so. */
export const TABLE_CAP = 400;

/** The mark list is viewport-scoped too, and for the same reason. */
export const MARK_LIST_CAP = 200;

/** So is the bar reading, which unlike the other two has a line for EVERY bar
 *  in view — a MAX viewport is 6,550 of them on daily, 11,600 intraday. */
export const READING_CAP = 300;

/**
 * Every preset, in days. Which are OFFERED is a property of the bar size —
 * `INTERVALS[x].ranges` — because a 5-year button against a 60-day intraday
 * archive shows the same thing as MAX while implying history that is not
 * there. The days are shared: the chart moves a viewport, and a viewport is
 * measured in time whatever the bars are made of.
 */
export const RANGES: { id: RangeId; days: number; label: string }[] = [
  { id: '1D', days: 1, label: '1 day' },
  { id: '3D', days: 3, label: '3 days' },
  { id: '1W', days: 7, label: '1 week' },
  { id: '2W', days: 14, label: '2 weeks' },
  { id: '1M', days: 31, label: '1 month' },
  { id: '3M', days: 92, label: '3 months' },
  { id: '6M', days: 183, label: '6 months' },
  { id: '1Y', days: 366, label: '1 year' },
  { id: '5Y', days: 1827, label: '5 years' },
  { id: 'MAX', days: Number.POSITIVE_INFINITY, label: 'Full history' },
];

export function rangesFor(interval: Interval): { id: RangeId; days: number; label: string }[] {
  const offered = INTERVALS[interval].ranges;
  return RANGES.filter((r) => offered.includes(r.id));
}

/**
 * Bars a Page Up / Page Down jumps.
 *
 * A COUNT of bars, and named so the chart's accessible description can quote
 * it. It used to be an inline 21 described as "about a month", which is true
 * of daily sessions and is 105 minutes of a five-minute chart.
 */
export const PAGE_STEP = 21;

export type Status = 'loading' | 'ready' | 'refreshing';

export interface Notice {
  tone: 'info' | 'error';
  text: string;
}

export class AppState {
  /**
   * Exactly what the source returned, before the session window.
   *
   * Held separately so RTH/ETH is a re-derive rather than a re-fetch: one
   * network pull serves both, and switching is the cost of filtering 11,609
   * bars (3 ms) plus recomputing metrics and rules, not a round trip.
   */
  #raw = $state<Dataset | null>(null);

  /**
   * The series everything else reads — the raw pull reduced to the chosen
   * session.
   *
   * A derived value rather than a stored one, so nothing can hold a dataset
   * that disagrees with the session setting. Note that this is what the CHART,
   * the marking layer and the exports all see: an RTH chart whose ATR was
   * computed over the overnight would not be an RTH chart.
   */
  dataset = $derived.by((): Dataset | null => {
    const raw = this.#raw;
    if (raw === null) return null;
    const windowed = applySession(raw, this.settings.session);
    // A DAILY chart holding intraday bars means one thing: the reader asked
    // for RTH daily, which the feed does not have — its daily bar is the whole
    // Globex day. So it is built here, from the session-filtered intraday
    // series. The aggregate carries `window` so everything downstream, the
    // export filename included, knows which of the two it is.
    //
    // `can.timeframes` FIRST, and it is load-bearing. `settings.interval` is a
    // REQUEST, and only a target that can switch bar size is in a position to
    // make one. The artifact carries a single snapshot and IS whatever bar size
    // that snapshot holds — it never patches `interval`, so the stored `1d`
    // there is a default that means nothing. Without this guard, an artifact
    // built from `data/es_5m.json` matched this branch and silently AGGREGATED
    // its own 11,609 five-minute bars into 44 daily ones: a page published as a
    // 5-minute chart rendering as a daily one. This is the same fault the note
    // about `app.interval` describes, which moved rather than being fixed —
    // reading the dataset stopped the LABEL lying, and left the transform.
    // Read `source.can` rather than `this.can`: class fields initialise in
    // declaration order and `can` is declared far below this one.
    return source.can.timeframes && this.settings.interval === '1d' && specOf(raw).intraday
      ? dailyFrom(windowed, this.settings.session)
      : windowed;
  });

  origin = $state<DatasetOrigin>('bundled');
  status = $state<Status>('loading');
  notice = $state<Notice | null>(null);

  settings = $state<Settings>({
    ...DEFAULT_SETTINGS,
    marks: {
      enabled: DEFAULT_SETTINGS.marks.enabled,
      show: DEFAULT_SETTINGS.marks.show,
      stopTarget: DEFAULT_SETTINGS.marks.stopTarget,
      rules: { ...DEFAULT_SETTINGS.marks.rules },
      folded: { ...DEFAULT_SETTINGS.marks.folded },
    },
    window: { ...DEFAULT_SETTINGS.window },
  });

  /**
   * The bar size of the series in hand, which is NOT always the one on screen.
   *
   * On an RTH daily chart the raw is 5-minute and the dataset is daily, so
   * anything that talks to the SOURCE — refresh, and the boot push — has to ask
   * for what it is actually holding. `interval` stays the reader's answer:
   * what the chart is of.
   */
  #sourceInterval = $derived(this.#raw ? intervalOf(this.#raw) : this.settings.interval);

  /** Crosshair driven by the pointer. */
  hoverIndex = $state<number | null>(null);
  /** Crosshair driven by the arrow keys; takes precedence while it is set. */
  keyIndex = $state<number | null>(null);
  viewport = $state<Viewport>({ from: 0, to: 0, rollsHidden: false, barMarksHidden: false, barNumbersHidden: false });

  /** OS preference, tracked so `theme: 'system'` resolves without a reload. */
  systemDark = $state(false);

  /**
   * Metrics and structure for the loaded dataset, built once and shared.
   *
   * Hoisted out of `#allMarks` because the bar reading needs the same columns:
   * two `buildCtx` calls would walk 6,550 bars twice and, worse, could be
   * given different structure dials and quietly disagree about what a pullback
   * was. Measured on the shipped series: 8.4 ms.
   */
  #ctx = $derived.by((): Ctx | null => (this.dataset ? buildCtx(this.dataset) : null));

  /**
   * Detection runs EVERY rule once per dataset and toggling filters the
   * result. Measured on the shipped series: 42 ms to detect all thirty-one
   * against 0.26 ms to filter — so re-detecting on each toggle would make a
   * checkbox two orders of magnitude more expensive than it needs to be, and
   * the memory cost is one array of 11,026 small objects.
   *
   * Never persisted. Rule output is a pure function of the dataset and the
   * rule config; storing it would let it drift out of alignment with the
   * candles the moment a session arrives.
   */
  #allMarks = $derived.by((): Mark[] => {
    const ctx = this.#ctx;
    return ctx ? detect(ctx) : [];
  });

  /** A rule is on unless the reader has said otherwise — `settings.marks.rules`
   *  is sparse, so an absent entry means "whatever the rule itself defaults to". */
  enabledRules = $derived.by((): Set<RuleId> => {
    const overrides = this.settings.marks.rules;
    return new Set(RULES.filter((r) => overrides[r.id] ?? r.defaultOn).map((r) => r.id));
  });

  /**
   * Which rules the panel keeps folded away, and which it therefore withholds.
   *
   * Two sets, because they answer two different questions and the panel needs
   * both. `foldedRules` is THE SETTING — the ids marked less-used, whether they
   * are switched on or not, which is what gives a rule its quieter name and
   * what the sheet's Fold box reflects. `hiddenRules` is the EFFECT: folded
   * minus enabled, because a folded rule that is ON is never hidden. Otherwise
   * the chart wears marks whose toggle is nowhere on the page — the mirror of
   * not rendering a control that would not work.
   *
   * `settings.marks.folded` is sparse, so an absent id means "whatever the
   * rule's own `tier` says".
   */
  foldedRules = $derived.by((): Set<RuleId> => {
    const over = this.settings.marks.folded;
    return new Set(RULES.filter((r) => over[r.id] ?? r.tier === 'extra').map((r) => r.id));
  });

  hiddenRules = $derived.by((): Set<RuleId> => {
    const on = this.enabledRules;
    return new Set([...this.foldedRules].filter((id) => !on.has(id)));
  });

  /**
   * The reader's decision on each candidate, keyed by the mark's stable id.
   * This — and nothing else about marking — is what persists.
   */
  markStore = $state<MarkStore>(emptyStore('series'));

  /** Which store is loaded — see `markScope`. Tracked so a window or timeframe
   *  switch reloads the verdicts only when it actually changed store. */
  #markScope = '';

  /**
   * Load the verdict store the series on screen belongs to.
   *
   * Called after every load that can change the window or the bar size. The
   * store used to be fetched once, at boot, which is why switching an ETH daily
   * chart to RTH carried the ETH verdicts straight over onto bars that share
   * their dates and nothing else.
   */
  async #adoptMarks(): Promise<void> {
    const ds = this.dataset;
    if (!ds) return;
    const scope = markScope(ds);
    if (scope === this.#markScope) return;
    this.#markScope = scope;
    try {
      this.markStore = await source.getMarks(scope);
    } catch {
      this.markStore = emptyStore(scope);
    }
  }

  verdictOf(id: string): Verdict | undefined {
    return this.markStore.verdicts[id];
  }

  /**
   * Rules propose, the reader disposes.
   *
   * Dismissed marks are gone from every view: keeping them visible-but-faded
   * would mean dismissing a rule's noise never actually quietens the chart.
   * `show: 'confirmed'` is the publishing mode — it hides everything the reader
   * has not explicitly stood behind, which is what should travel in an artifact.
   */
  marks = $derived.by((): Mark[] => {
    if (!this.settings.marks.enabled) return [];
    const on = this.enabledRules;
    const verdicts = this.markStore.verdicts;
    const confirmedOnly = this.settings.marks.show === 'confirmed';
    return this.#allMarks.filter((mk) => {
      if (!on.has(mk.rule)) return false;
      const verdict = verdicts[mk.id];
      if (verdict === 'dismissed') return false;
      return confirmedOnly ? verdict === 'confirmed' : true;
    });
  });

  /**
   * The mark the reader clicked in the list, highlighted on the chart.
   *
   * Transient view state, deliberately NOT persisted and deliberately not a
   * verdict: it says "show me where this one is", which is a different act
   * from standing behind it. Clicking a mark on the canvas still means Keep.
   */
  selectedMarkId = $state<string | null>(null);

  /**
   * The selection resolved against what is actually on the chart.
   *
   * Read this rather than the id. A selection only SHOWS while its mark is
   * still drawn, so dropping the mark, switching its rule off, or turning
   * marking off entirely clears the highlight BY CONSTRUCTION — no cleanup
   * effect that has to remember every way a mark can leave the chart.
   *
   * The id itself is deliberately kept, not cleared: switch the rule back on
   * and the reader's place comes back with it. Same argument as keeping
   * verdicts for marks that no longer regenerate — a toggle should not throw
   * away a decision the reader made.
   */
  selectedMark = $derived.by((): Mark | null => {
    const id = this.selectedMarkId;
    if (id === null) return null;
    return this.marks.find((mk) => mk.id === id) ?? null;
  });

  /** Clicking the selected mark again clears it, so the highlight is never a
   *  state the reader has to hunt for a way out of. */
  selectMark(id: string): void {
    this.selectedMarkId = this.selectedMarkId === id ? null : id;
  }

  clearMarkSelection(): void {
    this.selectedMarkId = null;
  }

  confirmedCount = $derived.by((): number =>
    Object.values(this.markStore.verdicts).filter((v) => v === 'confirmed').length);
  dismissedCount = $derived.by((): number =>
    Object.values(this.markStore.verdicts).filter((v) => v === 'dismissed').length);

  /**
   * The viewport clamped to the series — the one window every viewport-scoped
   * list reads.
   *
   * The chart reports its range on a 160 ms settle and can report one bar past
   * the end mid-refresh, so the clamp has to happen somewhere; it happens once
   * here rather than four times, because four copies of `Math.min(viewport.to,
   * n - 1)` are four chances for the table, the mark list and the reading to
   * disagree about what is on screen.
   */
  #span = $derived.by((): { from: number; to: number } | null => {
    const n = this.count;
    if (n === 0) return null;
    const to = Math.min(this.viewport.to, n - 1);
    return { from: Math.max(0, Math.min(this.viewport.from, to)), to };
  });

  /** Marks whose anchor is inside the window, newest first, uncapped. */
  #marksInView = $derived.by((): Mark[] => {
    const d = this.dataset;
    const span = this.#span;
    if (!d || !span) return [];
    const lo = d.d[span.from];
    const hi = d.d[span.to];
    if (lo === undefined || hi === undefined) return [];
    const inView = this.marks.filter((mk) => mk.at >= lo && mk.at <= hi);
    inView.reverse();
    return inView;
  });

  /**
   * Marks whose anchor sits inside the current viewport, newest first and
   * capped the way the data table is. A MAX viewport holds every mark in the
   * series and nobody scrolls three thousand rows.
   */
  visibleMarks = $derived.by((): Mark[] => this.#marksInView.slice(0, MARK_LIST_CAP));

  markListTruncated = $derived(this.#marksInView.length > MARK_LIST_CAP);

  /** How many marks each rule contributes right now, for the panel. */
  markCounts = $derived.by((): Map<RuleId, number> => {
    const out = new Map<RuleId, number>();
    for (const mk of this.#allMarks) out.set(mk.rule, (out.get(mk.rule) ?? 0) + 1);
    return out;
  });

  // ---- bar reading -----------------------------------------------------

  /**
   * One line per session in view, newest first — the tape in words.
   *
   * Newest first for the same reason the data table is: the reader's question
   * is almost always "what has just happened", and a list that answers it
   * without scrolling is worth more than chronological order.
   *
   * Deliberately built from the UNFILTERED marks. A rule toggle changes what
   * is DRAWN; it does not change what a bar did, and a reading that lost its
   * "breakout" clause because the reader hid the arrows would be a lie about
   * the session.
   */
  /**
   * The two lookups every reading needs, built once per dataset rather than
   * per reading. The readout asks for one bar on every crosshair move; without
   * this that is 8,400 map inserts per pointer event.
   */
  #readingIndex = $derived.by(() => {
    const ctx = this.#ctx;
    return ctx ? readingIndex(ctx, this.#allMarks) : null;
  });

  visibleReadings = $derived.by((): BarReading[] => {
    const ctx = this.#ctx;
    const index = this.#readingIndex;
    const span = this.#span;
    if (!ctx || !index || !span) return [];
    const from = Math.max(span.from, span.to - READING_CAP + 1);
    const out: BarReading[] = [];
    for (let i = span.to; i >= from; i--) out.push(readAt(ctx, index, i));
    return out;
  });

  /**
   * The reading of whatever session the readout is describing.
   *
   * Reads `focusIndex`, so it follows the crosshair, the arrow keys and a
   * clicked line in that order — one line of prose about the bar in front of
   * the reader, without them having to look anywhere else.
   */
  focusReading = $derived.by((): BarReading | null => {
    const ctx = this.#ctx;
    const index = this.#readingIndex;
    const i = this.focusIndex;
    if (!ctx || !index || i === null) return null;
    return readAt(ctx, index, i);
  });

  readingTruncated = $derived.by((): boolean => {
    const span = this.#span;
    return span !== null && span.to - span.from + 1 > READING_CAP;
  });

  /**
   * The session the reader clicked in the reading list, held as its DATE.
   *
   * Its own state rather than a reuse of `keyIndex`: the keyboard crosshair
   * takes precedence over the pointer, so driving this through it would freeze
   * the readout and stop the chart's own hover from updating it. Transient
   * view state, never persisted — the same contract `selectedMarkId` holds.
   *
   * A DATE, not an index, for the same reason `selectedMarkId` is an id: this
   * survives into a dataset it was not measured against. `dataset` is DERIVED,
   * so it changes length with nothing loaded and `#apply` never called — 5m
   * RTH to daily RTH is a pure re-derive of the bars in hand. An index then
   * stays perfectly in range and names a different bar: measured, a line
   * clicked at 21 Aug 2026 on the RTH daily chart moved the readout and the
   * highlight to 01 Jul 2026 16:30 UTC on the switch to 5-minute bars, seven
   * weeks from the session the reader picked. Bounds-checking `focusIndex`
   * catches only the out-of-range half of that. A date either finds its bar or
   * finds nothing, and the highlight clears itself BY CONSTRUCTION — exactly
   * what `selectedMark` does when its mark stops being drawn.
   */
  selectedBarDate = $state<string | null>(null);

  /** The selection resolved against the series actually on screen; null when
   *  this window does not contain that bar. */
  selectedBarIndex = $derived.by((): number | null => {
    const at = this.selectedBarDate;
    if (at === null) return null;
    const i = this.dataset?.d.indexOf(at) ?? -1;
    return i < 0 ? null : i;
  });

  /** Clicking the selected line again clears it, so the highlight is never a
   *  state the reader has to hunt for a way out of. */
  selectBar(i: number): void {
    const at = this.dataset?.d[i] ?? null;
    this.selectedBarDate = at !== null && at === this.selectedBarDate ? null : at;
  }

  clearBarSelection(): void {
    this.selectedBarDate = null;
  }

  readonly can = source.can;
  readonly target = source.kind;

  count = $derived(this.dataset?.d.length ?? 0);

  /**
   * What the readout is describing: keyboard beats pointer beats a clicked
   * reading beats the last session, so the panel is never blank.
   *
   * The reading sits BELOW the pointer on purpose. Clicking a line should tell
   * the readout which session it was — but moving the pointer back over the
   * candles has to take the readout with it, or the reader is left with a
   * readout stuck on a bar they have finished with.
   *
   * ALL THREE ARE BOUNDS-CHECKED, and that is the SECOND of two guards, not
   * the only one. They are positions in a dataset that is DERIVED, so it can
   * change length underneath them: RTH/ETH intraday is a pure re-derive
   * (11,609 bars to 3,402) and so is 5-minute RTH to daily RTH (3,402 to 42).
   * Unchecked, an index past the end left the readout on dashes and
   * `focusReading` reading a bar that does not exist — prose, so it came out
   * as "flat bar — trading range, LNaN" rather than as an error.
   *
   * Bounds are only half of it, and treating them as the whole fix is what
   * shipped: an index can stay perfectly IN range and name a different
   * session. Measured — a reading line clicked at 21 Aug 2026 on the RTH
   * daily chart put the readout on 01 Jul 2026 16:30 UTC after the switch to
   * 5-minute bars. So the reading selection is held as a DATE
   * (`selectedBarDate`) and the two positional crosshairs are dropped by
   * `#dropCrosshair()` on every path that changes the bars, load or re-derive.
   * This check is what catches whatever those two miss.
   */
  focusIndex = $derived.by((): number | null => {
    const n = this.count;
    const has = (i: number | null): i is number => i !== null && i >= 0 && i < n;
    if (has(this.keyIndex)) return this.keyIndex;
    if (has(this.hoverIndex)) return this.hoverIndex;
    if (has(this.selectedBarIndex)) return this.selectedBarIndex;
    return n > 0 ? n - 1 : null;
  });

  focusBar = $derived.by(() => this.bar(this.focusIndex));
  lastBar = $derived.by(() => this.bar(this.count > 0 ? this.count - 1 : null));

  resolvedTheme = $derived.by((): 'light' | 'dark' => {
    if (this.settings.theme === 'system') return this.systemDark ? 'dark' : 'light';
    return this.settings.theme;
  });

  /** Sessions inside the current viewport, newest first, capped. */
  visibleRows = $derived.by((): Bar[] => {
    const span = this.#span;
    if (!span) return [];
    const start = Math.max(span.from, span.to - TABLE_CAP + 1);
    const rows: Bar[] = [];
    for (let i = span.to; i >= start; i--) {
      const bar = this.bar(i);
      if (bar) rows.push(bar);
    }
    return rows;
  });

  visibleCount = $derived(Math.max(0, Math.min(this.viewport.to, this.count - 1) - this.viewport.from + 1));
  tableTruncated = $derived(this.visibleCount > this.visibleRows.length);

  /** The bars the UI calls a roll: the first session of each new contract, and
   *  deliberately NOT `dataset.rolls`, which holds the expiries. The expiry's
   *  own change is an ordinary same-contract move; the carry is the session
   *  after it — 2024-12-20 falls 0.49%, and 2024-12-23 gains 3.35% that nobody
   *  traded. Flagging the expiry warns off a real move and stays silent on the
   *  one worth disregarding. */
  #rollSet = $derived(
    new Set(this.dataset ? contractStarts(this.dataset.d, this.dataset.rolls) : []),
  );

  /** The full EMA column. Derived rather than stored, so a refresh cannot
   *  leave a stale average lined up against fresh candles. */
  emaSeries = $derived.by((): (number | null)[] =>
    this.dataset ? ema(this.dataset.c, EMA_PERIOD) : []);

  emaPeriod = EMA_PERIOD;

  /** The average at whatever session the readout is describing — null through
   *  the first 19 sessions, where it does not exist yet. */
  focusEma = $derived.by((): number | null => {
    const i = this.focusIndex;
    return i === null ? null : this.emaSeries[i] ?? null;
  });

  /** Close relative to the average: the one thing the line is read for. */
  focusEmaGap = $derived.by((): { abs: number; pct: number } | null => {
    const bar = this.focusBar;
    const avg = this.focusEma;
    if (!bar || avg === null || avg === 0) return null;
    return { abs: bar.close - avg, pct: (bar.close / avg - 1) * 100 };
  });

  bar(i: number | null): Bar | null {
    const d = this.dataset;
    if (!d || i === null || i < 0 || i >= d.d.length) return null;
    return {
      i,
      date: d.d[i]!,
      open: d.o[i]!,
      high: d.h[i]!,
      low: d.l[i]!,
      close: d.c[i]!,
      volume: d.v[i]!,
      isRoll: this.#rollSet.has(i),
    };
  }

  /** Session change: against the previous close where there is one, else
   *  against this bar's own open. Note that across a roll marker this is carry
   *  rather than a tradable return -- the UI labels those bars for that reason. */
  change(i: number): { abs: number; pct: number } {
    const d = this.dataset;
    if (!d) return { abs: 0, pct: 0 };
    const close = d.c[i]!;
    const base = i > 0 ? d.c[i - 1]! : d.o[i]!;
    return { abs: close - base, pct: base === 0 ? 0 : (close / base - 1) * 100 };
  }

  // ---- lifecycle -------------------------------------------------------

  async boot(): Promise<void> {
    this.#merge(await source.getSettings());
    // What the stored pair actually has to LOAD, which for RTH daily is the
    // intraday series those bars are aggregated from. Asking for `interval`
    // here loaded the feed's 24-hour daily bars and left the session control
    // saying RTH over them — and since the setting already said RTH, clicking
    // it was a no-op and the only way back was ETH and then RTH again.
    const want = sourceIntervalFor(this.settings.interval, this.settings.session);
    try {
      let result: DatasetResult;
      try {
        result = await source.load(want);
      } catch (err) {
        if (want === this.settings.interval) throw err;
        // The RTH daily source is intraday and ships no offline seed, so this
        // is a real possibility on a cold offline start. Fall back to the
        // feed's own daily bars rather than showing nothing — and say so,
        // because `session` then reports what is on screen rather than what
        // was asked for and the control would otherwise change under them
        // with no explanation.
        result = await source.load(this.settings.interval);
        this.notice = {
          tone: 'error',
          text: `Could not build ${SESSIONS.rth.label} daily bars: ${message(err)}. Showing ${SESSIONS.eth.label} instead.`,
        };
      }
      this.#apply(result.dataset, result.origin);
      // After the dataset, because the store is keyed off it.
      await this.#adoptMarks();
      if (result.error) this.notice = { tone: 'error', text: result.error };
    } catch (err) {
      this.notice = { tone: 'error', text: `Could not load any dataset: ${message(err)}` };
    }
    this.status = 'ready';
  }

  async refresh(): Promise<void> {
    if (!this.can.refresh || this.status === 'refreshing') return;
    this.status = 'refreshing';
    this.notice = null;
    try {
      const result = await source.refresh(this.#sourceInterval);
      // Against the RAW length, not `count`: `count` is post-session-filter, so
      // comparing the two would report a refresh as having lost 71% of its bars
      // whenever RTH is on.
      const grew = result.dataset.d.length - (this.#raw?.d.length ?? 0);
      this.#apply(result.dataset, result.origin);
      this.notice = result.error
        ? { tone: 'error', text: `Refresh failed, showing the ${result.origin}: ${result.error}` }
        : { tone: 'info', text: grew > 0 ? `Refreshed — ${grew} new session${grew === 1 ? '' : 's'}.` : 'Refreshed — already current.' };
    } catch (err) {
      this.notice = { tone: 'error', text: `Refresh failed: ${message(err)}` };
    }
    this.status = 'ready';
  }

  /**
   * A refresh the user did not ask for, landing behind the window. Adopted
   * quietly: no notice, because nothing went wrong and a toast for "the data
   * you were already looking at is now one session newer" is noise.
   *
   * Skipped while a user-initiated refresh is in flight — that one reports its
   * own result, and applying both would reset the crosshair twice.
   */
  adopt(result: DatasetResult): void {
    if (this.status === 'refreshing') return;
    // Not for the timeframe on screen. The boot refresh is fired for whatever
    // interval the window opened on, and the reader can switch before it
    // lands; adopting it would swap 60 days of 5-minute bars for 26 years of
    // daily ones under them, silently.
    if (intervalOf(result.dataset) !== this.#sourceInterval) return;
    const current = this.#raw;
    if (current && current.fetched === result.dataset.fetched) return;
    this.#apply(result.dataset, result.origin);
  }

  #apply(dataset: Dataset, origin: DatasetOrigin): void {
    this.#raw = dataset;
    this.origin = origin;
    this.#dropCrosshair();
  }

  /**
   * Forget the two POSITIONAL crosshairs.
   *
   * `keyIndex` and `hoverIndex` are bar positions, so they mean nothing once
   * the bars change — and the bars change on a re-derive as well as on a load:
   * RTH/ETH intraday is 11,609 bars to 3,402, and 5-minute RTH to daily RTH is
   * 3,402 to 42, neither of which goes anywhere near `#apply`. In range but
   * naming a different session is the failure mode, and `focusIndex`'s bounds
   * check cannot see it. The reading-list selection is NOT cleared here: it is
   * held as a date and resolves itself, so it survives a switch that still
   * contains that bar and vanishes on one that does not.
   */
  #dropCrosshair(): void {
    this.keyIndex = null;
    this.hoverIndex = null;
  }

  // ---- settings --------------------------------------------------------

  /**
   * Field-wise, and deliberately not `settings = { ...settings, ...patch }`.
   *
   * Replacing the object invalidates every reader of every field, so toggling
   * Volume would also re-fire the effect that watches `settings.range` — and
   * that effect calls setVisibleRange, which would snap a panned chart back to
   * the preset. Assigning only the fields that actually changed keeps the
   * invalidation as narrow as the change.
   */
  #merge(next: Partial<Settings>): void {
    const s = this.settings;
    if (next.theme !== undefined && next.theme !== s.theme) s.theme = next.theme;
    if (next.interval !== undefined && next.interval !== s.interval) s.interval = next.interval;
    if (next.session !== undefined && next.session !== s.session) s.session = next.session;
    if (next.range !== undefined && next.range !== s.range) s.range = next.range;
    if (next.showRolls !== undefined && next.showRolls !== s.showRolls) s.showRolls = next.showRolls;
    if (next.showEma !== undefined && next.showEma !== s.showEma) s.showEma = next.showEma;
    // Field-wise all the way down, and NOT `s.marks = next.marks`. Replacing
    // the nested object invalidates every reader of `settings`, so toggling
    // one rule would re-fire the effect watching `settings.range` — which
    // calls setVisibleRange and snaps a panned chart back to the preset.
    if (next.marks !== undefined) {
      if (next.marks.enabled !== s.marks.enabled) s.marks.enabled = next.marks.enabled;
      if (next.marks.show !== undefined && next.marks.show !== s.marks.show) s.marks.show = next.marks.show;
      if (next.marks.stopTarget !== undefined && next.marks.stopTarget !== s.marks.stopTarget) {
        s.marks.stopTarget = next.marks.stopTarget;
      }
      const rules = next.marks.rules;
      for (const [id, on] of Object.entries(rules)) {
        if (s.marks.rules[id] !== on) s.marks.rules[id] = on;
      }
      // `rules` is sparse for the same reason `folded` is, so it has to be able
      // to SHRINK. A merge that only ever added left a rule the reader had put
      // back on its shipped default stored forever, which is exactly what
      // sparseness exists to prevent — a later change to that default could
      // then never reach them.
      for (const id of Object.keys(s.marks.rules)) {
        if (!(id in rules)) delete s.marks.rules[id];
      }
      if (next.marks.folded !== undefined) {
        const incoming = next.marks.folded;
        for (const [id, folded] of Object.entries(incoming)) {
          if (s.marks.folded[id] !== folded) s.marks.folded[id] = folded;
        }
        // Field-wise MUST still delete here. `folded` is sparse and taking an
        // override back is a key going away, so a merge that only ever adds
        // would leave the reader with a fold they had just undone.
        for (const id of Object.keys(s.marks.folded)) {
          if (!(id in incoming)) delete s.marks.folded[id];
        }
      }
    }
    // `window` is main's business. Nothing in the renderer reads it, so it is
    // deliberately not mirrored here — copying a fresh object across on every
    // patch would be one more needless invalidation.
  }

  async patch(patch: Partial<Settings>): Promise<void> {
    this.#merge(patch);                    // optimistic: the UI must not lag a click
    try {
      // `$state.snapshot` is not optional, and this is the one seam where every
      // setting crosses. `settings.marks.rules` and `.folded` are rune-backed,
      // which means PROXIES, and a proxy cannot be structured-cloned — so
      // `ipcRenderer.invoke` rejected every marks patch with "An object could
      // not be cloned" and the catch below swallowed it. Rule toggles, folds,
      // Show marks and Confirmed only all survived the session and were gone on
      // the next launch. Snapshotting here rather than at each of the four call
      // sites means a fifth cannot reintroduce it.
      this.#merge(await source.patchSettings($state.snapshot(patch) as Partial<Settings>));
    } catch (err) {
      // Still not fatal — the session keeps the change either way — but it is
      // no longer INVISIBLE. The bug above lived for a whole release behind a
      // bare `catch {}`.
      this.notice = { tone: 'error', text: `Could not save settings: ${message(err)}` };
    }
  }

  // ---- timeframe ---------------------------------------------------------

  /**
   * The bar size on screen — read from the DATASET, not from the setting.
   *
   * The setting is a request; the loaded dataset is the answer, and the two can
   * legitimately differ. The artifact is the case that proves it: it carries one
   * snapshot, cannot switch and therefore never patches the setting, so an
   * artifact built from a 5-minute snapshot had `settings.interval === '1d'`
   * and told the reader "Daily bars" over intraday candles. Falls back to the
   * setting only before the first load, which is what `boot()` asks with.
   */
  interval = $derived<Interval>(
    this.dataset ? intervalOf(this.dataset) : this.settings.interval,
  );

  /** The presets this bar size offers — see `rangesFor`. */
  ranges = $derived(rangesFor(this.interval));

  /**
   * The range actually in force, which is the stored one only if this interval
   * offers it.
   *
   * Resolved here rather than only when settings are coerced, because the
   * artifact never coerces: a stored `6M` against a 5-minute snapshot would
   * leave every preset button unpressed and the chart on a range the control
   * cannot show. Read this; `settings.range` is what is on disk.
   */
  range = $derived(rangeFor(this.interval, this.settings.range));

  intervalLabel = $derived(INTERVALS[this.interval].label);
  /** The adjective form, so `${intervalBars} bars` reads: "5-minute bars", not
   *  "5 minutes bars". */
  intervalBars = $derived(INTERVALS[this.interval].bars);

  /** True while the loaded dataset's bars carry a time of day. */
  intraday = $derived(this.dataset ? specOf(this.dataset).intraday : false);

  /**
   * The session window ON SCREEN — read from the loaded series, not from the
   * setting, for exactly the reason `interval` is.
   *
   * The setting is a request; the series in hand is the answer. A DAILY series
   * that came from the feed covers the whole Globex day whatever the setting
   * says, because an RTH daily bar has to be aggregated out of intraday ones
   * and this is not that. Reading the setting here is what let the control sit
   * on RTH over 24-hour candles — and made clicking RTH a no-op, since the
   * setting it compares against already said so.
   *
   * Intraday, and for an aggregate, the two always agree.
   */
  session = $derived<Session>(
    this.#raw !== null && !specOf(this.#raw).intraday ? 'eth' : this.settings.session,
  );
  sessionLabel = $derived(SESSIONS[this.session].label);

  /** True when the session control has something to do: always intraday, and
   *  on daily only where a second dataset can be fetched to aggregate from. */
  sessionApplies = $derived(this.intraday || this.can.timeframes);

  /** True when the daily bars on screen were built here rather than fetched —
   *  which is what bounds their span, and what the notes card explains. */
  aggregated = $derived(this.dataset?.window !== undefined);

  /**
   * What the chart is OF, for the masthead heading and the chart's accessible
   * name: `daily bars`, or `5-minute bars, RTH`.
   *
   * The bar size is part of the subject, so the heading has to carry it — it
   * read "daily bars" over five-minute candles until the timeframe switch
   * existed. The product name stays in `<title>` and the footer.
   *
   * Declared AFTER `intraday` and `sessionLabel` on purpose: these are class
   * field initialisers and they run in declaration order, so a derived that
   * reads a field below it is not untidy, it is broken.
   */
  subjectLabel = $derived(
    `${this.intervalBars.toLowerCase()} bars${this.intraday || this.aggregated ? `, ${this.sessionLabel}` : ''}`,
  );

  /**
   * How many bars the session window is hiding, for the notes card.
   *
   * Zero when the dataset was aggregated: 11,609 five-minute bars became 42
   * daily ones, and calling the difference "held back" would be nonsense —
   * they were consumed, not dropped. The notes card says what happened instead.
   */
  hiddenBars = $derived(this.aggregated ? 0 : (this.#raw?.d.length ?? 0) - this.count);

  /**
   * Switch the session window.
   *
   * Intraday this is a pure re-derive of the series in hand — one pull serves
   * both windows. On DAILY it is a load, because an RTH daily bar does not
   * exist in the feed: it is aggregated from the 5-minute series, and going
   * back to ETH means the feed's own daily bars again.
   *
   * Loads BEFORE it commits, for the same reason `setInterval` does: the
   * intraday feed can fail, and committing first would leave the app claiming
   * an RTH daily chart while showing the 24-hour one.
   */
  async setSession(session: Session): Promise<void> {
    if (session === this.session) return;
    if (this.interval !== '1d') {
      // A re-derive, not a load, so `#apply` never runs — and 11,609 bars
      // become 3,402, which leaves both positional crosshairs on a different
      // session than the one they were put on.
      this.#dropCrosshair();
      await this.patch({ session });
      return;
    }
    if (!this.can.timeframes || this.status === 'refreshing') return;

    const need = sourceIntervalFor('1d', session);
    if (need === this.#sourceInterval) {
      this.#dropCrosshair();
      await this.patch({ session });
      await this.#adoptMarks();
      return;
    }

    this.status = 'refreshing';
    this.notice = null;
    try {
      const result = await source.load(need);
      if (intervalOf(result.dataset) !== need) {
        throw new Error(`asked for ${need} bars and got ${intervalOf(result.dataset)}`);
      }
      this.#apply(result.dataset, result.origin);
      await this.patch({ session });
      // The window is part of the verdict store's identity on a DAILY chart —
      // an RTH daily bar and an ETH one share a date and are not the same bar.
      await this.#adoptMarks();
      if (result.error) this.notice = { tone: 'error', text: result.error };
    } catch (err) {
      this.notice = {
        tone: 'error',
        text: `Could not build ${SESSIONS[session].label} daily bars: ${message(err)}`,
      };
    }
    this.status = 'ready';
  }


  /**
   * Switch bar size.
   *
   * Loads before it commits: an intraday timeframe ships no offline seed, so
   * the first switch needs the network and can fail. Committing the setting
   * first would leave the app claiming 5-minute bars while showing daily ones.
   *
   * The range is moved with it, because one stored range serves every
   * timeframe and `5Y` is not a preset a 60-day archive offers.
   */
  async setInterval(next: Interval): Promise<void> {
    if (next === this.interval || !this.can.timeframes || this.status === 'refreshing') return;
    this.status = 'refreshing';
    this.notice = null;
    try {
      // Daily + RTH is the one case where the interval asked for is not the
      // one loaded: those bars are aggregated from the intraday feed.
      const want = sourceIntervalFor(next, this.session);
      // ...and the one case where the series in hand is ALREADY the right one:
      // 5-minute RTH -> daily RTH is a re-derive of the bars on screen, not a
      // load. It went round the source anyway, which meant an IPC round trip
      // carrying 11,600 bars back for nothing. `setSession` has always had
      // this guard; this is the same one.
      if (want !== this.#sourceInterval) {
        const result = await source.load(want);
        if (intervalOf(result.dataset) !== want) {
          throw new Error(`asked for ${want} bars and got ${intervalOf(result.dataset)}`);
        }
        this.#apply(result.dataset, result.origin);
        if (result.error) this.notice = { tone: 'error', text: result.error };
      } else {
        // The bars underneath still change — this is the re-derive path, 3,402
        // five-minute bars to 42 daily ones — so the positional crosshairs go.
        // On the branch above `#apply` does it, and AFTER a successful load:
        // dropping them before would move the readout off the reader's bar on
        // a switch that then failed and changed nothing.
        this.#dropCrosshair();
      }
      await this.patch({ interval: next, range: rangeFor(next, this.settings.range) });
      // Daily and intraday do not share a verdict store on the same window —
      // see `#adoptMarks`.
      await this.#adoptMarks();
    } catch (err) {
      this.notice = {
        tone: 'error',
        text: `Could not load ${INTERVALS[next].label.toLowerCase()} bars: ${message(err)}`,
      };
    }
    this.status = 'ready';
  }

  setRange(range: RangeId): void { void this.patch({ range }); }
  setTheme(theme: ThemeChoice): void { void this.patch({ theme }); }
  toggleRolls(): void { void this.patch({ showRolls: !this.settings.showRolls }); }
  toggleEma(): void { void this.patch({ showEma: !this.settings.showEma }); }

  toggleMarks(): void {
    void this.patch({ marks: { ...this.settings.marks, enabled: !this.settings.marks.enabled } });
  }

  /** Clicking the verdict a mark already has clears it, back to a candidate. */
  setVerdict(id: string, verdict: Verdict): void {
    const next = { ...this.markStore.verdicts };
    if (next[id] === verdict) delete next[id];
    else next[id] = verdict;
    this.markStore = { ...this.markStore, verdicts: next };
    void this.#persistMarks();
  }

  clearVerdicts(): void {
    this.markStore = { ...this.markStore, verdicts: {} };
    void this.#persistMarks();
  }

  setMarkShow(show: 'all' | 'confirmed'): void {
    void this.patch({ marks: { ...this.settings.marks, show } });
  }

  /** The stop and target rails on an entry. Display only — see the field. */
  toggleStopTarget(): void {
    this.#patchMarks({ stopTarget: !this.settings.marks.stopTarget });
  }

  /**
   * `$state.snapshot` is not optional here.
   *
   * A rune-backed object is a PROXY, and a proxy cannot be structured-cloned,
   * so handing `this.markStore` straight to `ipcRenderer.invoke` throws "could
   * not be cloned" every time. It failed silently for exactly as long as this
   * catch swallowed it: the panel showed "1 kept" while nothing reached disk.
   * Anything crossing the bridge has to be snapshotted first.
   */
  async #persistMarks(): Promise<void> {
    try {
      this.markStore = await source.saveMarks($state.snapshot(this.markStore));
    } catch (err) {
      // Not swallowed. Persistence failing is a real fault the reader needs to
      // know about — they are making decisions they expect to keep.
      this.notice = { tone: 'error', text: `Could not save marks: ${message(err)}` };
    }
  }

  /**
   * Switch a rule on or off.
   *
   * An id whose new value agrees with the rule's own `defaultOn` is DELETED
   * rather than stored, exactly as `setRulesFolded` does — that is what makes
   * the record sparse, and it only ever ADDED before. A reader who switched a
   * rule off and back on left it pinned to today's default forever, so a later
   * tightening of that default could never reach them: the precise failure
   * sparseness exists to prevent.
   */
  toggleRule(id: RuleId): void {
    const next = !this.enabledRules.has(id);
    const rules = { ...this.settings.marks.rules };
    if (next === (ruleFor(id)?.defaultOn ?? true)) delete rules[id];
    else rules[id] = next;
    void this.#patchMarks({ rules });
  }

  /**
   * Fold rules away, or bring them back — one patch for however many ids.
   *
   * An id whose new value agrees with the rule's own `tier` is DELETED rather
   * than stored: the record has to be able to shrink, or a reader who once
   * matched today's shipped answer could never be reached by a later change to
   * it. That is the whole reason it is sparse.
   */
  setRulesFolded(ids: readonly RuleId[], folded: boolean): void {
    const next = { ...this.settings.marks.folded };
    let changed = false;
    for (const id of ids) {
      const authored = ruleFor(id)?.tier === 'extra';
      if (folded === authored) {
        if (id in next) { delete next[id]; changed = true; }
      } else if (next[id] !== folded) {
        next[id] = folded;
        changed = true;
      }
    }
    if (!changed) return;
    void this.#patchMarks({ folded: next });
  }

  /** Back to exactly what the build ships folded. */
  clearFolds(): void {
    if (Object.keys(this.settings.marks.folded).length === 0) return;
    void this.#patchMarks({ folded: {} });
  }

  /** Every mark patch sends the whole `marks` object, so it is built in one
   *  place rather than three that can drift about which fields to carry. */
  #patchMarks(part: Partial<MarkSettings>): void {
    const m = this.settings.marks;
    void this.patch({
      marks: {
        enabled: m.enabled,
        show: m.show,
        stopTarget: m.stopTarget,
        rules: m.rules,
        folded: m.folded,
        ...part,
      },
    });
  }

  /** The rules sheet, open or not. View state, never persisted — the same
   *  contract `selectedMarkId` holds. */
  rulesOpen = $state(false);

  openRules(): void { this.rulesOpen = true; }
  closeRules(): void { this.rulesOpen = false; }

  // ---- export ----------------------------------------------------------

  /**
   * Everything handed across the bridge is snapshotted first.
   *
   * `this.dataset` and `this.markStore` are rune-backed, which means PROXIES,
   * and a proxy cannot be structured-cloned — `ipcRenderer.invoke` rejects it
   * with "An object could not be cloned". Export was broken this way in v2.0.0
   * and nobody noticed, because the failure surfaced only as a notice nothing
   * asserted on. If you add a method that sends state to main, snapshot it.
   */
  async exportAs(kind: 'csv' | 'json' | 'marks'): Promise<void> {
    const d = this.dataset;
    if (!d || !this.can.export) return;
    try {
      const result = kind === 'marks'
        ? await source.exportMarks($state.snapshot(this.markStore))
        : kind === 'csv'
          ? await source.exportCsv($state.snapshot(d))
          : await source.exportJson($state.snapshot(d));
      if (result.status === 'saved') {
        this.notice = { tone: 'info', text: `Saved ${result.path}` };
      }
    } catch (err) {
      this.notice = { tone: 'error', text: `Export failed: ${message(err)}` };
    }
  }

  // ---- window ----------------------------------------------------------

  /**
   * True while the window is at full work-area height — held only so the button
   * can label itself.
   *
   * The OS is the authority, so main PUSHES this rather than the button setting
   * it: `Ctrl+Shift+M` acts straight through main, and a drag, an OS snap or a
   * display change moves the window with nothing telling the renderer at all.
   * Set by the button alone, the label sat on "Restore" over a window that was
   * no longer full height, and pressing it then maximized rather than restored
   * — the button doing the opposite of what it said.
   */
  fitted = $state(false);
  /** The left-edge gesture's own state: a window can be full-height and
   *  extended left at the same time, so one flag cannot serve both. */
  fittedLeft = $state(false);

  /** main's report of what the window is actually doing. */
  setWindowState(state: WindowState): void {
    this.fitted = state.fitted;
    this.fittedLeft = state.fittedLeft;
  }

  async fitHeight(): Promise<void> {
    if (!this.can.fitWindow) return;
    try {
      this.fitted = await source.fitHeight();
    } catch {
      /* the window went away mid-click */
    }
  }

  async fitLeft(): Promise<void> {
    if (!this.can.fitWindow) return;
    try {
      this.fittedLeft = await source.fitLeft();
    } catch {
      /* the window went away mid-click */
    }
  }

  // ---- crosshair -------------------------------------------------------

  /** Returns the new index so the caller can drive the chart, or null when the
   *  key was not one we handle. */
  stepKeyboard(key: string): number | null {
    const n = this.count;
    if (n === 0) return null;
    const current = this.keyIndex ?? this.hoverIndex ?? n - 1;
    switch (key) {
      case 'ArrowLeft':  return (this.keyIndex = Math.max(0, current - 1));
      case 'ArrowRight': return (this.keyIndex = Math.min(n - 1, current + 1));
      case 'PageUp':     return (this.keyIndex = Math.max(0, current - PAGE_STEP));
      case 'PageDown':   return (this.keyIndex = Math.min(n - 1, current + PAGE_STEP));
      case 'Home':       return (this.keyIndex = 0);
      case 'End':        return (this.keyIndex = n - 1);
      default:           return null;
    }
  }

  clearKeyboard(): void { this.keyIndex = null; }
  dismissNotice(): void { this.notice = null; }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const app = new AppState();
