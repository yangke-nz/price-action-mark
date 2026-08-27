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
  /** ISO `YYYY-MM-DD`, ascending, de-duplicated. All six arrays share this index. */
  d: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  /** Indices into `d` of the first session on/after each quarterly expiry. */
  rolls: number[];
}

export interface Bar {
  i: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isRoll: boolean;
}

export type RangeId = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'MAX';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeChoice;
  range: RangeId;
  showRolls: boolean;
  showEma: boolean;
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
