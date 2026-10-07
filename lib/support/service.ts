import "server-only";
import { ingest, serverRpc, sessionRpc } from "./db";
import { metricoolSend } from "./metricool";
import { REFUSAL, runSync } from "./sync";
import { isStatus, zendeskReplyWarning, type Status } from "./rules";
import { whatsappSend } from "./whatsapp";
import { getUpload, publishUpload } from "./uploads";
import { readTicket, zendeskComment, zendeskUpdate, ZendeskError, type OutgoingFile } from "./zendesk";
import type { Viewer } from "@/lib/viewer";

type Begin = {
  existing: boolean;
  platform: "zendesk" | "metricool" | "whatsapp";
  message: { id: string; kind: "outbound" | "note"; delivery: string | null; body: string };
  uploads: string[];
  conversation: { id: string; source_id: string; channel: string; external_id: string; via: string | null; contact_external_id: string | null };
};
type Result = { outcome: "accepted" | "failed" | "uncertain"; externalId: string | null; detail: string | null };

const PROVIDER: Record<string, string> = { "metricool-facebook": "FACEBOOK", "metricool-instagram": "INSTAGRAM" };

// Resposta pública ou nota interna. O servidor escolhe o adaptador pela conversa, nunca pelo pedido.
// Uma nota interna nunca segue por um caminho de envio ao cliente: no Zendesk é um comentário
// privado (public:false); nos outros canais fica só no dashboard.
// Anexos: imagens (e PDF no Zendesk) carregados antes pela mesma pessoa nesta conversa; a BD confirma.
export async function sendMessage(viewer: Viewer, conversationId: string, kind: "outbound" | "note", body: string, clientKey: string,
  uploads: string[], requestUrl: string) {
  const begin = await sessionRpc<Begin>(viewer.session, "ldo_support_begin_send", {
    p_id: conversationId, p_kind: kind, p_body: body, p_client_key: clientKey, p_uploads: uploads,
  });
  // Pedido repetido (duplo clique, nova tentativa do browser): devolve o que já existe, sem reenviar.
  if (begin.existing) return { messageId: begin.message.id, delivery: begin.message.delivery, repeated: true };
  if (kind === "note" && begin.platform !== "zendesk") return { messageId: begin.message.id, delivery: null, repeated: false };

  // Preparar os anexos ainda não envia nada: se falhar, o resultado é "Falhou", nunca "incerto".
  const files: OutgoingFile[] = [];
  let image: string | null = null;
  let prepared: Result | null = null;
  try {
    if (begin.platform === "zendesk")
      for (const id of begin.uploads || []) {
        const u = await getUpload(id);
        if (!u) throw new Error("Anexo já não disponível.");
        files.push({ name: u.name, type: u.type, data: Buffer.from(u.data, "base64") });
      }
    // Facebook/Instagram: foto de produto pelo endereço público da Shopify; outras imagens por um URL
    // público temporário (1 hora) do dashboard para a Meta ir buscar.
    else if (begin.platform === "metricool" && begin.uploads?.[0]) {
      const u = await getUpload(begin.uploads[0]);
      if (!u) throw new Error("Anexo já não disponível.");
      image = u.source_url || (await publishUpload(u.id, requestUrl));
    }
  } catch (e) {
    prepared = { outcome: "failed", externalId: null, detail: e instanceof Error ? e.message : "Anexo indisponível." };
  }

  let r: Result;
  try {
    if (prepared) r = prepared;
    else if (begin.platform === "zendesk") r = await zendeskComment(viewer.id, begin.conversation.external_id, begin.message.body, kind === "outbound", files);
    else if (begin.platform === "metricool")
      r = await metricoolSend(PROVIDER[begin.conversation.source_id], begin.conversation.external_id, begin.conversation.contact_external_id, begin.message.body, image);
    else r = await whatsappSend();
  } catch (e) {
    // Erro inesperado depois de o pedido poder ter saído: incerto, nunca repetido automaticamente.
    r = { outcome: "uncertain", externalId: null, detail: e instanceof Error ? e.message : "Erro inesperado." };
  }
  const detail =
    r.outcome === "accepted"
      ? begin.platform === "zendesk"
        ? kind === "note"
          ? "Nota interna gravada no Zendesk (privada)."
          : zendeskReplyWarning(begin.conversation.via)
        : "Aceite pela Metricool. Entrega no Messenger/Instagram sem confirmação pela API."
      : r.detail;
  await serverRpc("ldo_support_finish_send", { p_message: begin.message.id, p_delivery: r.outcome, p_detail: detail, p_external_id: r.externalId });
  // Atualiza o ticket com o que o Zendesk tem agora (comentário, estado); falhar aqui não muda o envio.
  if (begin.platform === "zendesk" && r.outcome !== "failed")
    await readTicket(viewer.id, begin.conversation.external_id).then((c) => ingest("zendesk", [c])).catch(() => undefined);
  return { messageId: begin.message.id, delivery: r.outcome === "accepted" && kind === "note" ? null : r.outcome, detail, repeated: false };
}

type Conversation = { conversation: { id: string; source_id: string; external_id: string; status: Status; assignee_id: string | null } };
type SupportUser = { id: string; name: string; zendesk: boolean; zendesk_user_id: string | null };

// Estado e responsável. Zendesk: escrito no Zendesk com a conta de quem altera, e guardado o que o
// Zendesk devolve. Restantes canais: o dashboard é a fonte de verdade.
export async function updateConversation(viewer: Viewer, id: string, change: { status?: unknown; assigneeId?: unknown }) {
  const status = change.status === undefined ? undefined : isStatus(change.status) ? change.status : null;
  if (status === null) throw new Error("Estado inválido.");
  const assignee = change.assigneeId === undefined ? undefined : typeof change.assigneeId === "string" && change.assigneeId ? change.assigneeId : null;
  const { conversation: c } = await sessionRpc<Conversation>(viewer.session, "ldo_support_conversation", { p_id: id });
  if (c.source_id !== "zendesk") {
    await sessionRpc(viewer.session, "ldo_support_set_local", {
      p_id: id, p_set_status: status !== undefined, p_status: status ?? null, p_set_assignee: assignee !== undefined, p_assignee: assignee ?? null,
    });
    return;
  }
  let zendeskAssignee: string | null | undefined;
  if (assignee !== undefined) {
    if (assignee === null) zendeskAssignee = null;
    else {
      const users = await sessionRpc<SupportUser[]>(viewer.session, "ldo_support_users");
      const target = users.find((u) => u.id === assignee);
      if (!target) throw new Error("Este colaborador não tem acesso ao Apoio ao Cliente.");
      if (!target.zendesk || !target.zendesk_user_id) throw new Error(`${target.name} ainda não ligou a conta Zendesk; não pode receber tickets Zendesk.`);
      zendeskAssignee = target.zendesk_user_id;
    }
  }
  try {
    const fresh = await zendeskUpdate(viewer.id, c.external_id, { status, assigneeZendeskId: zendeskAssignee });
    await ingest("zendesk", [fresh]);
  } catch (e) {
    if (e instanceof ZendeskError) throw new Error(e.message);
    throw e;
  }
  await serverRpc("ldo_support_log", {
    p_actor: viewer.id, p_conversation: id, p_action: status !== undefined ? "status" : "assign",
    p_details: { ...(status !== undefined ? { from: c.status, to: status } : {}), ...(assignee !== undefined ? { to: assignee } : {}), platform: "zendesk" },
  });
}

type ServerMessage = { message: { id: string; delivery: string | null; created_at: string }; conversation: { id: string; source_id: string; external_id: string } };

// Envio com resultado incerto: volta a ler a conversa na plataforma. Se a mensagem lá estiver,
// a sincronização reconhece-a (mesmo texto, até 15 min) e passa a "Aceite". Nunca reenvia.
export async function verifyMessage(viewer: Viewer, conversationId: string, messageId: string) {
  await sessionRpc(viewer.session, "ldo_support_conversation", { p_id: conversationId });
  const m = await serverRpc<ServerMessage | null>("ldo_support_server_message", { p_message: messageId });
  if (!m || m.conversation.id !== conversationId) throw new Error("Mensagem não encontrada.");
  let note: string | null = null;
  if (m.conversation.source_id === "zendesk") await ingest("zendesk", [await readTicket(viewer.id, m.conversation.external_id)]);
  else {
    const [r] = await runSync({ force: true, only: [m.conversation.source_id] });
    if (!r.ran) note = `A verificação não correu agora (${REFUSAL[r.reason || ""] || "indisponível"}); tente dentro de momentos.`;
    else if (r.ok === false) note = `A verificação falhou: ${r.detail}`;
  }
  const after = await serverRpc<ServerMessage | null>("ldo_support_server_message", { p_message: messageId });
  const delivery = after?.message.delivery ?? null;
  if (!note && (delivery === "uncertain" || delivery === "sending"))
    note = "Ainda não encontrada na plataforma. Confirme lá antes de a marcar como não enviada.";
  return { delivery, note };
}

// A pessoa confirma que uma mensagem incerta não chegou: fica "Falhou" e o texto pode voltar a ser enviado.
export async function markNotSent(viewer: Viewer, conversationId: string, messageId: string) {
  await sessionRpc(viewer.session, "ldo_support_conversation", { p_id: conversationId });
  const m = await serverRpc<ServerMessage | null>("ldo_support_server_message", { p_message: messageId });
  if (!m || m.conversation.id !== conversationId || !["uncertain", "sending"].includes(m.message.delivery || "")) throw new Error("Só um envio incerto pode ser marcado como não enviado.");
  if (Date.now() - Date.parse(m.message.created_at) < 60_000) throw new Error("Aguarde um minuto e use primeiro “Verificar”.");
  await serverRpc("ldo_support_finish_send", { p_message: messageId, p_delivery: "failed", p_detail: `Marcado como não enviado por ${viewer.fullName || viewer.username} depois de verificar.`, p_external_id: null });
}
