import { auctionSession } from "@/lib/leilao/site";
import { serverRpc } from "@/lib/support/db";

export const dynamic = "force-dynamic";

// RGPD (acesso e portabilidade): os dados da conta, as licitações, os favoritos e os lotes ganhos, em JSON.
export async function GET() {
  const session = await auctionSession();
  if (!session) return new Response("Entre na sua conta.", { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const data = await serverRpc<Record<string, unknown>>("ldo_auc_export", { p_session: session });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="leilao-loja-do-ouro-dados-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("A sua sessão terminou. Entre de novo.", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
