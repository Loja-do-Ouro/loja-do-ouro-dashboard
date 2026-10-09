import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { encryptionConfigured, randomToken, sha256Hex } from "@/lib/support/crypto";
import { sessionRpc } from "@/lib/support/db";
import { GMAIL_OAUTH_COOKIE, gmailAuthorizeUrl, gmailConfigured, gmailRedirectUri } from "@/lib/support/gmail";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const back = (base: string, status: string) => NextResponse.redirect(new URL(`/apoio/configuracao?gmail=${status}#email`, base), 303);

// "Ligar Gmail" (só o Super Admin): formulário POST da página de configuração. Como no Zendesk, o state
// (aleatório, uso único, 10 min) fica na BD ligado à pessoa e num cookie httpOnly com o verificador PKCE.
// Começa sempre no endereço registado na Google (o da produção), para o cookie voltar no retorno.
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== new URL(request.url).origin))
    return new Response("Pedido recusado.", { status: 403 });
  const viewer = await loadViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login?redirect=/apoio/configuracao", request.url), 303);
  if (!viewer.isSuper || viewer.mustChangePassword) return back(request.url, "sem-acesso");
  if (!gmailConfigured() || !encryptionConfigured()) return back(request.url, "por-configurar");
  const canonical = new URL(gmailRedirectUri()).origin;
  if (new URL(request.url).origin !== canonical) return back(canonical, "endereco");

  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await sessionRpc(viewer.session, "ldo_support_oauth_begin", { p_state_hash: sha256Hex(state) });
  const response = NextResponse.redirect(gmailAuthorizeUrl(state, challenge), 303);
  response.cookies.set(GMAIL_OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/support/gmail", maxAge: 600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
