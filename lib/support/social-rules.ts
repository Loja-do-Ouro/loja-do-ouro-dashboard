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
  // Campo "properties" da Metricool (não documentado): pode dizer se a mensagem é uma reação ou menção numa story.
  properties?: unknown;
};
export type SocialSettings = {
  enabled: boolean; text: string; offhours_text: string; thanks_text: string; hours: SupportHours;
  // Hora a que foram ligadas: mensagens anteriores nunca recebem resposta automática.
  enabled_at?: string | null;
};
// "since": a primeira mensagem nova do cliente (a base de dados recusa se a equipa respondeu depois dela).
export type SocialDecision = { kind: "support" | "thanks"; text: string; anchor: string; since: string };

// Só se responde a mensagens com menos de 3 horas (uma sincronização atrasada, por exemplo depois de erros da
// Metricool, ainda responde) e nunca a mensagens anteriores à ligação da função.
export const MAX_AGE_MS = 3 * 3600 * 1000;
// Uma reação só é agradecida 4 minutos depois, para não agradecer a quem ainda está a escrever o pedido
// (com a verificação de 5 em 5 minutos, a pergunta que se segue à reação chega antes do agradecimento).
export const SETTLE_MS = 4 * 60 * 1000;
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
// Uma mensagem vazia que a Metricool indique como reação ou menção numa story é reação mesmo com anexo (o anexo
// é a própria story).
export function classifySocial(m: Pick<SocialMessage, "body" | "attachments"> & { properties?: unknown }): "support" | "reaction" {
  const text = String(m.body ?? "").trim();
  const files = Array.isArray(m.attachments) ? m.attachments.length : 0;
  if (!text) return files && !reactionHint(m.properties) ? "support" : "reaction";
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

// Mensagens do cliente depois da nossa última, das últimas 3 horas e posteriores à ligação.
function freshBurst(msgs: SocialMessage[], t: number, since: number) {
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].kind === "inbound") i--;
  return msgs.slice(i + 1).filter((m) => t - at(m) <= MAX_AGE_MS && at(m) >= since);
}
const enabledSince = (s?: Pick<SocialSettings, "enabled_at"> | null) => (s?.enabled_at ? Date.parse(s.enabled_at) || 0 : 0);

// Dentro do horário? Nas redes sociais, sem nenhum dia preenchido está sempre fechado (o painel diz "vazio =
// fechado"): a mensagem de fora do horário sai sempre.
function socialOpen(hours: SupportHours | null | undefined, now: Date) {
  const any = [hours?.weekdays, hours?.saturday, hours?.sunday].some((v) => typeof v === "string" && v.trim());
  return any && withinHours(hours, now);
}

// Reação sozinha para o agradecimento: só reações nas mensagens novas e nada nosso nem pedidos nas últimas 24 horas.
// Só se agradece uma reação clara (a mesma regra de esconder): uma mensagem vazia sem indicação da Metricool pode
// ser uma nota de voz ou uma partilha e fica para a equipa, sem resposta automática.
function quietReaction(msgs: SocialMessage[], t: number, since: number) {
  const fresh = freshBurst(msgs, t, since);
  if (!fresh.length || !fresh.every(hideableReaction)) return false;
  const recent = msgs.filter((m) => t - at(m) <= QUIET_MS);
  return !recent.some((m) => m.kind === "outbound" || classifySocial(m) === "support");
}

// Indício, no campo "properties" da Metricool, de que uma mensagem vazia é uma reação ou menção numa story (ou um
// gosto): só um valor exato, de uma lista fechada, num campo de tipo (type, subtype, kind, event). Nunca palavras
// soltas noutros campos (URLs, contadores, campos vazios ou falsos). Sem este indício, uma mensagem vazia pode ser
// uma partilha de uma publicação ou um áudio, e fica na lista principal.
const HINT_KEYS = /^(type|subtype|kind|event|message_type|messagetype)$/i;
const HINT_VALUES = /^(story[_ -]?(mention|reaction|reply[_ -]?reaction)|reaction|like|like[_ -]?heart|mention)$/i;
export function reactionHint(properties: unknown): boolean {
  const walk = (v: unknown, key: string, depth: number): boolean => {
    if (typeof v === "string") return HINT_KEYS.test(key) && HINT_VALUES.test(v.trim());
    if (!v || typeof v !== "object" || Array.isArray(v) || depth > 3) return false;
    return Object.entries(v as Record<string, unknown>).slice(0, 30).some(([k, x]) => walk(x, k, depth + 1));
  };
  return walk(properties, "", 0);
}

// Palavras que, sozinhas, podem ser respostas a uma pergunta nossa ("Sim", "Ok", "Boa"): nunca escondem a conversa.
const NOT_HIDING = new Set(["sim", "ok", "okay", "boa", "bom", "e", "que", "muito", "mt", "mto", "tao", "demais", "show"]);

// Reação que se pode esconder com segurança: só emoji, ou um elogio curto com pelo menos uma palavra de elogio e
// nenhuma resposta do tipo "sim"/"ok"; ou uma mensagem vazia que a Metricool indique como reação ou menção numa story.
export function hideableReaction(m: Pick<SocialMessage, "body" | "attachments" | "properties">): boolean {
  if (classifySocial(m) !== "reaction") return false;
  const text = String(m.body ?? "").trim();
  if (!text) return reactionHint(m.properties);
  const words = strip(text).match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return true;
  return !words.some((w) => ["sim", "ok", "okay", "boa", "bom"].includes(w)) && words.some((w) => !NOT_HIDING.has(w));
}

// Conversa que não precisa da equipa: há reações novas, TODAS as mensagens que o cliente alguma vez enviou (as que
// a Metricool mostra) são reações que se podem esconder, e a loja nunca lhe escreveu nada além do agradecimento
// automático (uma conversa iniciada ou continuada pela loja fica sempre na lista principal). Sai da lista principal
// (separador "Automáticas") até o cliente voltar a escrever ou alguém da equipa lhe mexer. Devolve as horas da
// primeira e da última mensagem do cliente (a base de dados confirma que não há outras fora deste intervalo) ou null.
export function hiddenReaction(messages: SocialMessage[], now: Date, settings: Pick<SocialSettings, "enabled_at" | "thanks_text"> | null | undefined, contactName: string | null): { from: string; through: string } | null {
  const msgs = ordered(messages);
  const last = msgs[msgs.length - 1];
  if (!last || last.kind !== "inbound") return null;
  if (!freshBurst(msgs, now.getTime(), enabledSince(settings)).length) return null;
  const inbound = msgs.filter((m) => m.kind === "inbound");
  if (!inbound.every(hideableReaction)) return null;
  const thanks = settings?.thanks_text?.trim() ? personaliseSocial(settings.thanks_text, contactName) : null;
  if (msgs.some((m) => m.kind === "outbound" && (!thanks || String(m.body ?? "").trim() !== thanks))) return null;
  return { from: new Date(at(inbound[0])).toISOString(), through: new Date(at(last)).toISOString() };
}

// O que enviar nesta conversa agora (ou null). "anchor" é a última mensagem do cliente: a base de dados nunca
// responde duas vezes à mesma.
export function socialAutoReply(messages: SocialMessage[], settings: SocialSettings, now: Date, contactName: string | null): SocialDecision | null {
  if (!settings.enabled) return null;
  const msgs = ordered(messages);
  const last = msgs[msgs.length - 1];
  if (!last || last.kind !== "inbound") return null;
  const t = now.getTime();
  const fresh = freshBurst(msgs, t, enabledSince(settings));
  if (!fresh.length) return null;

  if (fresh.some((m) => classifySocial(m) === "support")) {
    const text = socialOpen(settings.hours, now) ? settings.text : settings.offhours_text;
    return text.trim() ? { kind: "support", text: personaliseSocial(text, contactName), anchor: last.external_id, since: fresh[0].created_at } : null;
  }

  if (!settings.thanks_text.trim() || t - at(last) < SETTLE_MS || !quietReaction(msgs, t, enabledSince(settings))) return null;
  return { kind: "thanks", text: personaliseSocial(settings.thanks_text, contactName), anchor: last.external_id, since: fresh[0].created_at };
}
