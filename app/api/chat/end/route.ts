import { serverRpc } from "@/lib/support/db";
import { chatHandle, chatJson, checkOrigin, identityEmail, preflight, readJson, sendTranscript, visitorTokenHash, type Transcript } from "@/lib/support/site-chat";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// O cliente termina a conversa no chat. Se pedir, recebe uma cópia no email que indicou ao iniciar
// (nunca noutro endereço); depois de terminada, a conversa deixa de responder a este token.
export async function POST(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const b = await readJson(request);
    const copy = b.transcript === true;
    const t = await serverRpc<Transcript>("ldo_support_site_end", { p_token_hash: tokenHash, p_identity_email: identityEmail(request), p_transcript: copy });
    const sent = copy && t.email ? await sendTranscript(t).catch(() => ({ ok: false })) : null;
    return chatJson(request, { ok: true, emailed: Boolean(sent?.ok), email: sent?.ok ? t.email : null });
  });
}
