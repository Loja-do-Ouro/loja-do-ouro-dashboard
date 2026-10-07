import { serverRpc, sessionRpc } from "@/lib/support/db";
import { handle, HttpError, supportViewer } from "@/lib/support/http";
import { metricoolImage } from "@/lib/support/metricool";
import { INLINE_TYPES, isUuid } from "@/lib/support/rules";
import { zendeskAttachment } from "@/lib/support/zendesk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Respostas das funções Vercel têm limite de tamanho; ficheiros maiores abrem-se na plataforma.
const MAX_BYTES = 4 * 1024 * 1024;
const PROVIDER: Record<string, string> = { "metricool-facebook": "FACEBOOK", "metricool-instagram": "INSTAGRAM" };

type Detail = {
  conversation: { id: string; source_id: string; external_id: string };
  messages: { id: string; attachments: { name: string; type: string | null; ref: string }[] }[];
};

// Anexos através do servidor: o browser nunca recebe tokens nem URLs autenticados. Só imagens
// comuns abrem em linha; tudo o resto é descarregado, sem execução nem interpretação pelo browser.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const q = new URL(request.url).searchParams;
    const conversation = q.get("c"), message = q.get("m"), index = Number(q.get("i"));
    if (!isUuid(conversation) || !isUuid(message) || !Number.isInteger(index) || index < 0) throw new HttpError(404, "Anexo não encontrado.");
    const d = await sessionRpc<Detail>(viewer.session, "ldo_support_conversation", { p_id: conversation });
    const a = d.messages.find((m) => m.id === message)?.attachments[index];
    if (!a) throw new HttpError(404, "Anexo não encontrado.");

    let upstream: Response, name = a.name, type: string | null = a.type;
    if (a.ref.startsWith("zendesk:") && d.conversation.source_id === "zendesk") {
      const users = await sessionRpc<{ id: string; zendesk: boolean }[]>(viewer.session, "ldo_support_users");
      const reader = users.find((u) => u.id === viewer.id)?.zendesk ? viewer.id : await serverRpc<string | null>("ldo_support_zendesk_sync_user");
      if (!reader) throw new HttpError(409, "Ligue o Zendesk para abrir anexos.");
      const z = await zendeskAttachment(reader, d.conversation.external_id, a.ref.slice(8));
      if (z.size && z.size > MAX_BYTES) throw new HttpError(413, "Anexo demasiado grande para abrir aqui; abra o ticket no Zendesk.");
      upstream = z.response;
      name = z.name;
      type = z.type;
    } else if (a.ref.startsWith("metricool:") && PROVIDER[d.conversation.source_id]) {
      const target = a.ref.slice(10);
      if (!/^https:\/\//.test(target)) throw new HttpError(400, "Anexo inválido.");
      upstream = await metricoolImage(PROVIDER[d.conversation.source_id], target);
      type = upstream.headers.get("content-type");
    } else throw new HttpError(404, "Anexo não encontrado.");

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "Anexo demasiado grande para abrir aqui; abra-o na plataforma de origem.");
    const mime = (type || "").split(";")[0].trim().toLowerCase();
    const inline = INLINE_TYPES.has(mime);
    const safeName = (name || "anexo").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "anexo";
    return new Response(bytes, {
      headers: {
        "Content-Type": inline ? mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
