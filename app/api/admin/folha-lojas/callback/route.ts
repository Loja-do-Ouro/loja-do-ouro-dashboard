import { NextRequest, NextResponse } from "next/server";
import { constantTimeTextEqual } from "@/lib/session";
import { sha256Hex } from "@/lib/support/crypto";
import { sessionRpc } from "@/lib/support/db";
import { exchangeStoreSheetCode, SheetError, STORE_SHEET_COOKIE } from "@/lib/store-sheet";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Redirect URI registado no cliente OAuth da Google: <produção>/api/admin/folha-lojas/callback.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Só códigos no URL: as mensagens são fixas na página.
  const done = (status: string) => {
    const r = NextResponse.redirect(new URL(`/admin/folha-lojas?ligacao=${status}`, request.url), 303);
    r.cookies.set(STORE_SHEET_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/admin/folha-lojas", maxAge: 0 });
    r.headers.set("Cache-Control", "no-store");
    return r;
  };
  const viewer = await loadViewer();
  if (!viewer || !viewer.isSuper || viewer.mustChangePassword) return done("sem-acesso");
  if (url.searchParams.get("error")) return done("recusado");

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const [cookieState, verifier] = (request.cookies.get(STORE_SHEET_COOKIE)?.value || "").split(".");
  if (!state || !code || !cookieState || !verifier || !constantTimeTextEqual(state, cookieState)) return done("invalido");
  if (!(await sessionRpc<boolean>(viewer.session, "ldo_support_oauth_consume", { p_state_hash: sha256Hex(state) }).catch(() => false)))
    return done("invalido");
  try {
    const status = await sessionRpc<{ connection: { spreadsheet_id: string } }>(viewer.session, "ldo_store_sheet_status");
    const c = await exchangeStoreSheetCode(code, verifier, status.connection.spreadsheet_id);
    await sessionRpc(viewer.session, "ldo_store_sheet_save", {
      p_email: c.email, p_scope: c.scope, p_refresh_ct: c.refresh_ct, p_access_ct: c.access_ct, p_access_expires_at: c.access_expires_at,
    });
  } catch (e) {
    if (e instanceof SheetError && (e.status === 403 || e.status === 404)) return done("sem-folha");
    return done("erro");
  }
  return done("ligado");
}
