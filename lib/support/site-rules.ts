import { createHmac, timingSafeEqual } from "crypto";

// Regras do chat do site que não dependem do servidor (testadas em tests/support-site.cjs).

// Sites que podem usar o chat: a loja em Portugal (lojadoouro.pt), a loja fora de Portugal (Gold Store Premium,
// goldstorepremium.com) e o myshopify, onde corre a pré-visualização do tema. SITE_CHAT_ORIGINS substitui a lista
// (separada por vírgulas).
export const DEFAULT_ORIGINS = [
  "https://www.lojadoouro.pt", "https://lojadoouro.pt",
  "https://www.goldstorepremium.com", "https://goldstorepremium.com",
  "https://lojadoouro-online.myshopify.com",
];

// fallback: lista usada sem variável ou com valores todos inválidos (a Private Selection tem a sua).
export function parseOrigins(value: string | undefined, fallback: string[] = DEFAULT_ORIGINS) {
  const list = (value || "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(s));
  return list.length ? list : fallback;
}

// Origem do pedido aceite: uma das lojas ou o próprio dashboard (página de teste).
export function allowedOrigin(origin: string | null, allowed: string[], self: string) {
  if (!origin) return null;
  const o = origin.trim().toLowerCase();
  return allowed.includes(o) || o === self.toLowerCase() ? origin : null;
}

// Marca e língua. A marca segue o domínio, que a Shopify escolhe pelo país do cliente: lojadoouro.pt (mercado
// Portugal) é a Loja do Ouro em qualquer língua; goldstorepremium.com (mercados Internacional e Espanha) é a Gold
// Store Premium. A língua vem do widget (<html lang> do tema) ou, sem ela, do prefixo do endereço da página.
export const SITE_LOCALES = ["pt", "en", "es", "fr", "de"] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];
export type Site = "ldo" | "gsp";

type SiteInfo = {
  brand: string; origin: string; domain: string; logo: string; // logótipo dos emails (ficheiro em public/)
  locale: SiteLocale; // língua da raiz do domínio
  roots: Partial<Record<SiteLocale, string>>; // início da loja em cada língua publicada no domínio
};
export const SITES: Record<Site, SiteInfo> = {
  ldo: {
    brand: "Loja do Ouro", origin: "https://www.lojadoouro.pt", domain: "lojadoouro.pt", logo: "/logo-loja-do-ouro.png", locale: "pt",
    roots: { pt: "/", en: "/en/", es: "/es/", fr: "/fr/", de: "/de/" },
  },
  // Sem francês nem alemão neste domínio: ficam na raiz (inglês).
  gsp: {
    brand: "Gold Store Premium", origin: "https://www.goldstorepremium.com", domain: "goldstorepremium.com", logo: "/logo-gold-store-premium.png", locale: "en",
    roots: { en: "/", es: "/es/", pt: "/pt-pt/" },
  },
};

export const isSite = (v: unknown): v is Site => v === "ldo" || v === "gsp";

// "pt-PT", "EN", "es_ES" → pt, en, es. Outra língua → en; o que não é um código de língua → null.
export function normLocale(v: unknown): SiteLocale | null {
  if (typeof v !== "string" || !/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(v.trim())) return null;
  const k = v.trim().toLowerCase().split(/[-_]/)[0];
  return (SITE_LOCALES as readonly string[]).includes(k) ? (k as SiteLocale) : "en";
}

// País da loja (Shopify.country): só duas maiúsculas.
export function cleanCountry(v: unknown) {
  return typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null;
}

// Site pelo domínio (aceita também uma origem, "https://…"). A pré-visualização no myshopify é a Loja do Ouro, a não
// ser que o país da loja não seja Portugal.
export function siteFor({ host, country }: { host: string | null | undefined; country?: string | null }): Site {
  const h = (host || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[:/].*$/, "");
  if (/(^|\.)goldstorepremium\.com$/.test(h)) return "gsp";
  const c = cleanCountry(country);
  if (/\.myshopify\.com$/.test(h) && c && c !== "PT") return "gsp";
  return "ldo";
}

// Língua pelo endereço da página: prefixo /en/, /es/, /fr/, /de/ ou /pt-pt/; sem prefixo, a língua da raiz do
// site. Endereço inválido → null.
export function localeFromPage(url: unknown, site: Site): SiteLocale | null {
  if (typeof url !== "string" || !url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = /^\/(pt|en|es|fr|de)(?:-[a-z]{2})?(?:\/|$)/i.exec(path);
  return m ? normLocale(m[1]) : SITES[site].locale;
}

// Início da loja na língua do cliente, com barra final (ex.: https://www.goldstorepremium.com/es/). Língua que o
// domínio não tem: a raiz. origin substitui o domínio (SITE_CHAT_URL, só na Loja do Ouro).
export function siteRoot(site: Site, locale: string | null | undefined, origin = SITES[site].origin) {
  const l = normLocale(locale) || SITES[site].locale;
  return `${origin.replace(/\/+$/, "")}${SITES[site].roots[l] || "/"}`;
}

// Erros para o visitante: o texto (em português) segue em "error" e um código estável em "code", que o widget
// traduz. Inclui as mensagens das funções do chat na BD, que o servidor passa tal e qual.
export const CHAT_UNAVAILABLE = "O chat está indisponível de momento. Tente novamente dentro de instantes.";
const CHAT_ERRORS = new Map<string, string>([
  ["Origem não autorizada.", "origin_not_allowed"],
  ["Sessão do chat inválida. Inicie uma nova conversa.", "session_invalid"],
  ["Esta conversa já não está disponível. Inicie uma nova.", "conversation_unavailable"],
  ["Pedido demasiado grande.", "request_too_large"],
  ["Pedido inválido.", "invalid_request"],
  ["Indique o seu nome.", "name_required"],
  ["Indique um email válido.", "email_invalid"],
  ["Escreva a sua mensagem.", "message_required"],
  ["Mensagem demasiado longa (máximo 2000 caracteres).", "message_too_long"],
  ["Demasiadas conversas iniciadas. Tente novamente mais tarde.", "too_many_chats"],
  ["Enviou muitas mensagens seguidas. Aguarde um pouco.", "too_many_messages"],
  ["O chat está indisponível de momento.", "chat_unavailable"],
  // Estrelas do pedido de avaliação (ldo_support_site_rate).
  ["Escolha de 1 a 5 estrelas.", "rating_invalid"],
  ["Esta avaliação já não está disponível.", "survey_closed"],
  [CHAT_UNAVAILABLE, "chat_unavailable"],
  ["Sem permissão.", "chat_unavailable"], // token do servidor recusado (ldo_private.bi_check)
]);
export const CHAT_ERROR_CODES = [...new Set(CHAT_ERRORS.values()), "unknown"];

export function errorCode(message: unknown) {
  return (typeof message === "string" && CHAT_ERRORS.get(message.trim())) || "unknown";
}

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim());
}

// Cliente com sessão iniciada na loja: o tema assina "email|segundos" com SITE_CHAT_SECRET
// ({{ customer.email | downcase | append: '|' | append: ts | hmac_sha256: segredo }}). A assinatura vale
// 24 horas; sem segredo configurado (ou assinatura inválida) o email conta como não confirmado.
export const IDENTITY_MAX_AGE_S = 24 * 60 * 60;

export function identitySignature(email: string, ts: string, secret: string) {
  return createHmac("sha256", secret).update(`${email}|${ts}`).digest("hex");
}

export function verifyIdentity(identity: unknown, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!secret || !identity || typeof identity !== "object") return null;
  const { email, ts, sig } = identity as Record<string, unknown>;
  if (typeof email !== "string" || typeof ts !== "string" || typeof sig !== "string") return null;
  const e = email.trim().toLowerCase();
  if (!isEmail(e) || !/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const age = nowMs / 1000 - Number(ts);
  if (age > IDENTITY_MAX_AGE_S || age < -300) return null;
  const expected = Buffer.from(identitySignature(e, ts, secret), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given) ? e : null;
}

// Página onde o cliente está: só o endereço da loja, sem parâmetros (podem ter dados de campanhas).
export function cleanPage(value: unknown, allowed: string[]) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (!allowed.includes(u.origin.toLowerCase())) return null;
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

// Rede do visitante para os limites de abuso: IPv4 /24 e IPv6 /64 (um atacante com muitos endereços da
// mesma rede conta como um só).
export function ipPrefix(ip: string) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const parts = ip.trim().toLowerCase().split("::")[0].split(":").filter(Boolean);
    return `${parts.slice(0, 4).join(":")}::/64`;
  }
  return ip.trim() || "desconhecido";
}

// Identidade do cliente com sessão iniciada, enviada pelo widget no cabeçalho X-LDO-Identity (JSON em base64).
export function decodeIdentity(header: string | null): unknown {
  if (!header || header.length > 2000) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Carrinho enviado pelo widget (lido de /cart.js da loja no browser do cliente). Só texto curto, números
// válidos e ligações relativas para produtos; até 20 artigos.
export type SiteCart = {
  count: number; total: number; currency: string;
  items: { title: string; variant: string | null; quantity: number; price: number; url: string | null }[];
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

export function cleanCart(value: unknown): SiteCart | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const count = num(c.count, 0, 10000);
  const total = num(c.total, 0, 10_000_000);
  const currency = typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency) ? c.currency : "EUR";
  if (count === null || total === null || !Array.isArray(c.items)) return null;
  const items = c.items.slice(0, 20).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const i = raw as Record<string, unknown>;
    const title = str(i.title, 120);
    const quantity = num(i.quantity, 1, 999);
    const price = num(i.price, 0, 10_000_000);
    if (!title || quantity === null || price === null) return [];
    const url = typeof i.url === "string" && /^\/[a-z0-9\-_/]*products\/[a-z0-9\-_%]+(\?variant=\d+)?$/i.test(i.url) ? i.url.slice(0, 300) : null;
    return [{ title, variant: str(i.variant, 80) || null, quantity: Math.round(quantity), price: Math.round(price * 100) / 100, url }];
  });
  return { count: Math.round(count), total: Math.round(total * 100) / 100, currency, items };
}
