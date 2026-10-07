import { constantTimeTextEqual } from "@/lib/session";
import { runSync } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Passagem diária de segurança (Vercel Cron, com CRON_SECRET), para o caso de ninguém ter o
// dashboard aberto. Durante o dia a sincronização é feita pelo dashboard aberto, com a frequência
// definida na configuração, sem processos permanentes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const results = await runSync({ force: true });
  return Response.json({ ok: results.every((r) => r.ok !== false), results }, { headers: { "Cache-Control": "no-store" } });
}
