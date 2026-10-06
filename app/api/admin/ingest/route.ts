import { NextResponse } from "next/server";
import { ingest, ingestRange } from "@/lib/bi/ingest";
import { writerConfigured } from "@/lib/bi/supabase-write";
import { windsorConfigured } from "@/lib/bi/windsor";
import { canSeeOnline } from "@/lib/permissions";
import { loadViewer } from "@/lib/viewer";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual collection from the dashboard, for people with Loja Online access.
// The session cookie is SameSite=Lax, so cross-site posts carry no session.
export async function POST(request: Request) {
  const viewer = await loadViewer();
  if (!viewer || viewer.mustChangePassword || !canSeeOnline(viewer)) return new NextResponse("Sem permissão.", { status: 403 });
  const form = await request.formData();
  const back = (status: string) => {
    const url = new URL("/", request.url);
    url.searchParams.set("section", "quality");
    url.searchParams.set("ingest", status);
    return NextResponse.redirect(url, 303);
  };
  if (!writerConfigured() || !windsorConfigured()) return back("config");
  let range;
  try {
    range = ingestRange({ from: String(form.get("from") || "") || null, to: String(form.get("to") || "") || null });
  } catch {
    return back("range");
  }
  const result = await ingest(range, "manual_dashboard");
  return back(result.status);
}
