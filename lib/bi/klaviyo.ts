import "server-only";
import type { Period } from "./periods";
import type { Row } from "./model";

// Klaviyo API, read-only private key (Campaigns, Flows, Metrics). Replaces the
// Windsor connector. Values reports allow ~2 requests per minute, so calls run
// one at a time and wait when Klaviyo asks to.
const BASE = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";
const MAX_WAIT_MS = 65_000;

export function klaviyoConfigured() {
  return Boolean(process.env.KLAVIYO_API_KEY);
}

async function api<T>(path: string, body?: unknown, attempt = 0): Promise<T> {
  const key = process.env.KLAVIYO_API_KEY;
  if (!key) throw new Error("Ligação Klaviyo por configurar.");
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json", ...(body ? { "content-type": "application/vnd.api+json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Consulta Klaviyo interrompida."); }
  if (r.status === 429 && attempt < 3) {
    const wait = Math.min(MAX_WAIT_MS, Math.max(1000, Number(r.headers.get("retry-after") || 30) * 1000));
    await new Promise((done) => setTimeout(done, wait));
    return api<T>(path, body, attempt + 1);
  }
  if (!r.ok) throw new Error(`Klaviyo recusou a consulta (HTTP ${r.status}).`);
  return r.json() as Promise<T>;
}

// Offset of Europe/Lisbon on a given day, e.g. "+01:00".
export function lisbonOffset(day: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || "00"}` : "+00:00";
}

const timeframe = (p: Period) => ({ start: `${p.from}T00:00:00${lisbonOffset(p.from)}`, end: `${p.to}T23:59:59${lisbonOffset(p.to)}` });

let metricId: Promise<string> | null = null;
// "Placed Order" from the Shopify integration, the metric Klaviyo uses for conversions.
function conversionMetric() {
  if (process.env.KLAVIYO_CONVERSION_METRIC_ID) return Promise.resolve(process.env.KLAVIYO_CONVERSION_METRIC_ID);
  metricId ??= (async () => {
    let path: string | null = "/metrics/?fields[metric]=name,integration";
    while (path) {
      const page: { data: { id: string; attributes: { name: string; integration?: { key?: string } } }[]; links?: { next?: string | null } } = await api(path);
      const hit = page.data.find((m) => m.attributes.name === "Placed Order" && m.attributes.integration?.key === "shopify");
      if (hit) return hit.id;
      path = page.links?.next ? page.links.next.replace(BASE, "") : null;
    }
    throw new Error("Métrica Klaviyo “Placed Order” (Shopify) não encontrada.");
  })().catch((e) => { metricId = null; throw e; });
  return metricId;
}

type Report = { data: { attributes: { results: { groupings: Record<string, string>; statistics: Record<string, number> }[] } } };

async function valuesReport(kind: "campaign" | "flow", p: Period) {
  const report = await api<Report>(`/${kind}-values-reports/`, {
    data: {
      type: `${kind}-values-report`,
      attributes: {
        statistics: ["recipients", "conversions", "conversion_value"],
        timeframe: timeframe(p),
        conversion_metric_id: await conversionMetric(),
        filter: 'equals(send_channel,"email")',
      },
    },
  });
  // One line per message; the dashboard shows one per campaign or flow.
  const totals = new Map<string, { recipients: number; conversions: number; value: number }>();
  for (const r of report.data.attributes.results) {
    const id = r.groupings[`${kind}_id`];
    const t = totals.get(id) || { recipients: 0, conversions: 0, value: 0 };
    t.recipients += r.statistics.recipients || 0;
    t.conversions += r.statistics.conversions || 0;
    t.value += r.statistics.conversion_value || 0;
    totals.set(id, t);
  }
  return totals;
}

async function names(kind: "campaigns" | "flows", ids: string[]) {
  const out = new Map<string, { name: string; sent?: string }>();
  for (const id of ids) {
    const fields = kind === "campaigns" ? "name,send_time" : "name";
    const r = await api<{ data: { attributes: { name: string; send_time?: string | null } } }>(`/${kind}/${id}/?fields[${kind.slice(0, -1)}]=${fields}`);
    out.set(id, { name: r.data.attributes.name, sent: r.data.attributes.send_time || undefined });
  }
  return out;
}

// Same columns the Windsor connector delivered, so the dashboard reads them unchanged.
export async function klaviyoCampaigns(p: Period): Promise<Row[]> {
  const totals = await valuesReport("campaign", p);
  const info = await names("campaigns", [...totals.keys()]);
  return [...totals].map(([id, t]) => ({
    campaign: info.get(id)?.name || id, campaign_id: id, sent_at: info.get(id)?.sent || null,
    campaign_report_recipients: t.recipients, campaign_report_conversions: t.conversions, campaign_report_conversion_value: Math.round(t.value * 100) / 100,
  })).sort((a, b) => String(b.sent_at || "").localeCompare(String(a.sent_at || "")));
}

export async function klaviyoFlows(p: Period): Promise<Row[]> {
  const totals = await valuesReport("flow", p);
  const info = await names("flows", [...totals.keys()]);
  return [...totals].map(([id, t]) => ({
    flow_name: info.get(id)?.name || id, flow_id: id,
    flow_recipients: t.recipients, flow_conversions: t.conversions, flow_conversion_value: Math.round(t.value * 100) / 100,
  })).sort((a, b) => b.flow_recipients - a.flow_recipients);
}
