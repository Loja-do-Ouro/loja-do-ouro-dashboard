import "server-only";
import { easypayBase, readError, type EasypayEnv } from "./easypay-rules";

// Ligação à easypay (API 2.0) com EASYPAY_ACCOUNT_ID e EASYPAY_API_KEY (colados na Vercel; nunca chegam ao browser).
// EASYPAY_ENV=prod para produção; por omissão, sandbox (api.test.easypay.pt).

// Valores colados na Vercel podem trazer espaços, aspas ou mudanças de linha: limpos antes de usar.
const env = (name: string) => (process.env[name] || "").trim().replace(/^["']|["']$/g, "").trim();

export function easypayConfigured() {
  return Boolean(env("EASYPAY_ACCOUNT_ID") && env("EASYPAY_API_KEY"));
}

export const easypayEnv = (): EasypayEnv => (env("EASYPAY_ENV").toLowerCase() === "prod" ? "prod" : "test");

export type EpResult = { ok: true; json: unknown } | { ok: false; error: string; status: number };

export async function easypay(method: "GET" | "POST", path: string, body?: unknown): Promise<EpResult> {
  if (!easypayConfigured()) return { ok: false, error: "Pagamentos por configurar (easypay).", status: 503 };
  try {
    const r = await fetch(`${easypayBase(easypayEnv())}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        AccountId: env("EASYPAY_ACCOUNT_ID"),
        ApiKey: env("EASYPAY_API_KEY"),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, json } : { ok: false, error: readError(json, r.status), status: r.status };
  } catch {
    return { ok: false, error: "easypay indisponível.", status: 503 };
  }
}
