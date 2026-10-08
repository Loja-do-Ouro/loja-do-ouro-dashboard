import { randomToken, sha256Hex } from "@/lib/support/crypto";
import { serverRpc } from "@/lib/support/db";
import { isUuid } from "@/lib/support/rules";
import { ChatError, chatHandle, chatJson, checkOrigin, ipHash, preflight, readJson, siteOrigins } from "@/lib/support/site-chat";
import { cleanPage, isEmail, verifyIdentity } from "@/lib/support/site-rules";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Início de uma conversa no chat do site: nome, email (obrigatório) e a primeira mensagem.
// Devolve o token do visitante, que o widget guarda no browser e envia nos pedidos seguintes.
export async function POST(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const b = await readJson(request);
    // Campo escondido: só robôs o preenchem.
    if (typeof b.website === "string" && b.website.trim()) throw new ChatError(400, "Pedido inválido.");
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    const message = typeof b.message === "string" ? b.message.trim() : "";
    if (!name) throw new ChatError(400, "Indique o seu nome.");
    if (!message) throw new ChatError(400, "Escreva a sua mensagem.");
    if (message.length > 2000) throw new ChatError(400, "Mensagem demasiado longa (máximo 2000 caracteres).");
    if (!isUuid(b.clientKey)) throw new ChatError(400, "Pedido inválido.");
    // Cliente com sessão iniciada na loja: email confirmado pela assinatura do tema.
    const verified = verifyIdentity(b.identity, process.env.SITE_CHAT_SECRET);
    const email = verified || (typeof b.email === "string" ? b.email.trim().toLowerCase() : "");
    if (!isEmail(email)) throw new ChatError(400, "Indique um email válido.");
    const token = randomToken(32);
    await serverRpc("ldo_support_site_start", {
      p_token_hash: sha256Hex(token), p_name: name, p_email: email, p_verified: Boolean(verified), p_message: message,
      p_client_key: b.clientKey, p_page: cleanPage(b.page, siteOrigins()), p_ip_hash: ipHash(request),
      p_user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
    });
    return chatJson(request, { token, verified: Boolean(verified) });
  });
}
