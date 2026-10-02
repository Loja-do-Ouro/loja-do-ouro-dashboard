import { ingest, ingestRange } from "@/lib/bi/ingest";
import { shopifyConfigured } from "@/lib/bi/shopify";
import { writerConfigured } from "@/lib/bi/supabase-write";
import { windsorConfigured } from "@/lib/bi/windsor";
import { constantTimeTextEqual } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Nightly collection into the private BI tables. Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET". A backfill accepts ?from=YYYY-MM-DD&to=YYYY-MM-DD.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const missing = [
    !writerConfigured() && "SUPABASE_SERVICE_ROLE_KEY / BI_SUPABASE_URL",
    !windsorConfigured() && "WINDSOR_API_KEY",
    !shopifyConfigured() && "SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN",
  ].filter(Boolean);
  if (missing.length)
    return Response.json({ ok: false, error: "Configuração em falta", missing }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  let range;
  try {
    range = ingestRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Intervalo inválido" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const trigger = url.searchParams.has("from") ? "manual_backfill" : "scheduled";
  const result = await ingest(range, trigger);
  return Response.json({ ok: result.status === "completed", ...result }, { status: result.status === "completed" ? 200 : 207, headers: { "Cache-Control": "no-store" } });
}
