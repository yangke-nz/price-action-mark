/**
 * One store for the whole window. Components read from it and call its
 * methods; none of them talk to the source, the chart or each other directly.
 *
 * Runes rather than the old store contract: `$state` fields on a class give
 * deep reactivity with no subscribe/unsubscribe ceremony, and `$derived`
 * recomputes only what actually changed when a 6,500-bar dataset swaps in.
 */
import { source } from '$source';
import type { Bar, Dataset, DatasetOrigin, DatasetResult, RangeId, Settings, ThemeChoice } from '$shared/types.ts';
import type { Viewport } from '$lib/chart/candles.ts';
import { EMA_PERIOD, ema } from '$shared/indicators.ts';
import { DEFAULT_SETTINGS } from '$lib/source/types.ts';
import { contractStarts } from '$shared/rolls.ts';
import type { Mark, MarkStore, RuleId, Verdict } from '$shared/marks/types.ts';
import { emptyStore } from '$shared/marks/types.ts';
import { buildCtx } from '$shared/marks/rule.ts';
import { RULES, detect } from '$shared/marks/registry.ts';

/** The table is viewport-scoped, but a MAX viewport is 6,500 rows and nobody
 *  scrolls that. Show the newest slice and say so. */
export const TABLE_CAP = 400;

/** The mark list is viewport-scoped too, and for the same reason. */
export const MARK_LIST_CAP = 200;

export const RANGES: { id: RangeId; days: number; label: string }[] = [
  { id: '1M', days: 31, label: '1 month' },
  { id: '3M', days: 92, label: '3 months' },
  { id: '6M', days: 183, label: '6 months' },
  { id: '1Y', days: 366, label: '1 year' },
  { id: '5Y', days: 1827, label: '5 years' },
  { id: 'MAX', days: Number.POSITIVE_INFINITY, label: 'Full history' },
];

export type Status = 'loading' | 'ready' | 'refreshing';

export interface Notice {
  tone: 'info' | 'error';
  text: string;
}

export class AppState {
  dataset = $state<Dataset | null>(null);
  origin = $state<DatasetOrigin>('bundled');
  status = $state<Status>('loading');
  notice = $state<Notice | null>(null);

  settings = $state<Settings>({
    ...DEFAULT_SETTINGS,
    marks: {
      enabled: DEFAULT_SETTINGS.marks.enabled,
      show: DEFAULT_SETTINGS.marks.show,
      rules: { ...DEFAULT_SETTINGS.marks.rules },
    },
    window: { ...DEFAULT_SETTINGS.window },
  });

  /** Crosshair driven by the pointer. */
  hoverIndex = $state<number | null>(null);
  /** Crosshair driven by the arrow keys; takes precedence while it is set. */
  keyIndex = $state<number | null>(null);
  viewport = $state<Viewport>({ from: 0, to: 0, rollsHidden: false, barMarksHidden: false });

  /** OS preference, tracked so `theme: 'system'` resolves without a reload. */
  systemDark = $state(false);

  /**
   * Detection runs EVERY rule once per dataset and toggling filters the
   * result. Measured on the shipped series: 34 ms to build the context and
   * detect all fifteen, against 0.26 ms to filter — so re-detecting on each
   * toggle would make a checkbox 130x more expensive than it needs to be, and
   * the memory cost is one array of 8,391 small objects.
   *
   * Never persisted. Rule output is a pure function of the dataset and the
   * rule config; storing it would let it drift out of alignment with the
   * candles the moment a session arrives.
   */
  #allMarks = $derived.by((): Mark[] =>
    this.dataset ? detect(buildCtx(this.dataset)) : []);

  /** A rule is on unless the reader has said otherwise — `settings.marks.rules`
   *  is sparse, so an absent entry means "whatever the rule itself defaults to". */
  enabledRules = $derived.by((): Set<RuleId> => {
    const overrides = this.settings.marks.rules;
    return new Set(RULES.filter((r) => overrides[r.id] ?? r.defaultOn).map((r) => r.id));
  });

  /**
   * The reader's decision on each candidate, keyed by the mark's stable id.
   * This — and nothing else about marking — is what persists.
   */
  markStore = $state<MarkStore>(emptyStore('series'));

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

  confirmedCount = $derived.by((): number =>
    Object.values(this.markStore.verdicts).filter((v) => v === 'confirmed').length);
  dismissedCount = $derived.by((): number =>
    Object.values(this.markStore.verdicts).filter((v) => v === 'dismissed').length);

  /**
   * Marks whose anchor sits inside the current viewport, newest first and
   * capped the way the data table is. A MAX viewport holds every mark in the
   * series and nobody scrolls three thousand rows.
   */
  visibleMarks = $derived.by((): Mark[] => {
    const d = this.dataset;
    if (!d) return [];
    const to = Math.min(this.viewport.to, d.d.length - 1);
    const from = Math.max(0, Math.min(this.viewport.from, to));
    const lo = d.d[from];
    const hi = d.d[to];
    if (lo === undefined || hi === undefined) return [];
    const inView = this.marks.filter((mk) => mk.at >= lo && mk.at <= hi);
    inView.reverse();
    return inView.slice(0, MARK_LIST_CAP);
  });

  markListTruncated = $derived.by((): boolean => {
    const d = this.dataset;
    if (!d) return false;
    const to = Math.min(this.viewport.to, d.d.length - 1);
    const from = Math.max(0, Math.min(this.viewport.from, to));
    const lo = d.d[from];
    const hi = d.d[to];
    if (lo === undefined || hi === undefined) return false;
    return this.marks.filter((mk) => mk.at >= lo && mk.at <= hi).length > MARK_LIST_CAP;
  });

  /** How many marks each rule contributes right now, for the panel. */
  markCounts = $derived.by((): Map<RuleId, number> => {
    const out = new Map<RuleId, number>();
    for (const mk of this.#allMarks) out.set(mk.rule, (out.get(mk.rule) ?? 0) + 1);
    return out;
  });

  readonly can = source.can;
  readonly target = source.kind;

  count = $derived(this.dataset?.d.length ?? 0);

  /** What the readout is describing: keyboard beats pointer beats the last
   *  session, so the panel is never blank. */
  focusIndex = $derived.by((): number | null => {
    if (this.keyIndex !== null) return this.keyIndex;
    if (this.hoverIndex !== null) return this.hoverIndex;
    return this.count > 0 ? this.count - 1 : null;
  });

  focusBar = $derived.by(() => this.bar(this.focusIndex));
  lastBar = $derived.by(() => this.bar(this.count > 0 ? this.count - 1 : null));

  resolvedTheme = $derived.by((): 'light' | 'dark' => {
    if (this.settings.theme === 'system') return this.systemDark ? 'dark' : 'light';
    return this.settings.theme;
  });

  /** Sessions inside the current viewport, newest first, capped. */
  visibleRows = $derived.by((): Bar[] => {
    const n = this.count;
    if (n === 0) return [];
    const to = Math.min(this.viewport.to, n - 1);
    const from = Math.max(0, Math.min(this.viewport.from, to));
    const start = Math.max(from, to - TABLE_CAP + 1);
    const rows: Bar[] = [];
    for (let i = to; i >= start; i--) {
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
    try {
      const result = await source.load();
      this.#apply(result.dataset, result.origin);
      // After the dataset, because the store is keyed by its symbol.
      try {
        this.markStore = await source.getMarks(result.dataset.symbol);
      } catch {
        this.markStore = emptyStore(result.dataset.symbol);
      }
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
      const result = await source.refresh();
      const grew = result.dataset.d.length - this.count;
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
    const current = this.dataset;
    if (current && current.fetched === result.dataset.fetched) return;
    this.#apply(result.dataset, result.origin);
  }

  #apply(dataset: Dataset, origin: DatasetOrigin): void {
    this.dataset = dataset;
    this.origin = origin;
    // Indices are positional, so a longer series would leave the crosshair
    // pointing at the wrong session.
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
      for (const [id, on] of Object.entries(next.marks.rules)) {
        if (s.marks.rules[id] !== on) s.marks.rules[id] = on;
      }
    }
    // `window` is main's business. Nothing in the renderer reads it, so it is
    // deliberately not mirrored here — copying a fresh object across on every
    // patch would be one more needless invalidation.
  }

  async patch(patch: Partial<Settings>): Promise<void> {
    this.#merge(patch);                    // optimistic: the UI must not lag a click
    try {
      this.#merge(await source.patchSettings(patch));
    } catch {
      /* persistence is best-effort; the session keeps the change either way */
    }
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

  toggleRule(id: RuleId): void {
    const next = !this.enabledRules.has(id);
    void this.patch({
      marks: {
        enabled: this.settings.marks.enabled,
        show: this.settings.marks.show,
        rules: { ...this.settings.marks.rules, [id]: next },
      },
    });
  }

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

  /** True while the window is at full work-area height. Tracked only so the
   *  button can label itself; the OS is the authority, and the accelerator or
   *  a manual drag can move it without telling us. */
  fitted = $state(false);

  async fitHeight(): Promise<void> {
    if (!this.can.fitWindow) return;
    try {
      this.fitted = await source.fitHeight();
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
      case 'PageUp':     return (this.keyIndex = Math.max(0, current - 21));
      case 'PageDown':   return (this.keyIndex = Math.min(n - 1, current + 21));
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
