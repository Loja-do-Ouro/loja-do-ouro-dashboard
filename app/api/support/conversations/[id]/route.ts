import { sessionRpc } from "@/lib/support/db";
import { body, handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";
import { markNotSent, sendMessage, updateConversation, verifyMessage } from "@/lib/support/service";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Ctx = { params: Promise<{ id: string }> };

async function conversationId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Conversa não encontrada.");
  return id;
}

export async function GET(request: Request, ctx: Ctx) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const id = await conversationId(ctx);
    const [detail, users] = await Promise.all([
      sessionRpc<Record<string, unknown>>(viewer.session, "ldo_support_conversation", { p_id: id }),
      sessionRpc(viewer.session, "ldo_support_users"),
    ]);
    return json({ ...detail, users, me: viewer.id });
  });
}

type Action = {
  action: "read" | "unread" | "presence" | "reply" | "note" | "update" | "verify" | "not_sent";
  composing: boolean;
  body: string;
  clientKey: string;
  uploads: string[];
  status: string;
  assigneeId: string | null;
  messageId: string;
  seen: string;
};

// Uma ação por pedido. "reply" é sempre resposta pública ao cliente pelo canal da conversa;
// "note" é sempre nota interna. O tipo nunca é deduzido do texto.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const viewer = await supportViewer(request, { write: true });
    const id = await conversationId(ctx);
    const b = await body<Action>(request);
    switch (b.action) {
      case "read":
      case "unread":
        // seen: hora de chegada da última mensagem do cliente mostrada no ecrã (a leitura nunca vai além).
        await sessionRpc(viewer.session, "ldo_support_mark_read", {
          p_id: id, p_unread: b.action === "unread", p_seen: typeof b.seen === "string" && !Number.isNaN(Date.parse(b.seen)) ? b.seen : null,
        });
        return json({ ok: true });
      case "presence":
        return json({ presence: await sessionRpc(viewer.session, "ldo_support_presence_ping", { p_id: id, p_composing: Boolean(b.composing) }) });
      case "reply":
      case "note": {
        const uploads = Array.isArray(b.uploads) ? b.uploads.filter(isUuid).slice(0, 5) : [];
        if (typeof b.body !== "string" || !isUuid(b.clientKey)) throw new HttpError(400, "Pedido inválido.");
        return json(await sendMessage(viewer, id, b.action === "reply" ? "outbound" : "note", b.body, b.clientKey, uploads, request.url));
      }
      case "update":
        await updateConversation(viewer, id, {
          ...("status" in b ? { status: b.status } : {}),
          ...("assigneeId" in b ? { assigneeId: b.assigneeId } : {}),
        });
        return json({ ok: true });
      case "verify":
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        return json(await verifyMessage(viewer, id, b.messageId));
      case "not_sent":
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        await markNotSent(viewer, id, b.messageId);
        return json({ ok: true });
      default:
        throw new HttpError(400, "Ação desconhecida.");
    }
  });
}
