import "server-only";

// Writes are limited to the BI tables and require the server-only service role key.
// RLS grants BI members read access only; nothing here runs in the browser.
const WRITABLE = new Set(["ldo_bi_daily", "ldo_bi_datasets", "ldo_bi_quality", "ldo_bi_runs"]);
const CONFLICT: Record<string, string> = {
  ldo_bi_daily: "source,metric_date",
  ldo_bi_datasets: "source,dataset,period_start,period_end",
  ldo_bi_quality: "run_id,metric_date,code",
};

export function writerConfigured() {
  return Boolean((process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function call(method: string, table: string, query: Record<string, string>, body?: unknown, prefer?: string) {
  if (!WRITABLE.has(table)) throw new Error("Tabela não autorizada");
  const base = process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Escrita BI por configurar.");
  const url = new URL(`/rest/v1/${table}`, base);
  url.search = new URLSearchParams(query).toString();
  const r = await fetch(url, {
    method, cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Escrita em ${table.replace("ldo_bi_", "")} recusada (${r.status}).`);
  return r.status === 204 ? null : r.json();
}

export async function upsert(table: keyof typeof CONFLICT, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200)
    await call("POST", table, { on_conflict: CONFLICT[table] }, rows.slice(i, i + 200), "resolution=merge-duplicates,return=minimal");
}

export async function startRun(trigger: string, notes: string): Promise<string> {
  const rows = await call("POST", "ldo_bi_runs", {}, [{ trigger_type: trigger, status: "running", notes }], "return=representation") as { id: string }[];
  return rows[0].id;
}

export async function finishRun(id: string, status: "completed" | "partial" | "failed", notes: string) {
  await call("PATCH", "ldo_bi_runs", { id: `eq.${id}` }, { status, notes, completed_at: new Date().toISOString() }, "return=minimal");
}

// A run left "running" for hours was interrupted; mark it so it no longer looks active.
export async function closeStaleRuns(olderThanHours = 6) {
  const before = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  await call("PATCH", "ldo_bi_runs", { status: "eq.running", started_at: `lt.${before}` },
    { status: "failed", completed_at: new Date().toISOString() }, "return=minimal");
}
