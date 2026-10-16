const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/support/rules.js");
const perm = require("../.test-build/permissions.js");

test("Zendesk is the source of truth for ticket status, in both directions", () => {
  assert.equal(r.fromZendeskStatus("new"), "novo");
  assert.equal(r.fromZendeskStatus("open"), "em_atendimento");
  assert.equal(r.fromZendeskStatus("hold"), "em_atendimento");
  assert.equal(r.fromZendeskStatus("pending"), "aguarda_cliente");
  assert.equal(r.fromZendeskStatus("solved"), "resolvido");
  assert.equal(r.fromZendeskStatus("closed"), "resolvido");
  // Zendesk does not accept going back to "new".
  assert.equal(r.toZendeskStatus("novo"), "open");
  assert.equal(r.toZendeskStatus("em_atendimento"), "open");
  assert.equal(r.toZendeskStatus("aguarda_cliente"), "pending");
  assert.equal(r.toZendeskStatus("resolvido"), "solved");
});

test("A new customer message reopens a resolved conversation by an explicit rule", () => {
  assert.equal(r.statusAfterCustomerMessage("resolvido", false), "novo");
  assert.equal(r.statusAfterCustomerMessage("resolvido", true), "em_atendimento");
  assert.equal(r.statusAfterCustomerMessage("aguarda_cliente", false), "em_atendimento");
  assert.equal(r.statusAfterCustomerMessage("em_atendimento", true), "em_atendimento");
  assert.equal(r.statusAfterCustomerMessage("novo", false), "novo");
});

test("A send without an answer is uncertain, never failed or accepted", () => {
  assert.equal(r.sendOutcome(200), "accepted");
  assert.equal(r.sendOutcome(201), "accepted");
  assert.equal(r.sendOutcome(null), "uncertain");
  assert.equal(r.sendOutcome(500), "uncertain");
  assert.equal(r.sendOutcome(504), "uncertain");
  assert.equal(r.sendOutcome(408), "uncertain");
  assert.equal(r.sendOutcome(400), "failed");
  assert.equal(r.sendOutcome(403), "failed");
  assert.equal(r.sendOutcome(422), "failed");
});

test("Errors back off progressively, capped at 30 minutes, honouring Retry-After", () => {
  assert.equal(r.backoffSeconds(60, 1), 120);
  assert.equal(r.backoffSeconds(60, 2), 240);
  assert.equal(r.backoffSeconds(60, 10), 1800);
  assert.equal(r.backoffSeconds(60, 1, 600), 600);
});

test("A Zendesk reply is never presented as delivered", () => {
  assert.match(r.zendeskReplyWarning("email"), /não significa entregue/);
  assert.match(r.zendeskReplyWarning("native_messaging"), /validar com um ticket de teste/);
  assert.equal(r.DELIVERY_LABEL.accepted, "Aceite pela plataforma");
});

test("Remote HTML is reduced to plain text", () => {
  assert.equal(r.plainText("<p>Olá <b>Ana</b></p><script>alert(1)</script><p>Até já &amp; obrigado</p>"), "Olá Ana\nAté já & obrigado");
  assert.equal(r.plainText('<img src=x onerror="alert(1)">texto'), "texto");
});

test("Only the Super Admin and people with support access open Apoio ao Cliente", () => {
  const base = { id: "x", online: false, stores: [] };
  assert.equal(perm.canSupport({ ...base, isSuper: true }), true);
  assert.equal(perm.canSupport({ ...base, isSuper: false, support: true }), true);
  assert.equal(perm.canSupport({ ...base, isSuper: false }), false);
  assert.equal(perm.homePath({ ...base, isSuper: false, support: true }), "/apoio");
  assert.equal(r.isStatus("resolvido"), true);
  assert.equal(r.isStatus("closed"), false);
  assert.equal(r.isUuid("6c5a81c8-3878-468a-8fbc-858876231fc4"), true);
  assert.equal(r.isUuid("1; drop table"), false);
});

test("The encryption key must be the 44-character result, never the command or a phrase", () => {
  const good = require("node:crypto").randomBytes(32).toString("base64");
  assert.equal(r.keyProblem(good), null);
  assert.match(r.keyProblem(`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), /comando em vez do resultado/);
  assert.match(r.keyProblem(""), /em falta/);
  assert.match(r.keyProblem("uma frase longa qualquer com mais de trinta e dois"), /comando|inválida/);
  assert.match(r.keyProblem("abc"), /inválida/);
});

test("Attachments are previewed only when the bytes match a safe type", () => {
  const b = (...x) => new Uint8Array(x);
  const ascii = (s, pad = 0) => new Uint8Array([...Array(pad).fill(0x20), ...[...s].map((c) => c.charCodeAt(0))]);
  assert.equal(r.sniffType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(r.sniffType(b(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(r.sniffType(ascii("%PDF-1.7")), "application/pdf");
  assert.equal(r.sniffType(ascii("%PDF-1.4", 10)), "application/pdf");
  assert.equal(r.sniffType(new Uint8Array([0, 0, 0, 0x18, ...[..."ftypmp42"].map((c) => c.charCodeAt(0))])), "video/mp4");
  assert.equal(r.sniffType(ascii("OggS")), "audio/ogg");
  // HTML ou SVG disfarçados nunca são mostrados em linha.
  assert.equal(r.sniffType(ascii("<svg onload=alert(1)>")), null);
  assert.equal(r.sniffType(ascii("<html><script>")), null);
  assert.equal(r.previewKind("image/svg+xml"), "file");
  assert.equal(r.previewKind("application/pdf"), "pdf");
  assert.equal(r.previewKind("video/mp4"), "video");
  assert.equal(r.previewKind("audio/ogg; codecs=opus"), "audio");
  assert.equal(r.previewKind(null), "file");
});

test("Only the owner replies; anyone can take an unowned conversation; owner or Super Admin transfer", () => {
  const owner = { assigneeId: "a", me: "a", isSuper: false };
  const colleague = { assigneeId: "a", me: "b", isSuper: false };
  const boss = { assigneeId: "a", me: "s", isSuper: true };
  const free = { assigneeId: null, me: "b", isSuper: false };
  assert.equal(r.canReply(owner), true);
  assert.equal(r.canReply(colleague), false);
  assert.equal(r.canReply(boss), false, "the Super Admin also has to take the conversation over first");
  assert.equal(r.canReply(free), true);
  assert.equal(r.canChangeStatus(colleague), false);
  assert.equal(r.canChangeStatus(boss), true);
  assert.equal(r.canChangeStatus(free), true);
  assert.equal(r.canTransfer(owner), true);
  assert.equal(r.canTransfer(colleague), false);
  assert.equal(r.canTransfer(boss), true);
  assert.equal(r.canTransfer(free), false);

  assert.deepEqual(r.assignmentChange(free, "b"), { kind: "claim" });
  assert.match(r.assignmentChange(free, "c").error, /a si próprio/);
  assert.deepEqual(r.assignmentChange({ ...free, isSuper: true }, "c"), { kind: "assign" });
  assert.deepEqual(r.assignmentChange(owner, "b"), { kind: "transfer" });
  assert.deepEqual(r.assignmentChange(boss, "s"), { kind: "transfer" });
  assert.match(r.assignmentChange(colleague, "b", "Bárbara").error, /está com Bárbara/);
  assert.match(r.assignmentChange(owner, null).error, /Super Admin/);
  assert.deepEqual(r.assignmentChange(boss, null), { kind: "release" });
  assert.deepEqual(r.assignmentChange(owner, "a"), { kind: null });
});

test("Customers only ever see the colleague's first name", () => {
  assert.equal(r.firstName("  Bárbara   Sousa Lima "), "Bárbara");
  assert.equal(r.firstName(""), null);
  assert.equal(r.firstName(null), null);
});

test("Order numbers the customer typed are found for a quick lookup", () => {
  assert.deepEqual(r.orderNumbersIn(["Olá, a minha encomenda #12345 ainda não chegou", "A encomenda nº 12346 e a #12345"]), ["12345", "12346"]);
  assert.deepEqual(r.orderNumbersIn(["Encomenda 54321 por favor", "encomenda número 1234"]), ["54321", "1234"]);
  assert.deepEqual(r.orderNumbersIn(["Ligue-me para 912345678", "Custa 1999 euros", "#12"]), []);
});

test("Meta #551 becomes a clear explanation and blocks retries until the customer writes again", () => {
  // Texto exato guardado em produção (cortado aos 160 caracteres pela mensagem genérica).
  const raw = '{"status":"BAD_REQUEST","code":"400","title":"es.bewwweb.blogsportal.restClient.InvalidTokenException: (#551) This person isn\'t available right now. [providerCo';
  const fb = r.metaSendRefusal(raw, "Messenger");
  assert.match(fb, /^Não enviada: o Messenger não aceita mensagens nossas para esta pessoa \(Meta #551\)\./);
  assert.ok(fb.length <= 500, "cabe em delivery_detail");
  assert.match(r.metaSendRefusal("This person isn’t receiving messages from you right now.", "Instagram"), /o Instagram/);
  assert.equal(r.metaSendRefusal('{"status":"BAD_REQUEST","title":"(#100) Invalid parameter"}', "Messenger"), null);
  assert.equal(r.metaSendRefusal("", "Messenger"), null);
  assert.equal(r.metaSendRefusal(null, "Messenger"), null);

  const inbound = (at) => ({ kind: "inbound", delivery: null, delivery_detail: null, created_at: at });
  const failed = (at, detail) => ({ kind: "outbound", delivery: "failed", delivery_detail: detail, created_at: at });
  const legacy = `Envio: Metricool recusou o pedido (HTTP 400 · ${raw}).`;
  assert.equal(r.metaUnreachable([inbound("2026-10-14T21:39:09+00:00"), failed("2026-10-15T08:51:42.964+00:00", legacy)]), true);
  assert.equal(r.metaUnreachable([inbound("2026-10-14T21:39:09+00:00"), failed("2026-10-15T08:51:42.964+00:00", fb)]), true);
  // O cliente voltou a escrever depois da recusa: pode tentar outra vez.
  assert.equal(r.metaUnreachable([failed("2026-10-15T08:51:42+00:00", fb), inbound("2026-10-15T10:00:00+00:00")]), false);
  // Outra falha qualquer não bloqueia.
  assert.equal(r.metaUnreachable([inbound("2026-10-14T21:39:09+00:00"), failed("2026-10-15T08:51:42+00:00", "Envio: Metricool recusou o pedido (HTTP 400 · (#100) x).")]), false);
  assert.equal(r.metaUnreachable([]), false);
  // Depois da recusa, uma mensagem nossa passou (por exemplo, no Meta Business Suite): a pessoa voltou a estar contactável.
  const accepted = (at) => ({ kind: "outbound", delivery: "accepted", delivery_detail: null, created_at: at });
  assert.equal(r.metaUnreachable([inbound("2026-10-14T21:39:09+00:00"), failed("2026-10-15T08:51:42+00:00", fb), accepted("2026-10-16T08:00:00+00:00")]), false);
  assert.equal(r.metaUnreachable([inbound("2026-10-14T21:39:09+00:00"), accepted("2026-10-15T08:00:00+00:00"), failed("2026-10-15T08:51:42+00:00", fb)]), true);
});

test("Site chat visitors carry the brand of the domain and the language of the site", () => {
  // Dados da BD: língua vazia conta como português; país só com duas maiúsculas.
  assert.deepEqual(r.visitorSite({ site: "gsp", locale: "es", country: "ES" }), { site: "gsp", locale: "es", country: "ES" });
  assert.deepEqual(r.visitorSite({ site: "ldo", locale: null, country: "pt" }), { site: "ldo", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite({ site: "gsp", locale: "it", country: null, page_url: "https://www.goldstorepremium.com/" }), { site: "gsp", locale: "pt", country: null });
  // Sem marca (servidor anterior às línguas): pela página.
  assert.deepEqual(r.visitorSite({ page_url: "https://www.goldstorepremium.com/products/anel" }), { site: "gsp", locale: "en", country: null });
  assert.deepEqual(r.visitorSite({ page_url: "https://www.goldstorepremium.com/pt-pt/products/anel" }), { site: "gsp", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite({ page_url: "https://www.lojadoouro.pt/es/products/anel" }), { site: "ldo", locale: "es", country: null });
  assert.deepEqual(r.visitorSite({ page_url: "https://www.lojadoouro.pt/" }), { site: "ldo", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite({ page_url: "https://www.goldstorepremium.com.evil.example/" }), { site: "ldo", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite({ page_url: "não é url" }), { site: "ldo", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite(null), { site: "ldo", locale: "pt", country: null });
  // Sem os dados do visitante, a conta da conversa diz a marca; os dados da BD prevalecem.
  assert.deepEqual(r.visitorSite(null, "goldstorepremium.com"), { site: "gsp", locale: "en", country: null });
  assert.deepEqual(r.visitorSite(undefined, "lojadoouro.pt"), { site: "ldo", locale: "pt", country: null });
  assert.deepEqual(r.visitorSite({ site: "ldo", locale: "en" }, "goldstorepremium.com"), { site: "ldo", locale: "en", country: null });

  // Ligações do catálogo (www.lojadoouro.pt, em português) no site e na língua do cliente.
  const anel = "https://www.lojadoouro.pt/products/anel?variant=1";
  assert.equal(r.siteLink(anel, "gsp", "es"), "https://www.goldstorepremium.com/es/products/anel?variant=1");
  assert.equal(r.siteLink(anel, "gsp", "en"), "https://www.goldstorepremium.com/products/anel?variant=1");
  assert.equal(r.siteLink(anel, "ldo", "de"), "https://www.lojadoouro.pt/de/products/anel?variant=1");
  assert.equal(r.siteLink(anel, "ldo", "pt"), anel);
  assert.equal(r.siteLink("https://lojadoouro.pt/en/collections/aneis", "gsp", "pt"), "https://www.goldstorepremium.com/pt-pt/collections/aneis");
  assert.equal(r.siteLink("https://www.lojadoouro.pt", "gsp", "es"), "https://www.goldstorepremium.com/es/");
  assert.equal(r.siteLink("https://www.lojadoouro.pt/es-tudo", "ldo", "en"), "https://www.lojadoouro.pt/en/es-tudo");
  assert.equal(r.siteLink("https://www.lojadoouro.pt.evil.example/products/anel", "gsp", "en"), "https://www.lojadoouro.pt.evil.example/products/anel");
  assert.equal(r.siteLink("https://exemplo.com/products/anel", "gsp", "en"), "https://exemplo.com/products/anel");

  assert.equal(r.siteRootUrl("ldo", "pt"), "https://www.lojadoouro.pt/");
  assert.equal(r.siteRootUrl("ldo", "de"), "https://www.lojadoouro.pt/de/");
  assert.equal(r.siteRootUrl("gsp", "en"), "https://www.goldstorepremium.com/");
  assert.equal(r.siteRootUrl("gsp", "pt"), "https://www.goldstorepremium.com/pt-pt/");
  // A Gold Store Premium não tem francês nem alemão: fica a raiz.
  assert.equal(r.siteRootUrl("gsp", "fr"), "https://www.goldstorepremium.com/");
  assert.deepEqual(r.SITE_LOCALES.map((l) => r.LOCALE_LABEL[l]), ["português", "inglês", "espanhol", "francês", "alemão"]);
});
