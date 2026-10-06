import "server-only";

// The nightly collection writes through token-checked database functions (ldo_bi_*),
// so the server never holds a Supabase key with access beyond the BI tables.
type Table = "ldo_bi_daily" | "ldo_bi_datasets" | "ldo_bi_quality";

export function writerConfigured() {
  return Boolean((process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_PUBLISHABLE_KEY && process.env.BI_INGEST_TOKEN);
}

export async function biRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const base = process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, token = process.env.BI_INGEST_TOKEN;
  if (!base || !key || !token) throw new Error("Ligação aos fechos por configurar.");
  const r = await fetch(new URL(`/rest/v1/rpc/${fn}`, base), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: { apikey: key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ p_token: token, ...args }),
  });
  if (!r.ok) throw new Error(`Fechos BI recusaram o pedido (${r.status}).`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

const KEYS: Record<Table, string[]> = {
  ldo_bi_daily: ["source", "metric_date"],
  ldo_bi_datasets: ["source", "dataset", "period_start", "period_end"],
  ldo_bi_quality: ["run_id", "metric_date", "code"],
};

// One row per key (the last one wins): a batch may not update the same row twice.
export function dedupe(table: Table, rows: Record<string, unknown>[]) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) byKey.set(KEYS[table].map((k) => String(r[k])).join("|"), r);
  return [...byKey.values()];
}

export async function upsert(table: Table, rows: Record<string, unknown>[]) {
  const unique = dedupe(table, rows);
  for (let i = 0; i < unique.length; i += 200)
    await biRpc("ldo_bi_write", { p_table: table, p_rows: unique.slice(i, i + 200) });
}

export async function startRun(trigger: string, notes: string): Promise<string> {
  return biRpc<string>("ldo_bi_start_run", { p_trigger: trigger, p_notes: notes });
}

export async function finishRun(id: string, status: "completed" | "partial" | "failed", notes: string) {
  await biRpc("ldo_bi_finish_run", { p_id: id, p_status: status, p_notes: notes });
}

// A run left "running" for hours was interrupted; mark it so it no longer looks active.
export async function closeStaleRuns(olderThanHours = 6) {
  await biRpc("ldo_bi_close_stale_runs", { p_hours: olderThanHours });
}
