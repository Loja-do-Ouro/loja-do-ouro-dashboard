import { closedPeriods } from "@/lib/bi/periods";
import { loadPeriods } from "@/lib/bi/store";
import { overview } from "@/lib/bi/model";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  const windows = closedPeriods(),
    store = await loadPeriods(windows.map((w) => w.range));
  const coverage = windows.map((w) => {
    const s = overview(store, w.range);
    return {
      period: w.key,
      range: w.range,
      sales: s.sales.value,
      spend: s.spend,
      complete: [
        s.sales,
        s.orders,
        s.aov,
        s.meta,
        s.google,
        s.sessions,
        s.users,
      ].every((m) => m.value !== null),
    };
  });
  const complete =
    store.errors.length === 0 && coverage.every((c) => c.complete);
  // Read-only coverage monitor, called on demand. Nightly ingestion is /api/cron/ingest.
  return Response.json(
    {
      ok: complete,
      status: complete ? "provisional" : "partial",
      checked_at: new Date().toISOString(),
      sources_refreshed: false,
      coverage,
      errors: store.errors,
    },
    { status: complete ? 200 : 207, headers: { "Cache-Control": "no-store" } },
  );
}
