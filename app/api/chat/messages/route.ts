import { serverRpc } from "@/lib/support/db";
import { isUuid } from "@/lib/support/rules";
import { ChatError, chatHandle, chatJson, checkOrigin, preflight, readJson, siteOrigins, visitorTokenHash } from "@/lib/support/site-chat";
import { cleanPage } from "@/lib/support/site-rules";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

type Messages = {
  name: string; email: string; verified: boolean; typing: boolean;
  messages: { id: string; from: "visitor" | "team"; author: string | null; body: string; created_at: string; inserted_at: string }[];
};

// Mensagens da conversa do visitante (desde ?depois=<inserted_at>). Com ?aberto=1 o chat está à
// vista: as respostas passam a "Lida" no dashboard.
export async function GET(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const q = new URL(request.url).searchParams;
    const after = q.get("depois");
    const valid = after && !Number.isNaN(Date.parse(after)) ? new Date(after).toISOString() : null;
    const r = await serverRpc<Messages>("ldo_support_site_messages", { p_token_hash: tokenHash, p_after: valid, p_open: q.get("aberto") === "1" });
    return chatJson(request, r);
  });
}

// Nova mensagem do visitante. A mesma chave (repetição depois de uma falha de rede) não duplica.
export async function POST(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const b = await readJson(request);
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (!body) throw new ChatError(400, "Escreva a sua mensagem.");
    if (body.length > 2000) throw new ChatError(400, "Mensagem demasiado longa (máximo 2000 caracteres).");
    if (!isUuid(b.clientKey)) throw new ChatError(400, "Pedido inválido.");
    const r = await serverRpc<{ id: string; created_at: string; repeated: boolean }>("ldo_support_site_send", {
      p_token_hash: tokenHash, p_body: body, p_client_key: b.clientKey, p_page: cleanPage(b.page, siteOrigins()),
    });
    return chatJson(request, r);
  });
}
