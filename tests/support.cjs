const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

test("A missing Metricool connection (UserConnection null) becomes a clear explanation, never the Java text", () => {
  // Textos exatos gravados em produção a 28/29-10-2026: no envio (cortado aos 160 caracteres) e na sincronização.
  const sent = 'Envio: Metricool recusou o pedido (HTTP 400 · {"status":"BAD_REQUEST","code":"400","title":"java.lang.NullPointerException: Cannot invoke \\"es.bewwweb.blogsportal.model.userconnection.UserConnection.getAcce).';
  const synced = 'Autorizações INSTAGRAM: Metricool recusou o pedido (HTTP 400 · {"status":"BAD_REQUEST","code":"400","title":"Cannot invoke \\"es.bewwweb.blogsportal.model.userconnection.UserConnection.getAccessToken()\\" because \\"connection).';
  const full = '{"status":"BAD_REQUEST","code":"400","title":"java.lang.NullPointerException: Cannot invoke \\"es.bewwweb.blogsportal.model.userconnection.UserConnection.getAccessToken()\\" because \\"connection\\" is null"}';
  for (const raw of [sent, synced, full]) assert.equal(r.metricoolFault(raw, "Facebook", "envio", 400).kind, "connection", raw);

  const ig = r.metricoolFault(full, "Instagram", "envio", 400).text;
  assert.match(ig, /^Não enviada: a Metricool não encontra, para o utilizador do token da API, a ligação do Instagram nesta marca\./);
  assert.match(ig, /Nada chegou ao cliente/);
  assert.match(ig, /Meta Business Suite/);
  // Verificar e confirmar com a Metricool antes de religar (religar não resolveu da primeira vez); sem atribuir culpas.
  assert.match(ig, /Quem gere a Metricool: ver Configuração → Validar ligações e confirmar com a Metricool; se religar, na mesma marca, com a conta do token da API e um perfil com controlo total da página \(Instagram através do Facebook\)\./);
  assert.doesNotMatch(ig, /dashboard\)|lado da Metricool/);
  assert.match(ig, /\(Ref\. Metricool: UserConnection nula, HTTP 400\)$/);
  assert.match(r.metricoolFault(sent, "Facebook", "envio", 400).text, /^Não enviada: a Metricool não encontra, para o utilizador do token da API, a ligação do Facebook nesta marca\./);
  const otherNpe = 'java.lang.NullPointerException: Cannot invoke "java.util.List.size()" because "messages" is null';
  for (const net of ["Facebook", "Instagram"]) {
    for (const where of ["envio", "comentario", "sincronizacao"]) {
      for (const raw of [full, "(#190) Error validating access token: The session has been invalidated", otherNpe]) {
        const t = r.metricoolFault(raw, net, where, 400).text;
        assert.ok(t.length <= 500, `${net} ${where}: ${t.length}`);
        // Na sincronização vem depois do nome do pedido (last_error guarda 500 caracteres).
        if (where === "sincronizacao") assert.ok(`Autorizações de comentários INSTAGRAMBUSINESS: ${t}`.length <= 500);
        assert.doesNotMatch(t, /java\.|es\.bewwweb|getAccessToken|BAD_REQUEST/);
      }
    }
  }
  assert.doesNotMatch(ig, /NullPointer/);
  assert.match(r.metricoolFault(full, "Facebook", "comentario", 400).text, /^Não publicada: .*Nada foi publicado/);
  assert.match(r.metricoolFault(full, "Facebook", "sincronizacao", 400).text, /^a Metricool não encontra, para o utilizador do token da API, a ligação do Facebook nesta marca\. Sem ela não entram mensagens novas/);

  // Sessão da Meta anulada (#190) e outros erros internos da Metricool.
  const token = r.metricoolFault('{"title":"es.bewwweb.blogsportal.restClient.InvalidTokenException: (#190) Error validating access token: The session has been invalidated"}', "Facebook", "envio", 400);
  assert.equal(token.kind, "token");
  assert.match(token.text, /^Não enviada: a Meta deixou de aceitar a autorização da Metricool para o Facebook.*Para repor: religar o Facebook na mesma marca, com a conta do token da API.*\(Ref\. Meta #190\)$/);
  const npe = r.metricoolFault(otherNpe, "Instagram", "envio", 400);
  assert.equal(npe.kind, "internal");
  // Um 400 fica "Falhou" (sendOutcome): o texto diz que nada saiu, não "confirme se chegou".
  assert.match(npe.text, /^Erro interno da Metricool \(NullPointerException\)\. Nada foi enviado ao cliente; pode tentar outra vez; se repetir, avise a Metricool/);
  assert.match(r.metricoolFault(otherNpe, "Facebook", "comentario", 400).text, /\. Nada foi publicado; pode tentar outra vez/);
  assert.match(r.metricoolFault(otherNpe, "Facebook", "envio", null).text, /Confirme no Meta Business Suite se chegou ao cliente antes de reenviar/);
  assert.match(r.metricoolFault(otherNpe, "Facebook", "sincronizacao", 400).text, /^erro interno da Metricool \(NullPointerException\)\. A sincronização volta a tentar sozinha/);
  // "Cannot invoke … is null" sem o nome da exceção também é uma NullPointerException.
  assert.match(r.metricoolFault('{"title":"Cannot invoke \\"java.util.Map.get(Object)\\" because \\"m\\" is null"}', "Facebook", "envio", 400).text, /\(NullPointerException\)/);
  // Outras exceções do Java são recusas normais com o motivo: ficam com o texto original (failure()).
  assert.equal(r.metricoolFault('{"title":"java.lang.IllegalArgumentException: The text exceeds the maximum length of 1000 characters"}', "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault("java.lang.IllegalStateException: x", "Facebook", "sincronizacao", 400), null);
  // 401/403 (acesso) e 429 (limite) têm o texto próprio de failure(), no envio como na sincronização.
  for (const status of [401, 403, 429]) {
    assert.equal(r.metricoolFault(full, "Facebook", "envio", status), null, String(status));
    assert.equal(r.metricoolFault("java.lang.NullPointerException: rate limit", "Facebook", "comentario", status), null, String(status));
  }
  // Nunca repete o texto da Metricool (podia trazer HTML).
  assert.doesNotMatch(r.metricoolFault("java.lang.NullPointerException: <img src=x onerror=1>", "Facebook", "envio", 400).text, /</);

  // Não é uma falha de ligação: fica como estava (o #551 tem a sua explicação; #100 e outros, o texto original).
  const p551 = '{"status":"BAD_REQUEST","code":"400","title":"es.bewwweb.blogsportal.restClient.InvalidTokenException: (#551) This person isn\'t available right now. [providerCo';
  assert.equal(r.metricoolFault(p551, "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault('{"status":"BAD_REQUEST","title":"(#100) Invalid parameter"}', "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault('{"title":"es.bewwweb.blogsportal.restClient.InvalidTokenException: (#100) This attachment format is not supported."}', "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault('{"status":"BAD_REQUEST","code":"400","title":"conversationId must not be null"}', "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault("", "Facebook", "envio", 400), null);
  assert.equal(r.metricoolFault(null, "Facebook", "envio", 400), null);

  // Uma falha de ligação não bloqueia novas tentativas como o #551.
  const inbound = { kind: "inbound", delivery: null, delivery_detail: null, created_at: "2026-10-27T21:00:00Z" };
  const failed = { kind: "outbound", delivery: "failed", delivery_detail: ig, created_at: "2026-10-28T10:03:19Z" };
  assert.equal(r.metaUnreachable([inbound, failed]), false);
  assert.equal(r.metaUnreachable([inbound, { ...failed, delivery_detail: sent }]), false);

  // Mensagens e erros gravados antes desta explicação: mostrados com o mesmo texto.
  assert.match(r.metricoolDetail(sent, "Facebook"), /^Não enviada: a Metricool não encontra, para o utilizador do token da API, a ligação do Facebook/);
  assert.match(r.metricoolDetail(synced, "Instagram"), /^Autorizações INSTAGRAM: a Metricool não encontra, para o utilizador do token da API, a ligação do Instagram/);
  // Uma recusa normal gravada antes (exceção do Java com o motivo) fica com o texto original.
  const tooLong = 'Envio: Metricool recusou o pedido (HTTP 400 · {"title":"java.lang.IllegalArgumentException: The text exceeds the maximum length"}).';
  assert.equal(r.metricoolDetail(tooLong, "Facebook"), tooLong);
  const legacy551 = `Envio: Metricool recusou o pedido (HTTP 400 · ${p551}).`;
  assert.equal(r.metricoolDetail(legacy551, "Facebook"), legacy551);
  assert.equal(r.metricoolDetail("Sem confirmação da Metricool; verificar antes de reenviar.", "Facebook"), "Sem confirmação da Metricool; verificar antes de reenviar.");
  assert.equal(r.metricoolDetail(null, "Facebook"), null);

  // INSTAGRAMBUSINESS (Instagram ligado pelo login do Instagram) é Instagram, não Messenger.
  assert.equal(r.metricoolNetwork("INSTAGRAMBUSINESS"), "Instagram");
  assert.equal(r.metricoolNetwork("INSTAGRAM"), "Instagram");
  assert.equal(r.metricoolNetwork("FACEBOOK"), "Facebook");
  assert.equal(r.metricoolNetwork(undefined), "Facebook");
});

test("The Metricool brand check keeps only ids and states and explains what is wrong", () => {
  const raw = {
    id: 2912472, label: "Loja do Ouro Jericó", userId: 2334170, ownerUserId: 2334170, isShared: false, deleted: false,
    firstConnectionDate: "2025-03-04T10:00:00+01:00", facebookPageId: "618695038234056", facebook: "Loja do Ouro", instagram: "lojadoouro",
    instagramConnectionType: "FACEBOOK_LOGIN", fbUserId: "1234567890", ownerUsername: "dono@exemplo.pt", hash: "abc", whiteLabelLink: "https://x",
    facebookPicture: "https://img", instagramPicture: "https://img", customEmail: "a@b.pt", inUserId: "9",
    brandRole: { name: "Owner", actions: { viewInbox: true, fullAccessInbox: true, viewAnalytics: true, editBrand: true } },
  };
  const safe = r.safeMetricoolBrand(raw);
  assert.deepEqual(Object.keys(safe).sort(), ["deleted", "facebookPageId", "fbUserId", "firstConnectionDate", "id", "instagram", "instagramConnectionType",
    "isShared", "label", "ownerUserId", "role", "userId"]);
  assert.equal(safe.fbUserId, true);
  assert.equal(safe.instagram, true);
  assert.equal(safe.firstConnectionDate, "2025-03-04T09:00:00.000Z");
  assert.deepEqual(safe.role, { name: "Owner", viewInbox: true, fullAccessInbox: true, viewAnalytics: true });
  const json = JSON.stringify(safe);
  for (const leak of ["dono@exemplo.pt", "abc", "https://", "1234567890", "lojadoouro\"", "a@b.pt"]) assert.ok(!json.includes(leak), leak);
  assert.equal(r.safeMetricoolBrand({ label: "sem id" }), null);
  assert.equal(r.safeMetricoolBrand(null), null);
  assert.equal(r.safeMetricoolBrand({ id: 1, label: "<b>x</b>" }).label, "bx/b");
  assert.equal(r.safeMetricoolBrand({ id: 1, facebookPageId: "javascript:1", instagramConnectionType: "OUTRO" }).facebookPageId, null);
  assert.equal(r.safeMetricoolBrand({ id: 1, instagramConnectionType: "OUTRO" }).instagramConnectionType, null);

  const account = { userId: "2334170", blogId: "2912472" };
  const expected = { facebookPageId: "618695038234056" };
  const ok = { status: 200, allowAccessToMessages: true, missingScopes: [] };
  const now = new Date("2026-10-27T12:00:00Z");
  const base = { account, brands: [safe], expected, inbox: { FACEBOOK: ok, INSTAGRAM: ok }, now };
  assert.deepEqual(r.metricoolBrandFindings(base), [{ level: "ok", text: "Marca, página de Facebook, Instagram e autorizações da Inbox como esperado." }]);

  const texts = (input) => r.metricoolBrandFindings(input).map((f) => `${f.level}: ${f.text}`).join("\n");
  assert.match(texts({ ...base, brands: [] }), /^erro: A marca 2912472 não aparece nas marcas do utilizador Metricool 2334170/);
  assert.match(texts({ ...base, brands: null, brandsStatus: 403 }), /^aviso: A lista de marcas da Metricool não respondeu \(HTTP 403\)/);
  assert.match(texts({ ...base, brands: [{ ...safe, facebookPageId: "111" }] }), /erro: A página de Facebook ligada à marca \(111\) não é a das conversas guardadas \(618695038234056\)/);
  assert.match(texts({ ...base, brands: [{ ...safe, facebookPageId: null }] }), /erro: A marca não tem página de Facebook ligada/);
  assert.match(texts({ ...base, brands: [{ ...safe, instagram: false }] }), /erro: A marca não tem conta de Instagram ligada/);
  assert.match(texts({ ...base, brands: [{ ...safe, ownerUserId: 999 }] }), /aviso: A marca é do utilizador Metricool 999; o dashboard usa o userId 2334170/);
  assert.match(texts({ ...base, brands: [{ ...safe, role: { name: "Editor", viewInbox: true, fullAccessInbox: false, viewAnalytics: false } }] }),
    /erro: O papel do utilizador da API nesta marca \(Editor\) não dá acesso total à Caixa de entrada[\s\S]*aviso: .*não dá acesso às Analytics/);
  // Papel sem "actions" (por exemplo, o dono da marca): permissões desconhecidas, nunca um erro falso.
  for (const brandRole of [{ name: "Owner" }, { name: "Owner", actions: null }, { name: "Owner", actions: { viewInbox: "sim" } }]) {
    const owner = r.safeMetricoolBrand({ ...raw, brandRole });
    assert.deepEqual(owner.role, { name: "Owner", viewInbox: null, fullAccessInbox: null, viewAnalytics: null });
    assert.deepEqual(r.metricoolBrandFindings({ ...base, brands: [owner] }), [{ level: "ok", text: "Marca, página de Facebook, Instagram e autorizações da Inbox como esperado." }]);
  }
  assert.match(texts({ ...base, brands: [{ ...safe, fbUserId: false }] }), /aviso: A marca não indica o perfil de Facebook que autorizou a ligação/);
  // Religação noutra marca: a mesma página aparece noutra marca.
  assert.match(texts({ ...base, brands: [safe, { ...safe, id: 3000001, label: "Loja do Ouro (2)" }] }), /aviso: A marca 3000001 «Loja do Ouro \(2\)» também tem a página de Facebook 618695038234056/);
  assert.match(texts({ ...base, brands: [{ ...safe, id: 3000001, label: "Nova" }] }), /erro: A marca 2912472 não aparece[\s\S]*aviso: A marca 3000001 «Nova» também tem a página/);

  // O caso de 28-10-2026: Instagram sem ligação na marca e o Facebook sem mensagens novas apesar de sincronizar.
  const npe = { status: 400, fault: "connection" };
  // A lista do Facebook responde 200 com 0 conversas (normalmente ~100): erro, mesmo com as autorizações OK.
  const today = texts({ ...base, inbox: { FACEBOOK: ok, INSTAGRAM: npe, INSTAGRAMBUSINESS: { status: 400, fault: "connection" } },
    listed: { FACEBOOK: 0, INSTAGRAM: 0 },
    lastInbound: { Facebook: "2026-10-27T23:50:36Z", Instagram: "2026-10-27T21:24:16Z" },
    lastSuccess: { Facebook: "2026-10-29T10:05:00Z", Instagram: "2026-10-28T07:25:05Z" }, now: new Date("2026-10-29T10:30:00Z") });
  assert.match(today, /^erro: Inbox FACEBOOK: a Metricool responde sem erro mas devolve 0 conversas do Facebook/);
  assert.match(today, /erro: Inbox INSTAGRAM: a Metricool não encontra a ligação do Instagram na marca \(UserConnection nula\) para o utilizador do token da API\. Confirmar com a Metricool/);
  // O Instagram já tem o erro da ligação: sem segundo erro pela lista vazia.
  assert.doesNotMatch(today, /0 conversas do Instagram/);
  assert.match(today, /aviso: Nenhuma mensagem nova do Facebook desde 27\/10, 23:50 \(mais de 24 h, com a sincronização a funcionar\)/);
  // O Instagram deixou de sincronizar 10 h depois da última mensagem: o aviso de silêncio não se aplica (já há o erro).
  assert.doesNotMatch(today, /Nenhuma mensagem nova do Instagram/);
  assert.doesNotMatch(today, /INSTAGRAMBUSINESS/);
  // A funcionar: a lista traz conversas e não há aviso.
  assert.deepEqual(r.metricoolBrandFindings({ ...base, listed: { FACEBOOK: 94, INSTAGRAM: 100 } }).map((f) => f.level), ["ok"]);
  assert.deepEqual(r.metricoolBrandFindings({ ...base, listed: { FACEBOOK: null } }).map((f) => f.level), ["ok"]);
  // Mensagem recente: sem aviso. Silêncio de uma noite (13 h) com a sincronização a funcionar: sem aviso.
  assert.doesNotMatch(texts({ ...base, lastInbound: { Facebook: "2026-10-27T08:00:00Z" } }), /Nenhuma mensagem nova/);
  assert.doesNotMatch(texts({ ...base, lastInbound: { Facebook: "2026-10-28T20:00:00Z" }, lastSuccess: { Facebook: "2026-10-29T08:58:00Z" },
    now: new Date("2026-10-29T09:00:00Z") }), /Nenhuma mensagem nova/);
  // Mais de 24 h, mas a sincronização parou pouco depois: sem aviso de silêncio.
  assert.doesNotMatch(texts({ ...base, lastInbound: { Facebook: "2026-10-27T20:00:00Z" }, lastSuccess: { Facebook: "2026-10-28T02:00:00Z" },
    now: new Date("2026-10-29T09:00:00Z") }), /Nenhuma mensagem nova/);
  // Acesso recusado à Inbox (401/403): erro próprio.
  assert.match(texts({ ...base, inbox: { FACEBOOK: { status: 403, fault: null } } }), /erro: Inbox FACEBOOK: a Metricool recusou o acesso \(HTTP 403\)/);
  // Instagram religado pelo login do Instagram: a Inbox responde como INSTAGRAMBUSINESS.
  const business = texts({ ...base, brands: [{ ...safe, instagramConnectionType: "BUSINESS" }], inbox: { FACEBOOK: ok, INSTAGRAM: npe, INSTAGRAMBUSINESS: ok } });
  assert.match(business, /aviso: O Instagram está ligado pelo login do Instagram \(BUSINESS\)/);
  assert.match(business, /aviso: A Inbox responde como INSTAGRAMBUSINESS mas não como INSTAGRAM/);
  assert.match(texts({ ...base, inbox: { FACEBOOK: { status: 200, allowAccessToMessages: false, missingScopes: ["pages_messaging", "<x>"] } } }),
    /erro: Inbox FACEBOOK: a Metricool não tem acesso às mensagens do Facebook \(em falta: pages_messaging\)\./);
  assert.match(texts({ ...base, inbox: { FACEBOOK: { status: 400, fault: "token" } } }), /erro: Inbox FACEBOOK: a Meta anulou a autorização da Metricool \(#190\)/);
  assert.match(texts({ ...base, inbox: { FACEBOOK: { status: null, fault: null } } }), /erro: Inbox FACEBOOK: a Metricool não respondeu como esperado \(sem resposta\)/);
  // Erros antes dos avisos.
  const levels = r.metricoolBrandFindings({ ...base, brands: [{ ...safe, ownerUserId: 999, instagram: false }] }).map((f) => f.level);
  assert.deepEqual(levels, ["erro", "aviso"]);
});

test("A Metricool source starts over when the brand in use changes (Jericó to Loja do Ouro)", () => {
  const old = { brand: "618695038234056", next: "https://app.metricool.com/api/v2/inbox/post-comments?page=x", full_read_at: "2026-10-29T08:25:00Z", auth_at: "2026-10-29T09:35:00Z" };
  // Cursor de antes desta mudança (sem blog): vale a marca da fonte (account).
  assert.deepEqual(r.metricoolCursor(old, "2912472", "7708381"), { blog: "7708381" });
  assert.deepEqual(r.metricoolCursor(old, "2912472", "2912472"), { ...old, blog: "2912472" });
  // Já na marca nova: fica tudo o que foi detetado nela.
  const current = { blog: "7708381", brand: "618695038234056", full_read_at: "2026-10-29T12:00:00Z" };
  assert.deepEqual(r.metricoolCursor(current, "2912472", "7708381"), current);
  // Voltar à marca anterior também recomeça; sem marca conhecida, só regista a atual.
  assert.deepEqual(r.metricoolCursor(current, "2912472", "2912472"), { blog: "2912472" });
  assert.deepEqual(r.metricoolCursor({ brand: "1" }, undefined, "7708381"), { brand: "1", blog: "7708381" });
});

test("Messages before the visible history date are folded in the thread and left out of the AI", () => {
  const m = (created_at) => ({ created_at });
  const msgs = [m("2026-08-31T22:59:59Z"), m("2026-08-31T23:00:00Z"), m("2026-10-01T10:00:00Z")];
  // 1 de setembro de 2026, 00:00 em Lisboa (hora de verão) = 31-08 às 23:00 UTC; a BD devolve a data em UTC.
  assert.deepEqual(r.visibleSince(msgs, "2026-09-01T00:00:00+01:00"), msgs.slice(1));
  assert.deepEqual(r.visibleSince(msgs, "2026-08-31T23:00:00+00:00"), msgs.slice(1));
  // Sem data (antes da migração) ou com uma data ilegível: conta tudo.
  for (const none of [undefined, null, "", "ontem"]) assert.equal(r.visibleSince(msgs, none), msgs, String(none));
  assert.equal(r.visibleSince([m("?")], "2026-09-01T00:00:00+01:00").length, 1);
  assert.equal(r.historyDateLabel("2026-08-31T23:00:00+00:00"), "1 de setembro de 2026");
  assert.equal(r.historyDateLabel("2026-10-29T23:30:00+00:00"), "29 de outubro de 2026");
  assert.equal(r.historyDateLabel(null), null);
});

test("Older assignment events fold behind the history divider with the older messages, keeping the time order", () => {
  const row = (at, kind) => ({ at, kind });
  const rows = [
    row("2026-10-01T09:00:00Z", "message"),
    row("2026-10-08T10:00:00.123+00:00", "event"),
    row("2026-10-20T08:00:00Z", "message"),
    row("2026-10-21T08:00:00Z", "event"),
  ];
  // Data mudada para 20 de outubro (Lisboa, hora de verão): a mudança de responsável de 8/10 vai com a mensagem de 1/10.
  const { older, rest } = r.historySplit(rows, "2026-10-19T23:00:00+00:00");
  assert.deepEqual(older, rows.slice(0, 2));
  assert.deepEqual(rest, rows.slice(2));
  assert.deepEqual([...older, ...rest], rows);
  for (const none of [undefined, null, "", "ontem"]) assert.deepEqual(r.historySplit(rows, none), { older: [], rest: rows }, String(none));
});

test("The history cutoff hides old conversations from the list, counters, suggestions and AI, without blocking access", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261030100000_ldo_support_history_from.sql"), "utf8").replace(/\r\n/g, "\n");
  const fn = (name) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, name);
    return sql.slice(start, sql.indexOf("$$;", start));
  };
  assert.match(sql, /add column if not exists history_from timestamptz not null default '2026-09-01 00:00:00\+01';/);
  // Atividade = última mensagem (created_at é a hora da importação). Só se esconde o que está resolvido: mudar a data
  // nunca tira da lista trabalho em curso.
  const active = "(coalesce(c.last_message_at, c.created_at) >= v_from or c.status <> 'resolvido'";
  const list = fn("ldo_support_list");
  const counts = list.indexOf("'counts', (");
  assert.equal(list.split(active).length - 1, 2, "lista e contagens");
  assert.ok(list.indexOf(active) < counts && list.lastIndexOf(active) > counts);
  assert.equal(list.split("v_from").length - 1, 4, "só a declaração, a lista, as contagens e a data devolvida");
  // Um ticket Zendesk antigo aparece pesquisando o número exato (o mesmo formato que a rota manda ler do Zendesk).
  const ticket = "or (v_q ~ '^#?[0-9]{1,12}$' and c.channel = 'zendesk' and c.external_id = ltrim(v_q, '#')))";
  assert.ok(list.indexOf(ticket) > list.indexOf(active) && list.indexOf(ticket) < counts, "só na lista");
  const route = fs.readFileSync(path.join(__dirname, "../app/api/support/conversations/route.ts"), "utf8");
  assert.ok(route.includes("/^#?(\\d{1,12})$/.exec(search)"));
  assert.match(list, /'history_from', v_from\n/);
  // Alterações feitas no lugar em produção (pesquisa no email indicado; "Automáticas" pela hora de gravação) mantêm-se.
  assert.ok(list.includes("coalesce(k.claimed_email, '')"));
  assert.equal(list.split("m.inserted_at > coalesce(c.auto_handled_at, c.auto_handled_through)").length - 1, 2);
  const conv = fn("ldo_support_conversation");
  assert.ok(conv.includes("(coalesce(c2.last_message_at, c2.created_at) >= v_from or c2.status <> 'resolvido')"), "sugestões");
  assert.ok(conv.includes("'history_from', v_from"));
  // Continua a abrir conversas antigas (é a verificação de acesso do envio, anexos e IA): só a recusa de sempre.
  assert.deepEqual([...conv.matchAll(/raise exception '([^']+)'/g)].map((x) => x[1]), ["Conversa não encontrada."]);
  const history = fn("ldo_support_ai_customer_history");
  assert.ok(history.includes(active) && history.includes("deleted_at is null and created_at >= v_from"));
  const replies = fn("ldo_support_ai_replies");
  assert.ok(replies.includes("m.created_at >= v_from") && replies.includes("i.created_at >= v_from"));
  for (const body of [history, replies]) assert.ok(body.indexOf("bi_check(p_token)") < body.indexOf("support_history_from()"), "token primeiro");
});

test("The history settings functions are Super Admin only and reachable only through the anon RPC grant", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261030100000_ldo_support_history_from.sql"), "utf8").replace(/\r\n/g, "\n");
  const stmts = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").split(";").map((s) => s.trim());
  for (const sig of ["public.ldo_support_history_settings(text)", "public.ldo_support_history_settings_save(text, date)"]) {
    assert.ok(stmts.some((s) => s.startsWith("revoke all on function ") && s.includes(sig) && s.endsWith(" from public, authenticated")), sig);
    assert.ok(stmts.some((s) => s.startsWith("grant execute on function ") && s.includes(sig) && s.endsWith(" to anon")), sig);
  }
  assert.ok(stmts.includes("revoke all on function ldo_private.support_history_from() from public, anon, authenticated"));
  for (const name of ["ldo_support_history_settings", "ldo_support_history_settings_save"]) {
    const start = sql.indexOf(`create function public.${name}(`);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.ok(body.includes("ldo_private.support_super(p_session)"), name);
  }
  // O número de ocultas na configuração segue a regra da lista (só resolvidas).
  assert.ok(sql.includes("where coalesce(c.last_message_at, c.created_at) < v_from and c.status = 'resolvido'));"));
});

// Regra das migrações seguintes (alterações no lugar em produção): a definição mais recente de cada função — uma cópia
// completa ou uma substituição ancorada (pg_get_functiondef) — mantém as condições das versões anteriores.
function latestDefinition(name) {
  const dir = path.join(__dirname, "../supabase/migrations");
  let last = null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    for (const head of [`function public.${name}(`, `pg_get_functiondef('public.${name}(`]) {
      for (let i = sql.indexOf(head); i >= 0; i = sql.indexOf(head, i + 1)) {
        const end = head.startsWith("pg_") ? sql.indexOf("\nend;\n$$;", i) : sql.indexOf("$$;", i);
        if (end > i && (!last || f >= last.file)) last = { file: f, at: i, text: sql.slice(i, end) };
      }
    }
  }
  assert.ok(last, name);
  return last;
}

test("Later migrations keep the earlier predicates: history_from, origin, the rating anchor and the notify origin filter", () => {
  const conv = latestDefinition("ldo_support_conversation").text;
  assert.ok(conv.includes("'history_from', v_from"), "history_from na conversa");
  assert.ok(conv.includes("(coalesce(c2.last_message_at, c2.created_at) >= v_from or c2.status <> 'resolvido')"), "sugestões só do histórico visível");
  assert.ok(conv.includes("'origin', m.origin"), "origem de cada mensagem");
  const ingest = latestDefinition("ldo_support_ingest").text;
  assert.ok(ingest.includes("ldo_private.support_take_rating(v_conv.id, v_mid,"), "âncora da nota na sincronização");
  assert.ok(ingest.includes("order by (x.value ->> ''created_at'') collate \"C\", x.n loop"), "mensagens pela ordem em que foram escritas");
  assert.ok(ingest.includes("perform ldo_private.support_rating_read(v_conv.id);"), "lida só no fim da conversa");
  assert.ok(latestDefinition("ldo_support_site_send").text.includes("v_rating := ldo_private.support_take_rating("), "âncora da nota no chat do site");
  assert.ok(latestDefinition("ldo_support_list").text.includes("m.conversation_id = c.id and m.origin is null and m.delivery in"), "mensagens automáticas sem atenção na lista");
  const notify = latestDefinition("ldo_support_site_notify_claim").text;
  assert.ok(notify.includes("and (m.origin is null or x.verified)") && notify.includes("and (m.origin is null or v.verified)"), "mensagens automáticas nunca por email a quem não confirmou o email");
  assert.ok(latestDefinition("ldo_support_social_autoreply_claim").text.includes("s.rating_message_id = m.id"), "nunca resposta automática a uma nota");
  assert.ok(latestDefinition("ldo_support_ai_replies").text.includes("m.origin is null"), "exemplos da IA só de pessoas");
});
