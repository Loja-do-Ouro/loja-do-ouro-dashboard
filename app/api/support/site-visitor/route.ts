import { sessionRpc } from "@/lib/support/db";
import { handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";

export const dynamic = "force-dynamic";

// Chat do site: o que o cliente está a fazer na loja (página, carrinho, tempo de visita), para o painel.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const conversation = new URL(request.url).searchParams.get("conversa");
    if (!isUuid(conversation)) throw new HttpError(400, "Conversa inválida.");
    return json({ visitor: await sessionRpc(viewer.session, "ldo_support_site_visitor_info", { p_conversation: conversation }) });
  });
}
