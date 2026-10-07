import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { canSupport } from "@/lib/permissions";
import { randomToken, sha256Hex } from "@/lib/support/crypto";
import { sessionRpc } from "@/lib/support/db";
import { authorizeUrl, OAUTH_COOKIE, publicOrigin, zendeskConfigured } from "@/lib/support/zendesk";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";



const back = (request: Request, status: string) => NextResponse.redirect(new URL(`/apoio?zendesk=${status}`, request.url), 303);

// "Ligar Zendesk": formulário POST do próprio dashboard, com sessão e acesso ao Apoio ao Cliente.
// O state (aleatório, uso único, 10 min) fica ligado à pessoa na BD e num cookie httpOnly com o
// verificador PKCE; o callback exige os dois.
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== new URL(request.url).origin))
    return new Response("Pedido recusado.", { status: 403 });
  const viewer = await loadViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login?redirect=/apoio", request.url), 303);
  if (!canSupport(viewer) || viewer.mustChangePassword) return back(request, "sem-acesso");
  if (!zendeskConfigured()) return back(request, "por-configurar");
  // A ligação tem de começar no endereço registado no Zendesk, para o cookie voltar no callback.
  const canonical = publicOrigin(request.url);
  if (new URL(request.url).origin !== canonical) return NextResponse.redirect(new URL("/apoio?zendesk=endereco", canonical), 303);

  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await sessionRpc(viewer.session, "ldo_support_oauth_begin", { p_state_hash: sha256Hex(state) });
  const response = NextResponse.redirect(authorizeUrl(request.url, state, challenge), 303);
  response.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/support/zendesk", maxAge: 600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
