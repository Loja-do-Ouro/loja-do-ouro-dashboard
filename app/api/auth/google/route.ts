import { NextResponse } from "next/server";
import { authConfigured, authorizeUrl, pkcePair, safeRedirect, setPkce } from "@/lib/session";

// Starts the Google sign-in through Supabase Auth.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!authConfigured()) return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  const { verifier, challenge } = await pkcePair();
  const response = NextResponse.redirect(authorizeUrl(new URL("/api/auth/callback", request.url).toString(), challenge), 303);
  setPkce(response.cookies, verifier, safeRedirect(url.searchParams.get("redirect")));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
