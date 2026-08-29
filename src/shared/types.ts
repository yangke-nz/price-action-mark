/** Wire + on-disk shape of the dataset. Columnar, because 6,500 bars as an
 *  array of objects costs ~3x the JSON and every consumer wants columns anyway. */
export interface Dataset {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  /** ISO instant the snapshot was taken. */
  fetched: string;
  w52h: number | null;
  w52l: number | null;
  /**
   * The bar key, ascending and de-duplicated. All six arrays share this index.
   *
   * `YYYY-MM-DD` for a daily bar, `YYYY-MM-DDTHH:MM:00Z` for an intraday one.
   * Both are ISO 8601 and therefore sort lexicographically, which is why the
   * date->index map, the mark ids and the viewport tests did not have to learn
   * about time — see interval.ts.
   */
  d: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  /** Indices into `d` of the first session on/after each quarterly expiry.
   *  These are the EXPIRY sessions, not the discontinuities: the bar whose
   *  change crosses contracts is the one after. Every consumer that means
   *  "where the carry is" derives it with `contractStarts()` from rolls.ts. */
  rolls: number[];
  /**
   * Bar size. OPTIONAL, and absent means daily.
   *
   * Required would invalidate every cached dataset and the committed snapshot,
   * and `isDataset()` would have to keep accepting the old shape anyway — the
   * same argument that kept `tick` out of this interface. Read it through
   * `intervalOf()`, never directly.
   */
  interval?: '1d' | '5m';
  /**
   * Which session window these bars cover, when it cannot be told from them.
   *
   * Only set on a DAILY series aggregated from intraday bars: an intraday
   * dataset says so in its own keys — every bar's time is inside the window —
   * and a daily bar's key is just a date. Absent means the whole session, which
   * is what the feed's own daily bars are and what every cached file holds, so
   * nothing on disk is invalidated by this existing.
   */
  window?: 'eth' | 'rth';
}

export interface Bar {
  i: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True at the first session of a new contract — the bar whose change
   *  against the previous session is carry. Derived through
   *  `contractStarts()`; deliberately not a lookup in `Dataset.rolls`. */
  isRoll: boolean;
}

/** Viewport presets. Which of these are OFFERED depends on the bar size — a
 *  5-year button against a 60-day intraday archive is a lie. See interval.ts. */
export type RangeId = '1D' | '3D' | '1W' | '2W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'MAX';
export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * Which marking rules are on, and which the panel folds away.
 *
 * BOTH RECORDS ARE SPARSE, for the same reason. `rules` holds only the ids the
 * reader has moved away from the rule's own `defaultOn`; `folded` only the ids
 * moved off the rule's own `tier`. Persisting all thirty-one booleans either
 * way would freeze today's answer into every settings file on disk, so
 * tightening a rule later — or folding a new one — would silently never reach
 * anyone who had run the app.
 */
export interface MarkSettings {
  /** Master switch for the whole marking layer. */
  enabled: boolean;
  /** `confirmed` hides every candidate the reader has not stood behind — the
   *  mode a chart should be in before it is published. */
  show: 'all' | 'confirmed';
  rules: Record<string, boolean>;
  /** Only the ids the reader moved off `Rule.tier`. `true` means "fold this
   *  away even though it ships listed", `false` the reverse; an absent id
   *  means the rule's own tier still decides. */
  folded: Record<string, boolean>;
}

export interface Settings {
  theme: ThemeChoice;
  /** Bar size. The range below is validated against it on load, because one
   *  stored range has to serve every timeframe — see `rangeFor()`. */
  interval: '1d' | '5m';
  /** Regular or extended hours. Only bites on an intraday interval: a daily
   *  bar is a whole session, so there is no window to apply. */
  session: 'eth' | 'rth';
  range: RangeId;
  showRolls: boolean;
  showEma: boolean;
  marks: MarkSettings;
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
}

/** Where a dataset came from — the footer says so, because a stale cache that
 *  looks live is the one failure mode a chart cannot show you. */
export type DatasetOrigin = 'network' | 'cache' | 'bundled';

export interface DatasetResult {
  dataset: Dataset;
  origin: DatasetOrigin;
  /** Set when a refresh failed and we fell back to cache/bundled. */
  error?: string;
}
