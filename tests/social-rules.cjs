const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../.test-build/support/social-rules.js");

// Quinta-feira, 8 de outubro de 2026, 22:00 em Lisboa (fora do horário 07:00-21:00).
const NIGHT = new Date("2026-10-08T21:00:00Z");
// Mesmo dia, 15:00 em Lisboa (dentro do horário).
const DAY = new Date("2026-10-08T14:00:00Z");
const HOURS = { weekdays: "07:00-21:00", saturday: "07:00-21:00", sunday: "07:00-21:00" };
const AWAY = "Olá {nome} 😊, obrigado pela sua mensagem. De momento não estamos disponíveis.";
const settings = (over = {}) => ({ enabled: true, text: "", offhours_text: AWAY, thanks_text: "Obrigado! 💛", hours: HOURS, ...over });
let n = 0;
const msg = (kind, body, minutesAgo, now = NIGHT, attachments = []) => ({
  external_id: `m${++n}`, kind, body, attachments, created_at: new Date(now.getTime() - minutesAgo * 60000).toISOString(),
});

test("Story reactions, likes and emoji-only messages are reactions; questions, text and photos are support", () => {
  const c = (body, attachments = []) => s.classifySocial({ body, attachments });
  assert.equal(c(""), "reaction"); // reação/menção na story ou gosto: a Metricool entrega vazia
  assert.equal(c("", ["https://x/img.jpg"]), "support"); // foto
  assert.equal(c("😍😍"), "reaction");
  assert.equal(c("❤️🔥 !!"), "reaction");
  assert.equal(c("Que lindo!"), "reaction");
  assert.equal(c("Lindíssimo 😍"), "reaction");
  assert.equal(c("Obrigada"), "reaction");
  assert.equal(c("muito bonito mesmo"), "support"); // "mesmo" não é elogio da lista: na dúvida, apoio
  assert.equal(c("?"), "support");
  assert.equal(c("Lindo! Quanto custa?"), "support");
  assert.equal(c("Tem este anel no tamanho 14"), "support");
  assert.equal(c("Bom dia, a minha encomenda ainda não chegou"), "support");
  assert.equal(c("lindo lindo lindo lindo lindo lindo"), "support"); // mais de 5 palavras
});

test("A support message off-hours gets the away message with the first name; within hours only if a text is set", () => {
  const d = s.socialAutoReply([msg("inbound", "Bom dia, tem este anel?", 2)], settings(), NIGHT, "Maria Odete");
  assert.equal(d.kind, "support");
  assert.equal(d.text, "Olá Maria 😊, obrigado pela sua mensagem. De momento não estamos disponíveis.");
  // Dentro do horário, sem texto para o horário: nada (a equipa responde).
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 2, DAY)], settings(), DAY, "Maria"), null);
  const inHours = s.socialAutoReply([msg("inbound", "Tem este anel?", 2, DAY)], settings({ text: "Olá {nome}! Já respondemos." }), DAY, "Maria");
  assert.equal(inHours.text, "Olá Maria! Já respondemos.");
  // Sem nome: o {nome} sai sem deixar espaços a mais.
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 2)], settings(), NIGHT, null).text, "Olá 😊, obrigado pela sua mensagem. De momento não estamos disponíveis.");
  // Nome de utilizador do Instagram.
  assert.match(s.socialAutoReply([msg("inbound", "Preço?", 2)], settings(), NIGHT, "@tania_14aldeia").text, /^Olá tania_14aldeia 😊/);
});

test("A story reaction never gets the away message; it gets a short thanks once it settles and only when isolated", () => {
  const reaction = [msg("inbound", "", 5)];
  const d = s.socialAutoReply(reaction, settings(), NIGHT, "Ana");
  assert.deepEqual({ kind: d.kind, text: d.text }, { kind: "thanks", text: "Obrigado! 💛" });
  // Ainda pode estar a escrever (menos de 4 minutos): espera.
  assert.equal(s.socialAutoReply([msg("inbound", "😍", 2)], settings(), NIGHT, "Ana"), null);
  // Reação no meio de uma conversa (respondemos há 2 horas): nada.
  assert.equal(s.socialAutoReply([msg("inbound", "Tem o anel?", 300), msg("outbound", "Temos sim!", 120), msg("inbound", "", 5)], settings(), NIGHT, "Ana"), null);
  // Reação seguida de um pedido: é o pedido que conta.
  assert.equal(s.socialAutoReply([msg("inbound", "", 3), msg("inbound", "Quanto custa este?", 1)], settings(), NIGHT, "Ana").kind, "support");
  // Sem texto de agradecimento: nada.
  assert.equal(s.socialAutoReply(reaction, settings({ thanks_text: "" }), NIGHT, "Ana"), null);
  // Conversa antiga (a última resposta foi há 3 dias): a reação de agora é agradecida.
  assert.equal(s.socialAutoReply([msg("outbound", "Obrigado!", 3 * 24 * 60), msg("inbound", "❤️", 6)], settings(), NIGHT, "Ana").kind, "thanks");
});

test("Nothing is sent when switched off, when we spoke last, for old messages or for deleted ones", () => {
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 2)], settings({ enabled: false }), NIGHT, "Ana"), null);
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 5), msg("outbound", "Temos!", 1)], settings(), NIGHT, "Ana"), null);
  // Mensagem com mais de 3 horas: nada.
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 200)], settings(), NIGHT, "Ana"), null);
  // Sincronização atrasada (45 minutos): ainda responde.
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 45)], settings(), NIGHT, "Ana").kind, "support");
  // Mensagem anterior à ligação da função: nada.
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 10)], settings({ enabled_at: new Date(NIGHT.getTime() - 5 * 60000).toISOString() }), NIGHT, "Ana"), null);
  assert.equal(s.socialAutoReply([{ ...msg("inbound", "Tem este anel?", 2), deleted: true }], settings(), NIGHT, "Ana"), null);
  assert.equal(s.socialAutoReply([], settings(), NIGHT, "Ana"), null);
  // Notas internas não contam como resposta nossa.
  const withNote = [msg("inbound", "Tem este anel?", 3), msg("note", "ver stock", 2)];
  assert.equal(s.socialAutoReply(withNote, settings(), NIGHT, "Ana").kind, "support");
  // A âncora é a última mensagem do cliente.
  const two = [msg("inbound", "Olá", 4), msg("inbound", "Tem este anel?", 2)];
  assert.equal(s.socialAutoReply(two, settings(), NIGHT, "Ana").anchor, two[1].external_id);
});

test("Only clear reactions from someone who never asked anything leave the main list", () => {
  // Emoji ou elogio escrito: sai logo (mesmo antes do agradecimento, que espera 4 minutos).
  const r = [msg("inbound", "😍", 0.2)];
  assert.deepEqual(s.hiddenReaction(r, NIGHT), { from: r[0].created_at, through: r[0].created_at });
  // Mensagem vazia sem indicação da Metricool (pode ser uma partilha ou um áudio): fica na lista principal...
  assert.equal(s.hiddenReaction([msg("inbound", "", 0.2)], NIGHT), null);
  // ...mas com a indicação de reação/menção na story sai.
  const story = [{ ...msg("inbound", "", 0.2), properties: { type: "story_mention" } }];
  assert.equal(s.hiddenReaction(story, NIGHT).through, story[0].created_at);
  assert.equal(s.reactionHint({ reply_to: { story: { id: "1" } } }), true);
  assert.equal(s.reactionHint({ shared_post: { url: "x" } }), false);
  assert.equal(s.reactionHint(null), false);
  // Um pedido, agora ou em qualquer altura da conversa, deixa-a na lista principal.
  assert.equal(s.hiddenReaction([msg("inbound", "Tem este anel?", 2)], NIGHT), null);
  assert.equal(s.hiddenReaction([msg("inbound", "Tem o anel?", 3000), msg("outbound", "Temos!", 2900), msg("inbound", "❤️", 3)], NIGHT), null);
  // Várias reações: do primeiro ao último.
  const many = [msg("inbound", "😍", 3000), msg("outbound", "Obrigado! 💛", 2990), msg("inbound", "Lindo!", 2)];
  assert.deepEqual(s.hiddenReaction(many, NIGHT), { from: many[0].created_at, through: many[2].created_at });
  // Já respondemos depois da reação, reação antiga ou anterior à ligação: nada a marcar.
  assert.equal(s.hiddenReaction([msg("inbound", "😍", 10), msg("outbound", "Obrigado! 💛", 5)], NIGHT), null);
  assert.equal(s.hiddenReaction([msg("inbound", "😍", 200)], NIGHT), null);
  assert.equal(s.hiddenReaction([msg("inbound", "😍", 10)], NIGHT, { enabled_at: new Date(NIGHT.getTime() - 5 * 60000).toISOString() }), null);
});

test("With no hours filled in, social media is always 'closed': the off-hours message always goes out", () => {
  const empty = { weekdays: "", saturday: "", sunday: "" };
  assert.equal(s.socialAutoReply([msg("inbound", "Tem este anel?", 2, DAY)], settings({ hours: empty }), DAY, "Ana").kind, "support");
  assert.match(s.socialAutoReply([msg("inbound", "Tem este anel?", 2, DAY)], settings({ hours: empty }), DAY, "Ana").text, /não estamos disponíveis/);
});
