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

// ---------------------------------------------------------------- o que o widget guarda no browser do visitante

// Widget completo num DOM mínimo. Cada openPage() é uma página nova no mesmo browser: o mesmo localStorage e cookies e
// o sessionStorage do separador atual (newSession() passa a outro separador, com o sessionStorage vazio; as páginas já
// abertas ficam com o do seu separador). Cada escrita fica em b.log.
const VISIT_KEY = "ldo-chat:visita-chat";
const OPEN_KEY = "ldo-chat:aberto";
const TOKEN_KEY = "ldo-chat:v1";
const LEGACY_KEY = "ldo-chat:visita";
let clock = Date.UTC(2026, 9, 30, 10, 0, 0);
class FakeDate extends Date {
  constructor(...a) { super(...(a.length ? a : [clock])); }
  static now() { return clock; }
}

class FakeStorage {
  constructor(name, log) { this.name = name; this.log = log; this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.log.push([this.name, "set", k]); this.map.set(k, String(v)); }
  removeItem(k) { this.log.push([this.name, "remove", k]); this.map.delete(k); }
}
function browser() {
  const log = [];
  return { log, local: new FakeStorage("local", log), session: new FakeStorage("session", log) };
}
function newSession(b) { b.session = new FakeStorage("session", b.log); return b; }

class FakeNode {
  constructor(name, data = "") {
    this.nodeName = name.toUpperCase();
    this.data = data;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.html = "";
    this.value = "";
    this.style = { setProperty() {} };
    this.scrollTop = this.scrollHeight = this.clientHeight = 0;
    const node = this;
    this.classList = {
      add(c) { if (!node.classes().includes(c)) node.className = [...node.classes(), c].join(" "); },
      remove(c) { node.className = node.classes().filter((x) => x !== c).join(" "); },
    };
  }
  classes() { return (this.attrs.class || "").split(/\s+/).filter(Boolean); }
  get className() { return this.attrs.class || ""; }
  set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = String(v); }
  get firstChild() { return this.childNodes[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) {
    if (c.nodeName === "#DOCUMENT-FRAGMENT") { [...c.childNodes].forEach((x) => this.appendChild(x)); return c; }
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  replaceChild(n, o) {
    if (n.parentNode) n.parentNode.removeChild(n);
    this.childNodes[this.childNodes.indexOf(o)] = n;
    n.parentNode = this;
    o.parentNode = null;
    return o;
  }
  get textContent() { return this.nodeName === "#TEXT" ? this.data : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    this.html = "";
    if (v != null && v !== "") this.appendChild(new FakeNode("#text", String(v)));
  }
  get innerHTML() {
    return this.html + this.childNodes.map((c) => c.nodeName === "#TEXT" ? c.data
      : `<${c.nodeName} ${JSON.stringify(c.attrs)}>${c.innerHTML}</${c.nodeName}>`).join("");
  }
  set innerHTML(v) { this.textContent = ""; this.html = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault() {} }); }
  click() { this.dispatch("click"); }
  focus() {}
  closest() { return null; }
  matches(sel) {
    let m;
    if (sel === "*") return true;
    if ((m = /^\[([\w-]+)=([\w-]+)\]$/.exec(sel))) return this.attrs[m[1]] === m[2];
    if ((m = /^\.([\w-]+)$/.exec(sel))) return this.classes().includes(m[1]);
    return /^[a-z]+$/.test(sel) && this.nodeName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeName !== "#TEXT" && c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// Servidor do chat falso: regista os pedidos (método, caminho, corpo e token).
function fakeServer() {
  const calls = [];
  const fetch = (url, opts = {}) => {
    const u = new URL(url, "https://www.lojadoouro.pt");
    const call = { method: opts.method || "GET", path: u.pathname, body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).Authorization || null };
    calls.push(call);
    const data = call.path === "/api/chat/start" ? { token: "tok-1", verified: null }
      : call.path === "/api/chat/messages" && call.method === "GET" ? { messages: [], agent: null, typing: false } : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  return { fetch, calls, context: () => calls.filter((c) => c.path === "/api/chat/context") };
}
const noServer = () => { throw new Error("pedido inesperado ao servidor"); };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function openPage(b, { url = "https://www.lojadoouro.pt/", config = {}, fetch = noServer } = {}) {
  const u = new URL(url);
  const session = b.session;
  const location = { href: u.href, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin };
  const body = new FakeNode("body");
  const head = new FakeNode("head");
  const document = {
    documentElement: { lang: "" }, body, head, title: "Página", hidden: false,
    getElementById: (id) => [...head.querySelectorAll("*"), ...body.querySelectorAll("*")].find((n) => n.id === id) || null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (s) => new FakeNode("#text", String(s)),
    createDocumentFragment: () => new FakeNode("#document-fragment"),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    get cookie() { return ""; },
    set cookie(v) { b.log.push(["cookie", "set", v]); },
  };
  const window = {
    LDO_CHAT_CONFIG: { api: "https://dash.example", ...config },
    get localStorage() { return b.local; },
    get sessionStorage() { return session; },
    matchMedia: () => ({ matches: false }),
  };
  const timers = [];
  const setTimeout = (fn, ms) => timers.push({ fn, ms: ms || 0, done: false });
  new Function("window", "document", "location", "localStorage", "sessionStorage", "fetch", "setTimeout", "clearTimeout", "Date", SRC)(
    window, document, location, b.local, session, fetch, setTimeout, () => {}, FakeDate);
  const host = body.childNodes[0] || null;
  const find = (cls) => (host ? host.querySelector("." + cls) : null);
  return {
    window, document, timers, host, launcher: find("launcher"), panel: find("panel"),
    // O formulário só entra na página quando o chat abre.
    get form() { return find("start"); },
    isOpen() { return this.launcher.getAttribute("aria-expanded") === "true"; },
    // Corre os temporizadores pendentes mais curtos do que max ms (não as consultas periódicas ao servidor).
    runTimers(max) { for (const t of timers) if (!t.done && t.ms < max) { t.done = true; t.fn(); } },
  };
}
const json = (s, k) => JSON.parse(s.getItem(k));

test("Chat widget: nothing is stored on the visitor's device before the chat is opened, on any page", () => {
  const b = browser();
  const pages = [
    ["https://www.lojadoouro.pt/", {}],
    ["https://www.lojadoouro.pt/collections/aneis?page=2", {}],
    ["https://www.lojadoouro.pt/products/anel-ouro#reviews", {}],
    ["https://www.lojadoouro.pt/en/pages/contact", {}],
    ["https://www.goldstorepremium.com/es/products/anillo", {}],
    ["https://www.lojadoouro.pt/cart", { hideOn: "/cart" }],
    ["https://www.lojadoouro.pt/", { enabled: false }],
  ];
  let shown = 0;
  for (let i = 0; i < 3; i++) {
    for (const [url, config] of pages) {
      const page = openPage(b, { url, config });
      if (page.launcher) {
        shown++;
        assert.equal(page.isOpen(), false, url);
      }
      clock += 45_000;
    }
    newSession(b);
  }
  assert.equal(shown, 15);
  // 21 páginas vistas (em 3 separadores), nenhum pedido ao servidor e nada gravado nem apagado: localStorage,
  // sessionStorage e cookies.
  assert.deepEqual(b.log, []);
  assert.equal(b.local.map.size, 0);
  assert.equal(b.session.map.size, 0);
});

test("Chat widget: the old visit counter (ldo-chat:visita) is removed at load, and nothing else is written", () => {
  const b = browser();
  b.local.map.set(LEGACY_KEY, JSON.stringify({ start: clock - 3_600_000, pages: 7, last: clock - 60_000 }));
  b.local.map.set("outra-aplicacao", "1");
  const page = openPage(b);
  assert.equal(page.isOpen(), false);
  assert.deepEqual(b.log, [["local", "remove", LEGACY_KEY]]);
  assert.equal(b.local.getItem(LEGACY_KEY), null);
  assert.equal(b.local.getItem("outra-aplicacao"), "1");
  // Já apagado: nas páginas seguintes não há mais nada a fazer.
  openPage(b);
  assert.deepEqual(b.log, [["local", "remove", LEGACY_KEY]]);
  // Também onde o chat está escondido ou desligado, e com um valor que não é JSON.
  for (const config of [{ hideOn: ["/cart"] }, { enabled: false }]) {
    b.log.length = 0;
    b.local.map.set(LEGACY_KEY, "{lixo");
    openPage(b, { url: "https://www.lojadoouro.pt/cart", config });
    assert.deepEqual(b.log, [["local", "remove", LEGACY_KEY]], JSON.stringify(config));
  }
  assert.equal(b.session.map.size, 0);
});

test("Chat widget: storage starts when the customer opens the chat; the visit counts from that moment", () => {
  const b = browser();
  const p1 = openPage(b, { url: "https://www.lojadoouro.pt/products/anel-ouro" });
  clock += 10 * 60_000; // 10 minutos na página antes de abrir o chat: não contam
  assert.deepEqual(b.log, []);
  const opened = clock;
  p1.launcher.click();
  assert.equal(p1.isOpen(), true);
  assert.deepEqual(b.log, [["session", "set", OPEN_KEY], ["session", "set", VISIT_KEY]]);
  assert.equal(json(b.session, OPEN_KEY), true);
  assert.deepEqual(json(b.session, VISIT_KEY), { start: opened, pages: 1, last: opened });
  assert.equal(b.local.map.size, 0, "sem conversa, nada no localStorage");

  // Página seguinte: o chat que estava aberto reabre e a visita continua (2 páginas desde que abriu o chat).
  clock += 60_000;
  const p2 = openPage(b, { url: "https://www.lojadoouro.pt/collections/aneis" });
  assert.equal(p2.isOpen(), true);
  assert.deepEqual(json(b.session, VISIT_KEY), { start: opened, pages: 2, last: clock });
  // Fechar o chat sem iniciar conversa apaga "aberto" e a visita: nas páginas seguintes nada é gravado.
  b.log.length = 0;
  p2.launcher.click();
  assert.equal(p2.isOpen(), false);
  assert.deepEqual(b.log, [["session", "remove", OPEN_KEY], ["session", "remove", VISIT_KEY]]);
  assert.equal(b.session.map.size, 0);
  b.log.length = 0;
  clock += 60_000;
  openPage(b);
  const p3 = openPage(b);
  assert.equal(p3.isOpen(), false);
  assert.deepEqual(b.log, []);
  assert.equal(b.local.map.size, 0);

  // Ao voltar a abrir, a visita conta desde esse momento.
  clock += 60_000;
  p3.launcher.click();
  assert.deepEqual(json(b.session, VISIT_KEY), { start: clock, pages: 1, last: clock });
  // Com o chat aberto, 31 minutos sem páginas novas nem contacto com o servidor: a visita acaba e recomeça nesta página.
  clock += 31 * 60_000;
  b.log.length = 0;
  const p5 = openPage(b);
  assert.equal(p5.isOpen(), true);
  assert.deepEqual(b.log, [["session", "remove", VISIT_KEY], ["session", "set", OPEN_KEY], ["session", "set", VISIT_KEY]]);
  assert.deepEqual(json(b.session, VISIT_KEY), { start: clock, pages: 1, last: clock });
  p5.launcher.click();
  assert.equal(b.session.map.size, 0);
  assert.equal(b.local.map.size, 0);

  // Separador novo: nada guardado de antes, nada gravado.
  newSession(b);
  b.log.length = 0;
  openPage(b);
  assert.deepEqual(b.log, []);

  // Abrir pela ligação do tema (#chat) também é abrir o chat: a visita começa nesse momento.
  const p4 = openPage(b, { url: "https://www.lojadoouro.pt/pages/contactos#chat" });
  assert.equal(p4.isOpen(), true);
  assert.deepEqual(json(b.session, VISIT_KEY), { start: clock, pages: 1, last: clock });
  assert.ok(!b.log.some(([store]) => store === "local" || store === "cookie"));
});

test("Chat widget: a conversation started after opening is restored on the next pages", async () => {
  const b = browser();
  const srv = fakeServer();
  const p1 = openPage(b, { url: "https://www.lojadoouro.pt/products/anel-ouro", fetch: srv.fetch });
  clock += 5 * 60_000;
  const opened = clock;
  p1.launcher.click();
  assert.deepEqual(b.log, [["session", "set", OPEN_KEY], ["session", "set", VISIT_KEY]]);
  assert.equal(srv.calls.length, 0, "sem conversa, o widget não fala com o servidor");
  p1.form.querySelector("[name=name]").value = "Ana";
  p1.form.querySelector("[name=email]").value = "ana@example.com";
  p1.form.querySelector("[name=message]").value = "Olá";
  p1.form.dispatch("submit");
  await flush();
  // A conversa começou: o token fica no localStorage, com a visita (para os outros separadores), e a equipa recebe a
  // hora a que o cliente abriu o chat.
  const stored1 = json(b.local, TOKEN_KEY);
  assert.equal(stored1.token, "tok-1");
  assert.deepEqual(stored1.visit, { start: opened, pages: 1, last: opened });
  assert.ok(p1.panel.querySelector(".chat"), "mostra a conversa");
  const ctx1 = srv.context().at(-1).body;
  assert.equal(ctx1.visitStartedAt, new Date(opened).toISOString());
  assert.equal(ctx1.pages, 1);
  assert.equal(ctx1.page, "https://www.lojadoouro.pt/products/anel-ouro");

  // Página seguinte: a conversa e o chat aberto voltam; a visita continua desde a mesma hora.
  clock += 2 * 60_000;
  srv.calls.length = 0;
  const p2 = openPage(b, { url: "https://www.lojadoouro.pt/collections/aneis", fetch: srv.fetch });
  await flush();
  assert.equal(p2.isOpen(), true);
  assert.ok(p2.panel.querySelector(".chat"), "mostra a conversa, não o formulário");
  assert.ok(srv.calls.some((c) => c.method === "GET" && c.path === "/api/chat/messages" && c.auth === "Bearer tok-1"));
  const ctx2 = srv.context().at(-1).body;
  assert.deepEqual([ctx2.visitStartedAt, ctx2.pages, ctx2.page], [new Date(opened).toISOString(), 2, "https://www.lojadoouro.pt/collections/aneis"]);
  assert.deepEqual(json(b.local, TOKEN_KEY).visit, { start: opened, pages: 2, last: clock });

  // Fechar o chat com a conversa iniciada: a visita continua nas páginas seguintes deste separador.
  p2.launcher.click();
  assert.equal(b.session.getItem(OPEN_KEY), null);
  clock += 60_000;
  const p3 = openPage(b, { fetch: srv.fetch });
  await flush();
  assert.equal(p3.isOpen(), false);
  assert.deepEqual(json(b.session, VISIT_KEY), { start: opened, pages: 3, last: clock });
  assert.equal(srv.context().at(-1).body.pages, 3);

  // 31 minutos sem páginas novas nem contacto com o servidor: a visita acaba (sai do sessionStorage e de
  // "ldo-chat:v1") e nada volta a ser gravado sem abrir o chat; a equipa recebe "pages: 0".
  clock += 31 * 60_000;
  b.log.length = 0;
  openPage(b, { fetch: srv.fetch });
  await flush();
  assert.deepEqual(b.log, [["local", "set", TOKEN_KEY], ["session", "remove", VISIT_KEY]]);
  assert.equal(json(b.local, TOKEN_KEY).visit, undefined);
  assert.equal(json(b.local, TOKEN_KEY).token, "tok-1");
  assert.deepEqual([srv.context().at(-1).body.pages, srv.context().at(-1).body.visitStartedAt], [0, undefined]);
  b.log.length = 0;
  openPage(b, { fetch: srv.fetch });
  await flush();
  assert.deepEqual(b.log, []);
  assert.equal(b.session.map.size, 0);
  assert.ok(!b.log.some(([store]) => store === "cookie"));
});

test("Chat widget: a new tab (product card, link, Ctrl+click) keeps the visit of the tab where the chat is open", async () => {
  const b = browser();
  const srv = fakeServer();
  // O que a BD grava (ldo_support_site_context): sem "pages" ou sem hora, fica o valor anterior.
  const db = { visit_started_at: null, pages_viewed: null };
  const apply = () => {
    for (const { body } of srv.context()) {
      if (body.visitStartedAt) db.visit_started_at = body.visitStartedAt;
      if (Number.isInteger(body.pages)) db.pages_viewed = body.pages;
    }
    srv.calls.length = 0;
  };
  // O painel: "Ainda não abriu o chat nesta visita" com pages_viewed 0; senão "Há N min".
  const panel = () => db.pages_viewed === 0 ? "Ainda não abriu o chat nesta visita"
    : db.visit_started_at ? `Há ${Math.round((clock - Date.parse(db.visit_started_at)) / 60_000)} min` : "—";

  // Separador A: o cliente abre o chat, inicia a conversa e vê mais uma página.
  const a1 = openPage(b, { url: "https://www.lojadoouro.pt/products/anel-ouro", fetch: srv.fetch });
  const opened = clock;
  a1.launcher.click();
  a1.form.querySelector("[name=name]").value = "Ana";
  a1.form.querySelector("[name=email]").value = "ana@example.com";
  a1.form.querySelector("[name=message]").value = "Olá";
  a1.form.dispatch("submit");
  await flush();
  clock += 60_000;
  const a2 = openPage(b, { url: "https://www.lojadoouro.pt/collections/aneis", fetch: srv.fetch });
  await flush();
  assert.equal(a2.isOpen(), true);
  apply();
  assert.deepEqual(db, { visit_started_at: new Date(opened).toISOString(), pages_viewed: 2 });
  const tabA = b.session;

  // Separador B (um cartão de produto do chat abre noutro separador, com o sessionStorage vazio): o chat fica fechado,
  // a equipa recebe a página com a mesma hora de abertura e sem "pages" (não 0), e nada é gravado.
  clock += 60_000;
  newSession(b);
  b.log.length = 0;
  const b1 = openPage(b, { url: "https://www.lojadoouro.pt/products/fio-ouro", fetch: srv.fetch });
  await flush();
  assert.equal(b1.isOpen(), false);
  assert.deepEqual(b.log, []);
  const ctxB = srv.context().at(-1).body;
  assert.equal(ctxB.page, "https://www.lojadoouro.pt/products/fio-ouro");
  assert.equal(ctxB.visitStartedAt, new Date(opened).toISOString());
  assert.ok(!("pages" in ctxB), JSON.stringify(ctxB));
  apply();
  // Três minutos depois, com o separador B a consultar o servidor: o painel continua a mostrar a visita.
  for (let i = 0; i < 6; i++) {
    clock += 30_000;
    b1.runTimers(30_001);
    await flush();
  }
  apply();
  assert.deepEqual(db, { visit_started_at: new Date(opened).toISOString(), pages_viewed: 2 });
  assert.equal(panel(), "Há 5 min");
  assert.deepEqual(b.log, []);

  // O cliente abre o chat no separador B: continua a mesma visita (mais uma página), não começa outra.
  b1.launcher.click();
  await flush();
  b1.runTimers(10_000);
  await flush();
  assert.deepEqual(json(b.session, VISIT_KEY), { start: opened, pages: 3, last: clock });
  assert.deepEqual(json(b.local, TOKEN_KEY).visit, { start: opened, pages: 3, last: clock });
  apply();
  assert.deepEqual(db, { visit_started_at: new Date(opened).toISOString(), pages_viewed: 3 });
  assert.equal(b.session.getItem(OPEN_KEY), "true");
  assert.equal(tabA.getItem(OPEN_KEY), "true", "o separador A não muda");

  // De volta ao separador A, outra página: conta também a que o cliente viu no separador B.
  clock += 60_000;
  b.session = tabA;
  openPage(b, { url: "https://www.lojadoouro.pt/pages/contactos", fetch: srv.fetch });
  await flush();
  apply();
  assert.deepEqual(db, { visit_started_at: new Date(opened).toISOString(), pages_viewed: 4 });
  assert.equal(panel(), "Há 6 min");
  assert.ok(!b.log.some(([store]) => store === "cookie"));
});

test("Chat widget: with an earlier conversation, a new visit stores nothing until the chat is opened", async () => {
  const b = browser();
  b.local.map.set(TOKEN_KEY, JSON.stringify({ token: "tok-1", name: "Ana", verifiedEmail: null, seenAt: "" }));
  const srv = fakeServer();
  // Noutro dia e separador: lê o token (as respostas e o aviso de mensagens novas continuam) e envia a página e o
  // carrinho à equipa, sem visita ("pages: 0") e sem gravar nada.
  openPage(b, { url: "https://www.lojadoouro.pt/products/anel-ouro", fetch: srv.fetch });
  await flush();
  clock += 3 * 60_000;
  const p2 = openPage(b, { url: "https://www.lojadoouro.pt/collections/aneis", fetch: srv.fetch });
  await flush();
  assert.equal(p2.isOpen(), false);
  assert.deepEqual(b.log, []);
  assert.ok(srv.calls.some((c) => c.method === "GET" && c.path === "/api/chat/messages" && c.auth === "Bearer tok-1"));
  const ctx = srv.context().at(-1).body;
  assert.equal(ctx.pages, 0);
  assert.equal(ctx.visitStartedAt, undefined);
  assert.equal(ctx.page, "https://www.lojadoouro.pt/collections/aneis");

  // Ao abrir o chat, a visita começa nesse momento e a equipa recebe-a (passados os 5 s que o servidor exige).
  clock += 60_000;
  const opened = clock;
  srv.calls.length = 0;
  p2.launcher.click();
  // A visita fica neste separador e, com a conversa, também em "ldo-chat:v1" (para os outros separadores).
  assert.deepEqual(b.log, [["session", "set", OPEN_KEY], ["session", "set", VISIT_KEY], ["local", "set", TOKEN_KEY]]);
  await flush();
  assert.equal(p2.isOpen(), true);
  // Depois de abrir, a resposta do servidor atualiza a visita (última atividade); nada mais é gravado.
  assert.ok(b.log.every(([store, op, key]) => op === "set" && (store === "session" ? [OPEN_KEY, VISIT_KEY].includes(key) : store === "local" && key === TOKEN_KEY)),
    JSON.stringify(b.log));
  p2.runTimers(3500);
  await flush();
  const after = srv.context().at(-1).body;
  assert.deepEqual([after.visitStartedAt, after.pages], [new Date(opened).toISOString(), 1]);
  assert.deepEqual(json(b.local, TOKEN_KEY), { token: "tok-1", name: "Ana", verifiedEmail: null, seenAt: "", visit: { start: opened, pages: 1, last: opened } });
});
