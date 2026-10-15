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

test("By default the email is in Portuguese with the Loja do Ouro logo (reports and staff emails unchanged)", () => {
  const html = mail.brandEmail({ baseUrl: "https://dash.example", eyebrow: "Relatório", title: "Fecho", body: "", footer: "Rodapé" });
  assert.match(html, /^<!doctype html><html lang="pt-PT">/);
  assert.ok(html.includes('<tr><td align="center" style="padding:24px 24px 12px"><img src="https://dash.example/logo-loja-do-ouro.png" alt="Loja do Ouro" width="170" style="display:block;width:170px;height:auto;border:0"></td></tr>'));
});

test("Emails for Gold Store Premium customers carry their language, logo and brand", () => {
  const html = mail.brandEmail({
    baseUrl: "https://dash.example", eyebrow: "Chat", title: "Hi", body: "", footer: "x",
    lang: "en-GB", logo: "https://dash.example/logo-gold-store-premium.png", logoAlt: "Gold Store Premium", logoWidth: 200,
  });
  assert.match(html, /<html lang="en-GB">/);
  assert.ok(html.includes('<img src="https://dash.example/logo-gold-store-premium.png" alt="Gold Store Premium" width="200" style="display:block;width:200px;'));
  assert.doesNotMatch(html, /Loja do Ouro|logo-loja-do-ouro/);
  // Sem imagem: o nome da marca em texto.
  const word = mail.brandEmail({ baseUrl: "https://dash.example", eyebrow: "Chat", title: "Hi", body: "", footer: "x", logo: null, logoAlt: "Gold <Store>", lang: "\"de" });
  assert.doesNotMatch(word, /<img /);
  assert.match(word, /Gold &lt;Store&gt;<\/div>/);
  assert.match(word, /<html lang="&quot;de">/);
});

test("Only http(s) addresses become links", () => {
  assert.equal(mail.linkedText("javascript:alert(1) e ftp://x"), "javascript:alert(1) e ftp://x");
  assert.equal(mail.linkedText("a & b"), "a &amp; b");
});

test("An emoji right after a link stays outside it", () => {
  assert.match(mail.linkedText("https://x.pt/a😍"), /^<a href="https:\/\/x\.pt\/a"[^>]*>https:\/\/x\.pt\/a<\/a>😍$/u);
  for (const e of ["👍🏼", "❤️", "👩‍💼", "🇵🇹", "✨"]) assert.match(mail.linkedText(`Veja https://x.pt/anel${e} obrigado`), new RegExp(`href="https://x\\.pt/anel"[^>]*>https://x\\.pt/anel</a>${e}`, "u"), e);
  assert.match(mail.linkedText("https://pt.wikipedia.org/wiki/Coração"), /href="https:\/\/pt\.wikipedia\.org\/wiki\/Coração"/);
});

test("Text written by customers never becomes clickable links in our emails", () => {
  const row = mail.emailQuote("Ana", "Confirme em https://evil.example/pt <b>já</b>", { links: false });
  assert.doesNotMatch(row, /<a /);
  assert.match(row, /https:\/\/evil\.example\/pt &lt;b&gt;já&lt;\/b&gt;/);
  assert.match(mail.emailQuote("Bárbara", "Veja https://www.lojadoouro.pt"), /<a href="https:\/\/www\.lojadoouro\.pt"/);
});
