const { test } = require("node:test");
const assert = require("node:assert/strict");
const mail = require("../.test-build/private-selection-email.js");
const ps = require("../.test-build/private-selection-rules.js");

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const BASE = "https://dash.example/";
const PASSWORD = "Ouro<&>\"'2026";
const make = (brand, locale, more = {}) => mail.privateSelectionEmail({
  baseUrl: BASE, brand, locale, name: "  Ana Maria Silva ", email: "ana@exemplo.pt", password: PASSWORD,
  entryUrl: ps.entryUrl(brand, locale, ps.PS_DEFAULT_ENTRY_PATH), ...more,
});

test("Every language has the same texts and placeholders as Portuguese", () => {
  assert.deepEqual(Object.keys(mail.PS_TEXTS).sort(), [...ps.PS_LOCALES].sort());
  const keys = Object.keys(mail.PS_TEXTS.pt).sort();
  for (const l of ps.PS_LOCALES) {
    const t = mail.PS_TEXTS[l];
    assert.deepEqual(Object.keys(t).sort(), keys, l);
    for (const k of keys) {
      assert.equal(typeof t[k], "string", `${l}.${k}`);
      assert.ok(t[k].trim(), `${l}.${k} is empty`);
      assert.equal(placeholders(t[k]), placeholders(mail.PS_TEXTS.pt[k]), `${l}.${k}`);
      assert.doesNotMatch(t[k], /Loja do Ouro|Gold Store|lojadoouro|goldstorepremium/, `${l}.${k} must use {brand}`);
      // "Private Selection" fica em inglês; o antigo "Salão Privado" não aparece em língua nenhuma.
      assert.doesNotMatch(t[k].replace(/Private Selection/g, ""), /Salão|Salon|Sal[oó]n|Privad|Privé|Privat/i, `${l}.${k}`);
      // A senha é a mesma para todos: nunca "pessoal".
      assert.doesNotMatch(t[k], /pessoal|personal|personnel|persönlich|intransferible|intransmiss/i, `${l}.${k}`);
    }
  }
});

test("French uses a non-breaking space before ? ! : ; and German uses the polite Sie form", () => {
  for (const [k, v] of Object.entries(mail.PS_TEXTS.fr)) {
    assert.doesNotMatch(v, /[^ ][?!:;]/, `fr.${k}`);
    assert.doesNotMatch(v, /^[?!:;]/, `fr.${k}`);
  }
  for (const [k, v] of Object.entries(mail.PS_TEXTS.de)) assert.doesNotMatch(v, /\b(du|dich|dir|dein\w*|euch|euer)\b/i, `de.${k}`);
});

test("Each brand and language: subject, greeting, credentials box, button and the two closing lines", () => {
  for (const brand of ["ldo", "gsp"]) {
    for (const locale of ps.PS_LOCALES) {
      const t = mail.PS_TEXTS[locale];
      const name = ps.brandName(brand);
      const url = ps.entryUrl(brand, locale, ps.PS_DEFAULT_ENTRY_PATH);
      const m = make(brand, locale);
      const where = `${brand} ${locale}`;
      assert.deepEqual(Object.keys(m).sort(), ["html", "preheader", "subject", "text"], where);
      assert.ok(m.subject.includes(name), where);
      assert.match(m.html, new RegExp(`^<!doctype html><html lang="${ps.PS_INTL[locale]}">`), where);
      assert.ok(m.html.includes(`<strong>${name}</strong>`), `${where}: the access is to the full brand name`);
      assert.ok(m.html.includes(t.hello.replace("{name}", "Ana")), `${where}: greets by first name`);
      assert.ok(!m.html.includes("Maria Silva"), `${where}: only the first name`);
      assert.ok(m.html.includes("ana@exemplo.pt"), where);
      assert.ok(m.html.includes(`href="${url.replace(/&/g, "&amp;")}"`), `${where}: button to the entry page`);
      // Ordem: dados → botão → não partilhar a senha → ignorar → rodapé.
      const box = m.html.indexOf("Ouro&lt;"), button = m.html.indexOf(`>${t.button}</a>`);
      const noShare = m.html.indexOf(t.noShare.replace(/'/g, "&#39;")), ignore = m.html.indexOf(t.ignore.replace(/'/g, "&#39;"));
      const footer = m.html.indexOf(`${name} · `);
      assert.ok(box > 0 && button > box && noShare > button && ignore > noShare && footer > ignore, where);
      // Versão em texto: tudo o que é preciso, sem HTML.
      for (const s of [t.hello.replace("{name}", "Ana"), "ana@exemplo.pt", PASSWORD, url, t.noShare, t.ignore, name]) assert.ok(m.text.includes(s), `${where}: ${s}`);
      assert.ok(!/<[a-z]/i.test(m.text), where);
    }
  }
});

test("The password is only in the body, escaped; never in the subject or the preheader", () => {
  for (const brand of ["ldo", "gsp"]) {
    for (const locale of ps.PS_LOCALES) {
      const m = make(brand, locale, { password: "SenhaSecreta<b>2026" });
      assert.ok(!m.subject.includes("SenhaSecreta"), `${brand} ${locale}`);
      assert.ok(!m.preheader.includes("SenhaSecreta"), `${brand} ${locale}`);
      assert.ok(!m.html.includes("<b>2026"), "never as HTML");
      assert.equal(m.html.split("SenhaSecreta&lt;b&gt;2026").length, 2, "exactly once in the body");
      assert.ok(m.html.includes(`display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${m.preheader.replace(/'/g, "&#39;")}</div>`));
    }
  }
  const m = make("ldo", "pt");
  assert.ok(m.html.includes("Ouro&lt;&amp;&gt;&quot;&#39;2026"));
  assert.ok(!m.html.includes(PASSWORD));
});

test("Gold Store Premium emails never mention Loja do Ouro, and the other way round", () => {
  for (const locale of ps.PS_LOCALES) {
    const gsp = make("gsp", locale);
    assert.doesNotMatch(`${gsp.subject}\n${gsp.preheader}\n${gsp.html}\n${gsp.text}`, /Loja do Ouro|lojadoouro\.pt|logo-loja-do-ouro/, locale);
    assert.ok(gsp.html.includes('<img src="https://dash.example/logo-gold-store-premium.png" alt="Gold Store Premium" width="200"'), locale);
    assert.match(gsp.html, /goldstorepremium\.com/);
    const ldo = make("ldo", locale);
    assert.doesNotMatch(`${ldo.subject}\n${ldo.preheader}\n${ldo.html}\n${ldo.text}`, /Gold Store|goldstorepremium/i, locale);
    assert.ok(ldo.html.includes('<img src="https://dash.example/logo-loja-do-ouro.png" alt="Loja do Ouro" width="170"'), locale);
  }
});

test("Portuguese copy for the Loja do Ouro", () => {
  const m = make("ldo", "pt");
  assert.equal(m.subject, "O seu acesso à Loja do Ouro Private Selection");
  assert.equal(m.preheader, "Aqui tem os seus dados de acesso.");
  assert.ok(m.text.startsWith("Olá, Ana,\n\nO seu acesso à Loja do Ouro Private Selection está pronto.\nPara entrar, use estes dados:\n\nE-mail: ana@exemplo.pt\nSenha: "));
  assert.ok(m.text.endsWith("Loja do Ouro Private Selection · lojadoouro.pt"));
  assert.equal(make("gsp", "fr").text.split("\n").find((l) => l.startsWith("Mot de passe")), `Mot de passe : ${PASSWORD}`);
});

test("Names with HTML are escaped; without a name the greeting is generic; unknown values fall back safely", () => {
  const h = make("ldo", "pt", { name: "<b>Ana</b> Silva" });
  assert.ok(h.html.includes("Olá, &lt;b&gt;Ana&lt;/b&gt;,"));
  assert.ok(!h.html.includes("<b>Ana</b>"));
  for (const locale of ps.PS_LOCALES) {
    const m = make("gsp", locale, { name: null });
    assert.ok(m.text.startsWith(`${mail.PS_TEXTS[locale].helloNoName}\n`), locale);
    assert.ok(!m.text.includes("{name}"), locale);
  }
  const odd = make("xx", "nl", { entryUrl: "https://www.goldstorepremium.com/" });
  assert.equal(odd.subject, "Your access to Gold Store Premium Private Selection");
  assert.match(odd.html, /<html lang="en-GB">/);
  assert.equal(make("ldo", "zz").subject, "O seu acesso à Loja do Ouro Private Selection");
});
