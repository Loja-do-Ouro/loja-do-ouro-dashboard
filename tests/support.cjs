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
