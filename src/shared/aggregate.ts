/**
 * Daily bars built from intraday ones.
 *
 * WHY THIS EXISTS. The feed's daily bar for `ES=F` covers the whole 23-hour
 * Globex day, so an RTH daily bar — one whose open is 09:30 New York and whose
 * close is 16:15 — is not something the feed has. It has to be assembled from
 * the intraday series, which is why the session control on a DAILY chart is a
 * load rather than the pure filter it is intraday.
 *
 * WHY THE FIVE-MINUTE FEED AND NOT THE HOURLY ONE. Hourly bars would buy far
 * more history — measured, Yahoo serves 14,560 of them over the full 730 days
 * against 60 days of 5-minute bars — and they are useless here: they sit on the
 * hour in New York, so the 09:00 bar straddles the 09:30 open and the 16:00 bar
 * straddles the 16:15 close. Every candidate window is wrong at both ends, and
 * an OPEN and a CLOSE are exactly what a price-action chart is read on — every
 * bar rule tests where the close sits in the range. A short series of correct
 * bars beats two years of bars whose first and last thirty minutes are a guess.
 *
 * The cost is stated rather than hidden: RTH daily is about 42 sessions, and
 * the app says so on the chart.
 */
import type { Dataset } from './types.ts';
import { rollIndices } from './rolls.ts';
import { specOf } from './interval.ts';
import { sessionBars, type Session } from './session.ts';

/**
 * Collapse each trading day of an intraday series into one bar.
 *
 * Open is the day's first bar's open, close its last bar's close, high and low
 * the extremes across it, and volume the sum. Grouping is `sessionBars`', so it
 * is the same trading-day definition the bar numbers use — including Globex
 * evenings belonging to the NEXT day — rather than a second idea of where a day
 * begins.
 *
 * A daily series is returned untouched: it is already what this produces.
 */
export function dailyFrom(ds: Dataset, window?: Session): Dataset {
  if (!specOf(ds).intraday) return ds;

  const { starts } = sessionBars(ds);
  const n = starts.length;
  const d: string[] = new Array(n);
  const o = new Array<number>(n);
  const h = new Array<number>(n);
  const l = new Array<number>(n);
  const c = new Array<number>(n);
  const v = new Array<number>(n);

  for (let k = 0; k < n; k++) {
    const from = starts[k]!.i;
    const to = k + 1 < n ? starts[k + 1]!.i : ds.d.length;
    let high = ds.h[from]!;
    let low = ds.l[from]!;
    let volume = 0;
    for (let i = from; i < to; i++) {
      if (ds.h[i]! > high) high = ds.h[i]!;
      if (ds.l[i]! < low) low = ds.l[i]!;
      volume += ds.v[i]!;
    }
    // The DAY, not the first bar's key: this is a daily series now, and
    // `Dataset.d[i]` being a plain `YYYY-MM-DD` is what makes every consumer
    // treat it as one.
    d[k] = starts[k]!.day;
    o[k] = ds.o[from]!;
    h[k] = high;
    l[k] = low;
    c[k] = ds.c[to - 1]!;
    v[k] = volume;
  }

  return {
    ...ds,
    d, o, h, l, c, v,
    interval: '1d',
    // Rebuilt, not remapped: `rolls` holds positions in `d`, and every one of
    // them just moved. Same reason `applySession` recomputes them.
    rolls: rollIndices(d),
    // Which window these bars cover, because from a daily key it can no longer
    // be told — and the export filename has to say which of the two it holds.
    ...(window === undefined ? {} : { window }),
  };
}
