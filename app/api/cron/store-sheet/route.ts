import { constantTimeTextEqual } from "@/lib/session";
import { importStoreSheet } from "@/lib/store-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LISBON_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" });

// Importação noturna da folha das lojas (Vercel Cron, "Authorization: Bearer $CRON_SECRET").
//   ?janela=noite&utc=0|1 → o vercel.json chama a rota às 00h UTC (utc=0) e à 01h UTC (utc=1); no plano da Vercel
//                    dispara em qualquer minuto dessa hora. Decide-se pelo agendamento e pelo fuso de Lisboa nesse
//                    dia (às 00:30 UTC): no horário de verão corre a das 00h UTC, no de inverno a da 01h UTC, ambas
//                    à 01h de Lisboa. Há sempre exatamente uma por noite, também quando a hora muda (no domingo
//                    de março corre às 02h de Lisboa, porque a 01h não existe).
//   ?janela=noite         → só entre a 01:00 e as 01:59 de Lisboa.
//   sem parâmetro         → corre já (para testes manuais com o segredo).
function nightSlot(utc: string | null, now: Date) {
  if (utc !== "0" && utc !== "1") return LISBON_HOUR.format(now) === "01";
  const summer = LISBON_HOUR.format(new Date(`${now.toISOString().slice(0, 10)}T00:30:00Z`)) === "01";
  return utc === (summer ? "0" : "1");
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  const night = params.get("janela") === "noite";
  if (night && !nightSlot(params.get("utc"), new Date()))
    return Response.json({ ok: true, ran: false, reason: "Fora da janela das 01h de Lisboa." }, { headers: { "Cache-Control": "no-store" } });
  // Uma exceção (base de dados ou BI_INGEST_TOKEN, antes de a execução ficar registada) é uma falha, não "nada a fazer".
  const result = await importStoreSheet(night ? "noite" : "cron").catch((e) => ({ ran: false as const, error: true as const, reason: e instanceof Error ? e.message : "Erro" }));
  const ok = result.ran ? result.status !== "failed" : !("error" in result);
  if (!ok) console.error("folha das lojas:", result.ran ? result.detail : result.reason);
  return Response.json({ ok, ...result }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
