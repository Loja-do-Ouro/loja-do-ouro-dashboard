// Username/password sessions. Passwords and sessions live in Supabase: ldo_login
// returns a random session token, stored here in an httpOnly cookie, and every
// ldo_* function checks that token and the person's permissions in the database.
// The proxy only checks that the cookie exists; pages validate it with ldo_me.

const SESSION_COOKIE = "ldo_session";
// Matches the session lifetime in ldo_private.new_session.
const SESSION_SECONDS = 60 * 60 * 12;

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

function options(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export function setSession(cookies: CookieWriter, token: string) {
  cookies.set(SESSION_COOKIE, token, options(SESSION_SECONDS));
}

export function clearSession(cookies: CookieWriter) {
  cookies.set(SESSION_COOKIE, "", options(0));
}

export function safeRedirect(value: unknown) {
  const v = typeof value === "string" ? value : "/";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export function constantTimeTextEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export { SESSION_COOKIE, SESSION_SECONDS };
