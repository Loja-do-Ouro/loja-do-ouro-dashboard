// Textos do chat do site para o cliente, nas 5 línguas e com a marca do domínio dele: emails (aviso de resposta e
// cópia da conversa) e aviso de transferência. Sem I/O (testado em tests/support-site-i18n.cjs); o envio está em
// site-chat.ts. Marcadores: {brand}, {domain}, {name}, {url}.
import { brandEmail, emailParagraph, emailQuote, esc } from "../email-layout";
import { cut } from "./comment-rules";
import { isSite, normLocale, SITES, siteRoot, type Site, type SiteLocale } from "./site-rules";

export const INTL: Record<SiteLocale, string> = { pt: "pt-PT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE" };

const PT = {
  hello: "Olá {name},",
  helloNoName: "Olá,",
  colon: ":",
  eyebrow: "Chat da {brand}",
  replySubjectOne: "Resposta da {brand} à sua mensagem",
  replySubjectMany: "Novas respostas da {brand}",
  replyTitleOne: "Respondemos à sua mensagem",
  replyTitleMany: "Tem novas respostas nossas",
  replyIntroOne: "Respondemos à sua mensagem no chat da {brand}:",
  replyIntroMany: "Deixámos-lhe estas respostas no chat da {brand}:",
  replyOutro: "Pode continuar a conversa no site ou responder diretamente a este email.",
  replyButton: "Continuar a conversa",
  replyLink: "Continuar a conversa: {url}",
  replyFooter: "Recebeu este email porque falou connosco no chat de {domain} · {brand}",
  transcriptSubject: "A sua conversa com a {brand}",
  transcriptTitle: "A sua conversa connosco",
  transcriptPreheader: "Cópia da conversa que teve no chat de {domain}.",
  transcriptIntro: "Obrigado por falar connosco. Segue a cópia da conversa que teve no chat de {domain}.",
  transcriptOutro: "Se precisar de mais alguma coisa, responda a este email ou fale connosco no site.",
  transcriptButton: "Voltar à loja",
  transcriptFooter: "Recebeu esta cópia porque a pediu ao terminar a conversa no chat de {domain} · {brand}",
  you: "Você",
  transfer: "A conversa foi transferida para {name}.",
  someoneElse: "outra pessoa da equipa",
};
export type SiteTexts = typeof PT;

// Francês: espaço inseparável ( ) antes de ? ! : ;. Alemão: tratamento por "Sie" e, depois da saudação com
// vírgula, a frase seguinte começa em minúscula.
export const SITE_TEXTS: Record<SiteLocale, SiteTexts> = {
  pt: PT,
  en: {
    hello: "Hello {name},",
    helloNoName: "Hello,",
    colon: ":",
    eyebrow: "{brand} chat",
    replySubjectOne: "{brand} has replied to your message",
    replySubjectMany: "New replies from {brand}",
    replyTitleOne: "We've replied to your message",
    replyTitleMany: "You have new replies from us",
    replyIntroOne: "We've replied to your message in the {brand} chat:",
    replyIntroMany: "We've left you these replies in the {brand} chat:",
    replyOutro: "You can continue the conversation on our website or simply reply to this email.",
    replyButton: "Continue the conversation",
    replyLink: "Continue the conversation: {url}",
    replyFooter: "You are receiving this email because you chatted with us on {domain} · {brand}",
    transcriptSubject: "Your conversation with {brand}",
    transcriptTitle: "Your conversation with us",
    transcriptPreheader: "A copy of your chat with us on {domain}.",
    transcriptIntro: "Thank you for getting in touch. Here is a copy of your chat with us on {domain}.",
    transcriptOutro: "If you need anything else, simply reply to this email or chat with us on our website.",
    transcriptButton: "Back to the shop",
    transcriptFooter: "You are receiving this copy because you asked for it when you ended the chat on {domain} · {brand}",
    you: "You",
    transfer: "The conversation was transferred to {name}.",
    someoneElse: "another team member",
  },
  es: {
    hello: "Hola, {name}:",
    helloNoName: "Hola:",
    colon: ":",
    eyebrow: "Chat de {brand}",
    replySubjectOne: "{brand} ha respondido a su mensaje",
    replySubjectMany: "Nuevas respuestas de {brand}",
    replyTitleOne: "Hemos respondido a su mensaje",
    replyTitleMany: "Tiene nuevas respuestas nuestras",
    replyIntroOne: "Hemos respondido a su mensaje en el chat de {brand}:",
    replyIntroMany: "Le hemos dejado estas respuestas en el chat de {brand}:",
    replyOutro: "Puede continuar la conversación en nuestra web o responder directamente a este correo.",
    replyButton: "Continuar la conversación",
    replyLink: "Continuar la conversación: {url}",
    replyFooter: "Ha recibido este correo porque habló con nosotros en el chat de {domain} · {brand}",
    transcriptSubject: "Su conversación con {brand}",
    transcriptTitle: "Su conversación con nosotros",
    transcriptPreheader: "Copia de la conversación que mantuvo en el chat de {domain}.",
    transcriptIntro: "Gracias por ponerse en contacto con nosotros. Le enviamos una copia de la conversación que mantuvo en el chat de {domain}.",
    transcriptOutro: "Si necesita algo más, responda a este correo o escríbanos en el chat de nuestra web.",
    transcriptButton: "Volver a la tienda",
    transcriptFooter: "Ha recibido esta copia porque la solicitó al terminar la conversación en el chat de {domain} · {brand}",
    you: "Usted",
    transfer: "La conversación se ha transferido a {name}.",
    someoneElse: "otra persona del equipo",
  },
  fr: {
    hello: "Bonjour {name},",
    helloNoName: "Bonjour,",
    colon: " :",
    eyebrow: "Chat {brand}",
    replySubjectOne: "{brand} a répondu à votre message",
    replySubjectMany: "Nouvelles réponses de {brand}",
    replyTitleOne: "Nous avons répondu à votre message",
    replyTitleMany: "Vous avez de nouvelles réponses",
    replyIntroOne: "Nous avons répondu à votre message sur le chat {brand} :",
    replyIntroMany: "Voici nos réponses sur le chat {brand} :",
    replyOutro: "Vous pouvez poursuivre la conversation sur notre site ou répondre directement à cet e-mail.",
    replyButton: "Poursuivre la conversation",
    replyLink: "Poursuivre la conversation : {url}",
    replyFooter: "Vous recevez cet e-mail car vous avez échangé avec nous sur le chat de {domain} · {brand}",
    transcriptSubject: "Votre conversation avec {brand}",
    transcriptTitle: "Votre conversation avec nous",
    transcriptPreheader: "Copie de votre conversation sur le chat de {domain}.",
    transcriptIntro: "Merci de nous avoir contactés. Voici la copie de votre conversation sur le chat de {domain}.",
    transcriptOutro: "Si vous avez besoin d'autre chose, répondez simplement à cet e-mail ou écrivez-nous sur le chat de notre site.",
    transcriptButton: "Retour à la boutique",
    transcriptFooter: "Vous recevez cette copie car vous l'avez demandée en terminant la conversation sur le chat de {domain} · {brand}",
    you: "Vous",
    transfer: "La conversation a été transférée à {name}.",
    someoneElse: "un autre membre de l'équipe",
  },
  de: {
    hello: "Hallo {name},",
    helloNoName: "Guten Tag,",
    colon: ":",
    eyebrow: "Chat von {brand}",
    replySubjectOne: "{brand} hat auf Ihre Nachricht geantwortet",
    replySubjectMany: "Neue Antworten von {brand}",
    replyTitleOne: "Wir haben auf Ihre Nachricht geantwortet",
    replyTitleMany: "Sie haben neue Antworten von uns",
    replyIntroOne: "wir haben im Chat von {brand} auf Ihre Nachricht geantwortet:",
    replyIntroMany: "wir haben Ihnen im Chat von {brand} folgende Antworten hinterlassen:",
    replyOutro: "Sie können das Gespräch auf unserer Website fortsetzen oder direkt auf diese E-Mail antworten.",
    replyButton: "Gespräch fortsetzen",
    replyLink: "Gespräch fortsetzen: {url}",
    replyFooter: "Sie erhalten diese E-Mail, weil Sie mit uns im Chat auf {domain} geschrieben haben · {brand}",
    transcriptSubject: "Ihr Gespräch mit {brand}",
    transcriptTitle: "Ihr Gespräch mit uns",
    transcriptPreheader: "Kopie Ihres Chats auf {domain}.",
    transcriptIntro: "vielen Dank für Ihre Nachricht. Hier ist die Kopie Ihres Chats auf {domain}.",
    transcriptOutro: "Wenn Sie noch etwas brauchen, antworten Sie einfach auf diese E-Mail oder schreiben Sie uns im Chat auf unserer Website.",
    transcriptButton: "Zurück zum Shop",
    transcriptFooter: "Sie erhalten diese Kopie, weil Sie sie beim Beenden des Chats auf {domain} angefordert haben · {brand}",
    you: "Sie",
    transfer: "Der Chat wurde an {name} übergeben.",
    someoneElse: "eine andere Person aus dem Team",
  },
};

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : m));
}

// Site e língua de um visitante guardado na BD (sem língua: a da raiz do site; visitantes antigos = pt).
export function visitorLang(site: unknown, locale: unknown): { site: Site; locale: SiteLocale } {
  const s = isSite(site) ? site : "ldo";
  return { site: s, locale: normLocale(locale) || SITES[s].locale };
}

// Aviso de transferência na língua do cliente (to_first: primeiro nome de quem passa a atender).
export function transferNotice(locale: unknown, toFirst: string | null | undefined) {
  const t = SITE_TEXTS[normLocale(locale) || "pt"];
  return fill(t.transfer, { name: toFirst?.trim() || t.someoneElse });
}

// Ligações da Loja do Ouro numa resposta a um cliente da Gold Store Premium: passam para o domínio dele, na língua
// dele (é a mesma loja Shopify; um produto com o endereço em português é encontrado na mesma). O prefixo de língua
// do endereço original sai. Na Loja do Ouro o texto fica igual.
export function rebrandLinks(body: string, site: Site, locale: string | null | undefined) {
  if (site !== "gsp") return body;
  const root = siteRoot("gsp", locale);
  return body.replace(/https?:\/\/(?:www\.)?lojadoouro\.pt(?![\w-]|\.[\w-])(\/[^\s<>"']*)?/gi, (_m, path?: string) =>
    root + (path || "").replace(/^\/(?:(?:pt|en|es|fr|de)(?:-[a-z]{2})?(?=[/?#]|$))?\/?/i, ""));
}

// Fuso das horas na cópia da conversa: o do país da loja do cliente (Europa Central por omissão na Gold Store
// Premium, que vende sobretudo para lá; Lisboa na Loja do Ouro).
const WESTERN = new Set(["PT", "GB", "IE", "IS", "FO"]);
const EASTERN = new Set(["FI", "EE", "LV", "LT", "RO", "BG", "GR", "CY", "UA", "MD"]);
export function emailTimeZone(site: Site, country: string | null | undefined) {
  if (country && WESTERN.has(country)) return "Europe/Lisbon";
  if (country && EASTERN.has(country)) return "Europe/Helsinki";
  return site === "gsp" || country ? "Europe/Paris" : "Europe/Lisbon";
}

type Visitor = { site: unknown; locale: unknown; country?: string | null; name: string };
type Mail = { subject: string; html: string; text: string };

function setup(v: Visitor, baseUrl: string, origin?: string | null) {
  const { site, locale } = visitorLang(v.site, v.locale);
  const info = SITES[site];
  const t = SITE_TEXTS[locale];
  const vars = { brand: info.brand, domain: info.domain };
  const tx = (k: keyof SiteTexts, more: Record<string, string> = {}) => fill(t[k], { ...vars, ...more });
  const first = (v.name || "").trim().split(/\s+/)[0] || "";
  return {
    site, locale, info, t, tx, first,
    hello: first ? tx("hello", { name: first }) : tx("helloNoName"),
    root: siteRoot(site, locale, site === "ldo" && origin ? origin : undefined),
    layout: { baseUrl, lang: INTL[locale], logo: `${baseUrl}${info.logo}`, logoAlt: info.brand, logoWidth: site === "gsp" ? 200 : 170 },
  };
}

// Aviso por email das respostas que o cliente ainda não viu (saiu do site). origin: SITE_CHAT_URL (só na Loja do Ouro).
export function replyEmail(v: Visitor & { items: { body: string; author: string | null }[] }, baseUrl: string, origin?: string | null): Mail {
  const s = setup(v, baseUrl, origin);
  const items = v.items.map((r) => ({ author: r.author, body: rebrandLinks(r.body, s.site, s.locale) }));
  const many = items.length > 1;
  const who = (author: string | null) => (author ? `${author} · ${s.info.brand}` : s.info.brand);
  const intro = s.tx(many ? "replyIntroMany" : "replyIntroOne");
  const outro = s.tx("replyOutro");
  const url = `${s.root}?chat=abrir`;
  const html = brandEmail({
    ...s.layout,
    eyebrow: s.tx("eyebrow"),
    title: s.tx(many ? "replyTitleMany" : "replyTitleOne"),
    // Cortado sem partir um emoji ao meio (metade de um emoji estraga o email).
    preheader: cut((items[0]?.body || "").replace(/\s+/g, " "), 120),
    body: emailParagraph(esc(s.hello)) + emailParagraph(esc(intro))
      + items.map((r) => emailQuote(who(r.author), r.body)).join("")
      + emailParagraph(esc(outro)),
    button: { label: s.tx("replyButton"), url },
    footer: s.tx("replyFooter"),
  });
  const text = [s.hello, "", intro, "", ...items.flatMap((r) => [`${who(r.author)}${s.t.colon}`, r.body, ""]), outro, s.tx("replyLink", { url })].join("\n");
  return { subject: s.tx(many ? "replySubjectMany" : "replySubjectOne"), html, text };
}

export type TranscriptMessage = {
  from: "visitor" | "team" | "notice"; author: string | null; body: string; at: string; kind?: string | null; to_first?: string | null;
};

// Cópia da conversa para o cliente que a terminou e a pediu.
export function transcriptEmail(v: Visitor & { messages: TranscriptMessage[] }, baseUrl: string, origin?: string | null): Mail {
  const s = setup(v, baseUrl, origin);
  const when = new Intl.DateTimeFormat(INTL[s.locale], { timeZone: emailTimeZone(s.site, v.country), dateStyle: "long", timeStyle: "short" });
  const label = (m: TranscriptMessage) => m.from === "visitor"
    ? `${s.first || s.t.you} · ${when.format(new Date(m.at))}`
    : `${m.author ? `${m.author} · ` : ""}${s.info.brand} · ${when.format(new Date(m.at))}`;
  // Avisos antigos (sem kind) ficam com o texto que a BD enviou.
  const notice = (m: TranscriptMessage) => (m.kind === "transfer" ? transferNotice(s.locale, m.to_first) : m.body);
  const body = (m: TranscriptMessage) => (m.from === "team" ? rebrandLinks(m.body, s.site, s.locale) : m.body);
  const rows = v.messages.map((m) => m.from === "notice"
    ? emailParagraph(`<span style="color:#9a917f;font-size:13px">${esc(notice(m))}</span>`)
    : emailQuote(label(m), body(m), { links: m.from !== "visitor" })).join("");
  const intro = s.tx("transcriptIntro");
  const html = brandEmail({
    ...s.layout,
    eyebrow: s.tx("eyebrow"),
    title: s.tx("transcriptTitle"),
    preheader: s.tx("transcriptPreheader"),
    body: emailParagraph(esc(s.hello)) + emailParagraph(esc(intro)) + rows + emailParagraph(esc(s.tx("transcriptOutro"))),
    button: { label: s.tx("transcriptButton"), url: s.root },
    footer: s.tx("transcriptFooter"),
  });
  const text = [s.hello, "", intro, "",
    ...v.messages.flatMap((m) => m.from === "notice" ? [`— ${notice(m)}`, ""] : [`${label(m)}${s.t.colon}`, body(m), ""]),
    `${s.info.brand} · ${s.root}`].join("\n");
  return { subject: s.tx("transcriptSubject"), html, text };
}
