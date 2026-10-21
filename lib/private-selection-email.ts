// Email com o acesso à Private Selection, nas 6 línguas e com a marca do membro: saudação pelo primeiro nome, o email
// e a senha numa caixa e o botão para a página reservada da loja. Sem I/O (testado em
// tests/private-selection-email.cjs); o envio está em lib/private-selection/send.ts. A senha só entra no corpo, e
// escapada: nunca no assunto nem na pré-visualização. Marcadores: {brand}, {name}, {url}.
import { BRAND, brandEmail, emailParagraph, esc } from "./email-layout";
import { firstName, PS_BRANDS, PS_INTL, psLang, type PsLocale } from "./private-selection-rules";
import { fill } from "./support/site-i18n";

const PT = {
  subject: "O seu acesso à {brand}",
  preheader: "Aqui tem os seus dados de acesso.",
  eyebrow: "Acesso reservado",
  hello: "Olá, {name},",
  helloNoName: "Olá,",
  ready: "O seu acesso à {brand} está pronto.",
  details: "Para entrar, use estes dados:",
  email: "E-mail",
  password: "Senha",
  button: "Entrar na Private Selection",
  link: "Entrar na Private Selection: {url}",
  noShare: "Por favor, não partilhe esta senha.",
  ignore: "Se não pediu este acesso, pode ignorar este e-mail.",
  colon: ":",
};
export type PsTexts = typeof PT;

// Tratamento formal em todas as línguas. Francês: espaço inseparável ( ) antes de ? ! : ;. Alemão: "Sie".
export const PS_TEXTS: Record<PsLocale, PsTexts> = {
  pt: PT,
  en: {
    subject: "Your access to {brand}",
    preheader: "Here are your sign-in details.",
    eyebrow: "Exclusive access",
    hello: "Dear {name},",
    helloNoName: "Hello,",
    ready: "Your access to {brand} is ready.",
    details: "To sign in, please use the following details:",
    email: "Email",
    password: "Password",
    button: "Enter Private Selection",
    link: "Enter Private Selection: {url}",
    noShare: "Please do not share this password.",
    ignore: "If you did not request this access, you can simply ignore this email.",
    colon: ":",
  },
  es: {
    subject: "Su acceso a {brand}",
    preheader: "Aquí tiene sus datos de acceso.",
    eyebrow: "Acceso exclusivo",
    hello: "Hola, {name}:",
    helloNoName: "Hola:",
    ready: "Su acceso a {brand} ya está listo.",
    details: "Para entrar, utilice estos datos:",
    email: "Correo electrónico",
    password: "Contraseña",
    button: "Entrar en Private Selection",
    link: "Entrar en Private Selection: {url}",
    noShare: "Por favor, no comparta esta contraseña.",
    ignore: "Si no ha solicitado este acceso, puede ignorar este correo.",
    colon: ":",
  },
  fr: {
    subject: "Votre accès à {brand}",
    preheader: "Voici vos identifiants de connexion.",
    eyebrow: "Accès réservé",
    hello: "Bonjour {name},",
    helloNoName: "Bonjour,",
    ready: "Votre accès à {brand} est prêt.",
    details: "Pour vous connecter, utilisez les identifiants suivants :",
    email: "E-mail",
    password: "Mot de passe",
    button: "Accéder à la Private Selection",
    link: "Accéder à la Private Selection : {url}",
    noShare: "Merci de ne pas communiquer ce mot de passe.",
    ignore: "Si vous n'avez pas demandé cet accès, vous pouvez ignorer cet e-mail.",
    colon: " :",
  },
  de: {
    subject: "Ihr Zugang zu {brand}",
    preheader: "Hier sind Ihre Zugangsdaten.",
    eyebrow: "Exklusiver Zugang",
    hello: "Guten Tag {name},",
    helloNoName: "Guten Tag,",
    ready: "Ihr Zugang zu {brand} ist eingerichtet.",
    details: "Melden Sie sich mit diesen Daten an:",
    email: "E-Mail",
    password: "Passwort",
    button: "Zur Private Selection",
    link: "Zur Private Selection: {url}",
    noShare: "Bitte geben Sie dieses Passwort nicht weiter.",
    ignore: "Falls Sie diesen Zugang nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    colon: ":",
  },
  it: {
    subject: "Il suo accesso a {brand}",
    preheader: "Ecco i suoi dati di accesso.",
    eyebrow: "Accesso riservato",
    hello: "Gentile {name},",
    helloNoName: "Gentile cliente,",
    ready: "Il suo accesso a {brand} è pronto.",
    details: "Per accedere, utilizzi questi dati:",
    email: "E-mail",
    password: "Password",
    button: "Accedere alla Private Selection",
    link: "Accedere alla Private Selection: {url}",
    noShare: "La preghiamo di non condividere questa password.",
    ignore: "Se non ha richiesto questo accesso, può ignorare questa e-mail.",
    colon: ":",
  },
};

export type PrivateSelectionMail = {
  baseUrl: string; // endereço do dashboard (logótipos públicos)
  brand: string; locale: string; // como na BD (ldo/gsp; pt, en, es, fr, de, it)
  name: string | null; email: string; password: string;
  entryUrl: string; // entryUrl() de lib/private-selection-rules.ts
};

// Caixa com o email e a senha (a senha em letra de largura fixa, para distinguir l, 1, O e 0).
function credentials(t: PsTexts, email: string, password: string) {
  const label = (s: string) => `<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};font-weight:bold">${esc(s)}</div>`;
  return `<tr><td style="padding:2px 24px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.soft};border:1px solid ${BRAND.line};border-left:3px solid ${BRAND.gold};border-radius:10px"><tr><td style="padding:16px 18px">
${label(t.email)}<div style="font-size:15px;color:${BRAND.text};margin:4px 0 14px;word-break:break-all">${esc(email)}</div>
${label(t.password)}<div style="font-family:'Courier New',Courier,monospace;font-size:20px;font-weight:bold;letter-spacing:1px;color:${BRAND.petrol};margin-top:4px;word-break:break-all">${esc(password)}</div>
</td></tr></table></td></tr>`;
}

export function privateSelectionEmail(m: PrivateSelectionMail) {
  const { brand, locale } = psLang(m.brand, m.locale);
  const info = PS_BRANDS[brand];
  const t = PS_TEXTS[locale];
  const base = m.baseUrl.replace(/\/+$/, "");
  const first = firstName(m.name);
  const tx = (k: keyof PsTexts, vars: Record<string, string> = {}) => fill(t[k], { brand: info.name, ...vars });
  const hello = first ? tx("hello", { name: first }) : tx("helloNoName");
  const subject = tx("subject");
  const preheader = tx("preheader");
  const html = brandEmail({
    baseUrl: base,
    lang: PS_INTL[locale],
    logo: `${base}${info.logo}`,
    logoAlt: info.store,
    logoWidth: brand === "gsp" ? 200 : 170,
    eyebrow: t.eyebrow,
    title: info.name,
    preheader,
    body: [
      emailParagraph(esc(hello)),
      emailParagraph(fill(esc(t.ready), { brand: `<strong>${esc(info.name)}</strong>` })),
      emailParagraph(esc(t.details)),
      credentials(t, m.email, m.password),
    ].join("\n"),
    button: { label: t.button, url: m.entryUrl },
    after: [
      emailParagraph(esc(t.noShare)),
      emailParagraph(`<span style="color:${BRAND.muted};font-size:13px">${esc(t.ignore)}</span>`),
    ].join("\n"),
    footer: `${info.name} · ${info.domain}`,
  });
  const text = [
    hello,
    "",
    tx("ready"),
    t.details,
    "",
    `${t.email}${t.colon} ${m.email}`,
    `${t.password}${t.colon} ${m.password}`,
    "",
    tx("link", { url: m.entryUrl }),
    "",
    t.noShare,
    t.ignore,
    "",
    `${info.name} · ${info.domain}`,
  ].join("\n");
  return { subject, preheader, html, text };
}
