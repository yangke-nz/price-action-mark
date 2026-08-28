/** One set of formatters for the chart axes, the readout, the table and the
 *  CLI scripts — so a price never renders two ways in the same product. */

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const EM_DASH = '—';

export function price(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? EM_DASH : nf2.format(v);
}

/** Price-axis labels: whole numbers lose the trailing `.00` — at a 26-year
 *  zoom the axis is all thousands and `.00` is pure noise. */
export function axisPrice(v: number): string {
  return Number.isInteger(v) ? nfInt.format(v) : nf2.format(v);
}

export function integer(v: number): string {
  return nfInt.format(v);
}

export function volume(v: number | null | undefined): string {
  if (!v) return EM_DASH;
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'K';
  return nfInt.format(v);
}

/** `2024-12-23` -> `23 Dec 2024`. Deliberately not `toLocaleDateString`:
 *  the readout is tabular-numeric and must not reflow with the locale. */
export function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/**
 * The time of day in a bar key, or `''` for a daily bar.
 *
 * UTC, and every displayed time in this app is UTC for one reason: the stored
 * key is UTC, and a mark id is built from that key. Rendering exchange-local
 * time would put a different clock in front of the reader than the one in the
 * data, and would spread DST arithmetic across the axis, the readout, the two
 * lists and the CSV. One clock, stated where there is room to state it.
 */
export function clock(key: string): string {
  return key.length > 10 ? key.slice(11, 16) : '';
}

/**
 * What a bar is called: `23 Dec 2024`, or `23 Dec 13:45` intraday.
 *
 * The year goes when a time arrives — an intraday archive is 60 days deep, so
 * the year is never in question, and the two together are too wide for a
 * table cell.
 */
export function barLabel(key: string): string {
  const time = clock(key);
  if (time === '') return day(key);
  const [, m, d] = key.slice(0, 10).split('-');
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${time}`;
}

export function signed(v: number): string {
  return (v >= 0 ? '+' : '') + nf2.format(v);
}

export function signedPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

export function delta(abs: number, pct: number): string {
  return `${signed(abs)} (${signedPct(pct)})`;
}

/** ISO instant -> `2026-08-27 02:51 UTC`, matching the footer in v1. */
export function stamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function relative(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
