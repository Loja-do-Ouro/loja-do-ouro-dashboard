import "server-only";
import { unstable_cache } from "next/cache";
import { accountFields, accounts } from "./accounts";
import type { Period } from "./periods";
import type { Row } from "./model";

export type WindsorResult = { rows: Row[]; fields: string[]; fetched_at: string };

// Seconds a dashboard view may reuse a Windsor answer. The connector itself can
// serve upstream cache, so a short reuse window does not lower data freshness.
export const LIVE_REVALIDATE_SECONDS = 900;
export const BI_CACHE_TAG = "bi";

export function windsorConfigured() {
  return Boolean(process.env.WINDSOR_API_KEY || process.env.WINDSORAI_API_KEY);
}

async function request(connector: string, from: string, to: string, requested: string[]): Promise<WindsorResult> {
  const key = process.env.WINDSOR_API_KEY || process.env.WINDSORAI_API_KEY;
  if (!key) throw new Error("Ligação às fontes indisponível.");
  const fields = [...new Set([...requested, ...accountFields[connector]])];
  const params = new URLSearchParams({ api_key: key, select_accounts: accounts()[connector], date_from: from, date_to: to, fields: fields.join(","), _renderer: "json" });
  if (connector === "facebook") params.set("attribution_window", "default");
  if (connector === "shopify") params.set("report_timezone", "Europe/Lisbon");
  // Never log the request URL, which contains the existing private API key.
  let response: Response;
  try {
    response = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, {
      cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "LojaDoOuroDashboard/4.2" },
    });
  } catch { throw new Error("Consulta interrompida ou excedeu o tempo disponível."); }
  if (!response.ok) throw new Error(`Fonte indisponível (HTTP ${response.status}).`);
  let json: unknown;
  try { json = await response.json(); } catch { throw new Error("Resposta inválida da fonte."); }
  const obj = json as Record<string, unknown>;
  const rows = Array.isArray(json) ? json : Array.isArray(obj?.data) ? obj.data : Array.isArray(obj?.result) ? obj.result : null;
  if (!rows || rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Resposta inválida da fonte.");
  const [currencyField, timezoneField] = accountFields[connector];
  if (currencyField && rows.some(r => r[currencyField] !== "EUR" || r[timezoneField] !== "Europe/Lisbon"))
    throw new Error("Moeda ou fuso da conta sem confirmação EUR / Europe/Lisbon.");
  return { rows: rows as Row[], fields, fetched_at: new Date().toISOString() };
}

// Dashboard reads: identical queries within the window reuse one answer.
// Failures throw and are never cached.
const cachedRequest = unstable_cache(request, ["windsor-read"], { revalidate: LIVE_REVALIDATE_SECONDS, tags: [BI_CACHE_TAG] });

export function readWindsor(connector: string, p: Period, fields: string[], options: { fresh?: boolean } = {}) {
  return options.fresh ? request(connector, p.from, p.to, fields) : cachedRequest(connector, p.from, p.to, fields);
}
