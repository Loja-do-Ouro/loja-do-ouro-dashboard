import { withinHours, type SupportHours } from "./gmail-rules";

// Respostas automáticas no Facebook e no Instagram (mensagens privadas pela Metricool), em vez da "mensagem de
// ausência" do Meta, que responde a tudo: também às reações às stories e às mensagens só com emoji.
// - Pedido de apoio (texto, pergunta ou foto): a mensagem automática (fora do horário e, se houver texto para
//   isso, também dentro), no máximo uma vez por conversa em 24 horas.
// - Reação (story, gosto, só emoji ou um elogio curto): um agradecimento curto, só quando a reação vem sozinha
//   (sem conversa nas últimas 24 horas) e no máximo uma vez por pessoa em 7 dias.
// Sem dependências do servidor (testado em tests/social-rules.cjs). Os limites por conversa e por pessoa são
// confirmados na base de dados (ldo_support_social_autoreply_claim).

export type SocialMessage = {
  external_id: string;
  kind: "inbound" | "outbound" | "note";
  body: string;
  attachments?: unknown[] | null;
  created_at: string;
  deleted?: boolean;
};
export type SocialSettings = { enabled: boolean; text: string; offhours_text: string; thanks_text: string; hours: SupportHours };
export type SocialDecision = { kind: "support" | "thanks"; text: string; anchor: string };

// Só se responde a mensagens com menos de 30 minutos (nunca a mensagens antigas, por exemplo ao ligar a função).
export const MAX_AGE_MS = 30 * 60 * 1000;
// Uma reação só é agradecida 1 minuto depois, para não agradecer a quem ainda está a escrever o pedido.
export const SETTLE_MS = 60 * 1000;
// Reação "sozinha": sem mensagens nossas nem pedidos do cliente nas últimas 24 horas.
export const QUIET_MS = 24 * 3600 * 1000;

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palavras de um elogio ou agradecimento curto (sem acentos). Mais de 5 palavras, ou qualquer outra palavra,
// já é tratado como pedido de apoio.
const PRAISE = new Set([
  "obrigado", "obrigada", "obrigados", "obrigadas", "obg", "obgd", "brigado", "brigada", "lindo", "linda", "lindos", "lindas",
  "lindissimo", "lindissima", "maravilha", "maravilhoso", "maravilhosa", "maravilhosos", "maravilhosas", "top", "adoro", "adorei",
  "amei", "amo", "bonito", "bonita", "bonitos", "bonitas", "perfeito", "perfeita", "perfeitos", "perfeitas", "parabens", "fantastico",
  "fantastica", "espetacular", "espectacular", "uau", "wow", "love", "lovely", "beautiful", "nice", "ok", "okay", "boa", "bom",
  "bravo", "show", "incrivel", "giro", "gira", "giros", "giras", "muito", "mt", "mto", "tao", "que", "e", "sim", "lindeza", "divinal",
  "divino", "divina", "spectacular", "brutal", "fixe", "demais", "otimo", "otima", "excelente", "bjs", "beijos", "beijinhos",
]);

// "support" quando é preciso responder (texto, pergunta ou foto); "reaction" quando é só uma reação.
// Uma mensagem vazia sem anexos é o que a Metricool entrega para reações e menções nas stories, gostos e
// partilhas: conta como reação.
export function classifySocial(m: Pick<SocialMessage, "body" | "attachments">): "support" | "reaction" {
  const text = String(m.body ?? "").trim();
  const files = Array.isArray(m.attachments) ? m.attachments.length : 0;
  if (!text) return files ? "support" : "reaction";
  if (text.includes("?")) return "support";
  if (!/[\p{L}\p{N}]/u.test(text)) return "reaction";
  const words = strip(text).match(/[\p{L}\p{N}]+/gu) || [];
  return words.length <= 5 && words.every((w) => PRAISE.has(w)) ? "reaction" : "support";
}

// "{nome}" passa ao primeiro nome do contacto (no Instagram, o nome de utilizador); sem nome, sai.
export function personaliseSocial(text: string, name: string | null | undefined): string {
  const first = String(name ?? "").trim().replace(/^@+/, "").split(/\s+/)[0] || "";
  const out = first ? text.replace(/\{nome\}/gi, first) : text.replace(/[ \t]*\{nome\}/gi, "");
  return out.replace(/[ \t]+([,.!?])/g, "$1").trim();
}

const at = (m: SocialMessage) => Date.parse(m.created_at) || 0;
const ordered = (messages: SocialMessage[]) => messages.filter((m) => m.kind !== "note" && !m.deleted && at(m)).sort((a, b) => at(a) - at(b));

// Mensagens do cliente depois da nossa última, das últimas 30 minutos.
function freshBurst(msgs: SocialMessage[], t: number) {
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].kind === "inbound") i--;
  return msgs.slice(i + 1).filter((m) => t - at(m) <= MAX_AGE_MS);
}

// Reação sozinha (só reações nas mensagens novas, sem mensagens nossas nem pedidos nas últimas 24 horas): a conversa
// não precisa da equipa e sai da lista principal (separador "Automáticas") até o cliente voltar a escrever.
// Devolve a hora da última mensagem do cliente (até onde a conversa fica tratada) ou null.
export function isolatedReaction(messages: SocialMessage[], now: Date): string | null {
  const msgs = ordered(messages);
  const last = msgs[msgs.length - 1];
  if (!last || last.kind !== "inbound") return null;
  const t = now.getTime();
  const fresh = freshBurst(msgs, t);
  if (!fresh.length || fresh.some((m) => classifySocial(m) === "support")) return null;
  const recent = msgs.filter((m) => t - at(m) <= QUIET_MS);
  if (recent.some((m) => m.kind === "outbound" || classifySocial(m) === "support")) return null;
  return new Date(at(last)).toISOString();
}

// O que enviar nesta conversa agora (ou null). "anchor" é a última mensagem do cliente: a base de dados nunca
// responde duas vezes à mesma.
export function socialAutoReply(messages: SocialMessage[], settings: SocialSettings, now: Date, contactName: string | null): SocialDecision | null {
  if (!settings.enabled) return null;
  const msgs = ordered(messages);
  const last = msgs[msgs.length - 1];
  if (!last || last.kind !== "inbound") return null;
  const t = now.getTime();
  const fresh = freshBurst(msgs, t);
  if (!fresh.length) return null;

  if (fresh.some((m) => classifySocial(m) === "support")) {
    const text = withinHours(settings.hours, now) ? settings.text : settings.offhours_text;
    return text.trim() ? { kind: "support", text: personaliseSocial(text, contactName), anchor: last.external_id } : null;
  }

  if (!settings.thanks_text.trim() || t - at(last) < SETTLE_MS || !isolatedReaction(msgs, now)) return null;
  return { kind: "thanks", text: personaliseSocial(settings.thanks_text, contactName), anchor: last.external_id };
}
