import { NextResponse } from "next/server";
import { authConfig, constantTimeTextEqual, COOKIE_NAME, createSessionToken, SESSION_SECONDS } from "@/lib/auth";
import { clearFailures, clientKey, isLocked, recordFailure } from "@/lib/rate-limit";

const FAILURE_DELAY_MS = 800;

function safeRedirect(value: FormDataEntryValue | null) {
  const v = typeof value === "string" ? value : "/";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const redirect = safeRedirect(form.get("redirect"));
  const config = authConfig();

  if (!config.username || !config.password || !config.secret) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }

  const client = clientKey(request);
  const fail = (error: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", error);
    url.searchParams.set("redirect", redirect);
    return NextResponse.redirect(url, 303);
  };
  // Locked clients are refused before the password is even compared.
  if (isLocked(client)) return fail("locked");

  const ok = constantTimeTextEqual(username, config.username) && constantTimeTextEqual(password, config.password);
  if (!ok) {
    recordFailure(client);
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return fail(isLocked(client) ? "locked" : "invalid");
  }
  clearFailures(client);

  const response = NextResponse.redirect(new URL(redirect, request.url), 303);
  response.cookies.set(COOKIE_NAME, await createSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
