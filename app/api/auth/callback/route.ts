import { NextRequest, NextResponse } from "next/server";
import { clearPkce, exchangeCode, PKCE_COOKIE, readPkce, revokeSession, setSession } from "@/lib/session";
import { rpc } from "@/lib/supabase";

// Google returns here through Supabase. Only invited, active emails get a session.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pkce = readPkce(request.cookies.get(PKCE_COOKIE)?.value);
  const fail = (error: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url), 303);
    clearPkce(response.cookies);
    return response;
  };
  const code = url.searchParams.get("code");
  if (!code || !pkce) return fail(url.searchParams.get("error") === "access_denied" ? "cancelled" : "oauth");

  const tokens = await exchangeCode(code, pkce.verifier);
  if (!tokens) return fail("oauth");

  let me: unknown = null;
  try {
    me = await rpc(tokens.access_token, "ldo_claim_login");
  } catch {
    me = null;
  }
  if (!me) {
    await revokeSession(tokens.access_token);
    return fail("noaccess");
  }

  const response = NextResponse.redirect(new URL(pkce.redirect, request.url), 303);
  setSession(response.cookies, tokens);
  clearPkce(response.cookies);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
