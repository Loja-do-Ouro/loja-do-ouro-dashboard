import { serverRpc } from "@/lib/support/db";
import { isUuid } from "@/lib/support/rules";
import { ChatError, chatHandle, chatJson, checkOrigin, identityEmail, preflight, readJson, visitorTokenHash } from "@/lib/support/site-chat";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Estrelas no chat do site, em resposta ao pedido de avaliação (1 a 5). A BD confirma que o pedido é desta conversa e
// ainda está aberto; a mesma nota outra vez não muda nada. Uma nota de 1 ou 2 reabre a conversa para a equipa.
export async function POST(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const b = await readJson(request);
    const score = typeof b.score === "number" && Number.isInteger(b.score) ? b.score : NaN;
    if (!isUuid(b.survey)) throw new ChatError(400, "Pedido inválido.");
    if (!(score >= 1 && score <= 5)) throw new ChatError(400, "Escolha de 1 a 5 estrelas.");
    const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 500) : null;
    const r = await serverRpc<{ ok: boolean; repeated: boolean }>("ldo_support_site_rate", {
      p_token_hash: tokenHash, p_identity_email: identityEmail(request), p_survey_id: b.survey, p_score: score, p_comment: comment || null,
    });
    return chatJson(request, r);
  });
}
