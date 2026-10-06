import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Period } from "./periods";
import type { Store } from "./model";
import { liveConfigured, loadLivePeriods } from "./live";
import { BI_CACHE_TAG } from "./windsor";
import { biRpc, writerConfigured } from "./supabase-write";

// Stored closes change only when the ingestion runs, which revalidates this tag.
const STORED_REVALIDATE_SECONDS = 300;
export function configured(): boolean {
  return writerConfigured();
}
// Uncached read, used by the ingestion right after it writes.
export async function readStore(from: string, to: string): Promise<Store> {
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
      const d = await biRpc<Pick<Store, "daily" | "datasets" | "quality" | "reports" | "runs">>("ldo_bi_read", { p_from: from, p_to: to });
      Object.assign(empty, { daily: d.daily, datasets: d.datasets, quality: d.quality, reports: d.reports, runs: d.runs });
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
class ReadFailure extends Error {}
const cachedStore = unstable_cache(
  async (from: string, to: string) => {
    const store = await readStore(from, to);
    // Failed reads are never cached; the next view retries.
    if (store.errors.some((e) => /^(daily|datasets|quality|reports|runs):/.test(e))) throw new ReadFailure();
    return store;
  },
  ["bi-store"],
  { revalidate: STORED_REVALIDATE_SECONDS, tags: [BI_CACHE_TAG] },
);
export const loadStore = cache(async (from: string, to: string): Promise<Store> => {
  if (!configured()) return readStore(from, to);
  try {
    return await cachedStore(from, to);
  } catch {
    return readStore(from, to);
  }
});
export async function loadPeriods(periods: Period[], selected = periods[0], section = "overview") {
  if (!configured() && liveConfigured()) return loadLivePeriods(periods, selected, section);
  return loadStore(
    periods.map((p) => p.from).sort()[0],
    periods
      .map((p) => p.to)
      .sort()
      .at(-1)!,
  );
}
