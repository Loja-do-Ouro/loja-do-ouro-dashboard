import { auctionSession, lotLive } from "@/lib/leilao/site";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Estado de um lote para o painel de licitação (preço, fecho, líder em pseudónimo; o máximo só para o próprio líder).
export async function GET(request: Request) {
  const lot = new URL(request.url).searchParams.get("lot") || "";
  if (!UUID.test(lot)) return Response.json(null, { status: 400 });
  try {
    const data = await lotLive(lot, await auctionSession());
    return Response.json(data, { status: data ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
