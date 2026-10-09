import { createPublicKey, verify, type KeyObject } from "crypto";

// Verificação do token OIDC que o Google Cloud Pub/Sub envia nos pedidos push ("Authorization: Bearer <JWT>",
// RS256, assinado pela Google). Sem dependências do servidor (testado em tests/google-jwt.cjs).

export type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };

export type PushClaims = { iss: string; aud: string; email: string; email_verified: boolean; exp: number; iat: number; sub?: string };

export type JwtResult = { ok: true; claims: PushClaims } | { ok: false; reason: string };

// Chaves públicas da Google (JWKS indicado em jwks_uri de https://accounts.google.com/.well-known/openid-configuration).
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Emissores válidos dos tokens de ID da Google (com e sem https://).
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Tolerância de relógio: expirado só 60 s depois de exp; emitido no futuro só além de 5 minutos.
export const EXP_LEEWAY_S = 60;
export const IAT_LEEWAY_S = 300;

// Cache das chaves: max-age do Cache-Control (3600 s se não vier), nunca menos de 5 minutos nem mais de um dia.
export const KEYS_DEFAULT_TTL_S = 3600;
export const KEYS_MIN_TTL_S = 300;
export const KEYS_MAX_TTL_S = 24 * 60 * 60;
export const KEYS_TIMEOUT_MS = 10_000;

// Chave desconhecida: só se volta a pedir as chaves se as que temos têm pelo menos 30 s (tokens com kid
// inventado não podem pôr o servidor a pedir as chaves à Google a cada pedido).
export const REFETCH_COOLDOWN_S = 30;

// Motivos de recusa (para registo; o pedido push recebe só 401/403).
export const JWT_REASONS = {
  malformed: "token mal formado",
  alg: "algoritmo não suportado",
  kid: "chave desconhecida",
  signature: "assinatura inválida",
  iss: "emissor inválido",
  aud: "audiência inválida",
  email: "conta de serviço inválida",
  verified: "email não verificado",
  expired: "token expirado",
  future: "token emitido no futuro",
  config: "audiência ou conta de serviço por configurar",
  header: "cabeçalho Authorization inválido",
  keys: "chaves da Google indisponíveis",
} as const;

const MAX_TOKEN_LENGTH = 8192;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

type Parsed = { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer };

// base64url sem preenchimento e na forma canónica (a mesma assinatura não pode ter duas escritas).
function b64url(segment: string): Buffer | null {
  if (!SEGMENT.test(segment) || segment.length % 4 === 1) return null;
  const buf = Buffer.from(segment, "base64url");
  return buf.toString("base64url") === segment ? buf : null;
}

function jsonObject(buf: Buffer | null): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    const v: unknown = JSON.parse(buf.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseJwt(token: unknown): Parsed | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = jsonObject(b64url(parts[0]));
  const payload = jsonObject(b64url(parts[1]));
  const signature = b64url(parts[2]);
  if (!header || !payload || !signature) return null;
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

// Só para registos e diagnóstico: o conteúdo NÃO está verificado e nunca serve para decidir.
export function decodeJwtUnverified(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const p = parseJwt(token);
  return p ? { header: p.header, payload: p.payload } : null;
}

// Cabeçalho do token: só RS256 (recusa "none", HS256 com a chave pública como segredo, etc.) e com kid.
function checkHeader(header: Record<string, unknown>): string | null {
  if (header.alg !== "RS256") return JWT_REASONS.alg;
  if ("crit" in header) return JWT_REASONS.malformed;
  if (typeof header.kid !== "string" || !header.kid || header.kid.length > 200) return JWT_REASONS.malformed;
  return null;
}

const keyObjects = new WeakMap<Jwk, KeyObject>();

function publicKey(jwk: Jwk): KeyObject | null {
  if (jwk.kty !== "RSA" || (jwk.alg !== undefined && jwk.alg !== "RS256") || (jwk.use !== undefined && jwk.use !== "sig")) return null;
  // Módulo RSA de pelo menos 2048 bits (as chaves da Google têm 2048).
  const n = typeof jwk.n === "string" && SEGMENT.test(jwk.n) ? Buffer.from(jwk.n, "base64url") : null;
  if (!n || n.length < 256 || typeof jwk.e !== "string" || !SEGMENT.test(jwk.e)) return null;
  const cached = keyObjects.get(jwk);
  if (cached) return cached;
  try {
    const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
    keyObjects.set(jwk, key);
    return key;
  } catch {
    return null;
  }
}

function signatureOk(p: Parsed, key: KeyObject) {
  try {
    return verify("RSA-SHA256", Buffer.from(p.signingInput), key, p.signature);
  } catch {
    return false;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Verifica assinatura e claims do push. "now" em segundos Unix (como exp e iat). Nunca lança exceções.
export function verifyGoogleJwt(token: string, keys: Jwk[], expect: { audience: string; email: string; now?: number }): JwtResult {
  try {
    const audience = typeof expect?.audience === "string" ? expect.audience : "";
    const email = typeof expect?.email === "string" ? expect.email.trim().toLowerCase() : "";
    if (!audience || !email) return { ok: false, reason: JWT_REASONS.config };
    const p = parseJwt(token);
    if (!p) return { ok: false, reason: JWT_REASONS.malformed };
    const bad = checkHeader(p.header);
    if (bad) return { ok: false, reason: bad };
    const jwk = Array.isArray(keys) ? keys.find((k) => k && k.kid === p.header.kid) : undefined;
    const key = jwk ? publicKey(jwk) : null;
    if (!key) return { ok: false, reason: JWT_REASONS.kid };
    if (!signatureOk(p, key)) return { ok: false, reason: JWT_REASONS.signature };

    const c = p.payload;
    if (typeof c.iss !== "string" || !GOOGLE_ISSUERS.includes(c.iss)) return { ok: false, reason: JWT_REASONS.iss };
    if (typeof c.aud !== "string" || c.aud !== audience) return { ok: false, reason: JWT_REASONS.aud };
    if (typeof c.email !== "string" || c.email.toLowerCase() !== email) return { ok: false, reason: JWT_REASONS.email };
    if (c.email_verified !== true) return { ok: false, reason: JWT_REASONS.verified };
    if (!isNum(c.exp) || !isNum(c.iat)) return { ok: false, reason: JWT_REASONS.malformed };
    const now = isNum(expect.now) ? expect.now : Math.floor(Date.now() / 1000);
    if (c.exp < now - EXP_LEEWAY_S) return { ok: false, reason: JWT_REASONS.expired };
    if (c.iat > now + IAT_LEEWAY_S) return { ok: false, reason: JWT_REASONS.future };

    const claims: PushClaims = { iss: c.iss, aud: c.aud, email: c.email, email_verified: true, exp: c.exp, iat: c.iat };
    if (typeof c.sub === "string") claims.sub = c.sub;
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: JWT_REASONS.malformed };
  }
}

// Validade da resposta das chaves: max-age menos Age (RFC 9111), entre 5 minutos e um dia.
export function keysTtl(cacheControl: string | null, age: string | null = null) {
  const m = /(?:^|,)\s*max-age\s*=\s*"?(\d{1,10})"?\s*(?:,|$)/i.exec(cacheControl || "");
  let ttl = m ? Number(m[1]) : KEYS_DEFAULT_TTL_S;
  const a = /^\s*(\d{1,10})\s*$/.exec(age || "");
  if (m && a) ttl -= Number(a[1]);
  return Math.min(KEYS_MAX_TTL_S, Math.max(KEYS_MIN_TTL_S, ttl));
}

function validJwks(body: unknown): Jwk[] {
  const list = body && typeof body === "object" ? (body as { keys?: unknown }).keys : null;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown) => typeof v === "string" && v.length > 0;
  return list
    .filter((k) => k && typeof k === "object" && str(k.kid) && str(k.kty) && str(k.n) && str(k.e))
    .map((k) => {
      const jwk: Jwk = { kid: k.kid, kty: k.kty, n: k.n, e: k.e };
      if (typeof k.alg === "string") jwk.alg = k.alg;
      if (typeof k.use === "string") jwk.use = k.use;
      return jwk;
    });
}

let cache: { keys: Jwk[]; fetchedAt: number; expiresAt: number } | null = null;
let inflight: Promise<Jwk[]> | null = null;

// Só para os testes.
export function clearGoogleKeysCache() {
  cache = null;
  inflight = null;
}

const nowS = (now?: number) => (isNum(now) ? now : Date.now() / 1000);

// Chaves públicas da Google, em memória enquanto o Cache-Control o permitir; "force" volta a pedi-las.
// Pedidos em simultâneo partilham o mesmo pedido à Google. Lança exceção se não as conseguir obter.
export async function googleKeys(opts: { fetchImpl?: typeof fetch; force?: boolean; now?: number } = {}): Promise<Jwk[]> {
  const now = nowS(opts.now);
  if (!opts.force && cache && now < cache.expiresAt) return cache.keys;
  if (inflight) return inflight;
  const doFetch = opts.fetchImpl || fetch;
  const run = (async () => {
    const r = await doFetch(GOOGLE_CERTS_URL, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(KEYS_TIMEOUT_MS), headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Chaves da Google: HTTP ${r.status}`);
    const keys = validJwks(await r.json());
    if (!keys.length) throw new Error("Chaves da Google: resposta sem chaves");
    cache = { keys, fetchedAt: now, expiresAt: now + keysTtl(r.headers.get("cache-control"), r.headers.get("age")) };
    return keys;
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

// Pedido push do Pub/Sub: "Bearer <JWT>" verificado com as chaves em cache. Com kid desconhecido volta a
// pedir as chaves uma vez (a Google pode ter rodado as chaves). Nunca lança exceções.
export async function verifyPubSubPush(
  authorization: string | null,
  expect: { audience: string; email: string },
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<JwtResult> {
  try {
    const m = typeof authorization === "string" && authorization.length <= MAX_TOKEN_LENGTH + 20
      ? /^\s*bearer[ \t]+([^\s]+)\s*$/i.exec(authorization) : null;
    if (!m) return { ok: false, reason: JWT_REASONS.header };
    const token = m[1];
    // Tokens mal formados ou com outro algoritmo são recusados sem pedir as chaves à Google.
    const p = parseJwt(token);
    if (!p) return { ok: false, reason: JWT_REASONS.malformed };
    const bad = checkHeader(p.header);
    if (bad) return { ok: false, reason: bad };

    const check = { audience: expect?.audience, email: expect?.email, now: opts.now };
    if (!check.audience || !check.email) return { ok: false, reason: JWT_REASONS.config };
    let keys: Jwk[];
    try {
      keys = await googleKeys({ fetchImpl: opts.fetchImpl, now: opts.now });
    } catch {
      return { ok: false, reason: JWT_REASONS.keys };
    }
    const first = verifyGoogleJwt(token, keys, check);
    if (!("reason" in first) || first.reason !== JWT_REASONS.kid) return first;
    if (!cache || nowS(opts.now) - cache.fetchedAt < REFETCH_COOLDOWN_S) return first;
    try {
      keys = await googleKeys({ fetchImpl: opts.fetchImpl, now: opts.now, force: true });
    } catch {
      return first;
    }
    return verifyGoogleJwt(token, keys, check);
  } catch {
    return { ok: false, reason: JWT_REASONS.malformed };
  }
}
