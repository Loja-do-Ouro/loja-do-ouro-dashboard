import { sessionRpc } from "@/lib/support/db";
import { body, handle, HttpError, json, supportViewer } from "@/lib/support/http";

export const dynamic = "force-dynamic";

// Preferências da própria pessoa no Apoio ao Cliente (botão no campo de resposta): por agora, rever ou não as suas
// respostas com a IA antes de enviar (só conta no modo "opcional"; a BD confirma a sessão).
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request, { write: true });
    const b = await body<{ aiReview: boolean }>(request);
    if (typeof b.aiReview !== "boolean") throw new HttpError(400, "Pedido inválido.");
    await sessionRpc(viewer.session, "ldo_support_user_prefs_save", { p_values: { ai_review: b.aiReview } });
    return json({ ok: true, aiReview: b.aiReview });
  });
}
