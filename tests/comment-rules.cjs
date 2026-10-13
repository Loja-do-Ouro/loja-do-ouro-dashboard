const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/support/comment-rules.js");

const NOW = new Date("2026-10-12T12:00:00Z");
const IMG = "https://scontent.cdninstagram.com/v/t51/123.jpg?oe=6A000000";
const BRAND = "17841400000000000";

function igThread(over = {}) {
  return {
    id: "mc-1", provider: "INSTAGRAM", status: "READ", lastUpdateTime: "2026-10-11T22:48:27+0200",
    participants: [{ id: "cliente_a", name: "cliente_a", imageProfileUrl: "https://scontent.cdninstagram.com/p.jpg" }],
    root: {
      id: "c-root", creationDate: "2026-10-11T20:00:00+0200", owner: "cliente_a", text: "Qual o preço?\u0007",
      element: {
        id: "post-1", owner: { id: BRAND, name: "lojadoouro" }, link: "https://www.instagram.com/reel/AbC/", text: "Anel solitário\nem ouro",
        mediaUrls: [IMG, "https://evil.example.com/x.jpg", "http://scontent.cdninstagram.com/y.jpg", "https://video.fbcdn.net/v/clip.mp4?x=1"],
        commentCount: 12, reactionCount: 40, properties: { igMediaProductType: "REELS" },
      },
      comments: [
        { id: "c-2", parentId: "c-root", creationDate: "2026-10-11T21:00:00+0200", owner: BRAND, text: "Enviámos mensagem privada 💛" },
        { id: "c-3", parentId: "c-root", creationDate: "2026-10-11T22:00:00+0200", owner: "amiga", text: "@cliente_a olha" },
      ],
      ...over,
    },
  };
}

test("Comment channels and their text limits", () => {
  assert.equal(r.isCommentChannel("instagram_comments"), true);
  assert.equal(r.isCommentChannel("facebook_comments"), true);
  for (const c of ["instagram", "facebook", "email", "", null, undefined]) assert.equal(r.isCommentChannel(c), false, String(c));
  assert.equal(r.COMMENT_MAX_CHARS.instagram_comments, 2200);
  assert.equal(r.COMMENT_MAX_CHARS.facebook_comments, 8000);
});

test("Post links: only https on Facebook or Instagram (they are used as href)", () => {
  for (const ok of ["https://www.instagram.com/p/x/", "https://instagram.com/reel/x", "https://www.facebook.com/123/posts/456", "https://m.facebook.com/story.php?story_fbid=1", "https://fb.watch/abc/"])
    assert.ok(r.safePostLink(ok), ok);
  for (const bad of ["http://www.instagram.com/p/x/", "javascript:alert(1)", "https://evil.com/instagram.com/p/x", "https://instagram.com.evil.com/p/x",
    "https://user:pw@www.instagram.com/p/x", "https://www.instagram.com:8443/p/x", "https://notfacebook.com/x", "", null, 42, "x".repeat(1200)])
    assert.equal(r.safePostLink(bad), null, String(bad));
});

test("Meta media: only https on the Meta servers", () => {
  assert.equal(r.metaMediaUrl(IMG), IMG);
  assert.ok(r.metaMediaUrl("https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1"));
  for (const bad of ["http://scontent.cdninstagram.com/a.jpg", "https://evil.com/a.jpg", "https://cdninstagram.com.evil.com/a.jpg", "https://evilfbcdn.net/a.jpg", "data:image/png;base64,AA", null])
    assert.equal(r.metaMediaUrl(bad), null, String(bad));
});

test("Post kind: Meta's classification first, then the link", () => {
  assert.equal(r.postKind("https://www.instagram.com/p/x/", "REELS"), "reel");
  assert.equal(r.postKind(null, "AD"), "ad");
  assert.equal(r.postKind(null, "ADS"), "ad");
  assert.equal(r.postKind(null, "STORY"), "story");
  assert.equal(r.postKind("https://www.instagram.com/p/x/", "FEED"), "post");
  assert.equal(r.postKind("https://www.instagram.com/reel/x/", null), "reel");
  assert.equal(r.postKind("https://www.facebook.com/123/videos/456", null), "video");
  assert.equal(r.postKind("https://www.facebook.com/photo.php?fbid=1", null), "photo");
  assert.equal(r.postKind("https://www.facebook.com/123/posts/456", null), "post");
  assert.equal(r.postKind(null, null), "other");
  assert.equal(r.postKind(null, "FEED"), "post");
  assert.equal(r.POST_KIND_LABEL.reel, "Reel");
});

test("Metricool dates with a +0200 offset", () => {
  assert.equal(r.commentDate("2026-10-11T22:48:27+0200"), "2026-10-11T20:48:27.000Z");
  assert.equal(r.commentDate("2026-10-11T22:48:27Z"), "2026-10-11T22:48:27.000Z");
  assert.equal(r.commentDate("ontem"), null);
  assert.equal(r.commentDate(undefined), null);
});

test("Instagram thread: brand replies are ours, other people are inbound with their username", () => {
  const c = r.threadToConversation(igThread(), { network: "INSTAGRAM", now: NOW });
  assert.equal(c.external_id, "c-root");
  assert.equal(c.via, "comment");
  assert.equal(c.platform_status, "READ");
  assert.equal(c.external_updated_at, "2026-10-11T20:48:27.000Z");
  assert.deepEqual(c.contact, { external_id: "cliente_a", name: "cliente_a", email: null, handle: "cliente_a", avatar_url: "https://scontent.cdninstagram.com/p.jpg" });
  assert.deepEqual(c.messages.map((m) => [m.external_id, m.kind, m.author_name]), [["c-root", "inbound", "cliente_a"], ["c-2", "outbound", null], ["c-3", "inbound", "amiga"]]);
  assert.equal(c.messages[0].body, "Qual o preço?", "caracteres de controlo retirados");
  // Última mensagem de outra pessoa, recente: fica em Novo.
  assert.equal(c.resolved, null);
  assert.equal(c.subject, "Reel · Anel solitário em ouro");
  assert.equal(c.post.external_id, "post-1");
  assert.equal(c.post.kind, "reel");
  assert.equal(c.post.product_type, "REELS");
  assert.equal(c.post.link, "https://www.instagram.com/reel/AbC/");
  assert.equal(c.post.caption, "Anel solitário\nem ouro");
  assert.deepEqual(c.post.media, [{ url: IMG, kind: "image" }, { url: "https://video.fbcdn.net/v/clip.mp4?x=1", kind: "video" }]);
  assert.equal(c.post.comment_count, 12);
  assert.equal(c.post.owner_name, "lojadoouro");
});

test("Answered (last message from the brand) and stale (no activity for more than 7 days)", () => {
  const t = igThread();
  t.root.comments = t.root.comments.slice(0, 1);
  assert.equal(r.threadToConversation(t, { network: "INSTAGRAM", now: NOW }).resolved, "answered");
  const old = igThread({ creationDate: "2026-09-01T10:00:00+0200", comments: [] });
  assert.equal(r.threadToConversation(old, { network: "INSTAGRAM", now: NOW }).resolved, "stale");
  const recent = igThread({ comments: [] });
  assert.equal(r.threadToConversation(recent, { network: "INSTAGRAM", now: NOW }).resolved, null);
});

test("Root comment by the brand: the customer is the first other person; only the brand → not imported", () => {
  const t = igThread({ owner: BRAND, comments: [{ id: "c-9", creationDate: "2026-10-11T23:00:00+0200", owner: "cliente_b", text: "Quanto custa?" }] });
  const c = r.threadToConversation(t, { network: "INSTAGRAM", now: NOW });
  assert.equal(c.contact.external_id, "cliente_b");
  assert.deepEqual(c.messages.map((m) => m.kind), ["outbound", "inbound"]);
  assert.equal(r.threadToConversation(igThread({ owner: BRAND, comments: [] }), { network: "INSTAGRAM", now: NOW }), null);
  // A marca também pelo nome de utilizador (dono da publicação ou configurado).
  const byName = igThread({ comments: [{ id: "c-5", creationDate: "2026-10-11T21:00:00+0200", owner: "@LojaDoOuro", text: "Olá!" }] });
  assert.equal(r.threadToConversation(byName, { network: "INSTAGRAM", now: NOW }).messages[1].kind, "outbound");
  const handle = igThread({ comments: [{ id: "c-6", creationDate: "2026-10-11T21:00:00+0200", owner: "ourivesaria.jerico", text: "Olá!" }] });
  assert.equal(r.threadToConversation(handle, { network: "INSTAGRAM", now: NOW, brandHandles: ["ourivesaria.jerico"] }).messages[1].kind, "outbound");
});

test("Threads without the root comment id or the post owner are not imported (the reply target must be known)", () => {
  assert.equal(r.threadToConversation(igThread({ id: undefined }), { network: "INSTAGRAM", now: NOW }), null);
  const noOwner = igThread();
  delete noOwner.root.element.owner;
  assert.equal(r.threadToConversation(noOwner, { network: "INSTAGRAM", now: NOW }), null);
  assert.equal(r.threadToConversation({ id: "x" }, { network: "INSTAGRAM", now: NOW }), null);
});

test("Facebook thread: numeric owners, names from the participants, unknown third parties", () => {
  const t = {
    id: "fb-1", status: "PENDING", participants: [{ id: "111", name: "Maria Silva" }],
    root: {
      id: "999_111", creationDate: "2026-10-12T09:00:00+0200", owner: "111", text: "Fazem entregas?", mediaUrl: "https://scontent.xx.fbcdn.net/v/a.jpg",
      element: { id: "page_post", owner: { id: "555" }, link: "https://www.facebook.com/555/posts/1", text: "", mediaUrls: [] , properties: { fbMediaProductType: "post" } },
      comments: [{ id: "999_222", creationDate: "2026-10-12T09:30:00+0200", owner: "222", text: "Também quero saber", mediaUrl: "https://evil.com/a.jpg" }],
    },
  };
  const c = r.threadToConversation(t, { network: "FACEBOOK", now: NOW });
  assert.deepEqual(c.contact, { external_id: "111", name: "Maria Silva", email: null, handle: null, avatar_url: null });
  assert.deepEqual(c.messages.map((m) => [m.kind, m.author_name, m.attachments.length]), [["inbound", "Maria Silva", 1], ["inbound", "Outra pessoa", 0]]);
  assert.equal(c.messages[0].attachments[0].ref, "metricool:https://scontent.xx.fbcdn.net/v/a.jpg");
  assert.equal(c.post.kind, "post");
  assert.equal(c.post.caption, null);
  assert.equal(c.subject, "Publicação");
});

test("Public reply risks: personal data visible to everyone (the store's own contacts do not count)", () => {
  assert.deepEqual(r.publicReplyRisks("Obrigado! Envie-nos mensagem privada, por favor 💛"), []);
  assert.deepEqual(r.publicReplyRisks("Escreva para apoiocliente@lojadoouro.pt"), []);
  assert.deepEqual(r.publicReplyRisks("O seu email maria@gmail.com está registado"), ["um endereço de email"]);
  for (const phone of ["912 345 678", "+351 912345678", "213 456 789", "96-123-4567"])
    assert.ok(r.publicReplyRisks(`Ligue para ${phone}`).includes("um número de telefone"), phone);
  assert.ok(r.publicReplyRisks("Morada: Rua X, 1000-001 Lisboa").includes("um código postal"));
  assert.ok(r.publicReplyRisks("A sua encomenda #93120 já seguiu").includes("um número de encomenda"));
  assert.ok(r.publicReplyRisks("A encomenda 93120 já seguiu").includes("um número de encomenda"));
  assert.ok(r.publicReplyRisks("Indique o NIF").includes("dados de identificação ou pagamento"));
  assert.deepEqual(r.publicReplyRisks("Temos o anel em 3 tamanhos, desde 250 €."), []);
});

test("Third-party text never carries half an emoji (the database would refuse the whole batch)", () => {
  const heart = "\u{1F48E}";
  const at119 = "a".repeat(119) + heart + " fim";
  assert.equal(r.cut(at119, 120), "a".repeat(119), "corte antes do emoji, nunca a meio");
  assert.equal(r.cut("abc", 10), "abc");
  assert.equal(r.wellFormed("x\uD83D"), "x�");
  assert.equal(r.wellFormed("\uDC8Ey"), "�y");
  assert.equal(r.wellFormed(`ok ${heart}`), `ok ${heart}`);
  const t = igThread();
  t.root.element.text = "b".repeat(115) + " " + heart + heart + " legenda";
  t.root.text = "olá \uD83D";
  const c = r.threadToConversation(t, { network: "INSTAGRAM", now: NOW });
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(!lone.test(c.subject), "assunto sem metade de emoji");
  assert.ok(!lone.test(c.messages[0].body), "texto do comentário sem metade de emoji");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(c)));
  const long = igThread();
  long.root.element.text = "c".repeat(2199) + heart;
  assert.equal(r.threadToConversation(long, { network: "INSTAGRAM", now: NOW }).post.caption, "c".repeat(2199));
});

test("Brand of a page: configured or known first, else the owner of more than half of the posts", () => {
  const th = (owner) => ({ root: { id: `r-${Math.random()}`, element: { id: "p", owner: { id: owner } } } });
  assert.equal(r.commentBrand([th("555"), th("555"), th("777")], null), "555");
  assert.equal(r.commentBrand([th(555), th(555)], null), "555", "id numérico");
  assert.equal(r.commentBrand([th("555"), th("777")], null), null, "empate: sem marca");
  assert.equal(r.commentBrand([], null), null);
  assert.equal(r.commentBrand([th("777")], "555"), "555", "conhecida prevalece");
  // Um tópico numa publicação de outra conta fica de fora.
  assert.equal(r.threadToConversation(igThread(), { network: "INSTAGRAM", now: NOW, brandId: "999" }), null);
  assert.ok(r.threadToConversation(igThread(), { network: "INSTAGRAM", now: NOW, brandId: BRAND }));
});

test("Facebook: page replies are ours and close the thread as answered; ids may come as numbers", () => {
  const t = {
    id: "fb-2", participants: [{ id: 111, name: "Maria Silva" }],
    root: {
      id: 999111, creationDate: "2026-10-12T09:00:00+0200", owner: 111, text: "Têm em prata?",
      element: { id: 42, owner: { id: 555 }, link: "https://www.facebook.com/555/posts/1", text: "Novidade" },
      comments: [
        { id: 999333, creationDate: "2026-10-12T10:00:00+0200", owner: 555, text: "Temos, sim!" },
        { id: 999222, creationDate: "2026-10-12T09:30:00+0200", owner: 222, text: "Também quero" },
      ],
    },
  };
  const c = r.threadToConversation(t, { network: "FACEBOOK", now: NOW });
  assert.equal(c.external_id, "999111");
  assert.equal(c.contact.external_id, "111");
  assert.equal(c.contact.name, "Maria Silva");
  // Por ordem de hora, mesmo que a Metricool as entregue desordenadas.
  assert.deepEqual(c.messages.map((m) => [m.external_id, m.kind]), [["999111", "inbound"], ["999222", "inbound"], ["999333", "outbound"]]);
  assert.equal(c.resolved, "answered");
  assert.equal(c.post.external_id, "42");
});

test("Root by the brand with replies out of order: the customer is the first other person by time", () => {
  const t = igThread({
    owner: BRAND,
    comments: [
      { id: "c-late", creationDate: "2026-10-11T23:00:00+0200", owner: "segunda", text: "eu também" },
      { id: "c-early", creationDate: "2026-10-11T21:00:00+0200", owner: "primeira", text: "quanto custa?" },
    ],
  });
  assert.equal(r.threadToConversation(t, { network: "INSTAGRAM", now: NOW }).contact.external_id, "primeira");
});

test("Public reply checks: notes never published, target from the database, text only, network limits", () => {
  const ok = { kind: "outbound", channel: "instagram_comments", provider: "INSTAGRAM", objectId: "17900000000000001", body: "Obrigado!", uploads: 0 };
  assert.equal(r.commentReplyProblem(ok), null);
  assert.equal(r.commentReplyProblem({ ...ok, objectId: "999_111" }), null, "ids do Facebook com _");
  assert.match(r.commentReplyProblem({ ...ok, kind: "note" }), /nunca é publicada/);
  assert.match(r.commentReplyProblem({ ...ok, channel: "instagram" }), /não é de comentários/);
  for (const objectId of [null, "", "../x", "a b", "x".repeat(201)]) assert.match(r.commentReplyProblem({ ...ok, objectId }), /destino por identificar/, String(objectId));
  assert.match(r.commentReplyProblem({ ...ok, provider: undefined }), /destino por identificar/);
  assert.match(r.commentReplyProblem({ ...ok, uploads: 1 }), /não levam anexos/);
  assert.match(r.commentReplyProblem({ ...ok, body: "   " }), /Escreva/);
  assert.match(r.commentReplyProblem({ ...ok, body: "x".repeat(2201) }), /máximo 2200/);
  assert.equal(r.commentReplyProblem({ ...ok, channel: "facebook_comments", body: "x".repeat(2201) }), null, "Facebook aceita até 8000");
  assert.match(r.commentReplyProblem({ ...ok, channel: "facebook_comments", body: "x".repeat(8001) }), /máximo 8000/);
});

test("Card titles agree with each post kind, and shipping codes are flagged in public replies", () => {
  assert.equal(r.POST_KIND_TITLE.reel, "Reel comentado");
  assert.equal(r.POST_KIND_TITLE.video, "Vídeo comentado");
  assert.equal(r.POST_KIND_TITLE.ad, "Anúncio comentado");
  assert.equal(r.POST_KIND_TITLE.post, "Publicação comentada");
  assert.ok(r.publicReplyRisks("Siga com o código RR123456789PT").includes("um código de envio"));
});

// Listagem simulada: n páginas, cada pedido avança o relógio; falhas por página (url -> estado).
function fakeListing(n, { cost = 3_000, fail = {} } = {}) {
  const url = (i) => `/v2/inbox/post-comments?provider=INSTAGRAM&page=${i}`;
  const clock = { t: 0 };
  const calls = [];
  const fetchPage = async (next, timeout) => {
    const i = next ? Number(new URL(next, "https://app.metricool.com/api/").searchParams.get("page")) : 1;
    calls.push({ i, timeout });
    clock.t += cost;
    if (fail[i] !== undefined) return { status: fail[i], data: [], next: null };
    return { status: 200, data: [`p${i}`], next: i < n ? url(i + 1) : null };
  };
  return { clock, calls, fetchPage, url };
}

async function pass(listing, cursor, { budget = 40_000, firstPageOnly = false } = {}) {
  const plan = r.commentReadPlan(cursor, listing.clock.t + Date.parse("2026-10-12T00:00:00Z"), firstPageOnly);
  const seen = [];
  const walk = await r.walkPages({
    fetchPage: listing.fetchPage, maxPages: plan.maxPages, deadline: listing.clock.t + budget, now: () => listing.clock.t,
    resume: plan.resume, onPage: async (p) => { seen.push(...p); },
  });
  const after = r.commentCursorAfter(cursor, plan.walking, walk, listing.clock.t + Date.parse("2026-10-12T00:00:00Z"));
  return { seen, walk, ...after };
}

test("Paging: today's single page ends the full read at once; then only page 1, and a new full read after 6 hours", async () => {
  const l = fakeListing(1);
  let p = await pass(l, {});
  assert.deepEqual(p.seen, ["p1"]);
  assert.equal(p.walk.end, true);
  assert.equal(p.importing, false);
  assert.ok(p.cursor.full_read_at);
  assert.equal(r.commentReadPlan(p.cursor, Date.parse(p.cursor.full_read_at) + 3_600_000).maxPages, 1);
  assert.equal(r.commentReadPlan(p.cursor, Date.parse(p.cursor.full_read_at) + 7 * 3_600_000).walking, true);
});

test("Paging: a long list is read across passes and the full read finishes (no endless 'more')", async () => {
  const l = fakeListing(12);
  let cursor = {};
  const passes = [];
  for (let k = 0; k < 10; k++) {
    const p = await pass(l, cursor);
    passes.push(p.seen.join(","));
    cursor = p.cursor;
    if (!p.importing) break;
  }
  assert.deepEqual(passes, ["p1,p2,p3,p4,p5", "p1,p6,p7,p8,p9", "p1,p10,p11,p12"]);
  assert.ok(cursor.full_read_at && !cursor.next);
  // Depois: só a 1.ª página.
  const p = await pass(l, cursor);
  assert.deepEqual(p.seen, ["p1"]);
  assert.equal(p.importing, false);
});

test("Paging: a later page that times out does not fail the pass; the next pass retries that page", async () => {
  const l = fakeListing(4, { fail: { 3: null } });
  const p = await pass(l, {});
  assert.equal(p.walk.error, null);
  assert.deepEqual(p.seen, ["p1", "p2"]);
  assert.equal(p.importing, true);
  assert.equal(p.cursor.next, l.url(3));
  // A página 3 volta a responder na passagem seguinte.
  const ok = fakeListing(4);
  const q = await pass(ok, p.cursor);
  assert.deepEqual(q.seen, ["p1", "p3", "p4"]);
  assert.equal(q.importing, false);
});

test("Paging: page 1 failing is an error of the pass; 401/403 later too; a dead pointer (404) restarts the full read", async () => {
  const first = await r.walkPages({ fetchPage: async () => ({ status: 500, data: [], next: null }), maxPages: 5, deadline: 40_000, now: () => 0 });
  assert.deepEqual(first.error, { status: 500, first: true });
  const denied = fakeListing(3, { fail: { 2: 403 } });
  const d = await pass(denied, {});
  assert.deepEqual(d.walk.error, { status: 403, first: false });
  const dead = fakeListing(9, { fail: { 7: 404 } });
  const p = await pass(dead, { next: dead.url(7) });
  assert.deepEqual(p.seen, ["p1"]);
  assert.equal(p.cursor.next, undefined, "ponteiro largado");
  assert.equal(p.importing, true, "a leitura completa recomeça na passagem seguinte");
  const busy = fakeListing(9, { fail: { 7: 429 } });
  const b = await pass(busy, { next: busy.url(7) });
  assert.equal(b.cursor.next, busy.url(7), "limite de pedidos: mantém o ponto e tenta depois");
});

test("Paging: Verify reads only page 1 and leaves the full read where it was; timeouts fit the budget", async () => {
  const l = fakeListing(9);
  const p = await pass(l, { next: l.url(6) }, { firstPageOnly: true });
  assert.deepEqual(p.seen, ["p1"]);
  assert.equal(p.cursor.next, l.url(6));
  assert.equal(p.importing, false);
  const t = fakeListing(9, { cost: 9_000 });
  await pass(t, {});
  assert.equal(t.calls[0].timeout, 40_000, "1.ª página com espera fixa");
  assert.ok(t.calls.slice(1).every((c) => c.timeout >= 10_000 && c.timeout <= 40_000));
  assert.ok(t.calls.length <= 3, "pára com 15 s de margem no orçamento");
});

test("Paging: only https links inside the Metricool API are followed", () => {
  assert.equal(r.metricoolNext("/v2/inbox/post-comments?page=2"), "/v2/inbox/post-comments?page=2");
  assert.ok(r.metricoolNext("https://app.metricool.com/api/v2/inbox/post-comments?page=2"));
  for (const bad of ["https://evil.com/api/v2", "http://app.metricool.com/api/v2", "javascript:x", "", null, 3, "x".repeat(2100)])
    assert.equal(r.metricoolNext(bad), null, String(bad));
});
