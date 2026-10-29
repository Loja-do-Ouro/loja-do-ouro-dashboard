import { ordersByEmail, shopifyConfigured } from "@/lib/bi/shopify";
import { sessionRpc } from "@/lib/support/db";
import { body, handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Encomendas Shopify do email associado (manualmente) ou conhecido do contacto.
export async function GET(request: Request, ctx: Ctx) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const { id } = await ctx.params;
    const conversation = new URL(request.url).searchParams.get("conversa");
    if (!isUuid(id) || !isUuid(conversation)) throw new HttpError(404, "Contacto não encontrado.");
    const detail = await sessionRpc<{ contact: { id: string; email: string | null; linked_email: string | null } | null }>(
      viewer.session, "ldo_support_conversation", { p_id: conversation });
    if (detail.contact?.id !== id) throw new HttpError(404, "Contacto não encontrado.");
    const email = detail.contact.linked_email || detail.contact.email;
    if (!email) return json({ email: null, orders: [], note: "Sem email associado. Associe o cliente pelo email para ver as encomendas." });
    if (!shopifyConfigured()) return json({ email, orders: [], error: "Ligação Shopify por configurar." });
    try {
      const r = await ordersByEmail(email);
      return json({ email, orders: r.orders, phone_note: r.phoneNote, linked: Boolean(detail.contact.linked_email) });
    } catch (e) {
      return json({ email, orders: [], error: e instanceof Error ? e.message : "Shopify indisponível." });
    }
  });
}

// Associação manual a um email de cliente (ou remoção, com email vazio). Nunca pelo nome. Com noSurveys: só os pedidos de
// avaliação a este contacto.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const viewer = await supportViewer(request, { write: true });
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new HttpError(404, "Contacto não encontrado.");
    const b = await body<{ email: string; noSurveys: boolean }>(request);
    // O cliente não quer (ou volta a aceitar) pedidos de avaliação.
    if (typeof b.noSurveys === "boolean") {
      await sessionRpc(viewer.session, "ldo_support_contact_surveys_save", { p_contact: id, p_no_surveys: b.noSurveys });
      return json({ ok: true });
    }
    await sessionRpc(viewer.session, "ldo_support_link_contact", { p_contact: id, p_email: typeof b.email === "string" ? b.email.slice(0, 254) : null });
    return json({ ok: true });
  });
}
