import { detail, type Dataset, type Store } from "./model";
import { dates, shift, type Period } from "./periods";

// Days of campaign detail (meta/ads and google_ads/campaigns) the nightly collection asks the source for, one query per
// day. The detail per day is what splits any period into online and physical-store investment (channels.ts), and one
// day without it leaves the split of the whole period unknown. On 31 Oct and 1 Nov 2026 Meta answered HTTP 400 to every
// query, the three-day queries of the following nights ran out of time, and October 2026 had no split. So each night asks:
//   - every day of the collection range (the platforms still revise the last days);
//   - the earlier days since the start of the month before the range's last month with no usable detail stored,
//     newest first, at most AD_GAP_LIMIT per dataset (the others on the following nights).

// Most earlier days asked again per dataset and night.
export const AD_GAP_LIMIT = 10;

// Interval read to find the stored days: from the start of the month before the range's last month (so the closed
// "Mês anterior" is always covered) to the end of the range. It spans two calendar months, so it is never a stored
// window (a day, a week or a month) and ldo_bi_read_detail returns the days themselves. null: nothing before the range.
export function adLookback(range: Period): Period | null {
  const [y, m] = range.to.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return from < range.from ? { from, to: range.to } : null;
}

// Days to ask for one dataset: the range's days, then the gaps found in `stored` (what the lookback read returned;
// null when that read failed, so no gap is guessed). gaps lists every day missing, newest first, even beyond the limit.
export function adDays(range: Period, stored: Dataset[] | null, source: string, dataset: string, limit = AD_GAP_LIMIT) {
  const lookback = adLookback(range);
  const store: Store = { daily: [], datasets: stored || [], quality: [], reports: [], runs: [], errors: [], mode: "stored" };
  const gaps = lookback && stored
    ? dates({ from: lookback.from, to: shift(range.from, -1) })
        .filter((day) => !detail(store, { from: day, to: day }, source, dataset).complete)
        .reverse()
    : [];
  return { days: [...dates(range), ...gaps.slice(0, limit)], gaps };
}
