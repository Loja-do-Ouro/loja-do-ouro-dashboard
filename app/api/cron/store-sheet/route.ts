import { constantTimeTextEqual } from "@/lib/session";
import { importStoreSheet } from "@/lib/store-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LISBON_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" });

// Importação noturna da folha das lojas (Vercel Cron, "Authorization: Bearer $CRON_SECRET").
//   ?janela=noite  → corre só entre a 01:00 e as 01:59 de Lisboa. O vercel.json chama esta rota às 00h e à 01h UTC
//                    (no plano da Vercel a hora exata varia dentro dessa hora): uma das duas cai sempre nessa janela,
//                    no horário de verão e no de inverno.
//   sem parâmetro  → corre já (para testes manuais com o segredo).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const night = new URL(request.url).searchParams.get("janela") === "noite";
  if (night && LISBON_HOUR.format(new Date()) !== "01")
    return Response.json({ ok: true, ran: false, reason: "Fora da janela das 01h de Lisboa." }, { headers: { "Cache-Control": "no-store" } });
  const result = await importStoreSheet(night ? "noite" : "cron").catch((e) => ({ ran: false as const, reason: e instanceof Error ? e.message : "Erro" }));
  const ok = !result.ran || result.status !== "failed";
  return Response.json({ ok, ...result }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
