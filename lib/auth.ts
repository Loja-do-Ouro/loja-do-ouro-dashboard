const COOKIE_NAME = "lo_dashboard_session";
const SESSION_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySignature(value: string, signature: string, secret: string) {
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), encoder.encode(value));
  } catch {
    return false;
  }
}

export function authConfig() {
  return {
    username: process.env.DASHBOARD_USER || "",
    password: process.env.DASHBOARD_PASSWORD || "",
    secret: process.env.DASHBOARD_SESSION_SECRET || "",
  };
}

export function isAuthConfigured() {
  const c = authConfig();
  return Boolean(c.username && c.password && c.secret);
}

// The password is part of the signing key, so changing DASHBOARD_PASSWORD
// invalidates every open session without rotating the session secret.
function signingKey(c: ReturnType<typeof authConfig>) {
  return `${c.secret}\u0000${c.password}`;
}

export async function createSessionToken(username: string) {
  const config = authConfig();
  if (!config.secret) throw new Error("DASHBOARD_SESSION_SECRET em falta");
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  return `${payload}.${await sign(payload, signingKey(config))}`;
}

export async function validateSessionToken(token?: string | null) {
  if (!token) return false;
  const config = authConfig();
  const { username, secret } = config;
  if (!username || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !(await verifySignature(payload, signature, signingKey(config)))) return false;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const parsed = JSON.parse(json) as { u?: string; exp?: number };
    return parsed.u === username && Number(parsed.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function constantTimeTextEqual(a: string, b: string) {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export { COOKIE_NAME, SESSION_SECONDS };
