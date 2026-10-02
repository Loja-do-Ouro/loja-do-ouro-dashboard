// Supabase Auth session (Google sign-in, PKCE flow) kept in httpOnly cookies.
// Used by the proxy and the auth routes, so it only relies on fetch and Web Crypto.
// The proxy reads token expiry only; every page validates the token for real
// by calling ldo_me() in Supabase, which rejects forged or revoked tokens.

const ACCESS_COOKIE = "ldo_at";
const REFRESH_COOKIE = "ldo_rt";
const PKCE_COOKIE = "ldo_pkce";
// The session ends after 12 hours without use.
const SESSION_SECONDS = 60 * 60 * 12;

export type Tokens = { access_token: string; refresh_token: string };
type CookieWriter = { set(name: string, value: string, options: Record<string, unknown>): unknown };

export function supabaseConfig() {
  return {
    url: (process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.BI_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
  };
}

export function authConfigured() {
  const c = supabaseConfig();
  return Boolean(c.url && c.key);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function pkcePair() {
  const verifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) };
}

export function authorizeUrl(callback: string, challenge: string) {
  const url = new URL(`${supabaseConfig().url}/auth/v1/authorize`);
  url.search = new URLSearchParams({
    provider: "google",
    redirect_to: callback,
    code_challenge: challenge,
    code_challenge_method: "s256",
    // Store computers are shared: always let the person pick the Google account.
    prompt: "select_account",
  }).toString();
  return url.toString();
}

async function tokenRequest(grant: "pkce" | "refresh_token", body: Record<string, string>): Promise<Tokens | null> {
  const c = supabaseConfig();
  try {
    const r = await fetch(`${c.url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { apikey: c.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as Partial<Tokens>;
    return json.access_token && json.refresh_token ? { access_token: json.access_token, refresh_token: json.refresh_token } : null;
  } catch {
    return null;
  }
}

export const exchangeCode = (code: string, verifier: string) =>
  tokenRequest("pkce", { auth_code: code, code_verifier: verifier });
export const refreshTokens = (refreshToken: string) => tokenRequest("refresh_token", { refresh_token: refreshToken });

// Revokes the refresh token on Supabase; best effort, the cookies are cleared anyway.
export async function revokeSession(accessToken?: string) {
  if (!accessToken) return;
  const c = supabaseConfig();
  await fetch(`${c.url}/auth/v1/logout?scope=local`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: { apikey: c.key, Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}

// Seconds since epoch at which the access token expires; 0 when unreadable.
export function tokenExpiry(token?: string | null) {
  try {
    const part = token?.split(".")[1];
    if (!part) return 0;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
    return Number((JSON.parse(json) as { exp?: number }).exp) || 0;
  } catch {
    return 0;
  }
}

export function tokenFresh(token?: string | null, now = Date.now()) {
  return tokenExpiry(token) - 60 > now / 1000;
}

function options(maxAge: number, path = "/") {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge };
}

export function setSession(cookies: CookieWriter, tokens: Tokens) {
  cookies.set(ACCESS_COOKIE, tokens.access_token, options(SESSION_SECONDS));
  cookies.set(REFRESH_COOKIE, tokens.refresh_token, options(SESSION_SECONDS));
}

export function clearSession(cookies: CookieWriter) {
  cookies.set(ACCESS_COOKIE, "", options(0));
  cookies.set(REFRESH_COOKIE, "", options(0));
}

export function setPkce(cookies: CookieWriter, verifier: string, redirect: string) {
  cookies.set(PKCE_COOKIE, `${verifier}.${bytesToBase64Url(new TextEncoder().encode(redirect))}`, options(600, "/api/auth"));
}

export function readPkce(value?: string) {
  const [verifier, encoded] = (value || "").split(".");
  if (!verifier || !encoded) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    return { verifier, redirect: safeRedirect(new TextDecoder().decode(bytes)) };
  } catch {
    return null;
  }
}

export function clearPkce(cookies: CookieWriter) {
  cookies.set(PKCE_COOKIE, "", options(0, "/api/auth"));
}

export function safeRedirect(value: unknown) {
  const v = typeof value === "string" ? value : "/";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export { ACCESS_COOKIE, REFRESH_COOKIE, PKCE_COOKIE, SESSION_SECONDS };

export function constantTimeTextEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
