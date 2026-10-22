const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/leilao-rules.js");

const STEPS = [[0, 5], [100, 10], [500, 25], [1000, 50], [2500, 100], [5000, 250], [10000, 500]];
const SETTINGS = { deposit_threshold: 2500, deposit_percent: 10, deposit_min: 100 };

test("Lisbon form times convert to UTC across summer and winter time", () => {
  assert.equal(r.lisbonInputToIso("2026-07-15T21:00"), "2026-07-15T20:00:00.000Z");
  assert.equal(r.lisbonInputToIso("2026-12-15T21:00"), "2026-12-15T21:00:00.000Z");
  assert.equal(r.lisbonInputToIso("2026-10-25T12:00"), "2026-10-25T12:00:00.000Z"); // dia da mudança para o inverno
  assert.equal(r.isoToLisbonInput("2026-07-15T20:00:00.000Z"), "2026-07-15T21:00");
  assert.equal(r.isoToLisbonInput("2026-12-15T21:00:00Z"), "2026-12-15T21:00");
  for (const bad of ["", "2026-02-30T10:00", "2026-13-01T10:00", "amanhã", null]) assert.equal(r.lisbonInputToIso(bad), null);
});

test("Euro inputs accept Portuguese and plain formats", () => {
  assert.equal(r.parseEuro("1.250,50"), 1250.5);
  assert.equal(r.parseEuro("1250.5"), 1250.5);
  assert.equal(r.parseEuro("2 500 €"), 2500);
  assert.equal(r.parseEuro(""), null);
  assert.ok(Number.isNaN(r.parseEuro("12,345")));
  assert.ok(Number.isNaN(r.parseEuro("abc")));
});

test("Increments and minimum bid follow the same steps as the database", () => {
  assert.equal(r.incrementFor(0, STEPS), 5);
  assert.equal(r.incrementFor(99.99, STEPS), 5);
  assert.equal(r.incrementFor(100, STEPS), 10);
  assert.equal(r.incrementFor(2500, STEPS), 100);
  assert.equal(r.incrementFor(25000, STEPS), 500);
  assert.equal(r.minNextBid({ leader_id: null, start_price: 1500, current_price: null }, STEPS), 1500);
  assert.equal(r.minNextBid({ leader_id: "x", start_price: 100, current_price: 300 }, STEPS), 310);
});

test("Deposit only on high lots (or when forced), with the minimum", () => {
  assert.equal(r.depositFor({ deposit_mode: "auto", start_price: 1500, current_price: null }, SETTINGS), 0);
  assert.equal(r.depositFor({ deposit_mode: "auto", start_price: 3000, current_price: null }, SETTINGS), 300);
  assert.equal(r.depositFor({ deposit_mode: "auto", start_price: 2000, current_price: 2600 }, SETTINGS), 200);
  assert.equal(r.depositFor({ deposit_mode: "required", start_price: 300, current_price: null }, SETTINGS), 100);
  assert.equal(r.depositFor({ deposit_mode: "none", start_price: 9000, current_price: null }, SETTINGS), 0);
});

test("Increment table text is validated", () => {
  assert.deepEqual(r.parseIncrements("0 5\n100 10\n\n500;25"), { ok: true, steps: [[0, 5], [100, 10], [500, 25]] });
  assert.equal(r.parseIncrements("100 10").ok, false);
  assert.equal(r.parseIncrements("0 5\n0 10").ok, false);
  assert.equal(r.parseIncrements("0 0").ok, false);
  assert.equal(r.parseIncrements("0 cinco").ok, false);
  assert.equal(r.formatIncrements([[0, 5], [100, 10]]), "0 5\n100 10");
});

test("Store product links resolve to a handle; other sites are refused", () => {
  assert.equal(r.productHandle("https://www.lojadoouro.pt/products/pulseira-marquesa-em-ouro-19kl-20-1cm"), "pulseira-marquesa-em-ouro-19kl-20-1cm");
  assert.equal(r.productHandle("https://www.lojadoouro.pt/en/products/anel-x?variant=1"), "anel-x");
  assert.equal(r.productHandle("https://goldstorepremium.com/products/ring"), "ring");
  assert.equal(r.productHandle("anel-solitario"), "anel-solitario");
  assert.equal(r.productHandle("https://evil.example/products/anel"), null);
  assert.equal(r.productHandle("https://www.lojadoouro.pt/collections/ouro"), null);
  assert.equal(r.slugify("Joias de Outono 2026!"), "joias-de-outono-2026");
});

test("Shopify product JSON becomes a lot draft (CDN photos, price, metal, fineness, weight)", () => {
  const d = r.shopifyProductDraft({
    id: 123, handle: "pulseira-marquesa", title: "Pulseira Marquesa em Ouro 19,2kl (20,1cm)",
    description: "<p>Pulseira em ouro amarelo 800‰.</p><p>Peso: 27,45 g</p>",
    images: ["//cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg", "javascript:alert(1)"], price: 598500,
    variants: [{ price: 598500, sku: "LDO-1" }],
  });
  assert.equal(d.title, "Pulseira Marquesa em Ouro 19,2kl (20,1cm)");
  assert.deepEqual(d.images, ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"]);
  assert.equal(d.price, 5985);
  assert.equal(d.sku, "LDO-1");
  assert.equal(d.metal, "Ouro");
  assert.equal(d.fineness, "800‰");
  assert.equal(d.weight_g, 27.45);
  assert.equal(d.description, "Pulseira em ouro amarelo 800‰.\n\nPeso: 27,45 g");
  assert.equal(r.shopifyProductDraft(null), null);
});

test("Lot phase for the team list", () => {
  const ev = { status: "published", opens_at: "2026-11-01T10:00:00Z" };
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(r.lotPhase({ status: "ready", close_at: "2026-11-08T21:00:00Z", result: null }, ev, now), "open");
  assert.equal(r.lotPhase({ status: "ready", close_at: "2026-11-05T12:30:00Z", result: null }, ev, now), "ending");
  assert.equal(r.lotPhase({ status: "ready", close_at: "2026-11-08T21:00:00Z", result: null }, ev, new Date("2026-10-30T00:00:00Z")), "scheduled");
  assert.equal(r.lotPhase({ status: "ready", close_at: "2026-11-08T21:00:00Z", result: null }, { ...ev, status: "draft" }, now), "draft");
  assert.equal(r.lotPhase({ status: "closed", close_at: null, result: "sold" }, ev, now), "closed_sold");
  assert.equal(r.lotPhase({ status: "withdrawn", close_at: null, result: null }, ev, now), "withdrawn");
});
