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
