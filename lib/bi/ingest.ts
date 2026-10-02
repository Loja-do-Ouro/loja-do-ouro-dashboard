import "server-only";
import { revalidateTag } from "next/cache";
import { closedPeriods, dates, previous, type Period } from "./periods";
import { calculatedChecks, type Daily, type Dataset, type Row } from "./model";
import { DAILY_SOURCES, DETAILS, sourceMetadata } from "./live";
import { gaFields } from "./accounts";
import { BI_CACHE_TAG, readWindsor } from "./windsor";
import { FULFILLMENT_FIELDS, SALES_FIELDS, SESSION_FIELDS, dailyQuery, ordersByDay, productsQuery, shopSettings, shopifyql, totalsQuery } from "./shopify";
import { closeStaleRuns, finishRun, startRun, upsert } from "./supabase-write";
import { readStore } from "./store";

export { ingestRange } from "./periods";
const CONCURRENCY = 6;

async function pool(tasks: (() => Promise<void>)[]) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) await tasks[next++]();
  }));
}

export async function ingest(range: Period, trigger: string) {
  await closeStaleRuns();
  const runId = await startRun(trigger, `Recolha ${range.from} a ${range.to} em curso.`);
  const errors: string[] = [], daily: Daily[] = [], datasets: Dataset[] = [];
  const windows = closedPeriods();
  const totalsPeriods = [...new Map(windows.flatMap(w => [w.range, previous(w.range, w.key)]).map(p => [`${p.from}:${p.to}`, p])).values()];
  const days = dates(range);
  const stamp = () => new Date().toISOString();
  const job = (label: string, action: () => Promise<void>) => async () => {
    try { await action(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : "Indisponível"}`); }
  };
  const pushDaily = (source: string, rows: Row[], dateField: string) => {
    const fetched_at = stamp(), found = new Set<string>();
    for (const r of rows) {
      const date = String(r[dateField] || "");
      if (!days.includes(date)) continue;
      found.add(date);
      const { [dateField]: _omit, ...metrics } = r;
      daily.push({ source, metric_date: date, metrics, fetched_at, status: "provisional", run_id: runId });
    }
    const missing = days.filter(d => !found.has(d));
    if (missing.length) errors.push(`${source}: sem dados para ${missing.join(", ")}.`);
  };
  const pushDataset = (source: string, dataset: string, p: Period, rows: Row[], metadata: Record<string, unknown>) =>
    datasets.push({ source, dataset, period_start: p.from, period_end: p.to, rows, metadata, fetched_at: stamp(), status: "provisional", run_id: runId });

  const tasks: (() => Promise<void>)[] = [];
  for (const d of DAILY_SOURCES)
    tasks.push(job(`${d.source} diário`, async () => pushDaily(d.source, (await readWindsor(d.connector, range, ["date", ...d.fields], { fresh: true })).rows, "date")));
  for (const p of totalsPeriods)
    tasks.push(job(`GA4 total ${p.from} a ${p.to}`, async () => {
      const r = await readWindsor("googleanalytics4", p, gaFields, { fresh: true });
      if (r.rows.length !== 1) throw new Error("Total de período ausente ou com granularidade inesperada.");
      pushDataset("ga4", "period_totals", p, r.rows, sourceMetadata("googleanalytics4", r.fields));
    }));
  for (const w of windows) for (const d of DETAILS)
    tasks.push(job(`${d.source} · ${d.dataset} ${w.key}`, async () => {
      const r = await readWindsor(d.connector, w.range, d.fields, { fresh: true });
      pushDataset(d.source, d.dataset, w.range, r.rows, sourceMetadata(d.connector, r.fields));
    }));

  // Shopify Admin API: official sales report, sessions, fulfillments and the order cohort.
  const shopMeta = { account_id: process.env.SHOPIFY_STORE_DOMAIN, currency: "EUR", timezone: "Europe/Lisbon", transport: "Shopify Admin API" };
  tasks.push(job("Shopify", async () => {
    const shop = await shopSettings();
    if (shop.currencyCode !== "EUR" || shop.ianaTimezone !== "Europe/Lisbon") throw new Error("Moeda ou fuso da loja sem confirmação EUR / Europe/Lisbon.");
    const shopTasks = [
      job("Shopify vendas diárias", async () => pushDaily("shopify_sales", await shopifyql(dailyQuery("sales", SALES_FIELDS, range)), "day")),
      job("Shopify sessões diárias", async () => pushDaily("shopify_sessions", await shopifyql(dailyQuery("sessions", SESSION_FIELDS, range)), "day")),
      job("Shopify expedições diárias", async () => pushDaily("shopify_fulfillments", await shopifyql(dailyQuery("fulfillments", FULFILLMENT_FIELDS, range)), "day")),
      job("Shopify encomendas", async () => {
        const byDay = await ordersByDay(range);
        // Pagination completed, so a day without orders is a confirmed empty cohort.
        for (const day of days) pushDataset("shopify", "orders", { from: day, to: day }, byDay.get(day) || [],
          { ...shopMeta, daily: true, complete: true, query: "Encomendas criadas no dia português; test excluídas; paginação completa." });
      }),
      ...totalsPeriods.map(p => job(`Shopify total ${p.from} a ${p.to}`, async () => {
        const rows = await shopifyql(totalsQuery(SALES_FIELDS, p));
        if (rows.length !== 1) throw new Error("Total de período ausente.");
        pushDataset("shopify_sales", "period_totals", p, rows, { ...shopMeta, query: totalsQuery(SALES_FIELDS, p) });
      })),
      ...windows.map(w => job(`Shopify produtos ${w.key}`, async () => {
        pushDataset("shopify", "products", w.range, await shopifyql(productsQuery(w.range)), { ...shopMeta, limit: 50 });
      })),
    ];
    for (const t of shopTasks) await t();
  }));

  await pool(tasks);
  const write = async (label: string, action: () => Promise<void>) => {
    try { await action(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : "falhou"}`); }
  };
  await write("Gravação diária", () => upsert("ldo_bi_daily", daily));
  await write("Gravação de conjuntos", () => upsert("ldo_bi_datasets", datasets));

  // Controls over what is now stored for each closed window.
  await write("Controlos", async () => {
    const all = windows.flatMap(w => [w.range, previous(w.range, w.key)]);
    const stored = await readStore(all.map(p => p.from).sort()[0], all.map(p => p.to).sort().at(-1)!);
    const quality = windows.flatMap(w => calculatedChecks(stored, w.range).map(c => ({
      run_id: runId, metric_date: w.range.to,
      code: `CHECK_${w.key.toUpperCase()}_${c.label.normalize("NFD").replace(/[^A-Za-z]+/g, "_").toUpperCase()}`,
      severity: c.warning ? "warning" : "info", message: `${c.label}: ${c.detail}`, evidence: { period: w.range, window: w.key },
    })));
    if (errors.length) quality.push({ run_id: runId, metric_date: range.to, code: "INGEST_ERRORS", severity: "warning",
      message: `Recolha com ${errors.length} falhas; os indicadores afetados ficam indisponíveis.`, evidence: { errors } as never });
    await upsert("ldo_bi_quality", quality);
  });

  const status = errors.length ? "partial" : "completed";
  const notes = `Recolha ${range.from} a ${range.to}: ${daily.length} registos diários, ${datasets.length} conjuntos.` +
    (errors.length ? ` Falhas: ${errors.slice(0, 10).join(" | ")}` : " Sem falhas.") + " Dados provisórios; tracking não certificado.";
  await finishRun(runId, status, notes);
  revalidateTag(BI_CACHE_TAG, { expire: 0 });
  return { run_id: runId, status, range, daily: daily.length, datasets: datasets.length, errors };
}
