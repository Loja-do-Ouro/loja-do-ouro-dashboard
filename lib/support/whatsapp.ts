import "server-only";

// WhatsApp Cloud API (Meta) — fase seguinte, independente do Zendesk. Nada aqui contacta a Meta:
// enquanto não houver número e conta empresarial configurados, o canal aparece "Por configurar".
//
// Preparado para:
// - Configuração reservada na fonte "whatsapp" (ldo_support_sources.config):
//   phone_number_id e business_account_id; o token e o segredo da app ficarão em variáveis
//   de ambiente do servidor (WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN).
// - Receção por webhook em /api/support/webhooks/whatsapp: verificação inicial (hub.challenge com o
//   verify token) e assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo com o segredo da app).
// - Estados de envio vindos do webhook (sent → accepted, delivered → delivered, read → read, failed).
// - Janela de atendimento de 24 horas desde a última mensagem do cliente: fora dela só podem
//   seguir mensagens modelo (templates) aprovadas pela Meta.
// Não se pede nem migra o número, nem se altera o WhatsApp atual nos telemóveis.

export const WHATSAPP_STATUS = "Por configurar";
export const SERVICE_WINDOW_HOURS = 24;

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
}

// Dentro da janela de 24 h pode responder-se com texto livre; fora dela, só com um modelo aprovado.
export function withinServiceWindow(lastInboundAt: string | null, now = Date.now()) {
  return Boolean(lastInboundAt) && now - Date.parse(lastInboundAt!) < SERVICE_WINDOW_HOURS * 3600 * 1000;
}

// Mapeamento previsto dos estados da Cloud API para o modelo comum.
export const WHATSAPP_DELIVERY: Record<string, "accepted" | "delivered" | "read" | "failed"> = {
  sent: "accepted",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

export async function whatsappSend(): Promise<{ outcome: "failed"; externalId: null; detail: string }> {
  return { outcome: "failed", externalId: null, detail: "WhatsApp por configurar: nenhuma mensagem foi enviada." };
}
