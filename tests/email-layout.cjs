const { test } = require("node:test");
const assert = require("node:assert/strict");
const mail = require("../.test-build/email-layout.js");

test("Branded emails escape every text and keep links clickable but safe", () => {
  const html = mail.brandEmail({
    baseUrl: "https://dash.example", eyebrow: "Chat", title: "<b>Olá</b>", preheader: "x\"y",
    body: mail.emailQuote("Bárbara · Loja do Ouro", "Veja: https://www.lojadoouro.pt/products/anel?x=1&y=2.\n<script>alert(1)</script>"),
    button: { label: "Abrir", url: "https://www.lojadoouro.pt/?chat=abrir&a=\"1\"" }, footer: "Rodapé",
  });
  assert.match(html, /&lt;b&gt;Olá&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<a href="https:\/\/www\.lojadoouro\.pt\/products\/anel\?x=1&amp;y=2"/);
  assert.match(html, /y=2<\/a>\./, "trailing punctuation stays outside the link");
  assert.match(html, /href="https:\/\/www\.lojadoouro\.pt\/\?chat=abrir&amp;a=&quot;1&quot;"/);
  assert.match(html, /https:\/\/dash\.example\/logo-loja-do-ouro\.png/);
});

test("Only http(s) addresses become links", () => {
  assert.equal(mail.linkedText("javascript:alert(1) e ftp://x"), "javascript:alert(1) e ftp://x");
  assert.equal(mail.linkedText("a & b"), "a &amp; b");
});
