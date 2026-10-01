const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../.test-build/bi/model.js");
const p = require("../.test-build/bi/periods.js");
const limit = require("../.test-build/rate-limit.js");

const store = (mode) => ({ daily: [], datasets: [], quality: [], reports: [], runs: [], errors: [], mode });

test("Campaign table sums ads and days per campaign, ordered by spend", () => {
  const rows = [
    { campaign: "A", campaign_id: "1", ad_id: "a1", date: "2026-09-29", spend: "2", conversions: 1 },
    { campaign: "A", campaign_id: "1", ad_id: "a2", date: "2026-09-30", spend: 3, conversions: 0 },
    { campaign: "B", campaign_id: "2", ad_id: "b1", date: "2026-09-30", spend: 10, conversions: 2 },
  ];
  const out = m.byCampaign(rows, ["spend", "conversions"]);
  assert.deepEqual(out.map((r) => [r.campaign, r.spend, r.conversions, r.ads]), [["B", 10, 2, 1], ["A", 5, 1, 2]]);
});

test("Campaign totals stay unknown when one row has no valid number", () => {
  const out = m.byCampaign([{ campaign: "A", spend: 1 }, { campaign: "A", spend: "" }], ["spend"]);
  assert.equal(out[0].spend, null);
});

test("Order status rules: voided and cancelled orders are neither paid nor awaiting preparation", () => {
  const paid = { financial_status: "PAID", fulfillment_status: "UNFULFILLED" };
  assert.equal(m.isPaid(paid), true);
  assert.equal(m.awaitingFulfillment(paid), true);
  assert.equal(m.awaitingFulfillment({ ...paid, fulfillment_status: "FULFILLED" }), false);
  assert.equal(m.isPaid({ ...paid, cancelled_at: "2026-09-30T10:00:00Z" }), false);
  assert.equal(m.isPending({ financial_status: "PENDING" }), true);
  assert.equal(m.isClosedWithoutPayment({ financial_status: "VOIDED" }), true);
  assert.equal(m.awaitingFulfillment({ financial_status: "VOIDED", fulfillment_status: "UNFULFILLED" }), false);
});

test("Composition check is not a warning in direct mode, but still is with stored closes missing", () => {
  const range = { from: "2026-09-30", to: "2026-09-30" };
  const live = m.calculatedChecks(store("live"), range).find((c) => c.label.startsWith("Composição"));
  assert.equal(live.warning, false);
  const stored = m.calculatedChecks(store("stored"), range).find((c) => c.label.startsWith("Composição"));
  assert.equal(stored.warning, true);
});

test("Ingestion window defaults to the last three closed Lisbon days and bounds backfills", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  assert.deepEqual(p.ingestRange({}, now), { from: "2026-09-28", to: "2026-09-30" });
  assert.deepEqual(p.ingestRange({ from: "2026-09-15", to: "2026-09-30" }, now), { from: "2026-09-15", to: "2026-09-30" });
  assert.throws(() => p.ingestRange({ from: "2026-10-01", to: "2026-10-01" }, now));
  assert.throws(() => p.ingestRange({ from: "2026-09-30", to: "2026-09-29" }, now));
  assert.throws(() => p.ingestRange({ from: "2026-07-01", to: "2026-09-30" }, now));
  assert.throws(() => p.ingestRange({ from: "2026-09-31", to: "2026-09-30" }, now));
});

test("Login limiter locks a client after five failures within fifteen minutes", () => {
  const t = Date.parse("2026-10-01T12:00:00Z");
  for (let i = 0; i < 4; i++) limit.recordFailure("1.2.3.4", t + i);
  assert.equal(limit.isLocked("1.2.3.4", t + 10), false);
  limit.recordFailure("1.2.3.4", t + 5);
  assert.equal(limit.isLocked("1.2.3.4", t + 10), true);
  assert.equal(limit.isLocked("5.6.7.8", t + 10), false);
  assert.equal(limit.isLocked("1.2.3.4", t + 16 * 60 * 1000), false);
  limit.recordFailure("9.9.9.9", t);
  limit.clearFailures("9.9.9.9");
  assert.equal(limit.isLocked("9.9.9.9", t), false);
});
