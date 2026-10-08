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
