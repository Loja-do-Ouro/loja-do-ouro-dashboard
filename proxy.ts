import { NextRequest, NextResponse } from "next/server";
import { authConfigured, SESSION_COOKIE } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

// Sends visitors without a session to the login. The session itself and the
// permissions are checked by each page and action in Supabase, never only here.
export function proxy(request: NextRequest) {
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
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = new URL("/login", request.url);
  const redirect = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (redirect !== "/" && redirect.startsWith("/") && !redirect.startsWith("//")) login.searchParams.set("redirect", redirect);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
