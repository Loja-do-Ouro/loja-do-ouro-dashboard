import { NextRequest, NextResponse } from "next/server";
import { clearSession, SESSION_COOKIE } from "@/lib/session";
import { rpc } from "@/lib/supabase";

const REASONS = new Set(["session", "password", "noaccess"]);

async function logout(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  // Ends the session in Supabase too; best effort, the cookie is cleared anyway.
  if (session) await rpc("ldo_logout", { p_session: session }).catch(() => undefined);
  const reason = new URL(request.url).searchParams.get("error") || "";
  const login = new URL("/login", request.url);
  if (REASONS.has(reason)) login.searchParams.set("error", reason);
  else login.searchParams.set("ok", "logout");
  const response = NextResponse.redirect(login, 303);
  clearSession(response.cookies);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = logout;
// Pages redirect here when the session is no longer valid.
export const GET = logout;
