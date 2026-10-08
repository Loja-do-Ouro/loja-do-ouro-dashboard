import { serverRpc } from "@/lib/support/db";
import { chatHandle, chatJson, checkOrigin, identityEmail, preflight, readJson, siteOrigins, visitorTokenHash } from "@/lib/support/site-chat";
import { cleanCart, cleanPage } from "@/lib/support/site-rules";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// O que o cliente está a fazer na loja (só depois de iniciar o chat): página atual, carrinho e início da
// visita. Enviado pelo browser do cliente; para ajudar a equipa, não é informação confirmada.
export async function POST(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const b = await readJson(request);
    const started = typeof b.visitStartedAt === "string" && !Number.isNaN(Date.parse(b.visitStartedAt)) ? new Date(b.visitStartedAt).toISOString() : null;
    const pages = typeof b.pages === "number" && Number.isInteger(b.pages) && b.pages >= 0 && b.pages <= 100000 ? b.pages : null;
    await serverRpc("ldo_support_site_context", {
      p_token_hash: tokenHash, p_identity_email: identityEmail(request),
      p_page: cleanPage(b.page, [...siteOrigins(), new URL(request.url).origin]), p_title: typeof b.title === "string" ? b.title.slice(0, 200) : null,
      p_cart: b.cart === undefined ? null : cleanCart(b.cart), p_visit_started_at: started, p_pages: pages,
    });
    return chatJson(request, { ok: true });
  });
}
