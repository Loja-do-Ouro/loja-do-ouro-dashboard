import { shopifyConfigured, staffOrderByNumber } from "@/lib/bi/shopify";
import { sessionRpc } from "@/lib/support/db";
import { handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";

export const dynamic = "force-dynamic";

// Encomenda Shopify pelo número (ex.: mencionada pelo cliente numa conversa). Só para a equipa do apoio,
// sempre a partir de uma conversa a que a pessoa tem acesso; diz se a encomenda é do email do contacto.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const q = new URL(request.url).searchParams;
    const conversation = q.get("conversa");
    const number = (q.get("numero") || "").replace(/\D/g, "").slice(0, 12);
    if (!isUuid(conversation) || !number) throw new HttpError(400, "Pedido inválido.");
    const detail = await sessionRpc<{ contact: { email: string | null; linked_email: string | null } | null }>(
      viewer.session, "ldo_support_conversation", { p_id: conversation });
    if (!shopifyConfigured()) return json({ order: null, error: "Ligação Shopify por configurar." });
    const email = detail.contact?.linked_email || detail.contact?.email || null;
    try {
      return json({ ...(await staffOrderByNumber(number, email)), number });
    } catch (e) {
      return json({ order: null, number, error: e instanceof Error ? e.message : "Shopify indisponível." });
    }
  });
}
