import { constantTimeTextEqual } from "@/lib/session";
import { notificationId } from "@/lib/easypay-rules";
import { syncRef } from "@/lib/leilao/money";

export const dynamic = "force-dynamic";

// Notificações da easypay (configurar no backoffice da easypay: https://<site>/api/l/easypay?s=<EASYPAY_WEBHOOK_SECRET>).
// O corpo só serve para saber o id: o estado é sempre lido na API da easypay, por isso uma notificação falsa não muda
// nada. Responde 200 depressa para a easypay não repetir.
export async function POST(request: Request) {
  const secret = process.env.EASYPAY_WEBHOOK_SECRET;
  if (secret && !constantTimeTextEqual(new URL(request.url).searchParams.get("s") || "", secret)) {
    return new Response("Não autorizado.", { status: 401 });
  }
  const id = notificationId(await request.json().catch(() => null));
  if (id) await syncRef(id).catch(() => null);
  return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });
}
