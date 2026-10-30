import "server-only";
import { serverRpc } from "./db";
import { emailSettings, gmailMailbox, gmailSendReply } from "./gmail";
import { contactAddress, recipientAllowed } from "./gmail-rules";
import { metricoolSend } from "./metricool";
import { gmailFailure, PROVIDER, type Result } from "./service";
import { surveyText, thanksText } from "./survey-rules";

// Pedidos de avaliação e agradecimentos no Messenger, no Instagram e no email, na passagem de 5 em 5 minutos (rota
// /api/support/webhooks/tick, depois de ler as mensagens novas). O chat do site não passa por aqui: o pedido aparece no
// widget quando o visitante tem o chat aberto. Cada pedido é entregue pela BD uma única vez (fica "a enviar"): a mensagem
// é gravada antes de sair (origin 'survey', com uma chave fixa), segue pelo canal e o resultado fica na mensagem e no
// pedido. Um envio sem resposta da plataforma (ou interrompido) fica incerto e nunca se repete. Sem IA.

type Due = {
  id: string; conversation_id: string; channel: "facebook" | "instagram" | "email"; source_id: string; external_id: string;
  contact_external_id: string | null; contact_name: string | null; agent_first: string | null;
};
type ThanksDue = Omit<Due, "channel" | "agent_first"> & { channel: "facebook" | "instagram"; score: number; client_key: string };

// No máximo 3 de cada por passagem, um de cada vez e só com tempo para o enviar e registar antes do fim da função: um
// pedido devolvido pela BD fica "a enviar" e nunca volta. Cada envio pela Metricool tem 10 s; pelo Gmail, a renovação do
// acesso e o envio podem chegar perto de 35 s.
const PER_RUN = 3;
const SEND_TIMEOUT_MS = 10_000;
const SEND_RESERVE_MS = 40_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.").slice(0, 300);

async function deliver(channel: "facebook" | "instagram" | "email", s: { source_id: string; external_id: string; contact_external_id: string | null },
  body: string, messageId: string, senderFirstName: string | null): Promise<Result> {
  if (channel === "email") {
    try {
      const settings = await emailSettings();
      // Marcada como automática (Auto-Submitted): a sincronização não a volta a trazer; o assunto é o da conversa.
      const sent = await gmailSendReply({
        threadId: s.external_id, to: contactAddress(s.contact_external_id) || "", body, signature: settings.signature, senderFirstName,
        autoSubmitted: true, dashboardId: messageId,
      });
      return { outcome: "accepted", externalId: sent.id, detail: null };
    } catch (e) {
      return gmailFailure(e);
    }
  }
  const provider = PROVIDER[s.source_id];
  if (!provider) return { outcome: "failed", externalId: null, detail: "Fonte desconhecida: nada foi enviado." };
  try {
    const r = await metricoolSend(provider, s.external_id, s.contact_external_id, body, null, SEND_TIMEOUT_MS);
    return { outcome: r.outcome, externalId: null, detail: r.detail };
  } catch (e) {
    return { outcome: "uncertain", externalId: null, detail: errorText(e) };
  }
}

const acceptedDetail = (channel: string) =>
  channel === "email"
    ? `Mensagem automática (pedido de avaliação), enviada pelo Gmail (${gmailMailbox()}) na mesma conversa.`
    : "Mensagem automática (pedido de avaliação). Aceite pela Metricool; entrega no Messenger/Instagram sem confirmação pela API.";

// Grava, envia e regista. kind: o pedido (chave = id do pedido) ou o agradecimento (chave fixa dada pela BD).
async function sendOne(kind: "survey" | "thanks", s: Due | ThanksDue, key: string, body: string, senderFirstName: string | null) {
  const done = (outcome: Result["outcome"], messageId: string | null, detail: string | null) =>
    kind === "survey"
      ? serverRpc("ldo_support_survey_sent", { p_id: s.id, p_outcome: outcome, p_message_id: messageId, p_detail: detail })
      : serverRpc("ldo_support_survey_thanks_sent", { p_id: s.id, p_outcome: outcome, p_message_id: messageId });
  let messageId: string;
  try {
    messageId = await serverRpc<string>("ldo_support_system_send_begin", {
      p_conversation_id: s.conversation_id, p_body: body, p_origin: "survey", p_client_key: key,
    });
  } catch (e) {
    // Nada saiu.
    await done("failed", null, errorText(e)).catch(() => undefined);
    return;
  }
  const r = await deliver(s.channel, s, body, messageId, senderFirstName);
  const detail = r.outcome === "accepted" ? acceptedDetail(s.channel) : r.detail;
  const finish = { p_message: messageId, p_delivery: r.outcome, p_detail: detail, p_external_id: r.externalId };
  // Uma segunda tentativa de registo (o envio nunca se repete).
  await serverRpc("ldo_support_finish_send", finish).catch(() => serverRpc("ldo_support_finish_send", finish)).catch(() => undefined);
  await done(r.outcome, messageId, r.detail).catch(() => done(r.outcome, messageId, r.detail)).catch(() => undefined);
}

// Email: nunca para a própria caixa ou o próprio domínio, para endereços de sistemas (noreply, mailer-daemon...) ou inválidos;
// fica "não enviado" com o motivo, sem gravar nenhuma mensagem.
function internalAddress(s: Due) {
  return s.channel === "email" && !recipientAllowed(contactAddress(s.contact_external_id) || "", [gmailMailbox().split("@")[1] || ""]);
}

// deadline: hora (ms) até à qual o envio e o registo têm de terminar (antes do limite da função).
export async function sendDueSurveys({ deadline }: { deadline: number }) {
  let surveys = 0;
  let thanks = 0;
  const time = () => Date.now() + SEND_RESERVE_MS < deadline;
  while (surveys < PER_RUN && time()) {
    const [s] = (await serverRpc<Due[]>("ldo_support_survey_due", { p_limit: 1 }).catch(() => [] as Due[])) || [];
    if (!s) break;
    surveys++;
    if (internalAddress(s)) {
      await serverRpc("ldo_support_survey_sent", { p_id: s.id, p_outcome: "skipped", p_message_id: null, p_detail: null }).catch(() => undefined);
      continue;
    }
    const body = surveyText(s.channel, { name: s.contact_name, agent: s.agent_first });
    await sendOne("survey", s, s.id, body, s.agent_first).catch(() => undefined);
  }
  while (thanks < PER_RUN && time()) {
    const [t] = (await serverRpc<ThanksDue[]>("ldo_support_survey_thanks_due", { p_limit: 1 }).catch(() => [] as ThanksDue[])) || [];
    if (!t) break;
    thanks++;
    await sendOne("thanks", t, t.client_key, thanksText(t.score, t.contact_name), null).catch(() => undefined);
  }
  return { surveys, thanks };
}
