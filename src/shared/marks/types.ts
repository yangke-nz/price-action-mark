/**
 * The serialised shape of a mark. This is the contract between the rules that
 * produce marks, the primitive that draws them, the store that persists a
 * verdict on them and the artifact that publishes them — so it is plain JSON
 * and nothing here knows about a canvas, a chart library or Svelte.
 *
 * Two fields carry the design and are easy to mistake for boilerplate.
 *
 * ANCHORS ARE DATES, NOT BAR INDICES. `toRows()` drops around 43 dirty bars
 * per pull and which ones it drops is not stable, so an index-anchored mark
 * slides by a session whenever the feed changes its mind about a holiday.
 * A date survives that, and it is also what lightweight-charts wants as
 * `Time`, so nothing is translated at draw time.
 *
 * `at` AND `knownAt` ARE BOTH REQUIRED. `at` is the session the mark points
 * at; `knownAt` is the first session on which it could have been known. A
 * swing high needs `strength` bars to its right before it is a swing high at
 * all, so a double top is not knowable on the day of its second peak. Drawing
 * one there claims foresight the trade did not have. They are equal for marks
 * that need no confirmation — most single-bar patterns — and that is fine;
 * what matters is that a consumer can always ask.
 */

export type MarkGroup = 'bars' | 'lines' | 'entries';

/**
 * `caution` is a mark the reader should distrust: a failed breakout, a pattern
 * sitting on a suspect bar. It deliberately has no colour of its own — it
 * draws in the neutral tone and DASHED, because this project carries meaning
 * in shape rather than hue wherever it can, and a fourth hue would have to be
 * measured against the other three under two colour-blindness simulations to
 * earn its place.
 */
export type Tone = 'bull' | 'bear' | 'neutral' | 'caution';

export type MarkSource = 'rule' | 'manual';

/** What the reader decided about a rule-generated candidate. */
export type Verdict = 'confirmed' | 'dismissed';

/**
 * Widened to `string` until `registry.ts` lands in phase 05 and can name the
 * real union. Everything that stores a RuleId already round-trips a string,
 * so narrowing it later is a compile-time change only.
 */
export type RuleId = string;

/** A price at a session. */
export interface Anchor {
  readonly d: string;
  readonly price: number;
}

interface MarkBase {
  /** Stable across recompute: derived from the rule and the anchor dates, so
   *  the same mark keeps the same id and therefore the same verdict. */
  readonly id: string;
  readonly rule: RuleId;
  readonly group: MarkGroup;
  /** What prints on the chart. Short: 'H2', 'ii', 'DT'. */
  readonly label: string;
  /** The one line that prints in the mark list. */
  readonly note?: string;
  readonly tone: Tone;
  /** The session the mark points at. */
  readonly at: string;
  /** The first session on which it could have been known. */
  readonly knownAt: string;
  readonly source: MarkSource;
}

/** A label pinned to one bar. Drawn as a series marker, not by the primitive:
 *  markers already thin themselves and already carry the roll arrows. */
export interface BarMark extends MarkBase {
  readonly kind: 'bar';
  readonly placement: 'above' | 'below';
}

/** A straight line between two anchors, optionally projected to the right. */
export interface SegmentMark extends MarkBase {
  readonly kind: 'segment';
  readonly from: Anchor;
  readonly to: Anchor;
  readonly extend: boolean;
}

/** A trendline plus a parallel `offset` away in price, and the band between. */
export interface ChannelMark extends MarkBase {
  readonly kind: 'channel';
  readonly from: Anchor;
  readonly to: Anchor;
  readonly offset: number;
  readonly extend: boolean;
}

/** A horizontal line across a span of sessions — a neckline, a range edge. */
export interface LevelMark extends MarkBase {
  readonly kind: 'level';
  readonly price: number;
  readonly fromD: string;
  readonly toD: string;
}

/**
 * An open polyline.
 *
 * NO RULE EMITS ONE TODAY, and that is not a reason to delete it. The doubles
 * drew a three-point path until the level replaced it (see `doubleRule` in
 * rules/lines.ts), and wedges and triangles draw as channels rather than as
 * the polyline this comment used to claim. `shapeOf` still handles the kind
 * because a manual drawing tool needs it — a freehand line is exactly this —
 * and it costs four lines to keep against a serialised shape that would
 * otherwise have to be reintroduced later.
 */
export interface PathMark extends MarkBase {
  readonly kind: 'path';
  readonly points: readonly Anchor[];
}

/** An entry with the two prices that bound it. `through` is the last session
 *  the box is drawn to — where the trade resolved, or the last bar. */
export interface TradeMark extends MarkBase {
  readonly kind: 'trade';
  readonly dir: 'long' | 'short';
  readonly entry: number;
  readonly stop: number;
  readonly target: number;
  readonly through: string;
}

export type Mark =
  | BarMark
  | SegmentMark
  | ChannelMark
  | LevelMark
  | PathMark
  | TradeMark;

/** Everything the canvas primitive draws — that is, everything except the
 *  bar labels, which are markers. */
export type GeometryMark = Exclude<Mark, BarMark>;

export function isGeometry(mark: Mark): mark is GeometryMark {
  return mark.kind !== 'bar';
}

/**
 * A mark's identity is its rule plus the sessions it is anchored to. Two runs
 * over the same data must produce the same id or a verdict would not survive a
 * refresh; two different marks from one rule must not collide or dismissing
 * one would dismiss the other.
 */
export function markId(rule: RuleId, ...dates: readonly string[]): string {
  return `${rule}:${dates.join('|')}`;
}

/**
 * What is written to disk for a symbol — and, just as importantly, what is not.
 *
 * Rule output never appears here. It is a pure function of the dataset and the
 * rule config, so persisting it would let it drift out of alignment with the
 * candles the moment a session arrives. Two things survive a restart: the
 * reader's verdict on each candidate, keyed by the mark's stable id, and marks
 * drawn by hand.
 *
 * `manual` is reserved and currently always empty — drawing tools are the next
 * body of work. It is in the shape from the start so adding them later is not a
 * format change that every file on disk has to be migrated through.
 */
export interface MarkStore {
  readonly version: 1;
  readonly symbol: string;
  /** ISO instant of the last write. */
  readonly updated: string;
  readonly verdicts: Readonly<Record<string, Verdict>>;
  readonly manual: readonly Mark[];
}

export function emptyStore(symbol: string): MarkStore {
  return { version: 1, symbol, updated: '', verdicts: {}, manual: [] };
}

/**
 * Validate field by field. A store written by a future version, or edited by
 * hand, has to degrade to "no verdicts" rather than reach the renderer
 * malformed — the same contract `main/settings.ts` holds itself to.
 *
 * A verdict whose mark no longer regenerates is kept rather than dropped: rule
 * thresholds move, and a mark that vanishes today may come back when the
 * reader loosens a tolerance. They cost a few bytes and dropping them would
 * silently discard decisions.
 */
export function coerceStore(raw: unknown, symbol: string): MarkStore {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const src = (typeof v['verdicts'] === 'object' && v['verdicts'] !== null
    ? v['verdicts'] : {}) as Record<string, unknown>;
  const verdicts: Record<string, Verdict> = {};
  for (const [id, verdict] of Object.entries(src)) {
    if ((verdict === 'confirmed' || verdict === 'dismissed') && id.length <= 200) {
      verdicts[id] = verdict;
    }
  }
  return {
    version: 1,
    symbol: typeof v['symbol'] === 'string' ? v['symbol'] : symbol,
    updated: typeof v['updated'] === 'string' ? v['updated'] : '',
    verdicts,
    manual: [],
  };
}
