// Pedido de avaliação depois de "Resolvido" e satisfação por colaborador: regras sem servidor nem I/O, partilhadas entre
// o servidor e o browser (testadas em tests/support-survey.cjs). Espelham a BD
// (supabase/migrations/20261030120000_ldo_support_survey.sql): o que conta como nota, quando se pode pedir e a quem conta.
// Sem IA (custo zero).

import { safeFirstName, type Channel, type SiteLocale } from "./rules";

// ---------------------------------------------------------------- definições

export const SURVEY_MODES = ["desligado", "perguntar", "automatico"] as const;
export type SurveyMode = (typeof SURVEY_MODES)[number];
export const SURVEY_MODE_LABEL: Record<SurveyMode, string> = {
  desligado: "Desligado",
  perguntar: "Perguntar ao resolver (quem resolve decide em cada conversa)",
  automatico: "Automático (recomendado): pedido sempre que a conversa cumpre as regras",
};
export const isSurveyMode = (v: unknown): v is SurveyMode => SURVEY_MODES.includes(v as SurveyMode);

export const SURVEY_CHANNELS = ["facebook", "instagram", "email", "site"] as const;
export type SurveyChannel = (typeof SURVEY_CHANNELS)[number];
export const SURVEY_CHANNEL_LABEL: Record<SurveyChannel, string> = {
  facebook: "Messenger (Facebook)",
  instagram: "Instagram Direct",
  email: "Email",
  site: "Chat do site",
};
export const isSurveyChannel = (v: unknown): v is SurveyChannel => SURVEY_CHANNELS.includes(v as SurveyChannel);

// Espera antes do pedido (minutos; o chat do site é sempre imediato). Uma conversa reaberta antes disso fica sem pedido.
export const SURVEY_DEFAULT_DELAY = 10;
export const SURVEY_MAX_DELAY = 120;
// Messenger/Instagram: a Meta só aceita mensagens que não sejam da equipa até 24 h depois da última do cliente (23 h com folga).
export const SURVEY_WINDOW_HOURS = 23;
// Um pedido enviado aceita a nota durante 72 h.
export const SURVEY_EXPIRES_HOURS = 72;
export const SURVEY_CONVERSATION_DAYS = 7;
export const SURVEY_CONTACT_DAYS = 30;
// Conversa antiga arrumada agora: a última resposta pelo dashboard tem mais de 7 dias.
export const SURVEY_STALE_DAYS = 7;
// Resultados por pessoa só com 10 avaliações ou mais.
export const SURVEY_RELIABLE = 10;

// ---------------------------------------------------------------- resposta do cliente

// Texto da resposta sem o seletor de emoji, a assinatura do email ("-- ") nem "Enviado do meu iPhone" (espelha
// ldo_private.support_rating_text).
const SIGNATURE_LINE = /\n[ \t]*(?:enviado do meu|enviado desde mi|sent from my|get outlook for|obter o outlook)[^\n]*/gi;
export function ratingText(body: string | null | undefined) {
  return (body || "").replace(/\r/g, "").replace(/️/g, "").replace(/\n--[ \t]*\n[\s\S]*$/, "").replace(SIGNATURE_LINE, "").trim();
}

const UNIT = String.raw`(?:\/\s*5|de\s*5|estrelas?|⭐+)`;
// Só a nota: "5", "5/5", "4 de 5", "5 estrelas", "5⭐", "3!", e também com emoji ou pontuação a seguir ("5 😊", "4 :)"),
// sem letras nem outros números (espelha ldo_private.support_rating_score).
const SCORE = new RegExp(String.raw`^([1-5])\s*${UNIT}?[^\p{L}\p{N}]*$`, "iu");
// Só estrelas (1 a 5): "⭐⭐⭐⭐".
const STARS = /^(?:[⭐🌟★]\s*){1,5}$/u;
// Nota seguida de texto: "5 obrigado", "2. A encomenda chegou partida" (espelha ldo_private.support_rating_lead).
const LEAD = new RegExp(String.raw`^[1-5](?:\s*${UNIT})?(?:\s*[.!,;:)–-]+\s*|\s+)(?=\S)`, "iu");
// "4,5" ou "3.5" não é uma nota de 1 a 5.
const DECIMAL = /^[1-5]\s*[.,]\s*[0-9]/;
// Não quer mais pedidos: «não», «nao», «parar» ou «stop», sozinhos.
const OPTOUT = /^(?:não|nao|parar|stop)[.!]*$/iu;

export type Rating =
  | { kind: "score"; score: number }
  | { kind: "score_text"; score: number; comment: string }
  | { kind: "optout" }
  | { kind: "none" };

export function parseRating(body: string | null | undefined): Rating {
  const s = ratingText(body);
  const m = SCORE.exec(s);
  if (m) return { kind: "score", score: Number(m[1]) };
  if (STARS.test(s)) return { kind: "score", score: Array.from(s.replace(/[^⭐🌟★]/gu, "")).length };
  if (OPTOUT.test(s)) return { kind: "optout" };
  const lead = DECIMAL.test(s) ? null : LEAD.exec(s);
  if (lead) return { kind: "score_text", score: Number(s[0]), comment: s.slice(lead[0].length).slice(0, 500) };
  return { kind: "none" };
}

// O que a BD faz com uma mensagem do cliente numa conversa com um pedido de avaliação (espelha
// ldo_private.support_take_rating). Só "rated" e "optout" ficam tratadas ali (a conversa não reabre); "rated_with_text"
// guarda a nota e reabre como qualquer mensagem; "expire" fecha o pedido e reabre; "ignore" não mexe no pedido.
export type RatingDecision = "rated" | "rated_with_text" | "optout" | "expire" | "ignore";
export function ratingDecision(o: {
  // Pedido enviado e por responder nesta conversa.
  surveySent: boolean;
  // Passaram as 72 h.
  expired: boolean;
  // Mensagem escrita antes do pedido (sincronização atrasada).
  beforeSurvey: boolean;
  // O pedido continua a ser a última mensagem para o cliente (a equipa não escreveu depois).
  surveyIsLastOutbound: boolean;
  // Primeira mensagem do cliente depois do pedido.
  firstInboundAfter: boolean;
  body: string;
}): RatingDecision {
  if (!o.surveySent) return "ignore";
  if (o.expired) return "expire";
  if (o.beforeSurvey) return "ignore";
  if (!o.surveyIsLastOutbound || !o.firstInboundAfter) return "expire";
  const r = parseRating(o.body);
  return r.kind === "score" ? "rated" : r.kind === "optout" ? "optout" : r.kind === "score_text" ? "rated_with_text" : "expire";
}
export const ratingTaken = (d: RatingDecision) => d === "rated" || d === "optout";

// Mensagem que é só uma nota (ou «não»): as respostas automáticas das redes sociais nunca lhe respondem (a BD confirma em
// ldo_support_social_autoreply_claim, pelo pedido de avaliação).
export function isRatingReply(body: string | null | undefined) {
  const r = parseRating(body);
  return r.kind === "score" || r.kind === "optout";
}

// ---------------------------------------------------------------- quando pedir

export type SkipReason =
  | "desligado" | "comentario" | "canal" | "canal_desligado" | "sem_resposta" | "ultima_cliente" | "janela_24h" | "chat_terminado"
  | "antiga" | "sem_pedidos" | "conversa_recente" | "contacto_recente" | "nao_resolvida" | "reaberta" | "cancelado" | "falhou"
  | "nao_pedido" | "nao_visto" | "interno";
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  desligado: "os pedidos de avaliação estão desligados",
  comentario: "comentário público",
  canal: "este canal não tem pedidos de avaliação",
  canal_desligado: "pedidos de avaliação desligados neste canal",
  sem_resposta: "sem resposta enviada pelo dashboard",
  ultima_cliente: "a última mensagem é do cliente",
  janela_24h: "fora da janela de 24 h do Messenger/Instagram",
  chat_terminado: "o cliente terminou a conversa no chat do site",
  antiga: "a última resposta pelo dashboard tem mais de 7 dias",
  sem_pedidos: "o cliente pediu para não receber pedidos de avaliação",
  conversa_recente: "já foi pedida uma avaliação nesta conversa nos últimos 7 dias",
  contacto_recente: "já foi pedida uma avaliação a este cliente nos últimos 30 dias",
  nao_resolvida: "a conversa não acabou de ser resolvida por si",
  reaberta: "a conversa foi reaberta antes do envio",
  cancelado: "cancelado pelo Super Admin",
  falhou: "o envio falhou",
  nao_pedido: "quem resolveu optou por não pedir",
  nao_visto: "o cliente não voltou a abrir o chat do site em 72 h",
  interno: "o endereço de email é da própria loja, de um sistema automático ou inválido",
};
export const skipText = (reason: string | null | undefined) =>
  `Sem pedido de avaliação: ${SKIP_REASON_TEXT[reason as SkipReason] ?? reason ?? "motivo desconhecido"}`;

export type SurveyContext = {
  mode: string;
  channels: readonly string[];
  channel: Channel;
  noSurveys: boolean;
  // Respostas enviadas pelo dashboard (author_user_id e sem origin) desde o início do ciclo.
  dashboardReplies: number;
  // A última mensagem que não é nota (as falhadas e apagadas não contam).
  lastKind: "inbound" | "outbound" | null;
  lastInboundAt: string | null;
  // Chat do site: o visitante ainda não terminou a conversa.
  siteChatOpen: boolean;
  // Última resposta pelo dashboard no ciclo (com mais de 7 dias: conversa antiga).
  lastDashboardReplyAt?: string | null;
  // Último pedido (enviado ou por enviar) nesta conversa e a este contacto.
  lastConversationSurveyAt: string | null;
  lastContactSurveyAt: string | null;
  now?: number;
};

// Motivo para não pedir (null = pode pedir), pela mesma ordem que ldo_private.support_survey_block.
export function surveyEligibility(c: SurveyContext): SkipReason | null {
  const now = c.now ?? Date.now();
  const within = (iso: string | null, ms: number) => Boolean(iso) && now - Date.parse(iso!) < ms;
  if (c.mode !== "perguntar" && c.mode !== "automatico") return "desligado";
  if (c.channel === "facebook_comments" || c.channel === "instagram_comments") return "comentario";
  if (!isSurveyChannel(c.channel)) return "canal";
  if (!c.channels.includes(c.channel)) return "canal_desligado";
  if (c.dashboardReplies < 1) return "sem_resposta";
  if (c.lastKind === "inbound") return "ultima_cliente";
  if ((c.channel === "facebook" || c.channel === "instagram") && !within(c.lastInboundAt, SURVEY_WINDOW_HOURS * 3_600_000)) return "janela_24h";
  if (c.channel === "site" && !c.siteChatOpen) return "chat_terminado";
  if (c.lastDashboardReplyAt && now - Date.parse(c.lastDashboardReplyAt) > SURVEY_STALE_DAYS * 86_400_000) return "antiga";
  if (c.noSurveys) return "sem_pedidos";
  if (within(c.lastConversationSurveyAt, SURVEY_CONVERSATION_DAYS * 86_400_000)) return "conversa_recente";
  if (within(c.lastContactSurveyAt, SURVEY_CONTACT_DAYS * 86_400_000)) return "contacto_recente";
  return null;
}

// Quem é avaliado: a pessoa com mais respostas enviadas pelo dashboard no ciclo (desde a última reabertura ou o último
// pedido); empate, a que respondeu por último. Nunca quem só resolveu nem o responsável sem respostas (espelha
// ldo_private.support_survey_agent).
export function attributeAgent(
  replies: { author: string | null; at: string; origin?: string | null; failed?: boolean }[],
  since: string | null = null,
): string | null {
  const from = since ? Date.parse(since) : -Infinity;
  const tally = new Map<string, { n: number; last: number }>();
  for (const r of replies) {
    const t = Date.parse(r.at);
    if (!r.author || r.origin || r.failed || !(t > from)) continue;
    const x = tally.get(r.author) || { n: 0, last: -Infinity };
    tally.set(r.author, { n: x.n + 1, last: Math.max(x.last, t) });
  }
  let best: string | null = null;
  let top = { n: 0, last: -Infinity };
  for (const [author, x] of tally) if (x.n > top.n || (x.n === top.n && x.last > top.last)) [best, top] = [author, x];
  return best;
}

// ---------------------------------------------------------------- textos para o cliente

const hello = (name: string | null | undefined, sep: "!" | ",") => {
  const n = safeFirstName(name);
  return n ? `Olá ${n}${sep}` : `Olá${sep}`;
};

// Pedido no Messenger/Instagram (sai em nome da página: sem o nome de quem atendeu) e no email (com o primeiro nome de
// quem atendeu; a assinatura é acrescentada no envio). O chat do site mostra o pedido no widget, nas 5 línguas.
export function surveyText(channel: "facebook" | "instagram" | "email", o: { name?: string | null; agent?: string | null }) {
  if (channel === "email") {
    const agent = (o.agent || "").trim();
    return `${hello(o.name, ",")}\n\nEsperamos ter ajudado. Tem um minuto para nos dizer como correu o atendimento${agent ? ` de ${agent}` : ""}?\n\n`
      + "Responda a este email apenas com um número de 1 (mau) a 5 (excelente).\n\nA sua opinião ajuda-nos a melhorar. Obrigado!\n\n"
      + "Se não quiser receber mais pedidos de avaliação, responda «NÃO».";
  }
  return `${hello(o.name, "!")} Foi um gosto ajudar 💛 Para continuarmos a melhorar, como avalia o nosso atendimento? `
    + "Responda apenas com um número de 1 (mau) a 5 (excelente). Obrigado!";
}

// Agradecimento no Messenger/Instagram depois de uma nota (só a nota; uma nota com texto segue para a equipa).
export function thanksText(score: number, name?: string | null) {
  const n = safeFirstName(name);
  return score >= 3
    ? `Obrigado pela sua avaliação${n ? `, ${n}` : ""}! Ajuda-nos a cuidar cada vez melhor de si. 💛`
    : `Obrigado por nos dizer${n ? `, ${n}` : ""}. Lamentamos que a experiência não tenha sido a melhor; um responsável da nossa equipa vai analisar o seu caso.`;
}

// Textos do pedido no widget do chat do site (iguais às chaves do bloco I18N de public/site-chat/ldo-chat.js; o teste
// compara). Francês com espaço inseparável antes de ! e ?.
export type SurveySiteTexts = {
  surveyRequest: string; surveyRequestNoName: string; surveyThanks: string; surveyStar: string; err_survey_closed: string; err_rating_invalid: string;
};
export const SURVEY_SITE_TEXTS: Record<SiteLocale, SurveySiteTexts> = {
  pt: {
    surveyRequest: "Obrigado por falar connosco! Como avalia o atendimento de {name}?",
    surveyRequestNoName: "Obrigado por falar connosco! Como avalia o nosso atendimento?",
    surveyThanks: "Obrigado pela sua avaliação!",
    surveyStar: "{n} de 5",
    err_survey_closed: "Esta avaliação já não está disponível.",
    err_rating_invalid: "Escolha de 1 a 5 estrelas.",
  },
  en: {
    surveyRequest: "Thank you for talking to us! How would you rate {name}’s help?",
    surveyRequestNoName: "Thank you for talking to us! How would you rate our help?",
    surveyThanks: "Thank you for your feedback!",
    surveyStar: "{n} of 5",
    err_survey_closed: "This rating is no longer available.",
    err_rating_invalid: "Please choose 1 to 5 stars.",
  },
  es: {
    surveyRequest: "¡Gracias por hablar con nosotros! ¿Cómo valora la atención de {name}?",
    surveyRequestNoName: "¡Gracias por hablar con nosotros! ¿Cómo valora nuestra atención?",
    surveyThanks: "¡Gracias por su valoración!",
    surveyStar: "{n} de 5",
    err_survey_closed: "Esta valoración ya no está disponible.",
    err_rating_invalid: "Elija de 1 a 5 estrellas.",
  },
  fr: {
    surveyRequest: "Merci d’avoir échangé avec nous ! Comment évaluez-vous l’aide de {name} ?",
    surveyRequestNoName: "Merci d’avoir échangé avec nous ! Comment évaluez-vous notre aide ?",
    surveyThanks: "Merci pour votre avis !",
    surveyStar: "{n} sur 5",
    err_survey_closed: "Cette évaluation n’est plus disponible.",
    err_rating_invalid: "Choisissez de 1 à 5 étoiles.",
  },
  de: {
    surveyRequest: "Danke, dass Sie uns geschrieben haben! Wie bewerten Sie die Beratung durch {name}?",
    surveyRequestNoName: "Danke, dass Sie uns geschrieben haben! Wie bewerten Sie unsere Beratung?",
    surveyThanks: "Vielen Dank für Ihre Bewertung!",
    surveyStar: "{n} von 5",
    err_survey_closed: "Diese Bewertung ist nicht mehr verfügbar.",
    err_rating_invalid: "Bitte wählen Sie 1 bis 5 Sterne.",
  },
};

// ---------------------------------------------------------------- na conversa (equipa)

// Resultado de ldo_support_survey_create (depois de "Resolvido").
export type SurveyCreate = { created: boolean; reason?: string | null; agent_name?: string | null; channel?: string | null };
// Chat do site: o pedido só aparece (e só conta como enviado) quando o cliente tem o chat aberto.
const SITE_PENDING = "Pedido de avaliação no chat do site: aparece quando o cliente abrir o chat";
// Aviso a quem resolveu. Sem pedido por decisão (modo desligado, caixa por marcar) não há aviso.
export function surveyCreateNote(r: SurveyCreate | null | undefined): string | null {
  if (!r) return null;
  const agent = (r.agent_name || "").trim() || "sem nome";
  if (r.created)
    return r.channel === "site"
      ? `${SITE_PENDING} (atendimento de ${agent}).`
      : `Pedido de avaliação agendado (atendimento de ${agent}).`;
  if (!r.reason || r.reason === "desligado" || r.reason === "nao_pedido" || r.reason === "nao_resolvida") return null;
  return `${skipText(r.reason)}.`;
}

export const SURVEY_EVENTS = new Set([
  "survey.created", "survey.sent", "survey.skipped", "survey.failed", "survey.cancelled", "survey.rated", "survey.followup", "survey.optout",
  "survey.thanks", "survey.declined", "survey.contact",
]);

type AuditLike = { action: string; details: Record<string, unknown>; actor: string };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const score = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

// Acontecimento do pedido de avaliação na conversa. A nota só vem da BD para o Super Admin e para quem foi avaliado;
// os outros veem "O cliente respondeu ao pedido de avaliação".
export function surveyEventText(a: AuditLike): string | null {
  const d = a.details || {};
  const agent = str(d.agent_name) || "sem nome";
  const n = score(d.score);
  switch (a.action) {
    case "survey.created":
      return d.channel === "site" ? `${SITE_PENDING} (atendimento de ${agent})` : `Pedido de avaliação agendado (atendimento de ${agent})`;
    case "survey.sent":
      if (d.channel === "site") return "Pedido de avaliação mostrado ao cliente no chat do site";
      return d.uncertain ? "Pedido de avaliação enviado ao cliente (sem confirmação da plataforma)" : "Pedido de avaliação enviado ao cliente";
    case "survey.skipped":
      // Marcado por alguém da equipa no contacto: com o nome.
      if (d.reason === "sem_pedidos" && a.actor && a.actor !== "Sistema")
        return `Pedido de avaliação não enviado: ${a.actor} marcou que o cliente não quer pedidos de avaliação`;
      return `Pedido de avaliação não enviado: ${SKIP_REASON_TEXT[d.reason as SkipReason] ?? str(d.reason) ?? "motivo desconhecido"}`;
    case "survey.declined":
      return `${a.actor} resolveu sem pedir avaliação ao cliente (atendimento de ${agent})`;
    case "survey.contact":
      return d.no_surveys === false
        ? `${a.actor} voltou a ativar os pedidos de avaliação para este cliente`
        : `${a.actor} marcou que o cliente não quer pedidos de avaliação`;
    case "survey.failed":
      return `Pedido de avaliação não enviado: o envio falhou${str(d.detail) ? ` (${str(d.detail)})` : ""}`;
    case "survey.cancelled":
      return `Pedido de avaliação cancelado por ${a.actor}: ${str(d.reason) || "sem motivo"}`;
    case "survey.rated":
      return n === null ? "O cliente respondeu ao pedido de avaliação" : `O cliente avaliou o atendimento de ${agent}: ${n}/5${d.with_text ? " (com comentário)" : ""}`;
    case "survey.followup":
      return n === null ? "Avaliação baixa: conversa reaberta para acompanhamento." : `Avaliação baixa (${n}/5): conversa reaberta para acompanhamento.`;
    case "survey.optout":
      return "O cliente pediu para não receber mais pedidos de avaliação";
    case "survey.thanks":
      return d.outcome === "failed" ? "Agradecimento pela avaliação não enviado (o envio falhou)" : "Agradecimento pela avaliação enviado ao cliente";
    default:
      return null;
  }
}

export const SURVEY_STATUS_LABEL: Record<string, string> = {
  pending: "Agendado",
  sending: "A enviar",
  sent: "Enviado, à espera da nota",
  failed: "Não enviado (falhou)",
  skipped: "Não enviado",
  rated: "Avaliado",
  expired: "Fechado sem nota",
};
// Porque é que um pedido enviado fechou sem nota.
const CLOSED_TEXT: Record<string, string> = {
  prazo: "sem resposta em 72 h",
  nova_mensagem: "a conversa continuou depois do pedido",
  outra_resposta: "o cliente respondeu sem dar uma nota",
  recusou: "o cliente pediu para não receber pedidos de avaliação",
  cancelado: "cancelado pelo Super Admin",
  desligado: "pedidos de avaliação desligados",
};
// Estado de um pedido no painel do cliente: "Não enviado: a conversa foi reaberta antes do envio". Chat do site por enviar:
// à espera de o cliente abrir o chat.
export function surveyStateText(s: { status: string; skip_reason: string | null; channel?: string | null }) {
  if (s.status === "pending" && s.channel === "site") return "Por mostrar: aparece quando o cliente abrir o chat do site";
  const label = SURVEY_STATUS_LABEL[s.status] || s.status;
  const why = s.status === "skipped" ? SKIP_REASON_TEXT[s.skip_reason as SkipReason] : s.status === "expired" ? CLOSED_TEXT[s.skip_reason || ""] : null;
  return why ? `${label}: ${why}` : label;
}

// ---------------------------------------------------------------- satisfação e desempenho

export const reliable = (ratings: number) => ratings >= SURVEY_RELIABLE;
export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

// Tempo até responder: minutos → "45 min", "3,2 h", "1,5 dias".
export function durationLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const nf = (v: number) => new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(v);
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  if (minutes < 48 * 60) return `${nf(minutes / 60)} h`;
  return `${nf(minutes / 1440)} dias`;
}

// Períodos do relatório (dias de Lisboa, fim exclusivo): mês "2026-10", trimestre "2026-T4", ano "2026" ou os últimos 12
// meses "12m" (do 1.º dia do mês, 11 meses atrás, até ao fim do mês atual). Por pessoa, 10 avaliações num mês são raras:
// os períodos longos chegam lá.
export type ReportPeriod = { key: string; label: string; from: string; to: string };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ymd = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
function lisbonYearMonth(now: Date) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  return { y, m };
}
export function reportPeriod(key: string | null | undefined, now = new Date()): ReportPeriod {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key || "");
  if (month) {
    const y = Number(month[1]), m = Number(month[2]);
    return { key: key!, label: `${MONTHS[m - 1]} de ${y}`, from: ymd(y, m), to: m === 12 ? ymd(y + 1, 1) : ymd(y, m + 1) };
  }
  const quarter = /^(\d{4})-T([1-4])$/.exec(key || "");
  if (quarter) {
    const y = Number(quarter[1]), q = Number(quarter[2]);
    return { key: key!, label: `${q}.º trimestre de ${y}`, from: ymd(y, q * 3 - 2), to: q === 4 ? ymd(y + 1, 1) : ymd(y, q * 3 + 1) };
  }
  const year = /^(\d{4})$/.exec(key || "");
  if (year) {
    const y = Number(year[1]);
    return { key: key!, label: `ano de ${y}`, from: ymd(y, 1), to: ymd(y + 1, 1) };
  }
  const { y, m } = lisbonYearMonth(now);
  if (key === "12m") {
    const t = y * 12 + (m - 1) - 11;
    return { key, label: "últimos 12 meses", from: ymd(Math.floor(t / 12), (t % 12) + 1), to: m === 12 ? ymd(y + 1, 1) : ymd(y, m + 1) };
  }
  return reportPeriod(`${y}-${String(m).padStart(2, "0")}`, now);
}
// Os últimos 12 meses, os últimos 6 meses, os 2 últimos trimestres e o ano (o atual primeiro).
export function reportPeriods(now = new Date()): { key: string; label: string }[] {
  const { y, m } = lisbonYearMonth(now);
  const months = Array.from({ length: 6 }, (_, i) => {
    const t = y * 12 + (m - 1) - i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
  const q = Math.ceil(m / 3);
  const quarters = [`${y}-T${q}`, q === 1 ? `${y - 1}-T4` : `${y}-T${q - 1}`];
  return ["12m", ...months, ...quarters, String(y)].map((k) => ({ key: k, label: reportPeriod(k, now).label }));
}
