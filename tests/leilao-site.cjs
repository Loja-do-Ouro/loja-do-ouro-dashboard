const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/leilao-site-rules.js");

const STEPS = [[0, 5], [100, 10], [500, 25], [1000, 50]];

test("auction domain is served from /l and old /l links lose the prefix", () => {
  assert.equal(r.isAuctionHost("leilao.lojadoouro.pt"), true);
  assert.equal(r.isAuctionHost("LEILAO.lojadoouro.pt"), true);
  assert.equal(r.isAuctionHost("loja-do-ouro-dashboard.vercel.app"), false);
  assert.equal(r.siteBaseFor("leilao.lojadoouro.pt"), "");
  assert.equal(r.siteBaseFor("loja-do-ouro-dashboard.vercel.app"), "/l");
  assert.deepEqual(r.auctionHostRoute("/"), { rewrite: "/l" });
  assert.deepEqual(r.auctionHostRoute("/outono-2026/3"), { rewrite: "/l/outono-2026/3" });
  // O dashboard não existe no domínio do leilão: /admin passa a /l/admin (404 do site).
  assert.deepEqual(r.auctionHostRoute("/admin"), { rewrite: "/l/admin" });
  assert.deepEqual(r.auctionHostRoute("/l/conta"), { redirect: "/conta" });
  assert.deepEqual(r.auctionHostRoute("/l"), { redirect: "/" });
  assert.equal(r.auctionHostRoute("/api/l/live"), null);
  assert.equal(r.auctionHostRoute("/_next/static/x.js"), null);
});

test("return path after login stays on the site", () => {
  assert.equal(r.safeNext("/l/outono/2", "/l"), "/l/outono/2");
  assert.equal(r.safeNext("//evil.com", "/l"), "/l/conta");
  assert.equal(r.safeNext("https://evil.com", ""), "/conta");
  assert.equal(r.safeNext(`/${String.fromCharCode(92)}evil.com`, ""), "/conta");
  assert.equal(r.safeNext(undefined, ""), "/conta");
});

test("countdown splits the time left and stops at zero", () => {
  const now = Date.parse("2026-11-02T20:00:00Z");
  assert.deepEqual(r.countdown("2026-11-02T20:10:05Z", now), { done: false, days: 0, hours: 0, minutes: 10, seconds: 5 });
  assert.equal(r.countdownText(r.countdown("2026-11-02T20:10:05Z", now)), "10:05");
  assert.equal(r.countdownText(r.countdown("2026-11-02T23:01:00Z", now)), "03:01:00");
  assert.equal(r.countdownText(r.countdown("2026-11-04T20:00:01Z", now)), "2 d 00:00:01");
  assert.equal(r.countdownText(r.countdown("2026-11-02T19:59:59Z", now)), "Terminado");
  assert.equal(r.countdown(null, now).done, true);
});

test("bid amounts accept Portuguese formats and reject the rest", () => {
  assert.equal(r.parseBid("1250"), 1250);
  assert.equal(r.parseBid("1.250"), 1250);
  assert.equal(r.parseBid("1.250,50"), 1250.5);
  assert.equal(r.parseBid("1 250 €"), 1250);
  assert.equal(r.parseBid("99,9"), 99.9);
  assert.equal(r.parseBid("12.5"), 12.5);
  assert.equal(r.parseBid(300), 300);
  assert.equal(r.parseBid("0"), null);
  assert.equal(r.parseBid("-5"), null);
  assert.equal(r.parseBid("abc"), null);
  assert.equal(r.parseBid("1,2,3"), null);
  assert.equal(r.parseBid(""), null);
});

test("quick bids follow the increment table", () => {
  assert.deepEqual(r.quickBids(110, STEPS), [110, 120, 130]);
  assert.deepEqual(r.quickBids(490, STEPS), [490, 500, 525]);
  assert.deepEqual(r.quickBids(5, STEPS), [5, 10, 15]);
});

test("bid result explains leading, outbid, reserve and extension", () => {
  const lead = r.bidResultText({ status: "leading", price: 110, max: 300, close_at: "x", extended: false, reserve_met: true, min_next: 120 });
  assert.equal(lead.tone, "ok");
  assert.match(lead.text, /110,00/);
  assert.match(lead.text, /300,00/);
  assert.doesNotMatch(lead.text, /reserva/);
  const out = r.bidResultText({ status: "outbid", price: 310, max: 300, close_at: "x", extended: true, reserve_met: false, min_next: 320 });
  assert.equal(out.tone, "warn");
  assert.match(out.text, /320,00/);
  assert.match(out.text, /prolongado/);
});

test("queue emails link to the lot and never mention the other bidders' maximum", () => {
  const item = {
    id: 1, kind: "outbid", payload: { price: 450, close_at: "2026-11-02T21:00:00Z" }, lease: "x", email: "a@b.pt", name: "Ana", alias: "Licitante X",
    deleted: false, lot: { title: "Anel solitário", position: 3, image: null, event_slug: "outono-2026", event_title: "Outono", current_price: 450, close_at: "2026-11-02T21:00:00Z" },
  };
  const t = r.outboxEmail(item, "https://leilao.lojadoouro.pt");
  assert.equal(t.button.url, "https://leilao.lojadoouro.pt/outono-2026/3");
  assert.match(t.subject, /Anel solitário/);
  assert.match(t.paragraphs.join(" "), /450,00/);
  assert.match(t.paragraphs.join(" "), /21:00/); // hora de Lisboa no inverno
  for (const kind of ["extended", "ending_soon", "won", "lost", "reserve_not_met", "withdrawn"]) {
    const e = r.outboxEmail({ ...item, kind, payload: { ...item.payload, payment_due_at: "2026-11-04T21:00:00Z" } }, "https://x");
    assert.ok(e && e.subject && e.paragraphs.length >= 2, kind);
  }
  assert.match(r.outboxEmail({ ...item, kind: "won", payload: { price: 450, payment_due_at: "2026-11-04T21:00:00Z" } }, "https://x").paragraphs.join(" "), /14 dias/);
  assert.equal(r.outboxEmail({ ...item, lot: null }, "https://x"), null);
});
