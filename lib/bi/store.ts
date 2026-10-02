import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Period } from "./periods";
import type { Store } from "./model";
import { liveConfigured, loadLivePeriods } from "./live";
import { BI_CACHE_TAG } from "./windsor";

// Stored closes change only when the ingestion runs, which revalidates this tag.
const STORED_REVALIDATE_SECONDS = 300;
const TABLES = new Set([
  "ldo_bi_daily",
  "ldo_bi_datasets",
  "ldo_bi_quality",
  "ldo_bi_reports",
  "ldo_bi_runs",
]);
export function configured(): boolean {
  return !!(
    (process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) &&
    (process.env.BI_SUPABASE_ACCESS_TOKEN ||
      process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}
async function read<T>(
  table: string,
  query: Record<string, string>,
): Promise<T[]> {
  if (!TABLES.has(table)) throw new Error("Tabela não autorizada");
  const base = process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL;
  const token =
    process.env.BI_SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.BI_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    token;
  if (!base || !token || !apiKey)
    throw new Error("Ligação privada aos fechos por configurar.");
  const out: T[] = [];
  // Explicit pagination: never silently cut a month at the API default row limit.
  for (let offset = 0; offset < 100000; offset += 100) {
    const url = new URL(`/rest/v1/${table}`, base);
    const p = new URLSearchParams({
      ...query,
      offset: String(offset),
      limit: "100",
    });
    url.search = p.toString();
    const r = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!r.ok)
      throw new Error(`Leitura dos fechos indisponível (${r.status}).`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error("Resposta de dados inesperada.");
    out.push(...rows);
    if (rows.length < 100) return out;
  }
  throw new Error("Cobertura incompleta: limite de paginação atingido.");
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
    const queries = [
      [
        "ldo_bi_daily",
        {
          select: "source,metric_date,metrics,fetched_at,status,run_id",
          and: `(metric_date.gte.${from},metric_date.lte.${to})`,
          order: "source.asc,metric_date.asc",
        },
      ],
      [
        "ldo_bi_datasets",
        {
          select:
            "source,dataset,period_start,period_end,rows,metadata,fetched_at,status,run_id",
          and: `(period_start.gte.${from},period_end.lte.${to})`,
          order: "source.asc,dataset.asc,period_start.asc,period_end.asc",
        },
      ],
      [
        "ldo_bi_quality",
        {
          select: "*",
          and: `(metric_date.gte.${from},metric_date.lte.${to})`,
          order: "created_at.desc,id.asc",
        },
      ],
      [
        "ldo_bi_reports",
        {
          select: "*",
          and: `(period_start.gte.${from},period_end.lte.${to})`,
          order: "created_at.desc,id.asc",
        },
      ],
      [
        "ldo_bi_runs",
        {
          select: "*",
          order: "started_at.desc",
          started_at: `gte.${to}T00:00:00Z`,
        },
      ],
    ] as [string, Record<string, string>][];
    const result = await Promise.allSettled(
      queries.map(([table, q]) => read(table, q)),
    );
    const keys = ["daily", "datasets", "quality", "reports", "runs"] as const;
    result.forEach((r, i) => {
      if (r.status === "fulfilled") (empty[keys[i]] as unknown[]) = r.value;
      else
        empty.errors.push(
          `${queries[i][0].replace("ldo_bi_", "")}: ${r.reason instanceof Error ? r.reason.message : "Leitura indisponível"}`,
        );
    });
    empty.mode = result[0].status === "fulfilled" ? "stored" : "unavailable";
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
