import { after } from "next/server";
import { sessionRpc } from "@/lib/support/db";
import { notifyHandover } from "@/lib/support/notify";
import { body, handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { proposeFromMessage } from "@/lib/support/knowledge";
import { reviewReply } from "@/lib/support/review";
import { reviewTag } from "@/lib/support/review-rules";
import { isUuid } from "@/lib/support/rules";
import { confirmSentInZendesk, markNotSent, sendMessage, updateConversation, verifyMessage } from "@/lib/support/service";

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
    return json({ ...detail, users, me: viewer.id, super: viewer.isSuper });
  });
}

type Action = {
  action: "read" | "unread" | "presence" | "review" | "reply" | "note" | "update" | "verify" | "confirm_sent" | "not_sent" | "knowledge"
    | "survey_preview" | "survey_cancel";
  composing: boolean;
  body: string;
  clientKey: string;
  uploads: string[];
  status: string;
  assigneeId: string | null;
  messageId: string;
  seen: string;
  // Revisão da IA: id gerado no browser (o mesmo no pedido de revisão e no envio) e, sem revisão feita, o motivo.
  reviewId: string;
  review: unknown;
  // Proposta da IA posta no campo de resposta com "Usar na resposta".
  aiDraftId: string;
  // Pedido de avaliação: a caixa ao resolver (modo "perguntar") e o cancelamento pelo Super Admin.
  survey: boolean;
  surveyId: string;
  reason: string;
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
      // Revisão da IA antes de enviar: não envia nada. Uma falha da IA volta como resposta normal e o browser envia.
      case "review":
        if (typeof b.body !== "string" || !isUuid(b.reviewId)) throw new HttpError(400, "Pedido inválido.");
        return json(await reviewReply(viewer, id, b.reviewId, b.body));
      case "reply":
      case "note": {
        const uploads = Array.isArray(b.uploads) ? b.uploads.filter(isUuid).slice(0, 5) : [];
        if (typeof b.body !== "string" || !isUuid(b.clientKey)) throw new HttpError(400, "Pedido inválido.");
        const links = b.action === "reply" ? { review: reviewTag(b.review), aiDraftId: isUuid(b.aiDraftId) ? b.aiDraftId : null } : {};
        return json(await sendMessage(viewer, id, b.action === "reply" ? "outbound" : "note", b.body, b.clientKey, uploads, request.url, links));
      }
      case "update": {
        const { handover, note } = await updateConversation(viewer, id, {
          ...("status" in b ? { status: b.status } : {}),
          ...("assigneeId" in b ? { assigneeId: b.assigneeId } : {}),
          ...(typeof b.survey === "boolean" ? { survey: b.survey } : {}),
        });
        // Aviso por email ao colega que recebe a conversa, depois de responder (não atrasa o ecrã).
        if (handover) after(() => notifyHandover(handover).catch(() => undefined));
        // note: o pedido de avaliação ao resolver (agendado, ou o motivo para não haver).
        return json({ ok: true, note });
      }
      // Antes de resolver no modo "perguntar": pode pedir-se avaliação, e porque não.
      case "survey_preview":
        return json(await sessionRpc(viewer.session, "ldo_support_survey_preview", { p_conv: id }));
      // Só o Super Admin (a BD confirma), com o motivo, que fica na conversa.
      case "survey_cancel":
        if (!isUuid(b.surveyId) || typeof b.reason !== "string") throw new HttpError(400, "Pedido inválido.");
        await sessionRpc(viewer.session, "ldo_support_survey_cancel", { p_id: b.surveyId, p_reason: b.reason.slice(0, 300) });
        return json({ ok: true });
      case "verify":
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        return json(await verifyMessage(viewer, id, b.messageId));
      case "confirm_sent":
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        await confirmSentInZendesk(viewer, id, b.messageId);
        return json({ ok: true });
      // Guardar uma resposta enviada pelo dashboard como proposta da base de conhecimento aprendida (o Super Admin aprova).
      // Uma falha da IA aparece como erro (não como uma nota de sucesso).
      case "knowledge": {
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        const r = await proposeFromMessage(viewer, id, b.messageId);
        if (r.resultado === "erro") throw new HttpError(502, r.note);
        return json(r);
      }
      case "not_sent":
        if (!isUuid(b.messageId)) throw new HttpError(400, "Pedido inválido.");
        await markNotSent(viewer, id, b.messageId);
        return json({ ok: true });
      default:
        throw new HttpError(400, "Ação desconhecida.");
    }
  });
}
