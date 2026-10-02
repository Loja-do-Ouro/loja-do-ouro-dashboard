import { NextResponse } from "next/server";
import { authConfigured, safeRedirect, setSession } from "@/lib/session";
import { rpc } from "@/lib/supabase";
import { clearFailures, clientKey, isLocked, recordFailure } from "@/lib/rate-limit";

const FAILURE_DELAY_MS = 800;
type Login = { ok: boolean; reason?: "invalid" | "locked"; token?: string; must_change_password?: boolean };

// Each account locks for 15 minutes after five wrong passwords (in Supabase);
// each network address is also limited here.
export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const redirect = safeRedirect(form.get("redirect"));
  const fail = (error: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", error);
    if (redirect !== "/") url.searchParams.set("redirect", redirect);
    if (username) url.searchParams.set("u", username.slice(0, 40));
    return NextResponse.redirect(url, 303);
  };
  if (!authConfigured()) return fail("config");

  const client = clientKey(request);
  if (isLocked(client)) return fail("locked");

  let result: Login;
  try {
    result = await rpc<Login>("ldo_login", { p_username: username, p_password: password });
  } catch {
    return fail("unavailable");
  }
  if (!result.ok || !result.token) {
    recordFailure(client);
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return fail(result.reason === "locked" || isLocked(client) ? "locked" : "invalid");
  }
  clearFailures(client);

  const response = NextResponse.redirect(new URL(result.must_change_password ? "/conta?primeiro=1" : redirect, request.url), 303);
  setSession(response.cookies, result.token);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
