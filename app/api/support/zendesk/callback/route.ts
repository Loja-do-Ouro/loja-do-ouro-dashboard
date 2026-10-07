import { NextRequest, NextResponse } from "next/server";
import { canSupport } from "@/lib/permissions";
import { constantTimeTextEqual } from "@/lib/session";
import { sha256Hex } from "@/lib/support/crypto";
import { SupabaseError } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { completeConnection, OAUTH_COOKIE, ZendeskError } from "@/lib/support/zendesk";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Redirect URL registado no cliente OAuth do Zendesk: <domínio>/api/support/zendesk/callback.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Só códigos no URL: as mensagens são fixas na página (nunca texto vindo de fora).
  const done = (status: string) => {
    const to = new URL("/apoio", request.url);
    to.searchParams.set("zendesk", status);
    const r = NextResponse.redirect(to, 303);
    r.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/support/zendesk", maxAge: 0 });
    r.headers.set("Cache-Control", "no-store");
    return r;
  };
  const viewer = await loadViewer();
  if (!viewer || !canSupport(viewer)) return done("sem-acesso");
  if (url.searchParams.get("error")) return done("recusado");

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const [cookieState, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value || "").split(".");
  // O state tem de coincidir com o cookie deste browser e com o registo de uso único desta pessoa.
  if (!state || !code || !cookieState || !verifier || !constantTimeTextEqual(state, cookieState)) return done("invalido");
  if (!(await sessionRpc<boolean>(viewer.session, "ldo_support_oauth_consume", { p_state_hash: sha256Hex(state) }).catch(() => false)))
    return done("invalido");
  try {
    await completeConnection(viewer.id, code, verifier, request.url);
  } catch (e) {
    if (e instanceof ZendeskError) return done(`erro-${e.code}`);
    if (e instanceof SupabaseError && e.code === "23505") return done("erro-ocupada");
    return done("erro");
  }
  return done("ligado");
}
