import "server-only";
import { supabaseConfig } from "./session";

// Calls the ldo_* functions in Supabase with the public key. The person's session
// token goes in p_session; each function checks it and the permissions itself.
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
    if (e.code === "23505" && e.message.startsWith("duplicate key")) return "Já existe um registo com este nome ou código.";
    return e.message;
  }
  return "Não foi possível guardar. Tente novamente dentro de momentos.";
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}, query?: Record<string, string>) {
  const c = supabaseConfig();
  const url = new URL(`${c.url}/rest/v1/rpc/${fn}`);
  if (query) url.search = new URLSearchParams(query).toString();
  const r = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { apikey: c.key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new SupabaseError(err.message || `Pedido recusado (${r.status}).`, r.status, err.code || "");
  }
  if (r.status === 204) return null as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Reads every page of a function returning rows, so a long period is never cut at the API row limit.
export async function rpcAll<T>(fn: string, args: Record<string, unknown>) {
  const out: T[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = await rpc<T[]>(fn, args, { offset: String(offset), limit: "1000" });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
  throw new Error("Demasiados registos para este período.");
}
