// Site dos criadores (criadores.lojadoouro.pt, e /c no endereço do dashboard só para testes internos, antes do DNS):
// encaminhamento por host, CSP do site, cookie de sessão, verificação de origem dos POST e "pronto para abrir".
// Espelho de lib/leilao-site-rules.ts. Sem I/O: as variáveis de ambiente entram por parâmetro (testado em
// tests/criadores-rotas.cjs). Quem lê process.env é o proxy.ts e lib/criadores/site.ts.

// ---------------------------------------------------------------- hosts e endereços

// No domínio próprio as páginas vivem na raiz; no dashboard, debaixo de /c.
export const isCreatorsHost = (host: string | null | undefined) => /^criadores\./i.test((host || "").trim());
export const creatorsSiteBaseFor = (host: string | null | undefined) => (isCreatorsHost(host) ? "" : "/c");

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");

// Origem de CREATORS_URL ("https://criadores.lojadoouro.pt"), ou null se faltar ou não for um endereço https
// (http só em localhost, para testes). Caminhos e barras finais são ignorados.
export function creatorsOrigin(creatorsUrl: string | null | undefined): string | null {
  const raw = (creatorsUrl || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return null;
    if (u.protocol === "https:" || (u.protocol === "http:" && isLocalHost(u.hostname))) return u.origin;
  } catch {
    // inválido
  }
  return null;
}

// Endereço público do site (ligações dos emails): CREATORS_URL ou, antes do DNS, o /c do dashboard.
export function creatorsSiteUrl(creatorsUrl: string | null | undefined, dashboardUrl: string): string {
  return creatorsOrigin(creatorsUrl) || `${dashboardUrl.replace(/\/+$/, "")}/c`;
}

// Pedido no host criadores.* → caminho interno (/c/…) ou endereço a corrigir. null = seguir sem mexer.
// O dashboard não existe nesse host: /admin passa a /c/admin, que dá o 404 do site.
export function creatorsHostRoute(path: string): { rewrite: string } | { redirect: string } | null {
  if (path.startsWith("/api/c/") || path.startsWith("/_next/")) return null;
  // Endereços com /c (os de testes internos): o mesmo sem o prefixo.
  if (path === "/c" || path.startsWith("/c/")) return { redirect: path.slice(2) || "/" };
  return { rewrite: path === "/" ? "/c" : `/c${path}` };
}

export type DashboardCreatorsRoute = { redirect: string } | { notFound: true } | { pass: true } | null;

// Os mesmos caminhos no host do dashboard [rev. S-M4]. O site dos criadores nunca corre na origem do cookie
// ldo_session da equipa:
// - com CREATORS_URL: /c e /c/* → 308 para o domínio próprio (com a query); /api/c/* → 404, salvo /api/c/tick (o
//   URL do pg_cron);
// - sem CREATORS_URL (antes do DNS): /c e /api/c/* seguem, sem a sessão da equipa, só para testes internos (as
//   inscrições e os emails ficam parados: creatorsReady);
// - tudo o resto (incluindo /conta e /api/cron/*) → null: o proxy segue com as regras do dashboard.
export function dashboardCreatorsRoute(path: string, search: string, creatorsUrl: string | null | undefined): DashboardCreatorsRoute {
  const site = path === "/c" || path.startsWith("/c/");
  const api = path === "/api/c" || path.startsWith("/api/c/");
  if (!site && !api) return null;
  const origin = creatorsOrigin(creatorsUrl);
  if (!origin) return { pass: true };
  if (api) return path === "/api/c/tick" ? { pass: true } : { notFound: true };
  // Montado com URL.pathname: um caminho como /c//outro.site nunca muda de domínio.
  const url = new URL(origin);
  url.pathname = path.slice(2) || "/";
  url.search = search && search !== "?" ? search : "";
  return { redirect: url.toString() };
}

// Volta depois de entrar: só caminhos do próprio site, nunca outro domínio. Recusa espaços e caracteres de controlo
// em qualquer ponto (o browser apaga TAB/CR/LF ao ler o Location, e «/<TAB>/evil.com» passaria a «//evil.com») e
// confirma a origem com o parser de URL, como o browser faria.
export function safeNext(value: unknown, base: string): string {
  const fallback = `${base}/painel`;
  const v = typeof value === "string" ? value.trim() : "";
  if (!v.startsWith("/") || v.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(v) || v.length > 300) return fallback;
  try {
    const u = new URL(v, "https://x.invalid");
    if (u.origin !== "https://x.invalid") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- cabeçalhos de segurança do site

// CSP das páginas do site (host criadores.*, e /c no dashboard antes do DNS), com o nonce gerado no proxy por pedido
// (guia content-security-policy do Next 16). form-action inclui a Meta porque /api/c/meta/connect responde 303 para
// o diálogo do Facebook Login (pode passar pelo Facebook móvel ou pelo Instagram) [rev. META-10]. Em desenvolvimento
// o React precisa de 'unsafe-eval'.
export function creatorsCsp(nonce: string, dev = false): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://www.facebook.com https://m.facebook.com https://www.instagram.com",
  ].join("; ");
}

// Cabeçalhos que acompanham a CSP em todas as respostas do site.
export const CREATORS_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// Nonce de 16 bytes aleatórios em base64 (a fonte de aleatoriedade entra por parâmetro para o teste).
export function makeNonce(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ---------------------------------------------------------------- sessão do criador [rev. S-B1]

// Em produção o cookie leva o prefixo __Host- (secure, path=/, sem Domain): www.lojadoouro.pt (Shopify) e
// leilao.lojadoouro.pt não o conseguem criar com Domain=.lojadoouro.pt para prender alguém numa sessão alheia.
// Em desenvolvimento sem HTTPS fica "ldo_criador"; em produção o servidor nunca lê o nome sem prefixo.
export const CREATOR_COOKIE_DEV = "ldo_criador";
export const CREATOR_COOKIE_PROD = "__Host-ldo_criador";
export const creatorCookieName = (production: boolean) => (production ? CREATOR_COOKIE_PROD : CREATOR_COOKIE_DEV);

// Opções do cookie (expira com a sessão: maxAge em segundos, 14 dias por omissão). Nunca leva Domain.
export function creatorCookieOptions(production: boolean, maxAgeSeconds = 14 * 24 * 60 * 60) {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

// Formato do token de sessão do criador (o mesmo que a BD gera).
export const isCreatorSessionToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

// ---------------------------------------------------------------- POST do browser [rev. S-B1]

// O Origin de um POST do browser às rotas /api/c/* (export, meta/connect, pedido de token do upload) tem de ser a
// origem de CREATORS_URL; antes do DNS, a do próprio pedido. "null", vazio ou outro subdomínio da loja → recusado.
// Não se usa no tick, nos callbacks da Meta nem no do Blob (chamadas de servidor com assinatura própria).
export function sameOriginAllowed(origin: string | null | undefined, creatorsUrl: string | null | undefined, requestUrl: string): boolean {
  const o = (origin || "").trim();
  if (!o || o === "null") return false;
  let expected = creatorsOrigin(creatorsUrl);
  if (!expected) {
    try {
      expected = new URL(requestUrl).origin;
    } catch {
      return false;
    }
  }
  let given: string;
  try {
    given = new URL(o).origin;
  } catch {
    return false;
  }
  // O Origin é só esquema://host[:porta]; qualquer outra coisa (caminho, credenciais) não é um Origin válido.
  return given === o.replace(/\/$/, "") && given === expected;
}

type RequestLike = { url: string; headers: { get(name: string): string | null } };

// Para as rotas: devolve a resposta 403 a enviar, ou null se o pedido pode seguir.
export function sameOriginPost(request: RequestLike, creatorsUrl: string | null | undefined): Response | null {
  if (sameOriginAllowed(request.headers.get("origin"), creatorsUrl, request.url)) return null;
  return new Response("Pedido recusado.", { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

// ---------------------------------------------------------------- pronto para abrir [rev. S-M4]

// Inscrições e emails só com o site no domínio próprio e as chaves configuradas. Em produção exige CREATORS_URL
// (https), CREATORS_SERVER_TOKEN e CREATORS_ENCRYPTION_KEY; fora de produção (testes locais em /c) dispensa só o
// CREATORS_URL. Dos segredos recebe só se existem, nunca o valor.
export function creatorsReady(env: { production: boolean; creatorsUrl?: string | null; hasServerToken: boolean; hasEncryptionKey: boolean }): boolean {
  if (!env.hasServerToken || !env.hasEncryptionKey) return false;
  return !env.production || creatorsOrigin(env.creatorsUrl) !== null;
}
