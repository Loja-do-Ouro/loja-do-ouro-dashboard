const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const r = require("../.test-build/criadores-rules.js");

// As rotas por host, safeNext, o cookie e sameOriginPost estão em tests/criadores-rotas.cjs.

const ROOT = path.join(__dirname, "..");
const SITE = "https://criadores.lojadoouro.pt";
const TOKEN = "a".repeat(64);

// Migração A da plataforma (supabase/migrations/*_ldo_creators*.sql, a que cria ldo_cr_consents).
function migrationA() {
  const dir = path.join(ROOT, "supabase", "migrations");
  const file = fs.readdirSync(dir).filter((f) => /ldo_creators.*\.sql$/.test(f)).sort()
    .find((f) => /create table public\.ldo_cr_consents\b/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  return file ? { file, sql: fs.readFileSync(path.join(dir, file), "utf8") } : null;
}
const MIG = migrationA();
const needsMigration = MIG ? {} : { skip: "migração A (supabase/migrations/*_ldo_creators.sql) ainda não existe" };

// Texto de um seed de documento legal na migração: $kind$…$kind$, ou a maior string do tuplo ('kind', …).
function seedBody(sql, kind) {
  const tagged = new RegExp(`\\$${kind}\\$([\\s\\S]*?)\\$${kind}\\$`).exec(sql);
  if (tagged) return tagged[1];
  const at = sql.search(new RegExp(`\\(\\s*'${kind}'\\s*,`));
  if (at < 0) return null;
  const next = sql.slice(at + 1).search(/\(\s*'(?:terms|privacy|cookies|meta_data)'\s*,|;\s*\n\s*(?:insert|create|alter|select|update|revoke|grant)\b/i);
  const tuple = next < 0 ? sql.slice(at) : sql.slice(at, at + 1 + next);
  const strings = [...tuple.matchAll(/\$([a-z_]*)\$([\s\S]*?)\$\1\$|'((?:[^']|'')*)'/g)].map((m) => (m[2] ?? m[3] ?? "").replace(/''/g, "'"));
  return strings.sort((a, b) => b.length - a.length)[0] || null;
}

// ---------------------------------------------------------------- IBAN, NIF, telefone, nome

test("IBAN: mod 97 and length per country, spaces and lowercase accepted", () => {
  assert.equal(r.validIban("PT50000201231234567890154"), true);
  assert.equal(r.validIban("pt50 0002 0123 1234 5678 9015 4"), true);
  assert.equal(r.validIban(" PT50\t0002 0123 1234 5678 9015 4 "), true);
  assert.equal(r.validIban("PT50000201231234567890145"), false, "dígitos trocados");
  assert.equal(r.validIban("PT50000210231234567890154"), false, "dígitos trocados no meio");
  assert.equal(r.validIban("PT5000020123123456789015"), false, "falta um");
  assert.equal(r.validIban("GB82WEST12345698765432"), true);
  assert.equal(r.validIban("DE89370400440532013000"), true);
  assert.equal(r.validIban("ES9121000418450200051332"), true);
  assert.equal(r.validIban("XX50000201231234567890154"), false);
  assert.equal(r.validIban(""), false);
  assert.equal(r.validIban(null), false);
  assert.match(r.ibanProblem("PT5000020123123456789015"), /25 caracteres/);
  assert.match(r.ibanProblem("PT50000201231234567890145"), /não está certo/);
  assert.deepEqual(r.parseIban("pt50 0002 0123 1234 5678 9015 4"), { iban: "PT50000201231234567890154", country: "PT", last4: "0154" });
  assert.equal(r.parseIban("PT50000201231234567890145"), null);
});

test("IBAN mask shows only the country, check digits and last 4", () => {
  const m = r.maskIban("PT50000201231234567890154");
  assert.equal(m, "PT50 •••• •••• •••• •••• 0154");
  assert.ok(m.startsWith("PT50 ••••") && m.endsWith(" 0154"));
  assert.ok(!/0002|0123|1234|5678|9015/.test(m));
  assert.equal(r.ibanLast4("pt50 0002 0123 1234 5678 9015 4"), "0154");
  assert.equal(r.ibanTail("0154"), "•••• 0154");
  assert.equal(r.ibanTail("PT50000201231234567890154"), "••••");
});

test("NIF: check digit", () => {
  assert.equal(r.validNif("123456789"), true);
  assert.equal(r.validNif("123456780"), false);
  assert.equal(r.validNif("PT 123 456 789"), true);
  assert.equal(r.validNif("12345678"), false);
  assert.equal(r.validNif("012345678"), false);
  assert.equal(r.validNif(""), false);
  assert.equal(r.validNif("503504564"), true); // NIF de empresa (dígito de controlo certo)
});

test("phones in E.164", () => {
  assert.equal(r.normalizePhone("912 345 678"), "+351912345678");
  assert.equal(r.normalizePhone("+351 912-345-678"), "+351912345678");
  assert.equal(r.normalizePhone("00351912345678"), "+351912345678");
  assert.equal(r.normalizePhone("+44 (20) 7946 0958"), "+442079460958");
  assert.equal(r.normalizePhone("212345678"), "+351212345678");
  assert.equal(r.normalizePhone("12345"), null);
  assert.equal(r.normalizePhone("+0123456789"), null);
  assert.equal(r.normalizePhone("telefone"), null);
  assert.equal(r.normalizePhone(""), null);
  assert.equal(r.validPhone("+351912345678"), true);
  assert.equal(r.validPhone("+3519123456789012"), false);
});

test("validName accepts real names and refuses URLs, emails and digits", () => {
  for (const ok of ["João", "Maria-José", "D'Ávila", "J. Silva", "Ana Maria da Silva", "O’Neill", "Zoë", "Иван", "Dr."])
    assert.equal(r.validName(ok), true, ok);
  for (const bad of ["exemplo.pt", "https://x", "a@b.pt", "Ana2", "", "  ", "Ana  .pt", "Ana <b>", "www.x.com", "Ana_Silva", "-Ana"])
    assert.equal(r.validName(bad), false, bad);
  assert.equal(r.validName("a".repeat(121)), false);
  assert.equal(r.cleanName("  Ana \n  Silva "), "Ana Silva");
  assert.equal(r.firstName("Ana Silva"), "Ana");
  assert.equal(r.firstName("exemplo.pt"), "");
});

test("other validations: email, password, https, handle, holder and fiscal data", () => {
  assert.equal(r.validEmail("ana@exemplo.pt"), true);
  assert.equal(r.validEmail("ana@exemplo"), false);
  assert.equal(r.passwordProblem("curta1"), "A palavra-passe tem de ter pelo menos 10 caracteres, com letras e números.");
  assert.equal(r.passwordProblem("sóletrasaqui"), r.passwordProblem("x"));
  assert.equal(r.passwordProblem("palavra2026passe"), null);
  assert.equal(r.httpsUrl("https://ana.pt/portefolio"), "https://ana.pt/portefolio");
  assert.equal(r.httpsUrl("http://ana.pt"), null);
  assert.equal(r.httpsUrl("javascript:alert(1)"), null);
  assert.equal(r.normalizeHandle("@ana.silva"), "ana.silva");
  assert.equal(r.normalizeHandle("https://www.instagram.com/ana.silva/?hl=pt"), "ana.silva");
  assert.equal(r.normalizeHandle("ana silva"), null);
  assert.equal(r.holderMismatch("ANA  Silva", "Ána Silva"), false);
  assert.equal(r.holderMismatch("Rui Silva", "Ana Silva"), true);
  const fiscal = { fiscal_name: "Ana Silva", nif: "123456789", fiscal_address: "Rua do Ouro, 10, 1100-060 Lisboa", tax_country: "PT", vat_regime: "art53", withholding_waiver: true };
  assert.equal(r.fiscalProblem(fiscal), null);
  assert.match(r.fiscalProblem({ ...fiscal, nif: "123456780" }), /NIF/);
  assert.match(r.fiscalProblem({ ...fiscal, vat_regime: "x" }), /IVA/);
  assert.match(r.fiscalProblem({ ...fiscal, withholding_waiver: undefined }), /retenção/);
  assert.equal(r.fiscalProblem({ ...fiscal, tax_country: "ES", nif: "X1234567L" }), null);
});

// ---------------------------------------------------------------- listas, onboarding e etiquetas

test("closed lists respect the database limits", () => {
  assert.deepEqual(r.PLATFORMS, ["instagram", "tiktok", "youtube", "facebook", "pinterest", "outra"]);
  assert.ok(r.LANGUAGES.includes("pt"));
  assert.ok(r.CATEGORIES.length >= r.MAX_CATEGORIES - 2 && r.FORMATS.length <= r.MAX_FORMATS);
  assert.deepEqual(r.pickAllowed(["moda", "x", "moda", "beleza"], r.CATEGORIES, 12), ["moda", "beleza"]);
  assert.deepEqual(r.pickAllowed(["pt", "en", "es", "fr", "de", "it"], r.LANGUAGES, 2), ["pt", "en"]);
  assert.deepEqual(r.pickAllowed("pt", r.LANGUAGES, 6), ["pt"]);
  assert.deepEqual(r.pickAllowed(undefined, r.LANGUAGES, 6), []);
  for (const k of [...r.CATEGORIES, ...r.FORMATS]) assert.match(k, /^[a-z_]{2,30}$/);
});

test("onboarding steps and the next one to do", () => {
  assert.equal(r.nextOnboardingStep({}), 1);
  const full = {
    full_name: "Ana Silva", city: "Braga", country: "PT", languages: ["pt"], phone: "+351912345678",
    categories: ["moda"], formats: ["reels"], social_accounts: [{ platform: "instagram", handle: "ana" }],
  };
  assert.equal(r.nextOnboardingStep(full), null);
  assert.ok(r.onboardingSteps(full).every((s) => s.done));
  const noPhone = r.onboardingSteps({ ...full, phone: "912345678" });
  assert.deepEqual(noPhone.map((s) => s.done), [true, false, true, true]);
  assert.deepEqual(noPhone[1].missing, ["o telemóvel"]);
  assert.equal(r.nextOnboardingStep({ ...full, social_accounts: [] }), 4);
  assert.equal(r.nextOnboardingStep({ ...full, full_name: "exemplo.pt" }), 1);
  assert.deepEqual(r.onboardingSteps(null).map((s) => s.key), ["about", "contacts", "content", "networks"]);
});

test("every status, request and document has a label", () => {
  for (const s of ["draft", "pending_review", "approved", "rejected", "suspended", "restricted", "deleted"]) {
    assert.ok(r.CREATOR_STATUS_LABEL[s] && r.CREATOR_STATUS_SITE[s] && r.CREATOR_STATUS_TONE[s], s);
  }
  for (const k of ["access", "portability", "rectification", "erasure", "objection", "restriction", "human_review", "withdrawal", "other"])
    assert.ok(r.PRIVACY_KIND_LABEL[k], k);
  for (const k of ["terms", "privacy", "cookies", "meta_data", "campaign_conditions"]) assert.ok(r.LEGAL_KIND_LABEL[k], k);
  assert.equal(r.VERIFICATION_LABEL.declared, "Não verificado");
  assert.equal(r.ACCESS_LEVEL_LABEL.manage, "Gerir");
  for (const p of r.CONSENT_PURPOSES) assert.ok(r.CONSENT_LABEL[p], p);
});

// ---------------------------------------------------------------- consentimentos

test("CONSENT_TEXT has a text for every purpose and fills the markers", () => {
  for (const p of r.CONSENT_PURPOSES) {
    assert.ok(typeof r.CONSENT_TEXT[p] === "string" && r.CONSENT_TEXT[p].length >= 20 && r.CONSENT_TEXT[p].length <= 2000, p);
  }
  assert.deepEqual(Object.keys(r.CONSENT_TEXT).sort(), [...r.CONSENT_PURPOSES].sort());
  assert.equal(r.consentText("terms", { versao: "1.0" }), "Aceito os Termos de participação (v1.0).");
  assert.throws(() => r.consentText("terms"), /versão/);
  assert.match(r.consentText("platform_public", { handle: "@ana.silva" }), /\(@ana\.silva\)/);
  assert.throws(() => r.consentText("platform_public", { handle: "<script>" }), /@/);
  assert.match(r.CONSENT_TEXT.platform_instagram, /indicadores estatísticos de autenticidade da audiência/);
  assert.match(r.CONSENT_TEXT.content_declaration, /não aparecem menores de 18 anos/);
  assert.doesNotMatch(r.CONSENT_TEXT.platform_public, /\[30\]/);
  const texts = r.registerTexts("1.0", "1.0");
  assert.deepEqual(Object.keys(texts).sort(), ["adult", "privacy_notice", "terms"]);
  assert.ok(Object.values(texts).every((t) => !t.includes("{")));
  assert.equal(r.privacyNoticeUpdateText("1.1"), "Tomei conhecimento da Política de Privacidade (v1.1).");
});

test("every purpose in the SQL check has a text in CONSENT_TEXT (reads migration A)", needsMigration, () => {
  const m = /purpose\s+text\s+not\s+null\s+check\s*\(\s*purpose\s+in\s*\(([^)]*)\)/i.exec(MIG.sql);
  assert.ok(m, `${MIG.file}: check de ldo_cr_consents.purpose não encontrado`);
  const purposes = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.ok(purposes.length >= 20);
  for (const p of purposes) assert.ok(r.CONSENT_TEXT[p], `sem texto: ${p}`);
  assert.deepEqual([...purposes].sort(), [...r.CONSENT_PURPOSES].sort());
});

// ---------------------------------------------------------------- emails

const IBAN = "PT50000201231234567890154";
// Payload hostil: campos a mais (nunca devem aparecer) e texto com HTML.
const HOSTILE = {
  reason: "<script>alert(1)</script> Ver https://mau.example/x",
  response: "<img src=x onerror=alert(1)> resposta",
  changes_summary: "<b>negrito</b> & mais",
  detail: "Tem uma colaboração a decorrer <a href=x>.",
  version: "1.1",
  kind: "access",
  extended_until: "2027-01-03T10:00:00Z",
  delete_on: "2027-01-03T10:00:00Z",
  at: "2026-11-04T10:42:00Z",
  count: 3,
  iban: IBAN, nif: "123456789", address: "Rua do Ouro 10", followers: 123456,
};

function render(t) {
  return { html: r.creatorEmailHtml(t, "https://loja-do-ouro-dashboard.vercel.app"), text: r.creatorEmailText(t) };
}

function noIbanDigits(s, where) {
  const digits = IBAN.slice(2);
  for (let i = 0; i + 5 <= digits.length; i++) assert.ok(!s.includes(digits.slice(i, i + 5)), `${where}: «${digits.slice(i, i + 5)}» do IBAN`);
  assert.ok(!s.includes("PT50"), `${where}: PT50`);
  assert.ok(!s.includes("123456789"), `${where}: NIF`);
  assert.ok(!s.includes("Rua do Ouro"), `${where}: morada`);
  assert.ok(!s.includes("123456") && !s.includes("123 456"), `${where}: seguidores`);
}

test("outboxEmail covers every PR1 kind, escapes HTML and never leaks IBAN digits", () => {
  for (const kind of r.PR1_OUTBOX_KINDS) {
    const t = r.outboxEmail({ id: 1, kind, payload: HOSTILE, email: "ana@exemplo.pt", first_name: "Ana" }, `${SITE}/`);
    assert.ok(t, kind);
    assert.ok(t.subject && t.title && t.paragraphs.length, kind);
    if (t.button) assert.ok(t.button.url.startsWith(`${SITE}/`) && !t.button.url.includes("//painel"), kind);
    const { html, text } = render(t);
    assert.ok(!/<script|<img src=x|<b>|<a href=x/i.test(html), `${kind}: HTML por escapar`);
    assert.ok(!html.includes('href="https://mau.example'), `${kind}: ligação de terceiros clicável`);
    noIbanDigits(html, kind);
    noIbanDigits(text, kind);
    assert.equal(r.outboxTitle(kind, HOSTILE), t.title);
  }
  assert.equal(r.outboxEmail({ id: 1, kind: "desconhecido", payload: {} }, SITE), null);
  assert.equal(r.outboxTitle("desconhecido"), null);
  const rejected = r.outboxEmail({ id: 1, kind: "profile_rejected", payload: { reason: "Faltam as capturas." }, first_name: "Ana" }, SITE);
  assert.equal(rejected.paragraphs[0], "Olá Ana,");
  assert.equal(rejected.quote.text, "Faltam as capturas.");
  assert.match(render(rejected).html, /Faltam as capturas\./);
  const odd = r.outboxEmail({ id: 1, kind: "message", payload: {}, first_name: "exemplo.pt" }, SITE);
  assert.equal(odd.paragraphs[0], "Olá,");
  assert.match(r.outboxEmail({ id: 1, kind: "privacy_updated", payload: { version: "1.1" } }, SITE).paragraphs[1], /Não precisa de aceitar nada/);
  assert.match(r.creatorEmailText(r.outboxEmail({ id: 1, kind: "erasure_blocked", payload: {} }, SITE)), /www\.cnpd\.pt/);
  // Pedido RGPD recusado (art. 12.º, n.º 4): outro título, o motivo e as vias de reclamação e recurso.
  const refused = r.outboxEmail({ id: 1, kind: "privacy_request_done", payload: { kind: "objection", status: "refused", response: "Interesse legítimo prevalecente." } }, SITE);
  assert.match(refused.title, /Não podemos dar seguimento/);
  assert.ok(!/Concluímos/.test(refused.paragraphs.join(" ")));
  assert.equal(refused.quote.label, "Motivo");
  assert.equal(refused.quote.text, "Interesse legítimo prevalecente.");
  assert.match(refused.after.join(" "), /www\.cnpd\.pt/);
  assert.match(refused.after.join(" "), /tribunais/);
  assert.equal(r.outboxTitle("privacy_request_done", { status: "refused" }), refused.title);
  const done = r.outboxEmail({ id: 1, kind: "privacy_request_done", payload: { kind: "objection", status: "done", response: "Feito." } }, SITE);
  assert.match(done.paragraphs[1], /Concluímos/);
});

test("account emails: no name, links with #t= and never ?t=", () => {
  const emails = [
    r.verifyEmailText(SITE, TOKEN),
    r.verifyEmailText(SITE, TOKEN, { pending: true }),
    r.accountExistsText(SITE),
    r.resetEmailText(SITE, TOKEN),
    r.ibanConfirmText(SITE, TOKEN, "0154", "2026-11-04T10:42:00Z"),
    r.accountDeletedText(),
  ];
  for (const t of emails) {
    assert.equal(t.paragraphs[0], "Olá,");
    const { html, text } = render(t);
    for (const s of [html, text]) {
      assert.ok(!/[?&]t=/.test(s), `${t.title}: ?t=`);
      assert.ok(!s.includes("Ana") && !s.includes("Silva"), `${t.title}: nome`);
      noIbanDigits(s, t.title);
    }
  }
  assert.equal(r.verifyEmailText(SITE, TOKEN).button.url, `${SITE}/conta/confirmar#t=${TOKEN}`);
  assert.equal(r.resetEmailText(`${SITE}/`, TOKEN).button.url, `${SITE}/conta/nova-palavra-passe#t=${TOKEN}`);
  assert.equal(r.ibanConfirmText(SITE, TOKEN, "0154", "2026-11-04T10:42:00Z").button.url, `${SITE}/conta/iban#t=${TOKEN}`);
  assert.match(r.verifyEmailText(SITE, TOKEN, { pending: true }).paragraphs[1], /Já existe um registo por confirmar/);
  const iban = r.ibanConfirmText(SITE, TOKEN, "0154", "2026-11-04T10:42:00Z");
  assert.match(iban.paragraphs[1], /IBAN terminado em 0154 \(pedido a 04-11-2026 às 10:42/);
  assert.match(iban.paragraphs[2], /«Não fui eu»/);
  assert.throws(() => r.ibanConfirmText(SITE, TOKEN, IBAN, "2026-11-04T10:42:00Z"), /4 caracteres/);
  assert.throws(() => r.verifyEmailText(SITE, "abc?x=1"), /Token inválido/);
  const exists = render(r.accountExistsText(SITE)).html;
  assert.ok(exists.includes(`${SITE}/conta/entrar`) && exists.includes(`${SITE}/conta/recuperar`));
  const alert = r.revealAlertText("https://dash.example/", "Rui <Gestor>", 10);
  assert.match(alert.paragraphs[0], /revelou 10 IBAN nas últimas 24 h/);
  assert.ok(!render(alert).html.includes("<Gestor>"));
  assert.match(render(r.accountDeletedText()).html, /Loja do Ouro Criadores · criadores\.lojadoouro\.pt/);
});

// ---------------------------------------------------------------- redact

test("redact removes Graph API secrets, JSON fields and Bearer tokens", () => {
  const url = "GET https://graph.facebook.com/v26.0/oauth/access_token?client_id=1353722143373745&redirect_uri=https%3A%2F%2Fcriadores.lojadoouro.pt%2Fapi%2Fc%2Fmeta%2Fcallback&client_secret=abc123SECRET&code=AQDxyzCODE#_=_ failed";
  const a = r.redact(url);
  assert.ok(!a.includes("abc123SECRET") && !a.includes("AQDxyzCODE"), a);
  assert.match(a, /client_secret=\[removido\]&code=\[removido\]/);
  assert.match(a, /client_id=1353722143373745/);
  const b = r.redact("https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=EAAshort1&client_secret=s3cr3t");
  assert.ok(!b.includes("EAAshort1") && !b.includes("s3cr3t"), b);
  assert.match(b, /grant_type=fb_exchange_token/);
  const c = r.redact("https://graph.facebook.com/debug_token?input_token=EAAGuser&access_token=1353722143373745|appSecretValue123456");
  assert.ok(!c.includes("EAAGuser") && !c.includes("appSecretValue123456"), c);
  const d = r.redact("https://graph.facebook.com/v26.0/me?fields=id&access_token=EAAB123&appsecret_proof=deadbeef&refresh_token=rt1&signed_request=sr.payload");
  for (const s of ["EAAB123", "deadbeef", "rt1", "sr.payload"]) assert.ok(!d.includes(s), `${s} em ${d}`);
  const json = '{"error":{"message":"Invalid OAuth access token","type":"OAuthException","code":190,"error_subcode":460},"access_token":"EAAX","client_secret":"cs1"}';
  const e = r.redact(json);
  assert.ok(!e.includes("EAAX") && !e.includes("cs1"), e);
  assert.match(e, /"code":190/);
  assert.match(e, /"access_token":"\[removido\]"/);
  const escaped = r.redact('detail: "{\\"access_token\\":\\"EAAY\\"}"');
  assert.ok(!escaped.includes("EAAY"), escaped);
  const f = r.redact("Authorization: Bearer abc.def-ghi_123 sent");
  assert.equal(f, "Authorization: Bearer [removido] sent");
  assert.equal(r.redact("Graph error_code=100 count=5"), "Graph error_code=100 count=5");
  assert.equal(r.redact("error_subcode=33&count=5&limit=25"), "error_subcode=33&count=5&limit=25");
  const g = r.redact(`POST /c/conta/confirmar?t=${"ab12".repeat(16)} 200`);
  assert.ok(!g.includes("ab12ab12"), g);
  assert.match(g, /t=\[removido\]/);
  assert.equal(r.redact("t=123"), "t=123");
  const enc = r.redact("next=https%3A%2F%2Fx.pt%2Fcb%3Faccess_token%3DEAAZsecret%26state%3Dok");
  assert.ok(!enc.includes("EAAZsecret"), enc);
  assert.match(enc, /state%3Dok/);
  assert.match(r.redact(new Error("falhou: access_token=EAAQ")), /^Error: falhou: access_token=\[removido\]$/);
  assert.equal(r.redact({ a: 1 }), '{"a":1}');
  assert.equal(r.redact("x".repeat(50), 10).length, 10);
  assert.ok(!r.redact("token EAAGm0PX4ZCpsBAOaZBk1234567890abcdef solto").includes("EAAGm0PX4ZCpsBA"));
});

test("no console.* in lib/criadores/* without redact( (static)", () => {
  const dir = path.join(ROOT, "lib", "criadores");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f)) : [];
  const problems = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/\bconsole\.[a-z]+\s*\(/.test(line) && !/\bredact\(/.test(line)) problems.push(`lib/criadores/${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(problems, []);
});

test("no token links with ?t= in the creators code (static)", () => {
  const roots = [path.join(ROOT, "lib", "criadores"), path.join(ROOT, "app", "(criadores-site)"), path.join(ROOT, "app", "api", "c")];
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []) : []);
  const problems = [];
  for (const file of roots.flatMap(walk)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/[?&]t=/.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)) problems.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------- prazos de conservação

test("retentionProblem: floors, caps, missing keys, text and the inactivity warning", () => {
  const def = { ...r.RETENTION_DEFAULT };
  assert.equal(r.retentionProblem(def), null);
  assert.match(r.retentionProblem({ ...def, payments_years: 9 }), /payments_years.*10 anos/);
  assert.match(r.retentionProblem({ ...def, inactive_months: 6 }), /inactive_months.*12 meses/);
  assert.match(r.retentionProblem({ ...def, consents_years_after_end: 0 }), /consents_years_after_end/);
  assert.match(r.retentionProblem({ ...def, proof_years: 2 }), /proof_years/);
  const missing = { ...def };
  delete missing.audit_decisions_years;
  assert.match(r.retentionProblem(missing), /Falta o prazo.*audit_decisions_years/);
  assert.match(r.retentionProblem({ ...def, messages_months: "24" }), /messages_months.*inteiro/);
  assert.match(r.retentionProblem({ ...def, messages_months: 1.5 }), /inteiro/);
  assert.match(r.retentionProblem({ ...def, inactive_warn_months: 24 }), /inactive_warn_months/);
  assert.match(r.retentionProblem({ ...def, inactive_warn_months: 30 }), /inactive_warn_months/);
  assert.match(r.retentionProblem({ ...def, outbox_days: 3651 }), /3650 dias/);
  assert.match(r.retentionProblem({ ...def, pending_files_hours: 721 }), /720 horas/);
  assert.match(r.retentionProblem({ ...def, payments_years: 31 }), /30 anos/);
  assert.match(r.retentionProblem({ ...def, messages_months: 0 }), /1 mês/);
  assert.match(r.retentionProblem({ ...def, chave_nova: 1 }), /desconhecido: chave_nova/);
  assert.ok(r.retentionProblem(null) && r.retentionProblem([]) && r.retentionProblem("x"));
  // As migrações seguintes juntam chaves: passam pela mesma regra.
  assert.equal(r.retentionProblem({ ...def, public_calls_days: 2 }, [...r.RETENTION_KEYS, "public_calls_days"]), null);
  assert.equal(r.retentionFloor("payments_years"), 10);
  assert.equal(r.retentionFloor("outbox_days"), 1);
  assert.equal(r.retentionUnit("consents_years_after_end"), "years");
  assert.equal(r.retentionMax("pending_files_hours"), 720);
  for (const k of r.RETENTION_KEYS) assert.ok(r.RETENTION_LABEL[k] && r.retentionUnit(k), k);
});

test("retention default matches migration A", needsMigration, () => {
  const m = /retention jsonb not null default '(\{[\s\S]*?\})'::jsonb/.exec(MIG.sql);
  assert.ok(m, `${MIG.file}: valor por omissão de retention não encontrado`);
  assert.deepEqual(JSON.parse(m[1]), { ...r.RETENTION_DEFAULT });
});

// ---------------------------------------------------------------- Markdown legal

test("legal Markdown render lets through no <script>, javascript: or raw HTML", () => {
  const md = [
    "# Política de Privacidade",
    "",
    "Texto com **negrito**, *itálico* e _também_ itálico, snake_case_intacto.",
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "",
    "- [CNPD](https://www.cnpd.pt) e [Dados Meta](/dados-meta)",
    "- [mau](javascript:alert) e [mau2](JavaScript:x) e [dados](data:text/html,x) e [rel](//evil.com)",
    "- [p](javascript:alert(1))",
    "- [http](http://inseguro.pt)",
    "1. primeiro",
    "2. segundo",
    "",
    "> *Dados públicos do Instagram:* em Redes.",
    "",
    "---",
    "## Fim",
  ].join("\n");
  const html = r.legalMarkdownToHtml(md);
  assert.ok(!/<script|<img/i.test(html) && !html.includes('onerror="'), html);
  assert.ok(!/href="(?:javascript|data|http:|\/\/)/i.test(html), html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<h2>Política de Privacidade<\/h2>/);
  assert.match(html, /<strong>negrito<\/strong>/);
  assert.match(html, /<em>itálico<\/em> e <em>também<\/em> itálico, snake_case_intacto\./);
  assert.match(html, /<a href="https:\/\/www\.cnpd\.pt\/" rel="noopener noreferrer nofollow">CNPD<\/a>/);
  assert.match(html, /<a href="\/dados-meta">Dados Meta<\/a>/);
  assert.match(html, /<li>mau e mau2 e dados e rel<\/li>/);
  assert.match(html, /<li>\[p\]\(javascript:alert\(1\)\)<\/li>/);
  assert.match(html, /<li>http<\/li>/);
  assert.match(html, /<ol><li>primeiro<\/li><li>segundo<\/li><\/ol>/);
  assert.match(html, /<p><em>Dados públicos do Instagram:<\/em> em Redes\.<\/p>/);
  assert.match(html, /<hr>\n<h3>Fim<\/h3>/);
  const blocks = r.parseLegalMarkdown(md);
  assert.equal(blocks[0].t, "h");
  assert.ok(blocks.every((b) => ["h", "p", "ul", "ol", "hr"].includes(b.t)));
  assert.equal(r.safeLegalHref("https://x.pt/a?b=1").internal, false);
  assert.equal(r.safeLegalHref("/termos").internal, true);
  assert.equal(r.safeLegalHref("javascript:alert(1)"), null);
  assert.equal(r.safeLegalHref("/\\evil.com"), null);
  assert.equal(r.legalMarkdownToHtml(""), "");
});

// ---------------------------------------------------------------- seeds dos documentos legais (rev. R-M12, META-4)

test("privacy and meta_data seeds say what the review requires (reads migration A)", needsMigration, () => {
  const privacy = seedBody(MIG.sql, "privacy");
  const meta = seedBody(MIG.sql, "meta_data");
  assert.ok(privacy && privacy.length > 500, `${MIG.file}: seed privacy não encontrado`);
  assert.ok(meta && meta.length > 100, `${MIG.file}: seed meta_data não encontrado`);
  for (const bad of ["Cloudinary", "fornecedor de autenticação", "data de nascimento", "[30] dias", "adequação temática", "autenticação forte",
    "encaminhamento de pedidos de IA", "Instagram Login"])
    assert.ok(!privacy.includes(bad), `privacy contém «${bad}»`);
  for (const good of ["www.cnpd.pt", "/dados-meta", "biografia"]) assert.ok(privacy.includes(good), `privacy sem «${good}»`);
  for (const good of ["Parar a leitura e apagar os dados públicos", "Integrações"]) assert.ok(meta.includes(good), `meta_data sem «${good}»`);
  // O render aceita os seeds sem deixar passar HTML.
  assert.ok(!/<script/i.test(r.legalMarkdownToHtml(privacy)));
});
