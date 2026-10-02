import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, clearSession, revokeSession } from "@/lib/session";

const REASONS = new Set(["session", "noaccess", "expired"]);

async function logout(request: NextRequest) {
  await revokeSession(request.cookies.get(ACCESS_COOKIE)?.value);
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
