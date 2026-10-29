const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const s = require("../.test-build/support/survey-rules.js");
const r = require("../.test-build/support/rules.js");
const site = require("../.test-build/support/site-rules.js");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261030120000_ldo_support_survey.sql";
const SQL = read(MIGRATION);
// Definição de uma função na migração (do cabeçalho até "$$;").
const fn = (sql, head) => {
  const start = sql.indexOf(head);
  assert.ok(start >= 0, head);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
};
const body = (def) => def.slice(def.indexOf("$$") + 2, def.lastIndexOf("$$;"));
const stmts = SQL.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").split(";").map((x) => x.trim());
const NOW = Date.parse("2026-10-30T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();

// ---------------------------------------------------------------- resposta do cliente

test("parseRating: only a score (or 1–5 stars) is a rating; a score with text keeps the text; 15 is not; «não» opts out", () => {
  const score = (b) => s.parseRating(b);
  assert.deepEqual(score("5"), { kind: "score", score: 5 });
  assert.deepEqual(score("5/5"), { kind: "score", score: 5 });
  assert.deepEqual(score("⭐⭐⭐⭐"), { kind: "score", score: 4 });
  assert.deepEqual(score("⭐️⭐️⭐️"), { kind: "score", score: 3 }, "com o seletor de emoji (FE0F)");
  assert.deepEqual(score("🌟 🌟"), { kind: "score", score: 2 });
  assert.deepEqual(score(" 4 de 5 "), { kind: "score", score: 4 });
  assert.deepEqual(score("1 Estrela!"), { kind: "score", score: 1 });
  assert.deepEqual(score("5⭐"), { kind: "score", score: 5 });
  assert.deepEqual(score("5 😊"), { kind: "score", score: 5 }, "emoji depois da nota não é texto");
  assert.deepEqual(score("3 :)"), { kind: "score", score: 3 });
  assert.deepEqual(score("5\n\nEnviado do meu iPhone"), { kind: "score", score: 5 }, "assinatura do telemóvel");
  assert.deepEqual(score("4\n-- \nAna Silva\nTel 912345678"), { kind: "score", score: 4 }, "assinatura do email");
  assert.deepEqual(score("5 obrigado"), { kind: "score_text", score: 5, comment: "obrigado" });
  assert.deepEqual(score("2. A encomenda chegou partida"), { kind: "score_text", score: 2, comment: "A encomenda chegou partida" });
  assert.deepEqual(score("4 de 5, demorou"), { kind: "score_text", score: 4, comment: "demorou" });
  for (const none of ["15", "6", "0", "4,5", "3.5", "Obrigada!", "não obrigado", "", null, undefined]) assert.deepEqual(score(none), { kind: "none" }, String(none));
  for (const out of ["NÃO", "Não.", "nao", "Parar", "STOP"]) assert.deepEqual(score(out), { kind: "optout" }, out);
  assert.equal(s.isRatingReply("5"), true);
  assert.equal(s.isRatingReply("NÃO"), true);
  assert.equal(s.isRatingReply("5 obrigado"), false, "com texto segue para a equipa (pode ter uma pergunta)");
  assert.equal(s.isRatingReply("Olá"), false);
});

test("A rating is taken only from the first reply after a sent survey that is still the last outbound (a 2 after a staff question is not)", () => {
  const base = { surveySent: true, expired: false, beforeSurvey: false, surveyIsLastOutbound: true, firstInboundAfter: true, body: "5" };
  assert.equal(s.ratingDecision(base), "rated");
  assert.equal(s.ratingDecision({ ...base, body: "2", surveyIsLastOutbound: false }), "expire", "«Quantas unidades?» → «2» não é uma nota");
  assert.equal(s.ratingDecision({ ...base, firstInboundAfter: false }), "expire");
  assert.equal(s.ratingDecision({ ...base, expired: true }), "expire");
  assert.equal(s.ratingDecision({ ...base, beforeSurvey: true }), "ignore");
  assert.equal(s.ratingDecision({ ...base, surveySent: false }), "ignore");
  assert.equal(s.ratingDecision({ ...base, body: "NÃO" }), "optout");
  assert.equal(s.ratingDecision({ ...base, body: "5 obrigado" }), "rated_with_text");
  assert.equal(s.ratingDecision({ ...base, body: "A encomenda não chegou" }), "expire");
  // Só a nota e o «não» ficam tratados na BD (a conversa não reabre).
  assert.deepEqual(["rated", "rated_with_text", "optout", "expire", "ignore"].filter(s.ratingTaken), ["rated", "optout"]);
});

test("A rating does not reopen the conversation; only a 1–2 alone on a resolved conversation goes back to Novo (statusAfterCustomerMessage)", () => {
  // Sem nota: a regra de sempre.
  assert.equal(r.statusAfterCustomerMessage("resolvido", true), "em_atendimento");
  assert.equal(r.statusAfterCustomerMessage("resolvido", false, null), "novo");
  // Nota tratada pela BD.
  assert.equal(r.statusAfterCustomerMessage("resolvido", true, { score: 5 }), "resolvido");
  assert.equal(r.statusAfterCustomerMessage("resolvido", true, { score: 3 }), "resolvido");
  assert.equal(r.statusAfterCustomerMessage("resolvido", true, { score: 2 }), "novo", "acompanhamento, sem responsável");
  assert.equal(r.statusAfterCustomerMessage("resolvido", false, { score: 1 }), "novo");
  assert.equal(r.statusAfterCustomerMessage("resolvido", true, { score: null }), "resolvido", "«não»");
  assert.equal(r.statusAfterCustomerMessage("em_atendimento", true, { score: 1 }), "em_atendimento", "já está em curso: não mexe");
});

// ---------------------------------------------------------------- quando pedir

test("surveyEligibility: each rule alone blocks the request, in the database's order", () => {
  const ok = {
    mode: "automatico", channels: s.SURVEY_CHANNELS, channel: "facebook", noSurveys: false, dashboardReplies: 2, lastKind: "outbound",
    lastInboundAt: ago(2), siteChatOpen: false, lastConversationSurveyAt: null, lastContactSurveyAt: null, now: NOW,
  };
  assert.equal(s.surveyEligibility(ok), null);
  assert.equal(s.surveyEligibility({ ...ok, mode: "perguntar" }), null);
  const cases = [
    [{ mode: "desligado" }, "desligado"],
    [{ mode: "" }, "desligado"],
    [{ channel: "facebook_comments" }, "comentario"],
    [{ channel: "instagram_comments" }, "comentario"],
    [{ channel: "zendesk" }, "canal"],
    [{ channel: "whatsapp" }, "canal"],
    [{ channels: ["instagram", "email", "site"] }, "canal_desligado"],
    [{ dashboardReplies: 0 }, "sem_resposta"],
    [{ lastKind: "inbound" }, "ultima_cliente"],
    [{ lastInboundAt: ago(23.5) }, "janela_24h"],
    [{ lastInboundAt: null }, "janela_24h"],
    [{ noSurveys: true }, "sem_pedidos"],
    [{ lastConversationSurveyAt: ago(24 * 6) }, "conversa_recente"],
    [{ lastContactSurveyAt: ago(24 * 29) }, "contacto_recente"],
  ];
  for (const [change, reason] of cases) assert.equal(s.surveyEligibility({ ...ok, ...change }), reason, JSON.stringify(change));
  // Fora dos 7 e dos 30 dias, pode.
  assert.equal(s.surveyEligibility({ ...ok, lastConversationSurveyAt: ago(24 * 8), lastContactSurveyAt: ago(24 * 31) }), null);
  // Email e chat do site: sem janela da Meta; o chat do site precisa da conversa por terminar no widget.
  assert.equal(s.surveyEligibility({ ...ok, channel: "email", lastInboundAt: ago(24 * 5) }), null);
  assert.equal(s.surveyEligibility({ ...ok, channel: "site", lastInboundAt: null, siteChatOpen: true }), null);
  assert.equal(s.surveyEligibility({ ...ok, channel: "site", siteChatOpen: false }), "chat_terminado");
});

test("The reasons shown when there is no survey are the agreed texts", () => {
  assert.equal(s.skipText("comentario"), "Sem pedido de avaliação: comentário público");
  assert.equal(s.skipText("sem_resposta"), "Sem pedido de avaliação: sem resposta enviada pelo dashboard");
  assert.equal(s.skipText("ultima_cliente"), "Sem pedido de avaliação: a última mensagem é do cliente");
  assert.equal(s.skipText("janela_24h"), "Sem pedido de avaliação: fora da janela de 24 h do Messenger/Instagram");
  assert.equal(s.skipText("contacto_recente"), "Sem pedido de avaliação: já foi pedida uma avaliação a este cliente nos últimos 30 dias");
  assert.equal(s.skipText("sem_pedidos"), "Sem pedido de avaliação: o cliente pediu para não receber pedidos de avaliação");
  // Nota ao resolver: agendado (com quem é avaliado), mostrado no chat do site, ou o motivo; nada sem decisão.
  assert.equal(s.surveyCreateNote({ created: true, agent_name: "Diana Costa", channel: "facebook" }), "Pedido de avaliação agendado (atendimento de Diana Costa).");
  assert.equal(s.surveyCreateNote({ created: true, agent_name: "Diana Costa", channel: "site" }), "Pedido de avaliação mostrado no chat do site (atendimento de Diana Costa).");
  assert.equal(s.surveyCreateNote({ created: false, reason: "janela_24h" }), "Sem pedido de avaliação: fora da janela de 24 h do Messenger/Instagram.");
  for (const reason of ["desligado", "nao_pedido", "nao_resolvida"]) assert.equal(s.surveyCreateNote({ created: false, reason }), null, reason);
  assert.equal(s.surveyCreateNote(null), null);
});

test("attributeAgent: most dashboard replies in the cycle; tie → the most recent; never automatic, failed or older replies", () => {
  const rep = (author, at, extra = {}) => ({ author, at, ...extra });
  const replies = [
    rep("ana", "2026-10-20T10:00:00Z"), rep("rui", "2026-10-20T11:00:00Z"), rep("ana", "2026-10-20T12:00:00Z"),
    rep("rui", "2026-10-20T13:00:00Z"), rep(null, "2026-10-20T14:00:00Z"),
  ];
  assert.equal(s.attributeAgent(replies), "rui", "2–2: quem respondeu por último");
  assert.equal(s.attributeAgent([...replies, rep("ana", "2026-10-20T09:00:00Z")]), "ana", "3–2");
  assert.equal(s.attributeAgent(replies, "2026-10-20T11:30:00Z"), "rui", "só depois da reabertura");
  assert.equal(s.attributeAgent([rep("ana", "2026-10-20T10:00:00Z"), rep("rui", "2026-10-20T11:00:00Z", { origin: "survey" })]), "ana");
  assert.equal(s.attributeAgent([rep("ana", "2026-10-20T10:00:00Z"), rep("rui", "2026-10-20T11:00:00Z", { failed: true }), rep("rui", "2026-10-20T11:01:00Z", { failed: true })]), "ana");
  assert.equal(s.attributeAgent([rep(null, "2026-10-20T10:00:00Z")]), null);
  assert.equal(s.attributeAgent([]), null);
});

// ---------------------------------------------------------------- textos para o cliente

test("safeFirstName: one clean word, else no name", () => {
  assert.equal(r.safeFirstName("Maria João Silva"), "Maria");
  assert.equal(r.safeFirstName("  José  "), "José");
  assert.equal(r.safeFirstName("D'Angelo"), "D'Angelo");
  assert.equal(r.safeFirstName("Anne-Marie Dupont"), "Anne-Marie");
  // Só maiúsculas ou só minúsculas: maiúscula inicial (com mistura fica como está).
  assert.equal(r.safeFirstName("MARIA SILVA"), "Maria");
  assert.equal(r.safeFirstName("maria"), "Maria");
  assert.equal(r.safeFirstName("ANNE-MARIE"), "Anne-Marie");
  assert.equal(r.safeFirstName("o'neil"), "O'Neil");
  assert.equal(r.safeFirstName("ÁLVARO"), "Álvaro");
  assert.equal(r.safeFirstName("McDonald"), "McDonald");
  for (const bad of ["💛Ana", "Ana💛", "J", "joao123", "www.exemplo.pt", "@ana", "<b>Ana</b>", "", null, undefined, "A".repeat(31)])
    assert.equal(r.safeFirstName(bad), "", String(bad));
});

test("surveyText: the agreed Messenger/Instagram and email texts, with the customer's first name only when it is clean", () => {
  assert.equal(
    s.surveyText("facebook", { name: "Maria Silva", agent: "Diana" }),
    "Olá Maria! Foi um gosto ajudar 💛 Para continuarmos a melhorar, como avalia o nosso atendimento? Responda apenas com um número de 1 (mau) a 5 (excelente). Obrigado!",
  );
  assert.ok(s.surveyText("instagram", { name: "🌸 flor.lojinha" }).startsWith("Olá! Foi um gosto ajudar 💛 Para continuarmos"));
  assert.ok(!s.surveyText("facebook", { name: "Maria", agent: "Diana" }).includes("Diana"), "sai em nome da página: sem o nome de quem atendeu");
  assert.equal(
    s.surveyText("email", { name: "Maria Silva", agent: "Diana" }),
    "Olá Maria,\n\nEsperamos ter ajudado. Tem um minuto para nos dizer como correu o atendimento de Diana?\n\n"
      + "Responda a este email apenas com um número de 1 (mau) a 5 (excelente).\n\nA sua opinião ajuda-nos a melhorar. Obrigado!\n\n"
      + "Se não quiser receber mais pedidos de avaliação, responda «NÃO».",
  );
  assert.ok(s.surveyText("email", { name: null, agent: null }).startsWith("Olá,\n\nEsperamos ter ajudado. Tem um minuto para nos dizer como correu o atendimento?"));
  assert.equal(s.thanksText(5, "Maria Silva"), "Obrigado pela sua avaliação, Maria! Ajuda-nos a cuidar cada vez melhor de si. 💛");
  assert.equal(s.thanksText(3, null), "Obrigado pela sua avaliação! Ajuda-nos a cuidar cada vez melhor de si. 💛");
  assert.equal(s.thanksText(2, "Maria"), "Obrigado por nos dizer, Maria. Lamentamos que a experiência não tenha sido a melhor; um responsável da nossa equipa vai analisar o seu caso.");
  assert.equal(s.thanksText(1, ""), "Obrigado por nos dizer. Lamentamos que a experiência não tenha sido a melhor; um responsável da nossa equipa vai analisar o seu caso.");
});

test("The site chat survey texts are the same in the widget and in survey-rules (5 languages)", () => {
  const SRC = read("public/site-chat/ldo-chat.js");
  const block = SRC.slice(SRC.indexOf("/* I18N:start */"), SRC.indexOf("/* I18N:end */"));
  const I18N = new Function("window", "location", "document", `"use strict"; var LANG = "pt", SITE = "ldo", BRAND = ""; ${block}; return I18N;`)(
    {}, { hostname: "www.lojadoouro.pt", pathname: "/", origin: "https://www.lojadoouro.pt" }, { documentElement: { lang: "" } });
  for (const lang of ["pt", "en", "es", "fr", "de"]) {
    for (const [key, text] of Object.entries(s.SURVEY_SITE_TEXTS[lang])) assert.equal(I18N[lang][key], text, `${lang}.${key}`);
  }
  assert.equal(s.SURVEY_SITE_TEXTS.pt.surveyRequest, "Obrigado por falar connosco! Como avalia o atendimento de {name}?");
  assert.equal(s.SURVEY_SITE_TEXTS.de.surveyStar, "{n} von 5");
  // As duas mensagens novas do servidor têm código (o widget traduz).
  assert.equal(site.errorCode("Esta avaliação já não está disponível."), "survey_closed");
  assert.equal(site.errorCode("Escolha de 1 a 5 estrelas."), "rating_invalid");
  // O widget mostra as estrelas, envia a nota e, quando o pedido fechou, tira-o da lista.
  assert.ok(SRC.includes('request("POST", "/api/chat/rating", { survey: m.id, score: score })'));
  assert.ok(SRC.includes('if (m.from === "notice" && m.kind === "survey") return surveyNode(m);'));
  assert.ok(SRC.includes('t("surveyStar", { n: n })'));
});

// ---------------------------------------------------------------- na conversa e no relatório

test("Thread events: the score only for whoever the database lets see it", () => {
  const ev = (action, details, actor = "Sistema") => s.surveyEventText({ action, details, actor });
  assert.equal(ev("survey.created", { agent_name: "Diana Costa", channel: "facebook" }), "Pedido de avaliação agendado (atendimento de Diana Costa)");
  assert.equal(ev("survey.sent", {}), "Pedido de avaliação enviado ao cliente");
  assert.equal(ev("survey.skipped", { reason: "reaberta" }), "Pedido de avaliação não enviado: a conversa foi reaberta antes do envio");
  assert.equal(ev("survey.cancelled", { reason: "cliente zangado com a transportadora" }, "Luís Rocha"), "Pedido de avaliação cancelado por Luís Rocha: cliente zangado com a transportadora");
  assert.equal(ev("survey.rated", { agent_name: "Diana Costa", score: 4 }), "O cliente avaliou o atendimento de Diana Costa: 4/5");
  assert.equal(ev("survey.rated", { agent_name: "Diana Costa" }), "O cliente respondeu ao pedido de avaliação", "sem a nota (outros colegas)");
  assert.equal(ev("survey.followup", { score: 1 }), "Avaliação baixa (1/5): conversa reaberta para acompanhamento.");
  assert.equal(ev("survey.followup", {}), "Avaliação baixa: conversa reaberta para acompanhamento.");
  assert.equal(ev("assign", {}), null);
  assert.equal(s.surveyStateText({ status: "skipped", skip_reason: "janela_24h" }), "Não enviado: fora da janela de 24 h do Messenger/Instagram");
  assert.equal(s.surveyStateText({ status: "expired", skip_reason: "nova_mensagem" }), "Fechado sem nota: a conversa continuou depois do pedido");
  assert.equal(s.surveyStateText({ status: "rated", skip_reason: null }), "Avaliado");
});

test("Report periods are Lisbon months and quarters; small samples are flagged", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  assert.deepEqual(s.reportPeriod("2026-10", now), { key: "2026-10", label: "outubro de 2026", from: "2026-10-01", to: "2026-11-01" });
  assert.deepEqual(s.reportPeriod("2026-12", now), { key: "2026-12", label: "dezembro de 2026", from: "2026-12-01", to: "2027-01-01" });
  assert.deepEqual(s.reportPeriod("2026-T4", now), { key: "2026-T4", label: "4.º trimestre de 2026", from: "2026-10-01", to: "2027-01-01" });
  assert.equal(s.reportPeriod("lixo", now).key, "2026-10");
  assert.equal(s.reportPeriod(null, new Date("2026-08-31T23:30:00Z")).key, "2026-09", "já é setembro em Lisboa (hora de verão)");
  assert.equal(s.reportPeriod(null, new Date("2026-10-31T23:30:00Z")).key, "2026-10", "ainda é outubro em Lisboa (hora de inverno)");
  const keys = s.reportPeriods(now).map((p) => p.key);
  assert.deepEqual(keys, ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-T4", "2026-T3"]);
  assert.deepEqual(s.reportPeriods(new Date("2026-02-10T12:00:00Z")).map((p) => p.key).slice(-2), ["2026-T1", "2025-T4"]);
  assert.equal(s.reliable(9), false);
  assert.equal(s.reliable(10), true);
  assert.equal(s.pct(3, 4), 75);
  assert.equal(s.pct(1, 0), null);
  assert.equal(s.durationLabel(45), "45 min");
  assert.equal(s.durationLabel(13.7 * 60), "13,7 h");
  assert.equal(s.durationLabel(3 * 1440), "3 dias");
  assert.equal(s.durationLabel(null), "—");
});

test("Satisfação e desempenho: APOIO menu for support users, own row only, no AI-review columns", () => {
  const page = read("app/(painel)/apoio/desempenho/page.tsx");
  assert.ok(page.includes('title="Satisfação e desempenho"'));
  assert.ok(page.includes("Avaliações dos clientes depois de cada conversa resolvida, por colaborador. Só contam conversas com resposta da equipa pelo dashboard."));
  for (const h of ["Pedidos enviados", "Avaliações", "Média (1–5)", "Satisfeitos (4–5)", "Clientes que avaliaram (%)", "Resolvidas com resposta",
    "Resolvidas sem pedido de avaliação (%)", "Tempo mediano até responder"]) assert.ok(page.includes(`"${h}"`), h);
  assert.ok(page.includes("Menos de {SURVEY_RELIABLE} avaliações: resultado ainda pouco fiável"));
  assert.ok(page.includes('title="A acompanhar (nota 1–2)"') && page.includes("report?.super &&"));
  assert.ok(!/revis[aã]o|ai_review|review-|ReviewStats/i.test(page), "sem a revisão da IA");
  assert.ok(page.includes("if (!canSupport(viewer))"));
  const shell = read("components/shell.tsx");
  const group = shell.slice(shell.indexOf('label: "APOIO AO CLIENTE"'), shell.indexOf('label: "LOJAS FÍSICAS"'));
  assert.ok(group.includes('{ key: "apoio-desempenho", label: "Satisfação e desempenho", href: "/apoio/desempenho", icon: "star" },'));
  assert.ok(group.indexOf("apoio-desempenho") < group.indexOf("viewer.isSuper"), "para toda a gente do apoio");
  // Na BD: cada pessoa só a sua linha; totais e "A acompanhar" só para o Super Admin; médias só com 10 avaliações.
  const report = fn(SQL, "create function public.ldo_support_ratings_report(");
  assert.ok(report.includes("where u.id = v_me or (v_super and ("));
  assert.ok(report.includes("'team', case when v_super then") && report.includes("'follow_up', case when v_super then"));
  assert.equal(report.split("ratings >= 10 then").length - 1, 4, "média e satisfeitos, por pessoa e na equipa");
  assert.ok(!/ai_review/.test(report));
});

// ---------------------------------------------------------------- envio

test("Sending: claimed once, written before it leaves, never resent; the sweep runs after reading new messages", () => {
  const sv = read("lib/support/survey.ts");
  const order = ["ldo_support_system_send_begin", "metricoolSend(", "ldo_support_finish_send", "ldo_support_survey_sent"].map((k) => sv.indexOf(k));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.ok(sv.indexOf("ldo_support_system_send_begin") < sv.indexOf("ldo_support_finish_send"));
  assert.ok(sv.includes('p_client_key: kind === "survey" ? s.id : randomUUID()'), "o pedido usa o próprio id como chave");
  assert.ok(sv.includes("autoSubmitted: true") && sv.includes("senderFirstName"), "email automático com o primeiro nome de quem atendeu na assinatura");
  assert.ok(!/retry|tentar de novo|for \(let attempt/i.test(sv.replace(/Uma segunda tentativa de registo[^\n]*/, "")), "sem novas tentativas de envio");
  const tick = read("app/api/support/webhooks/tick/route.ts");
  assert.ok(tick.includes("Promise.all([social, mail]).then(() => sendDueSurveys())"));
  // O chat do site não precisa de envio: o pedido aparece no widget no mesmo momento em que se resolve.
  const create = fn(SQL, "create function public.ldo_support_survey_create(");
  assert.ok(create.includes("case when v_site then 'sent' else 'pending' end"));
  // Respostas automáticas das redes sociais: nunca a uma nota (no código e na BD).
  const mc = read("lib/support/metricool.ts");
  assert.ok(mc.includes("if (isRatingReply(conv.messages.find((m) => m.external_id === decision.anchor)?.body)) continue;"));
  // Email automático do cliente (ausência): marcado na leitura do Gmail.
  assert.ok(read("lib/support/gmail.ts").includes("...(!own && isAutoSubmitted(m) ? { auto_submitted: true } : {}),"));
});

test("Resolving: automatic needs no dialog; ask mode shows the checkbox and the reason; only the Super Admin cancels", () => {
  const inbox = read("components/support/inbox.tsx");
  assert.ok(inbox.includes('d.survey_mode === "perguntar"'));
  assert.ok(inbox.includes("Marcar como resolvida?") && inbox.includes("Pedir ao cliente uma avaliação do atendimento (1 a 5)"));
  assert.ok(inbox.includes(">\n                Resolver\n") || inbox.includes(">Resolver<") || /\n\s+Resolver\n/.test(inbox));
  assert.ok(inbox.includes("{d.super && s && (s.status === \"pending\" || s.status === \"sent\") && ("));
  const route = read("app/api/support/conversations/[id]/route.ts");
  assert.ok(route.includes('case "survey_preview":') && route.includes('case "survey_cancel":'));
  assert.ok(route.includes('...(typeof b.survey === "boolean" ? { survey: b.survey } : {}),'));
  const service = read("lib/support/service.ts");
  assert.ok(service.includes('if (status === "resolvido" && c.status !== "resolvido") {'));
  assert.ok(service.includes('"ldo_support_survey_create"') && service.includes(".catch(() => null);"), "uma falha nunca desfaz o Resolvido");
});

// ---------------------------------------------------------------- migração

test("Survey settings start off: mode 'desligado', 10 minutes, the four channels; Super Admin only", () => {
  assert.ok(SQL.includes("add column if not exists survey_mode text not null default 'desligado'"));
  assert.ok(SQL.includes("check (survey_mode in ('desligado', 'perguntar', 'automatico'))"));
  assert.ok(SQL.includes("add column if not exists survey_delay_minutes integer not null default 10"));
  assert.ok(SQL.includes("add column if not exists survey_channels text[] not null default '{facebook,instagram,email,site}'"));
  assert.ok(SQL.includes("alter table public.ldo_support_contacts add column if not exists no_surveys boolean not null default false;"));
  assert.ok(SQL.includes("add column if not exists origin text check (origin in ('ai', 'handover', 'survey', 'rule'));"));
  for (const name of ["ldo_support_survey_settings", "ldo_support_survey_settings_save", "ldo_support_survey_cancel"]) {
    assert.ok(fn(SQL, `create function public.${name}(`).includes("ldo_private.support_super(p_session)"), name);
  }
  const ia = read("app/(painel)/apoio/configuracao/ia/page.tsx");
  assert.ok(ia.includes('id="avaliacao"') && ia.includes("action={saveSurveySettings}") && ia.includes("Recomendado: Automático."));
  assert.ok(ia.includes("action={saveReviewSettings}"), "a revisão da IA continua na página");
});

test("Survey table: RLS, no API access, comment purged after 12 months, indexes for the report", () => {
  assert.ok(stmts.includes("alter table public.ldo_support_surveys enable row level security"));
  assert.ok(stmts.includes("revoke all on public.ldo_support_surveys from anon, authenticated"));
  for (const col of ["status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'rated', 'expired'))",
    "score smallint check (score between 1 and 5)", "comment varchar(500)", "agent_id uuid not null", "assignee_at_resolve uuid", "resolved_by uuid"])
    assert.ok(SQL.includes(col), col);
  for (const idx of ["(agent_id, rated_at)", "(contact_id, sent_at)", "(conversation_id)"]) assert.ok(SQL.includes(idx), idx);
  assert.ok(fn(SQL, "create function public.ldo_support_survey_purge(").includes("set comment = null where comment is not null and rated_at < now() - interval '12 months'"));
  assert.ok(read("app/api/cron/support-sync/route.ts").includes('serverRpc<number>("ldo_support_survey_purge")'));
});

test("Survey functions: session or server token, anon-only grants, private helpers closed", () => {
  const PUBLIC = [
    "public.ldo_support_system_send_begin(text, uuid, text, text, uuid)", "public.ldo_support_survey_preview(text, uuid)",
    "public.ldo_support_survey_create(text, uuid, boolean)", "public.ldo_support_survey_cancel(text, uuid, text)",
    "public.ldo_support_contact_surveys_save(text, uuid, boolean)", "public.ldo_support_survey_due(text, integer)",
    "public.ldo_support_survey_sent(text, uuid, text, uuid, text)", "public.ldo_support_survey_thanks_due(text, integer)",
    "public.ldo_support_survey_thanks_sent(text, uuid, text, uuid)", "public.ldo_support_site_rate(text, text, text, uuid, integer, text)",
    "public.ldo_support_survey_purge(text)", "public.ldo_support_ratings_report(text, date, date)", "public.ldo_support_survey_settings(text)",
    "public.ldo_support_survey_settings_save(text, jsonb)",
  ];
  for (const sig of PUBLIC) {
    assert.ok(stmts.some((x) => x.startsWith("revoke all on function ") && x.includes(sig) && x.endsWith(" from public, authenticated")), sig);
    assert.ok(stmts.some((x) => x.startsWith("grant execute on function ") && x.includes(sig) && x.endsWith(" to anon")), sig);
    const name = sig.slice("public.".length, sig.indexOf("("));
    const def = fn(SQL, `create function public.${name}(`);
    const auth = def.includes("ldo_private.bi_check(p_token)") || def.includes("ldo_private.support_check(p_session)") || def.includes("ldo_private.support_super(p_session)");
    assert.ok(auth, `${name}: sem verificação`);
  }
  const created = [...SQL.matchAll(/^create function (public\.[a-z_]+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(created.sort(), PUBLIC.map((x) => x.slice(0, x.indexOf("("))).sort(), "todas as funções públicas novas têm acessos");
  const PRIVATE = [...SQL.matchAll(/^create function (ldo_private\.[a-z_]+)\(/gm)].map((m) => m[1]);
  assert.equal(PRIVATE.length, 11);
  const revoke = stmts.find((x) => x.startsWith("revoke all on function ldo_private.support_team_outbound_since"));
  assert.ok(revoke && revoke.endsWith(" from public, anon, authenticated"));
  for (const p of PRIVATE) assert.ok(revoke.includes(`${p}(`), p);
  // Ajuda partilhada com as respostas automáticas: atividade da equipa = mensagem para o cliente sem origin.
  assert.ok(fn(SQL, "create function ldo_private.support_team_outbound_since(").includes("m.kind = 'outbound' and m.origin is null"));
});

test("Automatic messages: written without a person, never assign or reopen, only private channels", () => {
  const begin = fn(SQL, "create function public.ldo_support_system_send_begin(");
  assert.ok(begin.includes("p_origin not in ('ai', 'handover', 'survey', 'rule')"));
  assert.ok(begin.includes("v_c.channel not in ('facebook', 'instagram', 'email', 'site')"));
  assert.ok(begin.includes("insert into public.ldo_support_messages (conversation_id, kind, body, created_at, delivery, client_key, origin)"));
  assert.ok(!/assignee_id|status =|ldo_support_audit/.test(body(begin)), "não assume a conversa nem muda o estado");
  // A sincronização reconhece as mensagens automáticas até 60 minutos.
  assert.ok(SQL.includes("< case when origin is not null then 3600 else 900 end"));
  // Um visitante do chat por confirmar nunca recebe por email uma mensagem automática.
  const notify = fn(SQL, "create or replace function public.ldo_support_site_notify_claim(");
  assert.ok(notify.includes("and (m.origin is null or x.verified)") && notify.includes("and (m.origin is null or v.verified)"));
  // Os exemplos para a IA são só respostas escritas por pessoas.
  assert.ok(SQL.includes("execute replace(v_def, v_old, v_old || ' and m.origin is null');"));
});

test("Taking a rating: open survey, last outbound, first reply; a score alone keeps the conversation resolved, 1–2 goes to follow-up", () => {
  const take = fn(SQL, "create function ldo_private.support_take_rating(");
  const at = (k) => {
    const i = take.indexOf(k);
    assert.ok(i > 0, k);
    return i;
  };
  assert.ok(at("status = 'sent'") < at("v_s.expires_at <= now()"));
  assert.ok(at("v_s.expires_at <= now()") < at("o.kind = 'outbound'") && at("o.kind = 'outbound'") < at("i.kind = 'inbound'"));
  assert.ok(at("i.kind = 'inbound'") < at("support_rating_score(p_body)") && at("support_rating_score(p_body)") < at("support_rating_optout(p_body)"));
  assert.ok(at("support_rating_optout(p_body)") < at("support_rating_lead(p_body)"));
  assert.ok(take.includes("perform ldo_private.support_survey_rate(v_s.id, v_score, v_m.id, null, false);\n    -- Nota de 1 ou 2: fica por ler"));
  assert.ok(take.includes("update public.ldo_support_contacts set no_surveys = true"));
  const rate = fn(SQL, "create function ldo_private.support_survey_rate(");
  assert.ok(rate.includes("if p_score <= 2 and not p_with_text then") && rate.includes("set status = 'novo', assignee_id = null"));
  assert.ok(rate.includes("'survey.followup'") && rate.includes("follow_up = p_score <= 2"));
  // Mesmas regras no SQL e no TypeScript (as expressões foram comparadas na BD com os mesmos 35 casos).
  const score = fn(SQL, "create function ldo_private.support_rating_score(");
  assert.ok(score.includes("'^([1-5])\\s*(/\\s*5|de\\s*5|estrelas?|⭐+)?[^[:alpha:][:digit:]]*$'"));
  assert.ok(score.includes("'^([⭐🌟★]\\s*){1,5}$'"));
  assert.ok(fn(SQL, "create function ldo_private.support_rating_optout(").includes("'^(não|nao|parar|stop)[.!]*$'"));
  // Estrelas no chat do site: o pedido tem de ser desta conversa, do chat do site e estar aberto.
  const site_ = fn(SQL, "create function public.ldo_support_site_rate(");
  assert.ok(site_.includes("v := ldo_private.site_visitor(p_token_hash, p_identity_email);"));
  assert.ok(site_.includes("where id = p_survey_id and conversation_id = v.conversation_id and channel = 'site' for update"));
  // Respostas automáticas das redes sociais: nunca a uma resposta a um pedido.
  const claim = fn(SQL, "create or replace function public.ldo_support_social_autoreply_claim(");
  assert.ok(claim.includes("join public.ldo_support_surveys s on s.rating_message_id = m.id"));
});

test("Creating and sending: own recent resolve, no choice in automatic mode, everything checked again before it leaves", () => {
  const create = fn(SQL, "create function public.ldo_support_survey_create(");
  assert.ok(create.includes("if v_s.survey_mode = 'perguntar' and p_request is not true then"));
  assert.ok(!/survey_mode = 'automatico'/.test(create), "no automático a caixa não conta");
  assert.ok(create.includes("v_a.actor is distinct from v_me or v_a.details ->> 'to' is distinct from 'resolvido'"));
  assert.ok(create.includes("or v_a.created_at < now() - interval '5 minutes'"));
  const due = fn(SQL, "create function public.ldo_support_survey_due(");
  assert.ok(due.includes("then 'reaberta'") && due.includes("ldo_private.support_survey_block(v.conversation_id, v.created_at)"));
  assert.ok(due.includes("set status = 'sending', attempt_at = now()") && due.includes("for update skip locked"));
  assert.ok(due.includes("where status = 'sending' and attempt_at < now() - interval '30 minutes'"), "sem resultado: falhado, nunca repetido");
  const block = fn(SQL, "create function ldo_private.support_survey_block(");
  const order = ["'desligado'", "'comentario'", "'canal'", "'canal_desligado'", "'sem_resposta'", "'ultima_cliente'", "'janela_24h'", "'chat_terminado'",
    "'sem_pedidos'", "'conversa_recente'", "'contacto_recente'"].map((k) => block.indexOf(`return ${k};`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), JSON.stringify(order));
  assert.ok(block.includes("v_c.last_inbound_at <= now() - interval '23 hours'"));
  const agent = fn(SQL, "create function ldo_private.support_survey_agent(");
  assert.ok(agent.includes("order by count(*) desc, max(m.created_at) desc") && agent.includes("m.author_user_id is not null and m.origin is null"));
  const sent = fn(SQL, "create function public.ldo_support_survey_sent(");
  assert.ok(sent.includes("status = case when p_outcome = 'failed' then 'failed' else 'sent' end"), "incerto = enviado (pode ter chegado)");
});

test("The conversation shows survey events beyond the 30 latest actions and the score only to the Super Admin and the rated person", () => {
  const conv = fn(SQL, "create or replace function public.ldo_support_conversation(");
  assert.ok(conv.includes("where l.conversation_id = p_id and (l.action like 'survey.%'"));
  assert.ok(conv.includes("then l.details - 'score' else l.details end"));
  assert.ok(conv.includes("'score', case when v_super or s.agent_id = v_me then s.score end"));
  assert.ok(conv.includes("'body', case when coalesce(rs.hidden, false) then '' else m.body end"));
  assert.ok(conv.includes("'origin', m.origin, 'rating', rs.survey_id is not null"));
  assert.deepEqual([...conv.matchAll(/raise exception '([^']+)'/g)].map((x) => x[1]), ["Conversa não encontrada."], "abre sempre (verificação de acesso)");
});

// Corpo de uma função numa migração anterior (com LF).
const source = (file, head) => body(fn(read(`supabase/migrations/${file}`), head));
// Linhas do texto de origem que já não estão na cópia (subsequência mais longa comum).
function removedLines(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) i++, j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(x[i++]);
    else j++;
  }
  return out.concat(x.slice(i));
}

test("The copied functions start from the production text (md5 in the header) and only the marked lines change", () => {
  const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");
  const COPIES = [
    ["20261008150000_ldo_support_site_chat_fixes.sql", "create function public.ldo_support_site_send(", "88370fd3dbd45d8130bff6de669c1af0",
      ["  if v_c.status in ('resolvido', 'aguarda_cliente') then"]],
    ["20261015120000_ldo_support_site_locale.sql", "create or replace function public.ldo_support_site_notify_claim(", "360f3b21a1eba5c2964707607ffe23d9", []],
    ["20261015120000_ldo_support_site_locale.sql", "create or replace function public.ldo_support_site_messages(", "6ea15123173245bcd5a22134acb4478c",
      ["    'messages', v_list || v_notices"]],
    ["20261009150000_ldo_support_social_fixes2.sql", "create function public.ldo_support_social_autoreply_claim(", "f426f91c0926e25ed35ec76c10e8327d", []],
    ["20261030100000_ldo_support_history_from.sql", "create or replace function public.ldo_support_conversation(", null, [
      "        'author_user_id', m.author_user_id, 'body', m.body, 'attachments', m.attachments, 'created_at', m.created_at,",
      "        'delivery', m.delivery, 'delivery_detail', m.delivery_detail, 'external', m.external_id is not null) order by m.created_at, m.inserted_at)",
      "      select jsonb_agg(jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,",
      "      from (select * from public.ldo_support_audit where conversation_id = p_id order by created_at desc limit 30) l",
    ]],
  ];
  for (const [file, head, live, removed] of COPIES) {
    const src = source(file, head);
    if (live) {
      assert.equal(md5(src), live, `${head}: o texto da migração de origem é o de produção`);
      assert.ok(SQL.slice(0, SQL.indexOf("-- ----")).includes(live), `${head}: md5 no cabeçalho`);
    }
    const copy = body(fn(SQL, head.replace(/^create function /, "create or replace function ")));
    assert.deepEqual(removedLines(src, copy), removed, head);
  }
  // Atributos e assinaturas iguais (create or replace mantém os acessos).
  for (const head of ["public.ldo_support_site_send(p_token text, p_token_hash text, p_identity_email text, p_body text, p_client_key uuid,",
    "public.ldo_support_social_autoreply_claim(p_token text, p_source text, p_conversation text, p_contact text,"])
    assert.ok(SQL.includes(`create or replace function ${head}`), head);
});

test("Sync patch: four anchors in the production text of ldo_support_ingest, each exactly once, or the migration stops", () => {
  const block = SQL.slice(SQL.indexOf("pg_get_functiondef('public.ldo_support_ingest(text,text,jsonb)'"), SQL.indexOf("execute v_def;"));
  assert.ok(block.includes("if length(v_def) - length(replace(v_def, v_old[i], '')) <> length(v_old[i]) then"));
  assert.ok(block.includes("raise exception 'ldo_support_ingest: âncora % não encontrada ou repetida: %', i, v_old[i];"));
  const live = source("20261013100000_ldo_support_post_comments.sql", "create or replace function public.ldo_support_ingest(");
  assert.equal(crypto.createHash("md5").update(live).digest("hex"), "246628003beab3ce0a50c26aca3e950f", "texto de produção");
  for (const anchor of ["  v_deleted boolean;", "on conflict (conversation_id, external_id) do nothing;", "        v_new_msgs := v_new_msgs + 1;",
    "and abs(extract(epoch from (created_at - (m ->> 'created_at')::timestamptz))) < 900"]) {
    assert.equal(live.split(anchor).length - 1, 1, anchor);
    assert.ok(block.includes(`'${anchor.replace(/'/g, "''")}'`), anchor);
  }
  assert.ok(block.includes("returning id into v_mid;"));
  assert.ok(block.includes("ldo_private.support_take_rating(v_conv.id, v_mid, m ->> ''body'')"));
  assert.ok(block.includes("coalesce(m ->> ''auto_submitted'', '''') = ''true''"));
  // A nota é lida antes de contar a mensagem como nova do cliente (a reabertura só olha para v_new_inbound).
  assert.ok(block.indexOf("v_new_msgs := v_new_msgs + 1;\\n'") < block.indexOf("support_take_rating"));
  // Chat do site: o mesmo, antes da reabertura.
  const send = fn(SQL, "create or replace function public.ldo_support_site_send(");
  assert.ok(send.indexOf("v_rated := ldo_private.support_take_rating(v_c.id, v_m.id, v_body);") < send.indexOf("if not v_rated and v_c.status in ('resolvido', 'aguarda_cliente') then"));
});

test("Accessibility: the resolve dialog gives focus back, follow-up links say which conversation, widget stars have 3:1 contrast", () => {
  const inbox = read("components/support/inbox.tsx");
  assert.ok(inbox.includes("<select ref={statusSelect}") && inbox.includes("statusSelect.current?.focus();"));
  const page = read("app/(painel)/apoio/desempenho/page.tsx");
  assert.ok(page.includes("aria-label={`Abrir a conversa com ${f.contact || \"o cliente\"} (${when(f.rated_at)})`}"));
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const widget = read("public/site-chat/ldo-chat.js");
  const star = /"\.star \{[^"]*color: (#[0-9a-f]{6});/.exec(widget);
  const hover = /"\.stars:hover \.star:not\(\[disabled\]\) \{ color: (#[0-9a-f]{6}); \}/.exec(widget);
  assert.ok(star && hover);
  for (const c of [star[1], hover[1]]) assert.ok(ratio(c, "#f2f4ef") >= 3, c);
});
