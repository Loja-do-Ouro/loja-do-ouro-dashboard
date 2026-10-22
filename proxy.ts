import { NextRequest, NextResponse } from "next/server";
import { auctionHostRoute, isAuctionHost } from "@/lib/leilao-site-rules";
import { authConfigured, SESSION_COOKIE } from "@/lib/session";

// /acesso: link do email para criar a palavra-passe (o token vai no corpo do pedido e é verificado na BD).
const PUBLIC_PATHS = ["/login", "/acesso", "/api/auth/login", "/api/auth/logout"];

// Sends visitors without a session to the login. The session itself and the
// permissions are checked by each page and action in Supabase, never only here.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Leilão (leilao.lojadoouro.pt): só o site público, servido a partir de /l; o dashboard não existe nesse domínio.
  if (isAuctionHost(request.headers.get("host"))) {
    const route = auctionHostRoute(path);
    if (!route) return NextResponse.next();
    const url = request.nextUrl.clone();
    if ("redirect" in route) {
      url.pathname = route.redirect;
      return NextResponse.redirect(url, 308);
    }
    url.pathname = route.rewrite;
    return NextResponse.rewrite(url);
  }
  // O mesmo site no endereço do dashboard (/l), enquanto o domínio não está ligado: contas próprias, sem a sessão da equipa.
  if (path === "/l" || path.startsWith("/l/") || path.startsWith("/api/l/")) return NextResponse.next();

  if (!authConfigured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Dashboard protection is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (path.startsWith("/api/cron/")) return NextResponse.next();
  // Webhooks das plataformas: validam a própria assinatura (WhatsApp ainda por configurar).
  if (path.startsWith("/api/support/webhooks/")) return NextResponse.next();
  // Imagens de respostas Facebook/Instagram: token aleatório de 32 bytes, válido 1 hora (a Meta vai buscá-las).
  if (path.startsWith("/api/support/media/")) return NextResponse.next();
  // Chat do site (botão no tema Shopify): token próprio de cada visitante, origens e limites na BD.
  if (path.startsWith("/api/chat/")) return NextResponse.next();
  // Código do widget do chat, carregado pelo tema da loja (ficheiro público, sem dados).
  if (path.startsWith("/site-chat/")) return NextResponse.next();
  // Private Selection (página reservada no tema Shopify): pedido de acesso, entrada e sessão da loja; origens,
  // senha e limites verificados nas rotas e na BD. A página da equipa (/private-selection) continua protegida.
  if (path.startsWith("/api/private-selection/")) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = new URL("/login", request.url);
  const redirect = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (redirect !== "/" && redirect.startsWith("/") && !redirect.startsWith("//")) login.searchParams.set("redirect", redirect);
  return NextResponse.redirect(login);
}

// Ícones da janela (app/favicon.ico, app/apple-icon.png) e logótipos: públicos, também na página de entrada e nos
// emails aos clientes (Loja do Ouro e Gold Store Premium).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|logo-loja-do-ouro.png|logo-gold-store-premium.png|emblema-loja-do-ouro.png).*)"],
};
