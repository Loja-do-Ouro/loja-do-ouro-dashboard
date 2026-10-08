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
