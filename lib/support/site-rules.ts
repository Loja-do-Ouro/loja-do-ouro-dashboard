import { createHmac, timingSafeEqual } from "crypto";

// Regras do chat do site que não dependem do servidor (testadas em tests/support-site.cjs).

// Sites que podem usar o chat: a loja (domínio principal e myshopify, onde corre a pré-visualização do
// tema). SITE_CHAT_ORIGINS substitui a lista (separada por vírgulas).
export const DEFAULT_ORIGINS = ["https://www.lojadoouro.pt", "https://lojadoouro.pt", "https://lojadoouro-online.myshopify.com"];

export function parseOrigins(value: string | undefined) {
  const list = (value || "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(s));
  return list.length ? list : DEFAULT_ORIGINS;
}

// Origem do pedido aceite: uma das lojas ou o próprio dashboard (página de teste).
export function allowedOrigin(origin: string | null, allowed: string[], self: string) {
  if (!origin) return null;
  const o = origin.trim().toLowerCase();
  return allowed.includes(o) || o === self.toLowerCase() ? origin : null;
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
