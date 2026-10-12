import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Period } from "./periods";
import type { Dataset, Store } from "./model";
import { liveConfigured, loadLivePeriods } from "./live";
import { PERIOD_TOTALS, sectionNeeds, type Needs } from "./read-plan";
import { BI_CACHE_TAG } from "./windsor";
import { biRpc, writerConfigured } from "./supabase-write";

// Stored closes change only when the ingestion runs, which revalidates this tag.
const STORED_REVALIDATE_SECONDS = 300;
export function configured(): boolean {
  return writerConfigured();
}
// Uncached read of an interval: daily rows, quality, reports, runs and only the named datasets (read-plan.ts).
// Used by the ingestion right after it writes.
export async function readStore(from: string, to: string, datasets: string[] = [PERIOD_TOTALS]): Promise<Store> {
    const empty: Store = {
      daily: [],
      datasets: [],
      quality: [],
      reports: [],
      runs: [],
      errors: [],
      mode: "unavailable",
    };
    if (!configured())
      return {
        ...empty,
        errors: [
          "A ligação privada aos fechos ainda não está configurada no servidor. Os valores não estão disponíveis nesta vista.",
        ],
      };
    try {
      const d = await biRpc<Pick<Store, "daily" | "datasets" | "quality" | "reports" | "runs" | "channels">>("ldo_bi_read", { p_from: from, p_to: to, p_datasets: datasets });
      Object.assign(empty, { daily: d.daily, datasets: d.datasets, quality: d.quality, reports: d.reports, runs: d.runs, channels: d.channels });
    } catch (e) {
      empty.errors.push(`daily: ${e instanceof Error ? e.message : "Leitura indisponível"}`);
    }
    empty.mode = empty.errors.length ? "unavailable" : "stored";
    if (!empty.errors.length && !empty.daily.length)
      empty.errors.push(
        "Sem registos acessíveis neste intervalo. Confirmar cobertura e permissões do utilizador BI.",
      );
    return empty;
}
// Uncached read of one period's detail datasets: the exact period, or its days for the daily ones (read-plan.ts).
export async function readDetail(p: Period, need: Pick<Needs, "exact" | "daily">): Promise<Dataset[]> {
  if (!need.exact.length && !need.daily.length) return [];
  return biRpc<Dataset[]>("ldo_bi_read_detail", { p_from: p.from, p_to: p.to, p_exact: need.exact, p_daily: need.daily });
}
type Detail = { datasets: Dataset[]; error?: string };
async function detailOrError(p: Period, need: Pick<Needs, "exact" | "daily">): Promise<Detail> {
  try {
    return { datasets: await readDetail(p, need) };
  } catch (e) {
    return { datasets: [], error: `datasets: ${e instanceof Error ? e.message : "Leitura indisponível"}` };
  }
}
// A failed read is never cached; the view shows it as it is instead of reading again (each retry adds load).
class ReadFailure<T> extends Error {
  constructor(readonly result: T) {
    super("Leitura dos fechos falhou.");
  }
}
async function cachedOr<T>(cached: () => Promise<T>, uncached: () => Promise<T>): Promise<T> {
  try {
    return await cached();
  } catch (e) {
    return e instanceof ReadFailure ? (e.result as T) : uncached();
  }
}
// Daily rows, totals, quality and reports are shared by every section; the detail is cached per section and period.
// Each entry must stay under the 2 MB limit of Next's data cache, or it is never stored.
const cachedStore = unstable_cache(
  async (from: string, to: string, datasets: string[]) => {
    const store = await readStore(from, to, datasets);
    if (store.errors.some((e) => /^(daily|datasets|quality|reports|runs):/.test(e))) throw new ReadFailure(store);
    return store;
  },
  ["bi-store"],
  { revalidate: STORED_REVALIDATE_SECONDS, tags: [BI_CACHE_TAG] },
);
const cachedDetail = unstable_cache(
  async (from: string, to: string, exact: string[], daily: string[]) => {
    const detail = await detailOrError({ from, to }, { exact, daily });
    if (detail.error) throw new ReadFailure(detail);
    return detail;
  },
  ["bi-detail"],
  { revalidate: STORED_REVALIDATE_SECONDS, tags: [BI_CACHE_TAG] },
);
const loadStore = cache((from: string, to: string, datasets: string[]): Promise<Store> =>
  configured() ? cachedOr(() => cachedStore(from, to, datasets), () => readStore(from, to, datasets)) : readStore(from, to, datasets),
);
const loadDetail = cache((from: string, to: string, need: Needs): Promise<Detail> =>
  cachedOr(() => cachedDetail(from, to, need.exact, need.daily), () => detailOrError({ from, to }, need)),
);
// Reads the closes a section needs: totals for every period, and the section's detail for the selected one
// (or for each of `detailPeriods`, when a view compares the detail of two periods).
export async function loadPeriods(periods: Period[], selected = periods[0], section = "overview", detailPeriods = [selected]): Promise<Store> {
  if (!configured() && liveConfigured()) return loadLivePeriods(periods, selected, section);
  const need = sectionNeeds(section);
  const from = periods.map((p) => p.from).sort()[0],
    to = periods.map((p) => p.to).sort().at(-1)!;
  const hasDetail = configured() && (need.exact.length > 0 || need.daily.length > 0);
  const [store, details] = await Promise.all([
    loadStore(from, to, need.interval),
    Promise.all(hasDetail ? detailPeriods.map((p) => loadDetail(p.from, p.to, need)) : []),
  ]);
  if (store.mode !== "stored") return store;
  // A missing detail leaves the section's tables empty with a notice; the totals above still show.
  const byKey = new Map<string, Dataset>();
  for (const d of [...store.datasets, ...details.flatMap((x) => x.datasets)])
    byKey.set(`${d.source}|${d.dataset}|${d.period_start}|${d.period_end}`, d);
  return {
    ...store,
    datasets: [...byKey.values()],
    errors: [...store.errors, ...details.flatMap((x) => (x.error ? [x.error] : []))],
  };
}
