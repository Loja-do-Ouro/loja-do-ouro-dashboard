const { test } = require("node:test");
const assert = require("node:assert/strict");
const a = require("../.test-build/access-email.js");

const TOKEN = "0123456789abcdef".repeat(4);

test("The access link carries the token after '#', never in the path or the query", () => {
  const link = a.accessLink("https://loja-do-ouro-dashboard.vercel.app/", TOKEN);
  assert.equal(link, `https://loja-do-ouro-dashboard.vercel.app/acesso#${TOKEN}`);
  const url = new URL(link);
  assert.equal(url.pathname, "/acesso");
  assert.equal(url.search, "");
  assert.equal(url.hash.slice(1), TOKEN);
});

test("Only 64 lowercase hexadecimal characters are accepted as a token", () => {
  assert.equal(a.validAccessToken(TOKEN), true);
  for (const bad of [TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`, "", null, undefined, 123, `${TOKEN.slice(0, 63)}g`, `../${TOKEN}`])
    assert.equal(a.validAccessToken(bad), false, String(bad));
});

test("The expiry is shown in Lisbon time, also across the clock change", () => {
  assert.equal(a.lisbonDateTime("2026-10-14T14:30:00Z"), "14/10/2026 às 15:30");
  assert.equal(a.lisbonDateTime("2026-12-01T09:05:00Z"), "01/12/2026 às 09:05");
  // 25/10/2026: às 01:00 UTC Lisboa volta de UTC+1 para UTC+0.
  assert.equal(a.lisbonDateTime("2026-10-25T00:30:00Z"), "25/10/2026 às 01:30");
  assert.equal(a.lisbonDateTime("2026-10-25T01:30:00Z"), "25/10/2026 às 01:30");
});

test("The email has the username, the button with the link and the expiry; names are escaped", () => {
  const link = a.accessLink("https://dash.example", TOKEN);
  const m = a.accessEmail({ baseUrl: "https://dash.example", link, username: "ana.silva", fullName: "  Ana Silva ", expiresAt: "2026-10-14T14:30:00Z" });
  assert.equal(m.subject, "O seu acesso à área de gestão da Loja do Ouro");
  assert.ok(m.html.includes("Olá, Ana<"), "título com o primeiro nome");
  // Um nome com HTML entra escapado (o primeiro nome é o que vai para o título).
  const h = a.accessEmail({ baseUrl: "https://dash.example", link, username: "ana.silva", fullName: "<b>Ana</b> Silva", expiresAt: "2026-10-14T14:30:00Z" });
  assert.ok(h.html.includes("Olá, &lt;b&gt;Ana&lt;/b&gt;"));
  assert.ok(!h.html.includes("<b>Ana</b>"), "o nome não pode entrar como HTML");
  assert.ok(m.html.includes("<strong>ana.silva</strong>"));
  assert.ok(m.html.includes(`href="https://dash.example/acesso#${TOKEN}"`));
  assert.ok(m.html.includes("Criar palavra-passe"));
  assert.ok(m.html.includes("14/10/2026 às 15:30"));
  assert.ok(m.html.includes("https://dash.example/login"));
  // O texto depois do botão fica mesmo depois do botão e antes do rodapé.
  const button = m.html.indexOf("Criar palavra-passe</a>"), after = m.html.indexOf("Se não esperava este email"), footer = m.html.indexOf("Mensagem automática");
  assert.ok(button > 0 && after > button && footer > after);
  // Versão em texto: tudo o que é preciso, sem HTML.
  assert.ok(m.text.includes("ana.silva") && m.text.includes(link) && m.text.includes("14/10/2026 às 15:30"));
  assert.ok(!/<[a-z]/i.test(m.text));
});

test("Without a name the title is generic, and a username with HTML is escaped", () => {
  const m = a.accessEmail({ baseUrl: "https://dash.example", link: a.accessLink("https://dash.example", TOKEN), username: "x<y", fullName: null, expiresAt: "2026-10-14T14:30:00Z" });
  assert.ok(m.html.includes("O seu acesso"));
  assert.ok(m.html.includes("<strong>x&lt;y</strong>"));
  assert.ok(m.text.startsWith("Olá."));
});
