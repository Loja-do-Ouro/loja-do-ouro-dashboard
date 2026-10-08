import { after, NextRequest, NextResponse } from "next/server";
import { constantTimeTextEqual } from "@/lib/session";
import { sha256Hex } from "@/lib/support/crypto";
import { sessionRpc } from "@/lib/support/db";
import { exchangeGmailCode, GMAIL_OAUTH_COOKIE, GmailError, gmailWatch } from "@/lib/support/gmail";
import { runSync } from "@/lib/support/sync";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Redirect URI registado no cliente OAuth da Google: <produção>/api/support/gmail/callback.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Só códigos no URL: as mensagens são fixas na página de configuração.
  const done = (status: string) => {
    const r = NextResponse.redirect(new URL(`/apoio/configuracao?gmail=${status}#email`, request.url), 303);
    r.cookies.set(GMAIL_OAUTH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/support/gmail", maxAge: 0 });
    r.headers.set("Cache-Control", "no-store");
    return r;
  };
  const viewer = await loadViewer();
  if (!viewer || !viewer.isSuper || viewer.mustChangePassword) return done("sem-acesso");
  if (url.searchParams.get("error")) return done("recusado");

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const [cookieState, verifier] = (request.cookies.get(GMAIL_OAUTH_COOKIE)?.value || "").split(".");
  if (!state || !code || !cookieState || !verifier || !constantTimeTextEqual(state, cookieState)) return done("invalido");
  if (!(await sessionRpc<boolean>(viewer.session, "ldo_support_oauth_consume", { p_state_hash: sha256Hex(state) }).catch(() => false)))
    return done("invalido");
  try {
    const c = await exchangeGmailCode(code, verifier);
    await sessionRpc(viewer.session, "ldo_support_gmail_save", {
      p_email: c.email, p_scope: c.scope, p_refresh_ct: c.refresh_ct, p_access_ct: c.access_ct, p_access_expires_at: c.access_expires_at,
    });
  } catch (e) {
    // 403 sem "voltar a ligar" = entrou com outra conta Google (a caixa confirmada não é a do apoio).
    if (e instanceof GmailError && e.status === 403 && !e.reconnect) return done("outra-conta");
    return done("erro");
  }
  // Avisos da Google e primeira sincronização (últimos 14 dias), depois de responder ao browser.
  after(async () => {
    await gmailWatch().catch(() => undefined);
    await runSync({ only: ["gmail"], force: true, override: true, budgetMs: 45_000 }).catch(() => undefined);
  });
  return done("ligado");
}
