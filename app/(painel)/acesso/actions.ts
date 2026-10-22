"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validAccessToken } from "@/lib/access-email";
import { clearFailures, isLocked, recordFailure } from "@/lib/rate-limit";
import { setSession } from "@/lib/session";
import { rpc, SupabaseError, userMessage } from "@/lib/supabase";

// Página pública /acesso (link do email): o token chega no corpo do pedido, nunca no endereço. Cada endereço
// de rede tem o mesmo limite de tentativas falhadas que o login; os tokens têm 256 bits.
export type AccessInfo =
  | { ok: true; username: string; full_name: string | null; expires_at: string }
  | { ok: false; reason: "incomplete" | "invalid" | "used" | "expired" | "locked" | "unavailable" };

async function client() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function checkAccess(token: string): Promise<AccessInfo> {
  const key = await client();
  if (isLocked(key)) return { ok: false, reason: "locked" };
  if (!validAccessToken(token)) {
    // Normalmente um link cortado ao copiar.
    recordFailure(key);
    return { ok: false, reason: "incomplete" };
  }
  try {
    const info = await rpc<AccessInfo>("ldo_access_info", { p_token: token });
    if (!info.ok && info.reason === "invalid") recordFailure(key);
    return info;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// Define a palavra-passe, gasta o link e entra logo (sessão nova; as antigas terminam).
export async function createPassword(token: string, password: string, confirm: string): Promise<{ ok: false; error: string }> {
  const key = await client();
  if (isLocked(key)) return { ok: false, error: "Demasiadas tentativas falhadas. Aguarde 15 minutos antes de tentar novamente." };
  if (!validAccessToken(token)) {
    recordFailure(key);
    return { ok: false, error: "Este link já não é válido. Peça ao administrador que lhe envie um novo acesso." };
  }
  if (password !== confirm) return { ok: false, error: "As duas palavras-passe não coincidem." };
  let session = "";
  try {
    const r = await rpc<{ ok: boolean; token: string }>("ldo_accept_access", { p_token: token, p_password: password });
    session = r.token;
  } catch (e) {
    if (e instanceof SupabaseError && e.message.startsWith("Este link")) recordFailure(key);
    return { ok: false, error: userMessage(e) };
  }
  clearFailures(key);
  setSession(await cookies(), session);
  redirect("/");
}
