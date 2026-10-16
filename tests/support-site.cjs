const { test } = require("node:test");
const assert = require("node:assert/strict");
const site = require("../.test-build/support/site-rules.js");

test("Only the store sites (and the dashboard itself) may use the chat", () => {
  const allowed = site.parseOrigins(undefined);
  assert.deepEqual(allowed, site.DEFAULT_ORIGINS);
  assert.equal(site.allowedOrigin("https://www.lojadoouro.pt", allowed, "https://dash.example"), "https://www.lojadoouro.pt");
  assert.equal(site.allowedOrigin("https://LOJADOOURO.PT", allowed, "https://dash.example"), "https://LOJADOOURO.PT");
  assert.equal(site.allowedOrigin("https://dash.example", allowed, "https://dash.example"), "https://dash.example");
  assert.equal(site.allowedOrigin("https://evil.example", allowed, "https://dash.example"), null);
  assert.equal(site.allowedOrigin("https://www.lojadoouro.pt.evil.example", allowed, "https://dash.example"), null);
  // Fora de Portugal a loja é a Gold Store Premium (goldstorepremium.com): o chat também funciona lá.
  assert.equal(site.allowedOrigin("https://www.goldstorepremium.com", allowed, "https://dash.example"), "https://www.goldstorepremium.com");
  assert.equal(site.allowedOrigin("https://goldstorepremium.com", allowed, "https://dash.example"), "https://goldstorepremium.com");
  assert.equal(site.allowedOrigin("https://www.goldstorepremium.com.evil.example", allowed, "https://dash.example"), null);
  assert.equal(site.allowedOrigin(null, allowed, "https://dash.example"), null);
  // Lista própria: só https, sem barras finais; valores inválidos são ignorados.
  assert.deepEqual(site.parseOrigins("https://a.pt/, http://b.pt, javascript:x, https://c.pt:8443"), ["https://a.pt", "https://c.pt:8443"]);
  assert.deepEqual(site.parseOrigins("lixo"), site.DEFAULT_ORIGINS);
});

test("A logged-in customer's email is confirmed only with a valid, recent theme signature", () => {
  const secret = "segredo-de-teste";
  const now = 1_791_400_000_000;
  const ts = String(Math.floor(now / 1000) - 60);
  const sig = site.identitySignature("cliente@exemplo.pt", ts, secret);
  assert.equal(site.verifyIdentity({ email: "Cliente@Exemplo.pt ", ts, sig }, secret, now), "cliente@exemplo.pt");
  // Assinatura de outro email, segredo errado, sem segredo, expirada ou do futuro: não confirma.
  assert.equal(site.verifyIdentity({ email: "outro@exemplo.pt", ts, sig }, secret, now), null);
  assert.equal(site.verifyIdentity({ email: "cliente@exemplo.pt", ts, sig }, "outro", now), null);
  assert.equal(site.verifyIdentity({ email: "cliente@exemplo.pt", ts, sig }, undefined, now), null);
  const old = String(Math.floor(now / 1000) - site.IDENTITY_MAX_AGE_S - 10);
  assert.equal(site.verifyIdentity({ email: "cliente@exemplo.pt", ts: old, sig: site.identitySignature("cliente@exemplo.pt", old, secret) }, secret, now), null);
  const future = String(Math.floor(now / 1000) + 3600);
  assert.equal(site.verifyIdentity({ email: "cliente@exemplo.pt", ts: future, sig: site.identitySignature("cliente@exemplo.pt", future, secret) }, secret, now), null);
  assert.equal(site.verifyIdentity({ email: "cliente@exemplo.pt", ts, sig: "zz" }, secret, now), null);
  assert.equal(site.verifyIdentity(null, secret, now), null);
  assert.equal(site.verifyIdentity("texto", secret, now), null);
});

test("Emails and pages from the widget are validated", () => {
  assert.equal(site.isEmail("a@b.pt"), true);
  assert.equal(site.isEmail("a@b"), false);
  assert.equal(site.isEmail("a b@c.pt"), false);
  assert.equal(site.isEmail(42), false);
  const allowed = site.DEFAULT_ORIGINS;
  assert.equal(site.cleanPage("https://www.lojadoouro.pt/products/anel?utm_source=x#y", allowed), "https://www.lojadoouro.pt/products/anel");
  assert.equal(site.cleanPage("https://www.goldstorepremium.com/es/products/anel?utm_source=x", allowed), "https://www.goldstorepremium.com/es/products/anel");
  assert.equal(site.cleanPage("https://evil.example/x", allowed), null);
  assert.equal(site.cleanPage("não é url", allowed), null);
});

test("The cart sent by the browser is reduced to short, valid data", () => {
  const cart = site.cleanCart({
    count: 2, total: 449.9, currency: "EUR",
    items: [
      { title: "Anel em ouro 19,2k\u0007", variant: "T14", quantity: 1, price: 399.9, url: "/products/anel-ouro?variant=123" },
      { title: "Fio", variant: null, quantity: 1, price: 50, url: "javascript:alert(1)" },
      { title: "", quantity: 1, price: 1 },
      { title: "Sem preço", quantity: 1, price: "x" },
    ],
  });
  assert.deepEqual(cart, {
    count: 2, total: 449.9, currency: "EUR",
    items: [
      { title: "Anel em ouro 19,2k", variant: "T14", quantity: 1, price: 399.9, url: "/products/anel-ouro?variant=123" },
      { title: "Fio", variant: null, quantity: 1, price: 50, url: null },
    ],
  });
  assert.equal(site.cleanCart(null), null);
  assert.equal(site.cleanCart({ count: -1, total: 0, items: [] }), null);
  assert.equal(site.cleanCart({ count: 1, total: 10, items: "x" }), null);
  assert.equal(site.cleanCart({ count: 0, total: 0, currency: "eur", items: [] }).currency, "EUR");
});

test("Abuse limits group visitors by network and the identity header is decoded safely", () => {
  assert.equal(site.ipPrefix("85.240.12.34"), "85.240.12.0/24");
  assert.equal(site.ipPrefix("2001:db8:1234:5678:9abc::1"), "2001:db8:1234:5678::/64");
  assert.equal(site.ipPrefix("unknown"), "unknown");
  const header = Buffer.from(JSON.stringify({ email: "a@b.pt", ts: "1", sig: "x" })).toString("base64");
  assert.deepEqual(site.decodeIdentity(header), { email: "a@b.pt", ts: "1", sig: "x" });
  assert.equal(site.decodeIdentity("não-é-base64-json"), null);
  assert.equal(site.decodeIdentity(null), null);
});

test("The brand follows the domain the customer is on (Shopify picks it by country)", () => {
  assert.equal(site.siteFor({ host: "www.lojadoouro.pt" }), "ldo");
  assert.equal(site.siteFor({ host: "lojadoouro.pt", country: "ES" }), "ldo", "lojadoouro.pt is always Loja do Ouro");
  assert.equal(site.siteFor({ host: "www.goldstorepremium.com" }), "gsp");
  assert.equal(site.siteFor({ host: "https://goldstorepremium.com" }), "gsp", "an Origin works too");
  assert.equal(site.siteFor({ host: "https://www.goldstorepremium.com/pt-pt/products/anel" }), "gsp");
  assert.equal(site.siteFor({ host: "WWW.GOLDSTOREPREMIUM.COM:443", country: "PT" }), "gsp");
  assert.equal(site.siteFor({ host: "www.goldstorepremium.com.evil.example" }), "ldo");
  // Pré-visualização do tema: Loja do Ouro, a não ser que o país da loja não seja Portugal.
  assert.equal(site.siteFor({ host: "lojadoouro-online.myshopify.com" }), "ldo");
  assert.equal(site.siteFor({ host: "lojadoouro-online.myshopify.com", country: "PT" }), "ldo");
  assert.equal(site.siteFor({ host: "https://lojadoouro-online.myshopify.com", country: "DE" }), "gsp");
  assert.equal(site.siteFor({ host: "lojadoouro-online.myshopify.com", country: "de" }), "ldo", "invalid country is ignored");
  assert.equal(site.siteFor({ host: "www.lojadoouro.pt", country: "DE" }), "ldo");
  assert.equal(site.siteFor({ host: null }), "ldo");
  assert.equal(site.siteFor({ host: "https://dash.example" }), "ldo");
  assert.equal(site.isSite("gsp"), true);
  assert.equal(site.isSite("GSP"), false);
  assert.equal(site.cleanCountry("ES"), "ES");
  assert.equal(site.cleanCountry("es"), null);
  assert.equal(site.cleanCountry("ESP"), null);
  assert.equal(site.cleanCountry(42), null);
});

test("Languages are normalised to pt, en, es, fr or de (anything else is English)", () => {
  assert.deepEqual([...site.SITE_LOCALES], ["pt", "en", "es", "fr", "de"]);
  const cases = [["pt-PT", "pt"], ["pt", "pt"], ["PT_pt", "pt"], ["EN", "en"], ["en-GB", "en"], ["es", "es"], ["es-ES", "es"],
    ["fr", "fr"], ["fr-CA", "fr"], ["de-DE", "de"], ["it", "en"], ["nl-BE", "en"], [" de ", "de"]];
  for (const [v, want] of cases) assert.equal(site.normLocale(v), want, v);
  for (const junk of ["", "x", "123", "pt-", "<script>", "português", null, undefined, 42, {}]) assert.equal(site.normLocale(junk), null, String(junk));
});

test("The page address gives the language when the widget sends none", () => {
  const cases = [
    ["https://www.lojadoouro.pt/", "ldo", "pt"],
    ["https://www.lojadoouro.pt/products/anel", "ldo", "pt"],
    ["https://www.lojadoouro.pt/en/products/x", "ldo", "en"],
    ["https://www.lojadoouro.pt/es", "ldo", "es"],
    ["https://www.lojadoouro.pt/fr/collections/aneis", "ldo", "fr"],
    ["https://www.lojadoouro.pt/de/", "ldo", "de"],
    ["https://www.lojadoouro.pt/endereco", "ldo", "pt"],
    ["https://www.goldstorepremium.com/", "gsp", "en"],
    ["https://www.goldstorepremium.com/products/ring", "gsp", "en"],
    ["https://www.goldstorepremium.com/pt-pt/", "gsp", "pt"],
    ["https://www.goldstorepremium.com/pt-pt/products/anel", "gsp", "pt"],
    ["https://www.goldstorepremium.com/es/products/anillo", "gsp", "es"],
    ["https://dash.example/apoio/chat-teste", "gsp", "en"],
  ];
  for (const [url, s, want] of cases) assert.equal(site.localeFromPage(url, s), want, url);
  assert.equal(site.localeFromPage(null, "ldo"), null);
  assert.equal(site.localeFromPage("não é url", "gsp"), null);
});

test("Each site has its own start page per language (missing languages go to the root)", () => {
  assert.equal(site.siteRoot("ldo", "pt"), "https://www.lojadoouro.pt/");
  assert.equal(site.siteRoot("ldo", "en"), "https://www.lojadoouro.pt/en/");
  assert.equal(site.siteRoot("ldo", "de"), "https://www.lojadoouro.pt/de/");
  assert.equal(site.siteRoot("ldo", null), "https://www.lojadoouro.pt/");
  assert.equal(site.siteRoot("gsp", "en"), "https://www.goldstorepremium.com/");
  assert.equal(site.siteRoot("gsp", "es"), "https://www.goldstorepremium.com/es/");
  assert.equal(site.siteRoot("gsp", "pt"), "https://www.goldstorepremium.com/pt-pt/");
  assert.equal(site.siteRoot("gsp", "fr"), "https://www.goldstorepremium.com/");
  assert.equal(site.siteRoot("gsp", "de"), "https://www.goldstorepremium.com/");
  assert.equal(site.siteRoot("gsp", undefined), "https://www.goldstorepremium.com/");
  assert.equal(site.siteRoot("ldo", "es", "https://staging.example/"), "https://staging.example/es/");
  assert.equal(site.SITES.ldo.brand, "Loja do Ouro");
  assert.equal(site.SITES.gsp.brand, "Gold Store Premium");
  assert.equal(site.SITES.gsp.domain, "goldstorepremium.com");
});

// Mensagens de erro das rotas do chat (ChatError) e das funções do chat na BD (raise exception).
function chatErrorMessages() {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const out = new Set();
  const routes = fs.readdirSync(path.join(root, "app/api/chat")).map((d) => path.join(root, "app/api/chat", d, "route.ts"));
  for (const file of [...routes, path.join(root, "lib/support/site-chat.ts")]) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/new ChatError\(\d+, "([^"]+)"/g)) out.add(m[1]);
  }
  const dir = path.join(root, "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const parts = fs.readFileSync(path.join(dir, f), "utf8").split(/create (?:or replace )?function /i).slice(1);
    for (const fn of parts.filter((p) => /^(public\.ldo_support_site_|ldo_private\.site_visitor\b)/.test(p))) {
      for (const m of fn.split("$$;")[0].matchAll(/raise exception '([^']+)'/g)) out.add(m[1]);
    }
  }
  return [...out];
}

test("Every error the visitor can see has a stable code for the widget to translate", () => {
  const messages = chatErrorMessages();
  assert.ok(messages.length >= 12, `found ${messages.length}`);
  for (const m of messages) assert.notEqual(site.errorCode(m), "unknown", m);
  for (const m of [site.CHAT_UNAVAILABLE, "Sem permissão."]) assert.equal(site.errorCode(m), "chat_unavailable", m);
  const expected = {
    "Origem não autorizada.": "origin_not_allowed",
    "Sessão do chat inválida. Inicie uma nova conversa.": "session_invalid",
    "Esta conversa já não está disponível. Inicie uma nova.": "conversation_unavailable",
    "Pedido demasiado grande.": "request_too_large",
    "Pedido inválido.": "invalid_request",
    "Indique o seu nome.": "name_required",
    "Indique um email válido.": "email_invalid",
    "Escreva a sua mensagem.": "message_required",
    "Mensagem demasiado longa (máximo 2000 caracteres).": "message_too_long",
    "Demasiadas conversas iniciadas. Tente novamente mais tarde.": "too_many_chats",
    "Enviou muitas mensagens seguidas. Aguarde um pouco.": "too_many_messages",
    "O chat está indisponível de momento.": "chat_unavailable",
  };
  for (const [m, code] of Object.entries(expected)) assert.equal(site.errorCode(m), code, m);
  assert.equal(site.errorCode("Outra coisa qualquer."), "unknown");
  assert.equal(site.errorCode("constructor"), "unknown");
  assert.equal(site.errorCode(null), "unknown");
  for (const code of site.CHAT_ERROR_CODES) assert.match(code, /^[a-z]+(_[a-z]+)*$/);
});
