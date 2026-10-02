import "server-only";
import { supabaseConfig } from "./session";

// Calls the Supabase Data API as the signed-in person, so row level security applies.
export class SupabaseError extends Error {
  constructor(message: string, public status: number, public code = "") {
    super(message);
  }
}

// Messages raised on purpose by the ldo_* functions are safe to show as written.
const USER_FACING = new Set(["42501", "22023", "23505", "P0002", "23514"]);

export function userMessage(e: unknown) {
  if (e instanceof SupabaseError && USER_FACING.has(e.code)) {
    if (e.code === "23514") return "Há um valor inválido no formulário.";
    // Unique constraints (not our own raised messages) arrive in English.
    if (e.code === "23505" && e.message.startsWith("duplicate key")) return "Já existe um registo com este código ou email.";
    return e.message;
  }
  return "Não foi possível guardar. Tente novamente dentro de momentos.";
}

async function request<T>(token: string, path: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}) {
  const c = supabaseConfig();
  const url = new URL(`${c.url}/rest/v1/${path}`);
  if (init.query) url.search = new URLSearchParams(init.query).toString();
  const r = await fetch(url, {
    method: init.method || "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new SupabaseError(err.message || `Pedido recusado (${r.status}).`, r.status, err.code || "");
  }
  if (r.status === 204) return null as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function select<T>(token: string, table: string, query: Record<string, string>) {
  return request<T[]>(token, table, { query });
}

// Reads every page so a long period is never silently cut at the API row limit.
export async function selectAll<T>(token: string, table: string, query: Record<string, string>) {
  const out: T[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = await select<T>(token, table, { ...query, offset: String(offset), limit: "1000" });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
  throw new Error("Demasiados registos para este período.");
}

export function rpc<T>(token: string, fn: string, args: Record<string, unknown> = {}) {
  return request<T>(token, `rpc/${fn}`, { method: "POST", body: args });
}
