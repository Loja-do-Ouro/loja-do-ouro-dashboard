import { loadViewer } from "@/lib/viewer";
import { metricoolAccount } from "@/lib/bi/metricool";
export const dynamic = "force-dynamic";

// TEMPORARY diagnostic (Super Admin only, read-only): shows Metricool's raw answer
// for an analytics path, to map metric names. Removed before production.
export async function GET(request: Request) {
  const viewer = await loadViewer();
  if (!viewer?.isSuper) return new Response("Sem permissão.", { status: 403 });
  const q = new URL(request.url).searchParams;
  const path = q.get("path") || "";
  if (!/^\/(stats|v2\/analytics)\/[A-Za-z0-9/_.-]+$/.test(path)) return new Response("Caminho inválido.", { status: 400 });
  q.delete("path");
  const url = new URL(`https://app.metricool.com/api${path}`);
  url.search = new URLSearchParams({ ...Object.fromEntries(q), ...metricoolAccount() }).toString();
  const r = await fetch(url, { cache: "no-store", headers: { "X-Mc-Auth": process.env.METRICOOL_USER_TOKEN || "", Accept: "application/json" } });
  const text = await r.text();
  return new Response(`HTTP ${r.status}\n${text.slice(0, 6000)}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
