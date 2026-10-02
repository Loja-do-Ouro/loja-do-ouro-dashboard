import { localDate } from "@/lib/bi/periods";
import { reportsConfigured, type ReportKind } from "@/lib/reports";
import { sendMissingAlert, sendReport } from "@/lib/report-send";
import { constantTimeTextEqual } from "@/lib/session";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET".
//   ?run=morning  → daily report of yesterday; on Mondays also weekly, on the 1st also monthly.
//   ?run=evening  → alert listing the open stores without any record today.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!reportsConfigured())
    return Response.json({ ok: false, error: "REPORTS_TOKEN por configurar" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const run = new URL(request.url).searchParams.get("run") === "evening" ? "evening" : "morning";
  const results = run === "evening" ? [await sendMissingAlert()] : await sendMorningReports();
  const ok = results.every((r) => r.status !== "failed");
  return Response.json({ ok, run, results }, { status: ok ? 200 : 207, headers: { "Cache-Control": "no-store" } });
}

async function sendMorningReports() {
  const today = localDate();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const kinds: ReportKind[] = ["daily", ...(weekday === 1 ? (["weekly"] as const) : []), ...(today.endsWith("-01") ? (["monthly"] as const) : [])];
  const out = [];
  for (const kind of kinds) out.push(await sendReport(kind));
  return out;
}
