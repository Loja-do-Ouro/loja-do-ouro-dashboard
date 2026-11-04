// Site dos criadores: encaminhamento por host, separação de origens [rev. S-M4], cookie e origem dos POST [rev. S-B1],
// CSP do site e cabeçalhos anti-iframe do dashboard (next.config.mjs).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const r = require("../.test-build/criadores-site-rules.js");

const ROOT = path.join(__dirname, "..");
const SITE = "https://criadores.lojadoouro.pt";
const DASH = "https://loja-do-ouro-dashboard.vercel.app";

test("criadores.* is served from /c and the dashboard does not exist there", () => {
  assert.equal(r.isCreatorsHost("criadores.lojadoouro.pt"), true);
  assert.equal(r.isCreatorsHost("CRIADORES.lojadoouro.pt"), true);
  assert.equal(r.isCreatorsHost("loja-do-ouro-dashboard.vercel.app"), false);
  assert.equal(r.isCreatorsHost("leilao.lojadoouro.pt"), false);
  assert.equal(r.isCreatorsHost(null), false);
  assert.equal(r.creatorsSiteBaseFor("criadores.lojadoouro.pt"), "");
  assert.equal(r.creatorsSiteBaseFor("loja-do-ouro-dashboard.vercel.app"), "/c");
  assert.deepEqual(r.creatorsHostRoute("/"), { rewrite: "/c" });
  assert.deepEqual(r.creatorsHostRoute("/conta/entrar"), { rewrite: "/c/conta/entrar" });
  // /admin, /influenciadores e /api/auth/* do dashboard passam a caminhos do site (404 do site).
  assert.deepEqual(r.creatorsHostRoute("/admin"), { rewrite: "/c/admin" });
  assert.deepEqual(r.creatorsHostRoute("/influenciadores"), { rewrite: "/c/influenciadores" });
  assert.deepEqual(r.creatorsHostRoute("/api/auth/login"), { rewrite: "/c/api/auth/login" });
  assert.deepEqual(r.creatorsHostRoute("/c/x"), { redirect: "/x" });
  assert.deepEqual(r.creatorsHostRoute("/c"), { redirect: "/" });
  assert.equal(r.creatorsHostRoute("/api/c/export"), null);
  assert.equal(r.creatorsHostRoute("/api/c/meta/callback"), null);
  assert.equal(r.creatorsHostRoute("/_next/static/x.js"), null);
  // /conta (página do site) não é confundida com /c/.
  assert.deepEqual(r.creatorsHostRoute("/conta"), { rewrite: "/c/conta" });
});

test("[S-M4] with CREATORS_URL the dashboard redirects /c and only lets the tick through /api/c", () => {
  assert.deepEqual(r.dashboardCreatorsRoute("/c/campanhas", "?x=1", SITE), { redirect: `${SITE}/campanhas?x=1` });
  assert.deepEqual(r.dashboardCreatorsRoute("/c", "", SITE), { redirect: `${SITE}/` });
  assert.deepEqual(r.dashboardCreatorsRoute("/c/", "", SITE), { redirect: `${SITE}/` });
  assert.deepEqual(r.dashboardCreatorsRoute("/c/conta/entrar", "", `${SITE}/`), { redirect: `${SITE}/conta/entrar` });
  // Um caminho com duas barras nunca muda de domínio.
  assert.equal(new URL(r.dashboardCreatorsRoute("/c//evil.example/x", "", SITE).redirect).host, "criadores.lojadoouro.pt");
  assert.deepEqual(r.dashboardCreatorsRoute("/api/c/tick", "", SITE), { pass: true });
  for (const p of ["/api/c/export", "/api/c/upload", "/api/c/meta/callback", "/api/c/meta/connect", "/api/c/ficheiros/1", "/api/c", "/api/c/tick/x"])
    assert.deepEqual(r.dashboardCreatorsRoute(p, "", SITE), { notFound: true }, p);
  // O dashboard continua igual: /conta, /api/cron/*, /api/chat/*, /campanhas do admin.
  for (const p of ["/conta", "/", "/api/cron/x", "/api/chat/x", "/admin/campanhas", "/campanhas", "/l/x", "/influenciadores"])
    assert.equal(r.dashboardCreatorsRoute(p, "", SITE), null, p);
});

test("[S-M4] without CREATORS_URL /c is served on the dashboard only for internal tests", () => {
  for (const url of [undefined, null, "", "   ", "criadores.lojadoouro.pt", "ftp://criadores.lojadoouro.pt", "http://criadores.lojadoouro.pt", "javascript:alert(1)"]) {
    assert.deepEqual(r.dashboardCreatorsRoute("/c/campanhas", "?x=1", url), { pass: true }, String(url));
    assert.deepEqual(r.dashboardCreatorsRoute("/api/c/export", "", url), { pass: true }, String(url));
  }
  assert.equal(r.dashboardCreatorsRoute("/conta", "", undefined), null);
  // Inscrições e emails parados em produção sem CREATORS_URL, sem token de servidor ou sem chave da cifra.
  const all = { production: true, creatorsUrl: SITE, hasServerToken: true, hasEncryptionKey: true };
  assert.equal(r.creatorsReady(all), true);
  assert.equal(r.creatorsReady({ ...all, creatorsUrl: undefined }), false);
  assert.equal(r.creatorsReady({ ...all, creatorsUrl: "http://criadores.lojadoouro.pt" }), false);
  assert.equal(r.creatorsReady({ ...all, hasServerToken: false }), false);
  assert.equal(r.creatorsReady({ ...all, hasEncryptionKey: false }), false);
  // Testes locais: sem domínio próprio, mas com as chaves.
  assert.equal(r.creatorsReady({ ...all, production: false, creatorsUrl: undefined }), true);
  assert.equal(r.creatorsReady({ ...all, production: false, hasServerToken: false }), false);
});

test("CREATORS_URL is reduced to its https origin", () => {
  assert.equal(r.creatorsOrigin(SITE), SITE);
  assert.equal(r.creatorsOrigin(`${SITE}/`), SITE);
  assert.equal(r.creatorsOrigin(`${SITE}/qualquer/coisa?x=1`), SITE);
  assert.equal(r.creatorsOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(r.creatorsOrigin("http://criadores.lojadoouro.pt"), null);
  assert.equal(r.creatorsOrigin("https://user:pw@criadores.lojadoouro.pt"), null);
  assert.equal(r.creatorsOrigin("nada"), null);
  assert.equal(r.creatorsSiteUrl(SITE, DASH), SITE);
  assert.equal(r.creatorsSiteUrl(undefined, `${DASH}/`), `${DASH}/c`);
});

test("return path after login stays on the creators site", () => {
  assert.equal(r.safeNext("/campanhas/outono", ""), "/campanhas/outono");
  assert.equal(r.safeNext("/c/campanhas", "/c"), "/c/campanhas");
  assert.equal(r.safeNext("//evil.com", ""), "/painel");
  assert.equal(r.safeNext("//evil.com", "/c"), "/c/painel");
  assert.equal(r.safeNext("https://evil.com", ""), "/painel");
  assert.equal(r.safeNext(`/${String.fromCharCode(92)}evil.com`, ""), "/painel");
  assert.equal(r.safeNext("/x".repeat(200), ""), "/painel");
  assert.equal(r.safeNext(undefined, "/c"), "/c/painel");
  assert.equal(r.safeNext(42, ""), "/painel");
  // Caracteres de controlo a meio: o browser apaga-os ao ler o Location e «/\t/evil.com» passaria a «//evil.com».
  assert.equal(r.safeNext("/\t/evil.com", ""), "/painel");
  assert.equal(r.safeNext("/\n/evil.com", "/c"), "/c/painel");
  assert.equal(r.safeNext(decodeURIComponent("/%09/evil.com"), ""), "/painel");
  assert.equal(r.safeNext("/\r\n/evil.com", ""), "/painel");
  assert.equal(r.safeNext("/a b", ""), "/painel");
  assert.equal(r.safeNext("/campanhas?x=1#topo", ""), "/campanhas?x=1#topo");
});

test("[S-B1] session cookie name and options", () => {
  assert.equal(r.creatorCookieName(true), "__Host-ldo_criador");
  assert.equal(r.creatorCookieName(false), "ldo_criador");
  const prod = r.creatorCookieOptions(true);
  // __Host- exige secure, path=/ e nenhum Domain.
  assert.equal(prod.secure, true);
  assert.equal(prod.path, "/");
  assert.equal(prod.httpOnly, true);
  assert.equal(prod.sameSite, "lax");
  assert.equal("domain" in prod, false);
  assert.equal(prod.maxAge, 14 * 24 * 3600);
  assert.equal(r.creatorCookieOptions(false).secure, false);
  assert.equal(r.isCreatorSessionToken("a".repeat(64)), true);
  assert.equal(r.isCreatorSessionToken("A".repeat(64)), false);
  assert.equal(r.isCreatorSessionToken("a".repeat(63)), false);
  assert.equal(r.isCreatorSessionToken(undefined), false);
});

test("[S-B1] browser POSTs to /api/c/* must come from the creators site", () => {
  const req = (origin, url = `${SITE}/api/c/export`) => ({ url, headers: { get: (k) => (k.toLowerCase() === "origin" ? origin : null) } });
  assert.equal(r.sameOriginPost(req(SITE), SITE), null);
  for (const bad of ["https://www.lojadoouro.pt", "https://leilao.lojadoouro.pt", "null", "", null, DASH, `${SITE}.evil.com`, "http://criadores.lojadoouro.pt", `${SITE}/x`]) {
    const res = r.sameOriginPost(req(bad), SITE);
    assert.ok(res instanceof Response, String(bad));
    assert.equal(res.status, 403, String(bad));
  }
  // Antes do DNS: vale a origem do próprio pedido (o /c do dashboard).
  assert.equal(r.sameOriginPost(req(DASH, `${DASH}/api/c/export`), undefined), null);
  assert.equal(r.sameOriginPost(req(SITE, `${DASH}/api/c/export`), undefined).status, 403);
  // Com CREATORS_URL, a origem do pedido não conta.
  assert.equal(r.sameOriginPost(req(DASH, `${DASH}/api/c/export`), SITE).status, 403);
  assert.equal(r.sameOriginAllowed(SITE, `${SITE}/`, `${SITE}/api/c/export`), true);
});

test("[S-M4] creators CSP carries the nonce, forbids framing and keeps the Meta form targets", () => {
  const csp = r.creatorsCsp("abc123==");
  assert.match(csp, /script-src 'self' 'nonce-abc123==' 'strict-dynamic'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self' https:\/\/www\.facebook\.com https:\/\/m\.facebook\.com https:\/\/www\.instagram\.com/);
  assert.doesNotMatch(csp, /unsafe-(eval|inline)/);
  assert.match(r.creatorsCsp("n", true), /'unsafe-eval'/);
  assert.equal(r.CREATORS_SECURITY_HEADERS["X-Frame-Options"], "DENY");
  const a = r.makeNonce();
  const b = r.makeNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  assert.equal(r.makeNonce((u) => u.fill(0)), "AAAAAAAAAAAAAAAAAAAAAA==");
});

test("[S-M4] proxy.ts wires the creators host and the dashboard redirect before the team login", () => {
  const src = fs.readFileSync(path.join(ROOT, "proxy.ts"), "utf8");
  assert.match(src, /from "@\/lib\/criadores-site-rules"/);
  assert.match(src, /isCreatorsHost\(request\.headers\.get\("host"\)\)/);
  assert.match(src, /dashboardCreatorsRoute\(path, request\.nextUrl\.search, process\.env\.CREATORS_URL\)/);
  assert.match(src, /NextResponse\.redirect\(creators\.redirect, 308\)/);
  assert.match(src, /status: 404/);
  // As duas decisões vêm antes da verificação do cookie da equipa (o site não usa ldo_session).
  const creatorsAt = src.indexOf("dashboardCreatorsRoute(path");
  assert.ok(creatorsAt > 0 && creatorsAt < src.indexOf("authConfigured()"));
  assert.ok(src.indexOf("isCreatorsHost(") < src.indexOf("authConfigured()"));
  // O nonce vai no pedido (o Next lê-o da CSP) e na resposta.
  assert.match(src, /headers\.set\("x-nonce", nonce\)/);
  assert.match(src, /headers\.set\("Content-Security-Policy", csp\)/);
  assert.match(src, /response\.headers\.set\("Content-Security-Policy", csp\)/);
});

test("[S-M4] the dashboard cannot be framed (next.config.mjs headers)", async () => {
  const config = (await import(pathToFileURL(path.join(ROOT, "next.config.mjs")).href)).default;
  const rules = await config.headers();
  const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
  const headersFor = (p, host = "loja-do-ouro-dashboard.vercel.app") => {
    const out = {};
    for (const rule of rules) {
      const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true, regexModifier: (x) => x });
      if (!match(p)) continue;
      const hostBlocked = (rule.missing || []).some((m) => m.type === "host" && new RegExp(`^${m.value}$`).test(host));
      if (hostBlocked) continue;
      for (const h of rule.headers) out[h.key] = h.value;
    }
    return out;
  };
  for (const p of ["/", "/login", "/conta", "/influenciadores", "/admin/utilizadores", "/leilao", "/apoio"]) {
    assert.equal(headersFor(p)["X-Frame-Options"], "DENY", p);
    assert.equal(headersFor(p)["Content-Security-Policy"], "frame-ancestors 'none'", p);
  }
  // As rotas de ficheiros guardam a sua própria CSP (sandbox); a pré-visualização de PDF do apoio pode ser
  // emoldurada pelo próprio dashboard.
  assert.equal(headersFor("/api/chat/attachments")["Content-Security-Policy"], undefined);
  assert.equal(headersFor("/api/chat/attachments")["X-Frame-Options"], "DENY");
  assert.deepEqual(headersFor("/api/support/attachments"), {});
  // /c no dashboard (antes do DNS) recebe a CSP com nonce do proxy, não esta.
  assert.equal(headersFor("/c/conta")["Content-Security-Policy"], undefined);
  assert.equal(headersFor("/c")["Content-Security-Policy"], undefined);
  // No host criadores.* manda o proxy.ts.
  assert.deepEqual(headersFor("/", "criadores.lojadoouro.pt"), {});
  // A cache do widget do chat continua.
  assert.match(headersFor("/site-chat/ldo-chat.js")["Cache-Control"], /max-age=300/);
});
