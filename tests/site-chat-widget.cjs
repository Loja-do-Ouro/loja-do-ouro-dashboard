const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Widget do chat do site (public/site-chat/ldo-chat.js, sem compilação): corre-se só o bloco das línguas
// (/* I18N:start */ … /* I18N:end */) com location, document e Shopify falsos.
const SRC = fs.readFileSync(path.join(__dirname, "../public/site-chat/ldo-chat.js"), "utf8");
const START = SRC.indexOf("/* I18N:start */");
const END = SRC.indexOf("/* I18N:end */");
const BLOCK = SRC.slice(START, END);
const LANGS = ["pt", "en", "es", "fr", "de"];
const PLACEHOLDERS = ["brand", "name", "email", "n", "price", "status", "hours"];

function load({ host = "www.lojadoouro.pt", pathname = "/", htmlLang = "", shopify } = {}) {
  const window = shopify === undefined ? {} : { Shopify: shopify };
  const location = { hostname: host, pathname, origin: `https://${host}` };
  const document = { documentElement: { lang: htmlLang } };
  const make = new Function("window", "location", "document", `"use strict";
    var LANG = "pt", SITE = "ldo", BRAND = "";
    ${BLOCK}
    BRAND = BRANDS.ldo;
    return {
      I18N: I18N, INTL: INTL, BRANDS: BRANDS, SERVER_ERRORS: SERVER_ERRORS,
      pickSite: pickSite, pickBrand: pickBrand, pickLang: pickLang, pickCountry: pickCountry,
      t: t, themeText: themeText, errorText: errorText, noticeText: noticeText, productHref: productHref,
      use: function (lang, site) { LANG = lang; SITE = site || "ldo"; BRAND = BRANDS[SITE]; },
    };`);
  return make(window, location, document);
}
const marks = (s) => (s.match(/\{(\w+)\}/g) || []).sort();

test("The widget parses and keeps the language block in one piece", () => {
  assert.doesNotThrow(() => new vm.Script(SRC));
  assert.ok(START > 0 && END > START, "marcadores I18N:start/end");
  // O bloco vem antes de readConfig() (os valores das variáveis não são içados).
  assert.ok(END < SRC.indexOf("var cfg = readConfig("));
});

test("All five languages have the same keys and placeholders", () => {
  const { I18N, INTL } = load();
  assert.deepEqual(Object.keys(I18N).sort(), [...LANGS].sort());
  assert.deepEqual(Object.keys(INTL).sort(), [...LANGS].sort());
  const keys = Object.keys(I18N.pt).sort();
  assert.ok(keys.length >= 55, `${keys.length} chaves`);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(I18N[lang]).sort(), keys, `chaves de ${lang}`);
    for (const key of keys) {
      const s = I18N[lang][key];
      assert.equal(typeof s, "string", `${lang}.${key}`);
      assert.ok(s.trim(), `${lang}.${key} vazio`);
      assert.equal(s, s.trim(), `${lang}.${key} com espaços nas pontas`);
      assert.deepEqual(marks(s), marks(I18N.pt[key]), `marcadores de ${lang}.${key}`);
      for (const m of marks(s)) assert.ok(PLACEHOLDERS.includes(m.slice(1, -1)), `${lang}.${key}: ${m}`);
      // A marca entra sempre pelo marcador: nenhum texto traz uma marca fixa.
      assert.ok(!/Loja do Ouro|Gold Store/.test(s), `${lang}.${key} com marca fixa`);
    }
  }
});

test("French uses a non-breaking space before ? ! : ;", () => {
  const { I18N } = load();
  let checked = 0;
  for (const [key, s] of Object.entries(I18N.fr)) {
    for (let i = 0; i < s.length; i++) {
      if (!"?!:;".includes(s[i])) continue;
      checked++;
      assert.ok(i > 0 && /[  ]/.test(s[i - 1]), `fr.${key}: «${s.slice(Math.max(0, i - 12), i + 1)}»`);
    }
  }
  assert.ok(checked >= 5);
  // As outras línguas não levam o espaço inseparável antes da pontuação.
  for (const lang of ["pt", "en", "es", "de"]) {
    for (const [key, s] of Object.entries(load().I18N[lang])) assert.ok(!/ [?!:;]/.test(s), `${lang}.${key}`);
  }
});

test("Every text the widget uses exists in the table", () => {
  const { I18N, SERVER_ERRORS } = load();
  const rest = SRC.slice(END);
  const used = new Set();
  for (const m of rest.matchAll(/\bt\("([A-Za-z_]+)"/g)) used.add(m[1]);
  for (const m of rest.matchAll(/themeText\([^,]+, "([A-Za-z_]+)"\)/g)) used.add(m[1]);
  assert.ok(used.size >= 35, `${used.size} textos usados`);
  for (const key of used) assert.ok(Object.hasOwn(I18N.pt, key), `t("${key}") sem tradução`);
  for (const code of Object.values(SERVER_ERRORS)) assert.ok(Object.hasOwn(I18N.pt, "err_" + code), `err_${code}`);
});

test("No fixed brand outside the language block (only in comments)", () => {
  const outside = SRC.slice(0, START) + "\n" + SRC.slice(END);
  outside.split("\n").forEach((line, i) => {
    const at = line.indexOf("Loja do Ouro");
    if (at < 0) return;
    const before = line.slice(0, at);
    const comment = /^\s*(\*|\/\*|\/\/)/.test(line) || before.includes("// ");
    assert.ok(comment, `linha ${i + 1}: ${line.trim()}`);
  });
  assert.ok(!/Gold Store Premium/.test(SRC.slice(END).split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n")));
});

test("Language: config, <html lang>, Shopify.locale, address prefix, then the site default", () => {
  const ldo = (o) => load({ host: "www.lojadoouro.pt", ...o });
  const gsp = (o) => load({ host: "www.goldstorepremium.com", ...o });
  // Ordem dos sinais.
  assert.equal(ldo({ htmlLang: "en", shopify: { locale: "es" }, pathname: "/fr/" }).pickLang({ lang: "de" }, "ldo"), "de");
  assert.equal(ldo({ htmlLang: "en", shopify: { locale: "es" }, pathname: "/fr/" }).pickLang({}, "ldo"), "en");
  assert.equal(ldo({ shopify: { locale: "es" }, pathname: "/fr/" }).pickLang({}, "ldo"), "es");
  assert.equal(ldo({ pathname: "/fr/products/anel" }).pickLang({}, "ldo"), "fr");
  assert.equal(ldo({ pathname: "/de" }).pickLang(null, "ldo"), "de");
  assert.equal(gsp({ pathname: "/pt-pt/collections/aneis" }).pickLang({}, "gsp"), "pt");
  assert.equal(gsp({ pathname: "/es/" }).pickLang({}, "gsp"), "es");
  // Sem sinais: a língua do site.
  assert.equal(ldo().pickLang({}, "ldo"), "pt");
  assert.equal(gsp().pickLang({}, "gsp"), "en");
  assert.equal(ldo({ pathname: "/products/anel" }).pickLang({}, "ldo"), "pt");
  // Formatos da Shopify e línguas que o chat não tem.
  assert.equal(ldo({ htmlLang: "pt-PT" }).pickLang({}, "ldo"), "pt");
  assert.equal(gsp({ htmlLang: "PT-pt" }).pickLang({}, "gsp"), "pt");
  assert.equal(ldo({ htmlLang: "de-DE" }).pickLang({}, "ldo"), "de");
  assert.equal(ldo({ htmlLang: "fr_FR" }).pickLang({}, "ldo"), "fr");
  assert.equal(ldo({ htmlLang: "it" }).pickLang({}, "ldo"), "en");
  assert.equal(ldo({ shopify: { locale: "nl" } }).pickLang({}, "ldo"), "en");
  // Lixo é ignorado e passa ao sinal seguinte; um prefixo de língua desconhecida também.
  assert.equal(ldo({ htmlLang: "??", shopify: { locale: "es" } }).pickLang({ lang: 42 }, "ldo"), "es");
  assert.equal(ldo({ pathname: "/it/products/anel" }).pickLang({}, "ldo"), "pt");
});

test("Brand follows the domain; the theme preview follows the customer's country", () => {
  const brand = (host, shopify, c) => load({ host, shopify }).pickBrand(c);
  assert.equal(brand("www.lojadoouro.pt"), "Loja do Ouro");
  assert.equal(brand("lojadoouro.pt"), "Loja do Ouro");
  assert.equal(brand("www.goldstorepremium.com"), "Gold Store Premium");
  assert.equal(brand("GoldStorePremium.com"), "Gold Store Premium");
  // O domínio manda, seja qual for a língua ou o país.
  assert.equal(load({ host: "www.goldstorepremium.com", pathname: "/pt-pt/", htmlLang: "pt-PT" }).pickBrand({}), "Gold Store Premium");
  assert.equal(brand("www.lojadoouro.pt", { country: "ES" }), "Loja do Ouro");
  assert.equal(brand("www.goldstorepremium.com", { country: "PT" }), "Gold Store Premium");
  // Pré-visualização do tema (myshopify): Loja do Ouro, a não ser que o país não seja Portugal.
  assert.equal(brand("lojadoouro-online.myshopify.com", { country: "PT" }), "Loja do Ouro");
  assert.equal(brand("lojadoouro-online.myshopify.com", {}), "Loja do Ouro");
  assert.equal(brand("lojadoouro-online.myshopify.com"), "Loja do Ouro");
  assert.equal(brand("lojadoouro-online.myshopify.com", { country: "ES" }), "Gold Store Premium");
  assert.equal(brand("lojadoouro-online.myshopify.com", { country: "fr" }), "Loja do Ouro");
  // Domínios parecidos não contam.
  assert.equal(brand("www.goldstorepremium.com.evil.example"), "Loja do Ouro");
  assert.equal(brand("notgoldstorepremium.com"), "Loja do Ouro");
  // Página de teste do dashboard: a configuração fixa o site.
  assert.equal(brand("dash.example", undefined, { site: "gsp" }), "Gold Store Premium");
  assert.equal(brand("www.goldstorepremium.com", undefined, { site: "ldo" }), "Loja do Ouro");
  assert.equal(brand("dash.example", undefined, { brand: "Gold Store Premium" }), "Gold Store Premium");
  assert.equal(load({ host: "www.goldstorepremium.com" }).pickSite({}), "gsp");
  assert.equal(load({ host: "www.lojadoouro.pt" }).pickSite(null), "ldo");
  // País: só duas letras maiúsculas (Shopify primeiro, depois a configuração).
  assert.equal(load({ shopify: { country: "DE" } }).pickCountry({ country: "FR" }), "DE");
  assert.equal(load({ shopify: { country: "deu" } }).pickCountry({ country: "FR" }), "FR");
  assert.equal(load().pickCountry({ country: "<x>" }), null);
});

test("Texts take the brand and placeholders; theme texts only in Portuguese", () => {
  const w = load();
  w.use("pt", "ldo");
  assert.equal(w.t("subtitle"), "A equipa da Loja do Ouro responde aqui.");
  assert.equal(w.t("typingAgent", { name: "Diana" }), "Diana está a escrever…");
  assert.equal(w.t("unreadMany", { n: 3 }), "3 mensagens novas");
  assert.equal(w.t("hours", { hours: "{brand}" }), "Horário: {brand}");
  assert.equal(w.t("nao-existe"), "");
  assert.equal(w.themeText("Fale com a Loja do Ouro", "title"), "Fale com a Loja do Ouro");
  assert.equal(w.themeText("", "title"), "Fale connosco");
  assert.equal(w.themeText(undefined, "subtitle"), "A equipa da Loja do Ouro responde aqui.");
  w.use("pt", "gsp");
  assert.equal(w.themeText("A equipa da Loja do Ouro responde aqui.", "subtitle"), "A equipa da Gold Store Premium responde aqui.");
  w.use("en", "gsp");
  assert.equal(w.t("subtitle"), "The Gold Store Premium team replies here.");
  assert.equal(w.themeText("Fale connosco", "title"), "Chat with us");
  assert.equal(w.t("emailed", { email: "a@b.pt" }), "We have sent a copy of the conversation to a@b.pt.");
  w.use("de", "ldo");
  assert.equal(w.t("subtitle"), "Das Team von Loja do Ouro antwortet Ihnen hier.");
  assert.equal(w.t("fromPrice", { price: "12,00 €" }), "ab 12,00 €");
});

test("API errors: code first, then the known Portuguese text, never Portuguese in another language", () => {
  const w = load();
  w.use("en", "gsp");
  assert.equal(w.errorText({ error: "Demasiadas conversas iniciadas. Tente novamente mais tarde.", code: "too_many_chats" }, 429), w.I18N.en.err_too_many_chats);
  assert.equal(w.errorText({ error: "Indique o seu nome." }, 400), w.I18N.en.err_name_required);
  assert.equal(w.errorText({ error: "Mensagem demasiado longa." }, 400), w.I18N.en.err_message_too_long);
  assert.equal(w.errorText({ error: "Indique o seu nome.", code: "codigo_novo" }, 400), w.I18N.en.err_name_required);
  assert.equal(w.errorText({ error: "Outro erro qualquer." }, 400), w.I18N.en.err_chat_unavailable);
  assert.equal(w.errorText({ error: "constructor" }, 400), w.I18N.en.err_chat_unavailable);
  assert.equal(w.errorText({}, 502), "The chat is unavailable at the moment (error 502). Please try again shortly.");
  assert.equal(w.errorText({}, 0), "");
  w.use("pt", "ldo");
  assert.equal(w.errorText({ error: "Outro erro qualquer." }, 400), "Outro erro qualquer.");
  assert.equal(w.errorText({ error: "Sessão do chat inválida. Inicie uma nova conversa.", code: "session_invalid" }, 401), w.I18N.pt.err_session_invalid);
  w.use("fr", "gsp");
  assert.equal(w.errorText({ code: "too_many_messages" }, 429), w.I18N.fr.err_too_many_messages);
});

test("Transfer notices are translated (new and old server)", () => {
  const w = load();
  w.use("es", "gsp");
  assert.equal(w.noticeText({ from: "notice", kind: "transfer", to_first: "Diana", body: "A conversa foi transferida para Diana." }), "Su conversación se ha transferido a Diana.");
  assert.equal(w.noticeText({ from: "notice", kind: "transfer", to_first: null, body: "A conversa foi transferida para outra pessoa da equipa." }), "Su conversación se ha transferido a otra persona del equipo.");
  assert.equal(w.noticeText({ from: "notice", body: "A conversa foi transferida para Rui." }), "Su conversación se ha transferido a Rui.");
  assert.equal(w.noticeText({ from: "notice", body: "A conversa foi transferida para outra pessoa da equipa." }), "Su conversación se ha transferido a otra persona del equipo.");
  assert.equal(w.noticeText({ from: "notice", body: "Outro aviso." }), "Outro aviso.");
  w.use("pt", "ldo");
  assert.equal(w.noticeText({ from: "notice", kind: "transfer", to_first: "Diana" }), "A conversa foi transferida para Diana.");
});

test("Product cards open in the shop and language the customer is on", () => {
  const ldo = "https://www.lojadoouro.pt/products/anel-ouro?variant=7";
  const link = { handle: "anel-ouro", variant: "7" };
  const es = load({ host: "www.goldstorepremium.com", pathname: "/es/", shopify: { routes: { root: "/es/" } } });
  assert.equal(es.productHref(ldo, link), "https://www.goldstorepremium.com/es/products/anel-ouro?variant=7");
  const en = load({ host: "www.lojadoouro.pt", pathname: "/en/", shopify: { routes: { root: "/en" } } });
  assert.equal(en.productHref(ldo, { handle: "anel-ouro", variant: null }), "https://www.lojadoouro.pt/en/products/anel-ouro");
  // Raiz estranha: a da loja.
  const odd = load({ host: "www.goldstorepremium.com", shopify: { routes: { root: "//evil.example/" } } });
  assert.equal(odd.productHref(ldo, link), "https://www.goldstorepremium.com/products/anel-ouro?variant=7");
  // Fora da loja (página de teste do dashboard): a ligação original.
  assert.equal(load({ host: "loja-do-ouro-dashboard.vercel.app" }).productHref(ldo, link), ldo);
});
