const { test } = require("node:test");
const assert = require("node:assert/strict");
const i18n = require("../.test-build/support/site-i18n.js");
const { SITE_LOCALES } = require("../.test-build/support/site-rules.js");

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const BASE = "https://dash.example";
const LINK = "https://www.lojadoouro.pt/products/anel-ouro?variant=1";
const items = [
  { body: `Bom dia! Veja este anel: ${LINK}`, author: "Bárbara" },
  { body: "E também https://www.lojadoouro.pt/en/collections/aneis.", author: null },
];
const messages = [
  { from: "visitor", author: null, body: "Olá, procuro um anel https://evil.example/x", at: "2026-10-15T10:00:00Z" },
  { from: "notice", author: null, body: "A conversa foi transferida para Ana.", at: "2026-10-15T10:01:00Z", kind: "transfer", to_first: "Ana" },
  { from: "notice", author: null, body: "A conversa foi transferida para outra pessoa da equipa.", at: "2026-10-15T10:01:30Z", kind: "transfer", to_first: null },
  { from: "team", author: "Ana", body: `Temos este: ${LINK}`, at: "2026-10-15T10:02:00Z" },
];
const all = (m) => `${m.subject}\n${m.html}\n${m.text}`;

test("Every language has the same texts and placeholders as Portuguese", () => {
  assert.deepEqual(Object.keys(i18n.SITE_TEXTS).sort(), [...SITE_LOCALES].sort());
  const keys = Object.keys(i18n.SITE_TEXTS.pt).sort();
  for (const l of SITE_LOCALES) {
    const t = i18n.SITE_TEXTS[l];
    assert.deepEqual(Object.keys(t).sort(), keys, l);
    for (const k of keys) {
      assert.equal(typeof t[k], "string", `${l}.${k}`);
      assert.ok(t[k].trim(), `${l}.${k} is empty`);
      assert.equal(placeholders(t[k]), placeholders(i18n.SITE_TEXTS.pt[k]), `${l}.${k}`);
      assert.doesNotMatch(t[k], /Loja do Ouro|Gold Store|lojadoouro|goldstorepremium/, `${l}.${k} must use {brand}/{domain}`);
    }
    assert.match(i18n.INTL[l], new RegExp(`^${l}-[A-Z]{2}$`));
  }
});

test("French uses a non-breaking space before ? ! : ; and German uses the polite Sie form", () => {
  for (const [k, v] of Object.entries(i18n.SITE_TEXTS.fr)) {
    assert.doesNotMatch(v, /[^\u00a0][?!:;]/, `fr.${k}`);
    assert.doesNotMatch(v, /^[?!:;]/, `fr.${k}`);
  }
  for (const [k, v] of Object.entries(i18n.SITE_TEXTS.de)) assert.doesNotMatch(v, /\b(du|dich|dir|dein\w*|euch|euer)\b/i, `de.${k}`);
});

test("Gold Store Premium emails never mention Loja do Ouro (only the sender address is ours)", () => {
  for (const locale of SITE_LOCALES) {
    for (const mail of [
      i18n.replyEmail({ site: "gsp", locale, country: "ES", name: "María José", items }, BASE),
      i18n.replyEmail({ site: "gsp", locale, name: "", items: items.slice(0, 1) }, BASE, "https://staging.example"),
      i18n.transcriptEmail({ site: "gsp", locale, country: "DE", name: "Hans", messages }, BASE),
    ]) {
      assert.doesNotMatch(all(mail), /Loja do Ouro|lojadoouro\.pt|logo-loja-do-ouro/, locale);
      assert.match(mail.html, /Gold Store Premium/);
      assert.match(mail.html, /logo-gold-store-premium\.png/);
      assert.match(mail.html, new RegExp(`<html lang="${i18n.INTL[locale]}">`));
      assert.match(mail.html, /goldstorepremium\.com/);
    }
  }
});

test("Loja do Ouro emails never mention Gold Store Premium", () => {
  for (const locale of [...SITE_LOCALES, null]) {
    for (const mail of [
      i18n.replyEmail({ site: "ldo", locale, name: "Ana Silva", items }, BASE),
      i18n.transcriptEmail({ site: "ldo", locale, name: "Ana", messages }, BASE),
    ]) {
      assert.doesNotMatch(all(mail), /Gold Store|goldstorepremium/i, String(locale));
      assert.match(mail.html, /Loja do Ouro/);
      assert.match(mail.html, /logo-loja-do-ouro\.png/);
    }
  }
});

test("The Portuguese reply email for Loja do Ouro keeps its texts and links", () => {
  const one = i18n.replyEmail({ site: "ldo", locale: null, name: "Ana Silva", items: items.slice(0, 1) }, BASE);
  assert.equal(one.subject, "Resposta da Loja do Ouro à sua mensagem");
  assert.match(one.html, /Olá Ana,/);
  assert.match(one.html, /Respondemos à sua mensagem no chat da Loja do Ouro:/);
  assert.match(one.html, /Bárbara · Loja do Ouro/);
  assert.match(one.html, /href="https:\/\/www\.lojadoouro\.pt\/\?chat=abrir"/);
  assert.match(one.html, /<a href="https:\/\/www\.lojadoouro\.pt\/products\/anel-ouro\?variant=1"/, "links unchanged on Loja do Ouro");
  assert.match(one.html, /Recebeu este email porque falou connosco no chat de lojadoouro\.pt · Loja do Ouro/);
  assert.match(one.text, /\nBárbara · Loja do Ouro:\n/);
  assert.match(one.text, /Continuar a conversa: https:\/\/www\.lojadoouro\.pt\/\?chat=abrir$/);
  const many = i18n.replyEmail({ site: "ldo", locale: "pt", name: "", items }, BASE);
  assert.equal(many.subject, "Novas respostas da Loja do Ouro");
  assert.match(many.html, /Olá,/);
  // SITE_CHAT_URL só muda os links da Loja do Ouro.
  assert.match(i18n.replyEmail({ site: "ldo", locale: "en", name: "A", items }, BASE, "https://staging.example").html, /href="https:\/\/staging\.example\/en\/\?chat=abrir"/);
});

test("Reply emails are in the visitor's language and link to their site and language", () => {
  const en = i18n.replyEmail({ site: "gsp", locale: "en", name: "John Smith", items: items.slice(0, 1) }, BASE);
  assert.equal(en.subject, "Gold Store Premium has replied to your message");
  assert.match(en.html, /Hello John,/);
  assert.match(en.html, /Bárbara · Gold Store Premium/);
  assert.match(en.html, /href="https:\/\/www\.goldstorepremium\.com\/\?chat=abrir"/);
  assert.match(en.html, /<a href="https:\/\/www\.goldstorepremium\.com\/products\/anel-ouro\?variant=1"/);
  const es = i18n.replyEmail({ site: "gsp", locale: "es", name: "María", items }, BASE);
  assert.equal(es.subject, "Nuevas respuestas de Gold Store Premium");
  assert.match(es.html, /Hola, María:/);
  assert.match(es.html, /href="https:\/\/www\.goldstorepremium\.com\/es\/\?chat=abrir"/);
  assert.match(es.html, /https:\/\/www\.goldstorepremium\.com\/es\/collections\/aneis/);
  const fr = i18n.replyEmail({ site: "gsp", locale: "fr", name: "Luc", items: items.slice(0, 1) }, BASE);
  assert.match(fr.html, /href="https:\/\/www\.goldstorepremium\.com\/\?chat=abrir"/, "no French on this domain: root");
  assert.match(fr.text, /Bárbara · Gold Store Premium\u00a0:/);
  const de = i18n.replyEmail({ site: "ldo", locale: "de", name: "Hans", items: items.slice(0, 1) }, BASE);
  assert.equal(de.subject, "Loja do Ouro hat auf Ihre Nachricht geantwortet");
  assert.match(de.html, /href="https:\/\/www\.lojadoouro\.pt\/de\/\?chat=abrir"/);
  const ptGsp = i18n.replyEmail({ site: "gsp", locale: "pt", name: "Rui", items: items.slice(0, 1) }, BASE);
  assert.equal(ptGsp.subject, "Resposta da Gold Store Premium à sua mensagem");
  assert.match(ptGsp.html, /href="https:\/\/www\.goldstorepremium\.com\/pt-pt\/\?chat=abrir"/);
  assert.match(ptGsp.html, /<html lang="pt-PT">/);
});

test("Transcript emails translate transfer notices and dates, and never link customer text", () => {
  const es = i18n.transcriptEmail({ site: "gsp", locale: "es", country: "ES", name: "María José", messages }, BASE);
  assert.equal(es.subject, "Su conversación con Gold Store Premium");
  assert.match(es.html, /La conversación se ha transferido a Ana\./);
  assert.match(es.html, /La conversación se ha transferido a otra persona del equipo\./);
  assert.doesNotMatch(all(es), /A conversa foi transferida/);
  // O separador entre data e hora muda com a versão do ICU do Node (", " no 22, " a las " no 24).
  assert.match(es.html, /María · 15 de octubre de 2026(?:,| a las) 12:00/, "Spain is on Central European time");
  assert.match(es.html, /Ana · Gold Store Premium · 15 de octubre de 2026(?:,| a las) 12:02/);
  assert.doesNotMatch(es.html, /<a href="https:\/\/evil\.example/);
  assert.match(es.html, /href="https:\/\/www\.goldstorepremium\.com\/es\/products\/anel-ouro\?variant=1"/);
  assert.match(es.html, /href="https:\/\/www\.goldstorepremium\.com\/es\/"/, "back to the shop in Spanish");
  assert.match(es.text, /^— La conversación se ha transferido a Ana\.$/m);
  assert.match(es.text, /Gold Store Premium · https:\/\/www\.goldstorepremium\.com\/es\/$/);
  const pt = i18n.transcriptEmail({ site: "ldo", locale: null, name: "", messages }, BASE);
  assert.equal(pt.subject, "A sua conversa com a Loja do Ouro");
  assert.match(pt.html, /Você · 15 de outubro de 2026/);
  assert.match(pt.html, /11:00/, "Lisbon time");
  assert.match(pt.html, /A conversa foi transferida para Ana\./);
  const de = i18n.transcriptEmail({ site: "gsp", locale: "de", name: "Hans", messages }, BASE);
  assert.match(de.html, /Der Chat wurde an Ana übergeben\./);
  assert.match(de.html, /15\. Oktober 2026/);
  // Avisos antigos (sem kind): o texto da BD.
  const old = i18n.transcriptEmail({ site: "ldo", locale: "pt", name: "A", messages: [{ from: "notice", author: null, body: "Aviso antigo.", at: "2026-10-15T10:00:00Z" }] }, BASE);
  assert.match(old.html, /Aviso antigo\./);
});

test("Transfer notices, time zones and the visitor's site and language", () => {
  assert.equal(i18n.transferNotice("fr", "Ana"), "La conversation a été transférée à Ana.");
  assert.equal(i18n.transferNotice("en", null), "The conversation was transferred to another team member.");
  assert.equal(i18n.transferNotice(null, " "), "A conversa foi transferida para outra pessoa da equipa.");
  assert.equal(i18n.emailTimeZone("ldo", null), "Europe/Lisbon");
  assert.equal(i18n.emailTimeZone("ldo", "PT"), "Europe/Lisbon");
  assert.equal(i18n.emailTimeZone("gsp", null), "Europe/Paris");
  assert.equal(i18n.emailTimeZone("gsp", "ES"), "Europe/Paris");
  assert.equal(i18n.emailTimeZone("gsp", "IE"), "Europe/Lisbon");
  assert.equal(i18n.emailTimeZone("gsp", "FI"), "Europe/Helsinki");
  assert.deepEqual(i18n.visitorLang(null, null), { site: "ldo", locale: "pt" });
  assert.deepEqual(i18n.visitorLang("gsp", null), { site: "gsp", locale: "en" });
  assert.deepEqual(i18n.visitorLang("xpto", "de-DE"), { site: "ldo", locale: "de" });
  assert.equal(i18n.fill("{brand} · {x}", { brand: "B" }), "B · {x}");
  assert.equal(i18n.fill("{constructor}", {}), "{constructor}");
});

test("Loja do Ouro links in replies to Gold Store Premium customers point to their site", () => {
  const r = (body, locale = "en") => i18n.rebrandLinks(body, "gsp", locale);
  assert.equal(r("Veja https://www.lojadoouro.pt/products/anel"), "Veja https://www.goldstorepremium.com/products/anel");
  assert.equal(r("https://lojadoouro.pt/en/products/anel?variant=2", "es"), "https://www.goldstorepremium.com/es/products/anel?variant=2");
  assert.equal(r("http://www.lojadoouro.pt/pt-pt/collections/fios", "pt"), "https://www.goldstorepremium.com/pt-pt/collections/fios");
  assert.equal(r("Loja: https://www.lojadoouro.pt.", "fr"), "Loja: https://www.goldstorepremium.com/.");
  assert.equal(r("https://www.lojadoouro.pt/", "es"), "https://www.goldstorepremium.com/es/");
  assert.equal(r("https://www.lojadoouro.pt/endereco"), "https://www.goldstorepremium.com/endereco");
  assert.equal(r("(https://WWW.LOJADOOURO.PT/products/x)"), "(https://www.goldstorepremium.com/products/x)");
  assert.equal(r("a https://www.lojadoouro.pt/products/a e https://www.lojadoouro.pt/products/b"),
    "a https://www.goldstorepremium.com/products/a e https://www.goldstorepremium.com/products/b");
  // Outros endereços ficam iguais.
  assert.equal(r("apoiocliente@lojadoouro.pt"), "apoiocliente@lojadoouro.pt");
  assert.equal(r("https://www.lojadoouro.pt.evil.example/x"), "https://www.lojadoouro.pt.evil.example/x");
  assert.equal(r("https://evil.example/www.lojadoouro.pt"), "https://evil.example/www.lojadoouro.pt");
  assert.equal(i18n.rebrandLinks(`Veja ${LINK}`, "ldo", "en"), `Veja ${LINK}`);
});
