import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  authConfigured,
  clearSession,
  REFRESH_COOKIE,
  refreshTokens,
  setSession,
  tokenFresh,
} from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/google", "/api/auth/callback", "/api/auth/logout"];

// Keeps the Supabase session alive and sends visitors without one to the login.
// Permissions are checked by each page and action, never only here.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (!authConfigured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Dashboard protection is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (path.startsWith("/api/cron/")) return NextResponse.next();

  if (tokenFresh(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const tokens = refresh ? await refreshTokens(refresh) : null;
  if (tokens) {
    // The page rendered in this request must already see the new token.
    request.cookies.set(ACCESS_COOKIE, tokens.access_token);
    request.cookies.set(REFRESH_COOKIE, tokens.refresh_token);
    const response = NextResponse.next({ request: { headers: request.headers } });
    setSession(response.cookies, tokens);
    return response;
  }

  const login = new URL("/login", request.url);
  const redirect = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (redirect !== "/" && redirect.startsWith("/") && !redirect.startsWith("//")) login.searchParams.set("redirect", redirect);
  if (refresh) login.searchParams.set("error", "expired");
  const response = NextResponse.redirect(login);
  clearSession(response.cookies);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
