const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../.test-build/criadores-meta-rules.js");
const r = require("../.test-build/criadores-rules.js");

// Plataforma de criadores, fase 3A: regras da leitura dos dados públicos do Instagram (lib/criadores-meta-rules.ts).
// Sem pedidos à Meta: as respostas são exemplos com a forma da Graph API.

const IG = "17841402274014251";
const CODE = "LDO-7K3Q9P";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400e3).toISOString();

// Resposta da Business Discovery com campos a mais (nunca podem sair do parse).
function discovery(over = {}, media = null) {
  return {
    business_discovery: {
      id: "17841400000000001", username: "ana.silva", followers_count: 12034, media_count: 321,
      biography: "Joias e estilo ✨", name: "Ana Silva", profile_picture_url: "https://scontent.cdninstagram.com/x.jpg",
      media: {
        data: media ?? [
          { id: "17900000000000001", timestamp: "2026-11-01T10:00:00+0000", media_type: "VIDEO", media_product_type: "REELS", like_count: 100, comments_count: 5, view_count: 4000,
            caption: "Legenda", media_url: "https://scontent.cdninstagram.com/v.mp4", thumbnail_url: "https://scontent.cdninstagram.com/t.jpg", permalink: "https://www.instagram.com/reel/x/" },
          { id: "17900000000000002", timestamp: "2026-10-30T09:30:00+0000", media_type: "IMAGE", media_product_type: "FEED", comments_count: 2 },
          { id: "17900000000000003", timestamp: "2026-10-29T09:30:00+0000", media_type: "CAROUSEL_ALBUM", like_count: "12", comments_count: -1, view_count: 1.5 },
          { id: "17900000000000004", timestamp: "2026-10-28T09:30:00+0000", media_type: "GIF" },
          { id: "17900000000000005", timestamp: "2026-10-27T09:30:00+0000", media_type: "IMAGE", media_product_type: "XPTO" },
          { id: "abc", timestamp: "2026-10-27T09:30:00+0000", media_type: "IMAGE" },
          { id: "17900000000000006", timestamp: "ontem", media_type: "IMAGE" },
        ],
        paging: { cursors: { after: "QVFIUk" } },
      },
      ...over,
    },
    id: IG,
  };
}

// ---------------------------------------------------------------- @ e campos

test("instagramHandle: Instagram usernames only, in lowercase", () => {
  assert.equal(m.instagramHandle("@Ana.Silva"), "ana.silva");
  assert.equal(m.instagramHandle("https://www.instagram.com/ana_silva/?hl=pt"), "ana_silva");
  assert.equal(m.instagramHandle("instagram.com/ana_silva/"), "ana_silva");
  assert.equal(m.instagramHandle(" ana.silva "), "ana.silva");
  for (const bad of ["ana-silva", "a".repeat(31), "ana silva", "", null, undefined, "@", "ana(silva)"]) assert.equal(m.instagramHandle(bad), null, String(bad));
  assert.equal(m.instagramHandle("a".repeat(30)), "a".repeat(30));
});

test("fields: exactly the whitelist, never a forbidden field; the biography only in its own request", () => {
  const d = m.discoveryFields("ana.silva");
  assert.equal(d, "business_discovery.username(ana.silva){id,username,followers_count,media_count,media.limit(25){id,timestamp,media_type,media_product_type,like_count,comments_count,view_count}}");
  assert.equal(m.biographyFields("ana.silva"), "business_discovery.username(ana.silva){id,username,biography}");
  assert.equal(m.connectionTestFields(), `id,username,${m.discoveryFields("lojadoouro")}`);
  const names = (s) => s.replace(/business_discovery\.username\([^)]*\)/, "").split(/[{},]/).map((x) => x.replace(/\.limit\(\d+\)/, "").trim()).filter(Boolean);
  for (const f of [d, m.connectionTestFields()]) {
    for (const n of names(f)) assert.ok([...m.PUBLIC_PROFILE_FIELDS, ...m.PUBLIC_MEDIA_FIELDS, "media"].includes(n), `${n} fora da lista branca`);
    for (const bad of m.FORBIDDEN_FIELDS) assert.ok(!names(f).includes(bad), `${bad} pedido`);
  }
  assert.deepEqual(names(m.biographyFields("ana.silva")).filter((n) => m.FORBIDDEN_FIELDS.includes(n)), ["biography"]);
  for (const bad of ["ana){id}", "a,b", "a(b", "a b", "Ana", "", "a{b}"]) {
    assert.throws(() => m.discoveryFields(bad), /inválido/, bad);
    assert.throws(() => m.biographyFields(bad), /inválido/, bad);
  }
});

test("graphUrl: graph.facebook.com, the version and the account, never the token; appsecret_proof only as 64 hex", () => {
  const u = new URL(m.graphUrl(IG, m.discoveryFields("ana.silva")));
  assert.equal(u.origin, "https://graph.facebook.com");
  assert.equal(u.pathname, `/v27.0/${IG}`);
  assert.equal(u.searchParams.get("fields"), m.discoveryFields("ana.silva"));
  assert.deepEqual([...u.searchParams.keys()], ["fields"]);
  assert.ok(!u.href.includes("access_token"));
  const proof = "a".repeat(64);
  assert.equal(new URL(m.graphUrl(IG, "id", proof)).searchParams.get("appsecret_proof"), proof);
  assert.throws(() => m.graphUrl(IG, "id", "curto"), /appsecret_proof/);
  for (const bad of ["", "123", "abc17841402274014251", "1784140227401425/../me"]) assert.throws(() => m.graphUrl(bad, "id"), /inválido/, bad);
  assert.equal(m.META_GRAPH_VERSION, "v27.0");
});

// ---------------------------------------------------------------- respostas

test("parseDiscovery keeps only the whitelist: no caption, URLs, biography or name; nulls stay null", () => {
  const p = m.parseDiscovery(discovery(), "ana.silva");
  assert.equal(p.ok, true);
  const s = JSON.stringify(p);
  for (const bad of ["caption", "Legenda", "media_url", "thumbnail_url", "permalink", "cdninstagram", "biography", "Joias", "Ana Silva", "profile_picture", "username", "paging", "QVFIUk"])
    assert.ok(!s.includes(bad), `${bad} saiu do parse`);
  assert.deepEqual(Object.keys(p.reading).sort(), ["followers", "ig_user_id", "media", "media_count"]);
  assert.equal(p.reading.ig_user_id, "17841400000000001");
  assert.equal(p.reading.followers, 12034);
  assert.equal(p.reading.media_count, 321);
  assert.deepEqual(p.reading.media.map((x) => x.media_id), ["17900000000000001", "17900000000000002", "17900000000000003"]);
  const [reel, image, carousel] = p.reading.media;
  assert.deepEqual(reel, { media_id: "17900000000000001", posted_at: "2026-11-01T10:00:00.000Z", media_type: "VIDEO", product_type: "REELS", like_count: 100, comments_count: 5, view_count: 4000 });
  assert.equal(image.like_count, null, "gostos escondidos: null, nunca 0");
  assert.equal(image.view_count, null);
  assert.equal(carousel.product_type, null);
  assert.equal(carousel.like_count, null, "número em texto");
  assert.equal(carousel.comments_count, null, "negativo");
  assert.equal(carousel.view_count, null, "decimal");
  for (const x of p.reading.media) assert.deepEqual(Object.keys(x).sort(), ["comments_count", "like_count", "media_id", "media_type", "posted_at", "product_type", "view_count"]);
});

test("parseDiscovery keeps views only on reels (the consent says «visualizações de reels»)", () => {
  const p = m.parseDiscovery(discovery({}, [
    { id: "17900000000000011", timestamp: "2026-11-01T10:00:00+0000", media_type: "VIDEO", media_product_type: "REELS", view_count: 900 },
    { id: "17900000000000012", timestamp: "2026-11-01T10:00:00+0000", media_type: "VIDEO", media_product_type: "FEED", like_count: 3, view_count: 800 },
    { id: "17900000000000013", timestamp: "2026-11-01T10:00:00+0000", media_type: "IMAGE", media_product_type: "FEED", view_count: 700 },
    { id: "17900000000000014", timestamp: "2026-11-01T10:00:00+0000", media_type: "CAROUSEL_ALBUM", view_count: 600 },
    { id: "17900000000000015", timestamp: "2026-11-01T10:00:00+0000", media_type: "VIDEO", view_count: 500 },
  ]), "ana.silva");
  assert.deepEqual(p.reading.media.map((x) => x.view_count), [900, null, null, null, null]);
  assert.equal(p.reading.media[1].like_count, 3, "os outros números ficam");
});

test("parseDiscovery: another username, a missing id or an error is not a reading; at most 25 posts", () => {
  assert.deepEqual(m.parseDiscovery(discovery({ username: "outra.conta" }), "ana.silva"), { ok: false, error: "temporary", code: null, subcode: null });
  assert.deepEqual(m.parseDiscovery(discovery({ id: "x1" }), "ana.silva"), { ok: false, error: "temporary", code: null, subcode: null });
  assert.equal(m.parseDiscovery(discovery({ username: "ANA.Silva" }), "ana.silva").ok, true);
  assert.equal(m.parseDiscovery(null, "ana.silva").ok, false);
  assert.equal(m.parseDiscovery({ error: { code: 110, error_subcode: 2207013, error_user_msg: "Não encontrado" } }, "ana.silva").error, "not_found");
  const many = Array.from({ length: 40 }, (_, i) => ({ id: String(17900000000000100 + i), timestamp: "2026-11-01T10:00:00+0000", media_type: "IMAGE" }));
  assert.equal(m.parseDiscovery(discovery({}, many), "ana.silva").reading.media.length, 25);
  const big = m.parseDiscovery(discovery({ followers_count: 3_000_000_000, media_count: -2 }), "ana.silva");
  assert.equal(big.reading.followers, null);
  assert.equal(big.reading.media_count, null);
});

test("isoTimestamp converts the Graph format to ISO UTC", () => {
  assert.equal(m.isoTimestamp("2026-11-01T10:00:00+0000"), "2026-11-01T10:00:00.000Z");
  assert.equal(m.isoTimestamp("2026-11-01T10:00:00+0100"), "2026-11-01T09:00:00.000Z");
  assert.equal(m.isoTimestamp("2026-11-01T10:00:00Z"), "2026-11-01T10:00:00.000Z");
  for (const bad of ["ontem", "2026-11-01", "", null, 1730455200, "2026-13-45T10:00:00+0000"]) assert.equal(m.isoTimestamp(bad), null, String(bad));
});

test("parseConnectionTest requires the configured Instagram account of Loja do Ouro", () => {
  const ok = discovery({ id: IG, username: "lojadoouro" });
  assert.equal(m.parseConnectionTest(ok, IG).ok, true);
  assert.deepEqual(m.parseConnectionTest(discovery({ id: "17841400000000009", username: "lojadoouro" }), IG), { ok: false, error: "config", code: null, subcode: null });
  assert.equal(m.parseConnectionTest(discovery(), IG).ok, false);
});

test("parseBiography returns only {ok, igUserId, found}: the biography never leaves", () => {
  const json = { business_discovery: { id: "17841400000000001", username: "ana.silva", biography: `Joias ✨ ${CODE} e mais`, followers_count: 5 } };
  const p = m.parseBiography(json, "ana.silva", CODE);
  assert.deepEqual(p, { ok: true, igUserId: "17841400000000001", found: true });
  assert.ok(!JSON.stringify(p).includes("Joias"));
  assert.deepEqual(m.parseBiography({ business_discovery: { id: "17841400000000001", username: "ana.silva", biography: "sem código" } }, "ana.silva", CODE),
    { ok: true, igUserId: "17841400000000001", found: false });
  assert.deepEqual(m.parseBiography({ business_discovery: { id: "17841400000000001", username: "ana.silva" } }, "ana.silva", CODE).found, false);
  assert.equal(m.parseBiography({ business_discovery: { id: "17841400000000001", username: "outra", biography: CODE } }, "ana.silva", CODE).ok, false);
  assert.equal(m.parseBiography({ error: { code: 190 } }, "ana.silva", CODE).error, "token");
});

test("parseBiographyTest: the biography request on @lojadoouro must return the configured id; nothing of the bio leaves", () => {
  const json = (id, username = "lojadoouro") => ({ business_discovery: { id, username, biography: "Joias desde 1990" } });
  assert.deepEqual(m.parseBiographyTest(json(IG), IG), { ok: true });
  assert.deepEqual(m.parseBiographyTest(json("17841400000000009"), IG), { ok: false, error: "config", code: null, subcode: null });
  assert.equal(m.parseBiographyTest(json(IG, "outra"), IG).ok, false);
  assert.equal(m.parseBiographyTest({ error: { code: 10 } }, IG).error, "config");
  assert.ok(!JSON.stringify(m.parseBiographyTest(json(IG), IG)).includes("Joias"));
});

test("bioHasCode: anywhere in the text, NFKC, any case, any separators", () => {
  assert.equal(m.bioHasCode("Joias ✨ LDO-7K3Q9P", CODE), true);
  assert.equal(m.bioHasCode("ldo 7k3q 9p", CODE), true);
  assert.equal(m.bioHasCode("código:ＬＤＯ－７Ｋ３Ｑ９Ｐ!", CODE), true);
  assert.equal(m.bioHasCode("LDO-7K3Q9", CODE), false);
  assert.equal(m.bioHasCode(null, CODE), false);
  assert.equal(m.bioHasCode("LDO-7K3Q9P", "LDO-7K3Q9O"), false, "código fora do formato");
  assert.equal(m.bioHasCode("LDO-7K3Q9P", "ldo-7k3q9p"), false);
});

// ---------------------------------------------------------------- erros e uso

test("classifyGraphError decides by code and subcode only", () => {
  const cases = [
    [200, 110, 2207013, "not_found"], [200, 110, 123, "temporary"], [400, 190, null, "token"], [400, 102, null, "token"],
    [400, 10, null, "config"], [400, 100, null, "config"], [400, 100, 33, "config"], [400, 200, null, "config"], [400, 299, null, "config"],
    [400, 4, null, "limit"], [400, 17, null, "limit"], [400, 32, null, "limit"], [400, 341, null, "limit"], [400, 368, null, "limit"],
    [400, 613, null, "limit"], [400, 80002, null, "limit"], [500, 1, null, "temporary"], [500, 2, null, "temporary"], [400, -1, null, "temporary"],
  ];
  for (const [status, code, subcode, kind] of cases) {
    const c = m.classifyGraphError(status, { error: { code, error_subcode: subcode ?? undefined, error_user_msg: "Mensagem traduzida", message: "x" } });
    assert.deepEqual(c, { kind, code, subcode }, `${code}/${subcode}`);
  }
  assert.deepEqual(m.classifyGraphError(500, null), { kind: "temporary", code: null, subcode: null }, "HTTP 500 sem JSON");
  assert.deepEqual(m.classifyGraphError(null, null), { kind: "temporary", code: null, subcode: null }, "sem resposta");
  assert.deepEqual(m.classifyGraphError(429, null), { kind: "limit", code: null, subcode: null }, "HTTP 429");
  assert.equal(m.classifyGraphError(400, { error: { code: "190" } }).kind, "temporary", "código em texto não conta");
  assert.deepEqual(m.graphFailure(400, { error: { code: 190 } }), { ok: false, error: "token", code: 190, subcode: null });
});

test("usageFromHeaders: the highest usage of both headers and the time to regain access", () => {
  assert.deepEqual(m.usageFromHeaders('{"call_count":28,"total_time":25,"total_cputime":40}', null), { pct: 40, regainMinutes: null });
  const buc = JSON.stringify({ [IG]: [{ type: "instagram", call_count: 12, total_cputime: 80, total_time: 9, estimated_time_to_regain_access: 7 }] });
  assert.deepEqual(m.usageFromHeaders('{"call_count":28}', buc), { pct: 80, regainMinutes: 7 });
  assert.deepEqual(m.usageFromHeaders("não é json", "{"), { pct: null, regainMinutes: null });
  assert.deepEqual(m.usageFromHeaders(null, null), { pct: null, regainMinutes: null });
  assert.deepEqual(m.usageFromHeaders('{"call_count":-3}', JSON.stringify({ x: [{ estimated_time_to_regain_access: 0 }] })), { pct: null, regainMinutes: 0 });
});

// ---------------------------------------------------------------- ecrã e textos

test("publicSummary: simple averages of posts older than 48 h, views only on reels, no ratios", () => {
  const media = [
    { posted_at: daysAgo(1), product_type: "REELS", media_type: "VIDEO", like_count: 999, comments_count: 999, view_count: 999999 },
    { posted_at: daysAgo(3), product_type: "REELS", media_type: "VIDEO", like_count: 100, comments_count: 10, view_count: 5000 },
    { posted_at: daysAgo(4), product_type: "FEED", media_type: "IMAGE", like_count: null, comments_count: 4, view_count: 777 },
    { posted_at: daysAgo(5), product_type: "FEED", media_type: "CAROUSEL_ALBUM", like_count: 51, comments_count: null, view_count: null },
  ];
  const s = m.publicSummary(media, NOW);
  assert.deepEqual(s, { posts: 3, likes: 76, comments: 7, reels: 1, reelViews: 5000 });
  assert.deepEqual(Object.keys(s).sort(), ["comments", "likes", "posts", "reelViews", "reels"]);
  assert.ok(!Object.keys(s).some((k) => /rate|ratio|pct|engagement|follower/i.test(k)), "sem rácios");
  assert.equal(m.publicSummary([], NOW), null);
  assert.equal(m.publicSummary(media.slice(0, 1), NOW), null, "só publicações recentes");
  assert.equal(m.publicSummary(media, NOW, { n: 1 }).posts, 1);
  assert.equal(m.PUBLIC_SHOW_AVERAGES, false, "as médias esperam pelo advogado");
});

test("labels, proof messages and the stop button", () => {
  assert.equal(m.mediaKindLabel({ media_type: "VIDEO", product_type: "REELS" }), "Reel");
  assert.equal(m.mediaKindLabel({ media_type: "VIDEO", product_type: "FEED" }), "Vídeo");
  assert.equal(m.mediaKindLabel({ media_type: "CAROUSEL_ALBUM", product_type: null }), "Carrossel");
  assert.equal(m.mediaKindLabel({ media_type: "IMAGE", product_type: null }), "Fotografia");
  for (const reason of ["missing", "not_found", "rate", "busy", "expired", "taken", "changed", "off", "state", "error"]) {
    const t = m.proofMessage(reason, "ana.silva", 3);
    assert.ok(typeof t === "string" && t.length > 20, reason);
  }
  assert.match(m.proofMessage("missing", "ana.silva", 3), /@ana\.silva.*mais 3 vezes/);
  assert.match(m.proofMessage("missing", "ana.silva", 1), /mais 1 vez /);
  assert.match(m.proofMessage("not_found", "@ana.silva"), /@ana\.silva como conta profissional/);
  assert.match(m.proofMessage("rate", ""), /5 vezes/);
  // A pausa vem da Meta ou da Loja do Ouro (token, configuração): o texto não diz que foi a Meta.
  assert.equal(m.proofMessage("busy", "ana.silva"), m.PUBLIC_PAUSED_TEXT);
  assert.doesNotMatch(m.PUBLIC_PAUSED_TEXT, /Meta/);
  assert.equal(m.PUBLIC_STOP_LABEL, "Parar a leitura e apagar os dados públicos");
  assert.equal(m.PUBLIC_PROOF_PER_DAY, 5);
  assert.equal(m.PUBLIC_CODES_PER_DAY, 5);
  assert.equal(m.PUBLIC_CODE_DAYS, 7);
  for (const k of ["token", "config", "limit", "temporary", "not_found"]) assert.match(m.graphErrorText(k, 190), /\(código 190\)/, k);
  assert.ok(!m.graphErrorText("token", null).includes("código"));
  for (const why of ["creator", "staff", "handle", "delete", "other_account", "proof_expired", "not_found", "erase"]) assert.ok(m.PUBLIC_STOP_WHY_LABEL[why], why);
});

test("coherence with the published Privacy Policy: the consent text says what is read and how to stop", () => {
  const t = r.CONSENT_TEXT.platform_public;
  assert.ok(t.includes("seguidores, número de publicações e, por publicação, gostos, comentários e visualizações de reels"));
  // À letra da Política («não servem para indicadores nem para análise por inteligência artificial»): nenhum indicador.
  assert.ok(t.includes("Não servem para indicadores nem para análise por inteligência artificial."));
  assert.doesNotMatch(t, /indicadores de autenticidade/);
  assert.ok(t.includes("Posso parar a leitura em Redes"));
  // Os campos pedidos à Meta são os do texto, e nada mais.
  assert.deepEqual([...m.PUBLIC_PROFILE_FIELDS], ["id", "username", "followers_count", "media_count"]);
  assert.deepEqual([...m.PUBLIC_MEDIA_FIELDS], ["id", "timestamp", "media_type", "media_product_type", "like_count", "comments_count", "view_count"]);
});

test("metaAlertText: no tokens and no creator data", () => {
  for (const kind of ["token", "config"]) {
    const t = r.metaAlertText("https://dash.example/", kind);
    const html = r.creatorEmailHtml(t, "https://dash.example");
    const text = r.creatorEmailText(t);
    for (const s of [html, text]) {
      assert.ok(!/EAA[A-Za-z0-9]{10,}|Bearer|access_token|appsecret/.test(s), kind);
      assert.ok(!/seguidores|biografia|criador(a)? @/i.test(s), kind);
    }
    assert.equal(t.button.url, "https://dash.example/influenciadores");
    assert.match(t.paragraphs.join(" "), /de hora a hora/);
  }
  assert.match(r.metaAlertText("https://dash.example", "token").paragraphs[0], /META_SYSTEM_USER_TOKEN/);
});

test("new emails and audit labels of phase 3A", () => {
  const site = "https://criadores.lojadoouro.pt";
  const err = r.outboxEmail({ id: 1, kind: "public_error", payload: {}, first_name: "Ana" }, site);
  assert.match(err.title, /Não conseguimos ler os números públicos/);
  assert.equal(err.button.url, `${site}/redes`);
  for (const reason of ["other_account", "proof_expired", "not_found", "xpto"]) {
    const t = r.outboxEmail({ id: 1, kind: "public_stopped", payload: { reason }, first_name: "Ana" }, site);
    assert.ok(t.title && t.paragraphs.length >= 2, reason);
    assert.ok(!r.creatorEmailText(t).includes(reason), `o motivo «${reason}» não se escreve no email`);
    assert.equal(t.button.url, `${site}/redes`);
  }
  assert.match(r.outboxEmail({ id: 1, kind: "public_stopped", payload: { reason: "proof_expired" } }, site).paragraphs[1], /30 dias/);
  for (const a of ["public.start", "public.verified", "public.stop", "public.error", "privacy.withdrawal"]) assert.ok(r.AUDIT_ACTION_LABEL[a], a);
});
