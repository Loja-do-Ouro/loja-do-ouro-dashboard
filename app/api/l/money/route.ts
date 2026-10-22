import { auctionSession } from "@/lib/leilao/site";
import { lotMoney } from "@/lib/leilao/money";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caução e pagamento do cliente num lote (o ecrã pergunta enquanto espera pela aprovação no MB WAY ou no cartão).
export async function GET(request: Request) {
  const lot = new URL(request.url).searchParams.get("lot") || "";
  const session = await auctionSession();
  if (!UUID.test(lot) || !session) return Response.json(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json(await lotMoney(session, lot, true), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
