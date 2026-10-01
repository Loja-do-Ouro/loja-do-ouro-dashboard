const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../.test-build/bi/periods.js");
const m = require("../.test-build/bi/model.js");
const empty = () => ({
  daily: [],
  datasets: [],
  quality: [],
  reports: [],
  runs: [],
  errors: [],
  mode: "stored",
});
const day = (date, metrics, source = "shopify_sales") => ({
  source,
  metric_date: date,
  metrics,
  fetched_at: "2026-09-15T01:00:00Z",
  status: "provisional",
  run_id: "run",
});
const period = { from: "2026-09-07", to: "2026-09-13" };
test("Lisbon midnight differs from UTC during summer", () => {
  assert.equal(p.localDate(new Date("2026-09-14T23:30:00Z")), "2026-09-15");
  assert.equal(
    p.closedPeriods(new Date("2026-09-14T23:30:00Z"))[0].range.to,
    "2026-09-14",
  );
});
test("Previous week is Monday–Sunday including Monday and Sunday executions", () => {
  assert.deepEqual(
    p.closedPeriods(new Date("2026-09-14T12:00:00Z"))[1].range,
    period,
  );
  assert.deepEqual(
    p.closedPeriods(new Date("2026-09-20T12:00:00Z"))[1].range,
    period,
  );
});
test("DST transitions preserve Portuguese calendar dates", () => {
  assert.equal(
    p.closedPeriods(new Date("2026-03-29T23:30:00Z"))[0].range.to,
    "2026-03-29",
  );
  assert.equal(
    p.closedPeriods(new Date("2026-10-25T23:30:00Z"))[0].range.to,
    "2026-10-24",
  );
});
test("Monthly comparisons are calendar months, including leap February", () => {
  assert.deepEqual(
    p.previous({ from: "2024-03-01", to: "2024-03-31" }, "month"),
    { from: "2024-02-01", to: "2024-02-29" },
  );
  assert.deepEqual(p.closedPeriods(new Date("2026-01-01T12:00:00Z"))[2].range, {
    from: "2025-12-01",
    to: "2025-12-31",
  });
});
test("Date filters reject impossible, future, inverted and oversized periods", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  for (const [from, to] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-09-15", "2026-09-15"],
    ["2026-09-14", "2026-09-13"],
    ["2020-01-01", "2026-01-01"],
  ])
    assert.ok(p.selection({ period: "custom", from, to }, now).error);
});
test("Missing values and missing days are not zero; duplicate grain blocks totals", () => {
  const s = empty();
  s.daily = p.dates(period).map((d) => day(d, { total_sales: 0 }));
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, 0);
  s.daily.pop();
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, null);
  s.daily.push(s.daily[0]);
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, null);
  assert.equal(m.number(null), null);
  assert.equal(m.number(""), null);
  assert.equal(m.number({ amount: 3 }), null);
  assert.equal(m.number("3,99"), null);
  assert.equal(m.number("198.7706"), 198.7706);
});
test("AOV and distinct users require exact full-period totals", () => {
  const s = empty();
  s.daily = p
    .dates(period)
    .map((d) => day(d, { average_order_value: 50, totalusers: 100 }, "ga4"));
  assert.equal(m.metric(s, period, "ga4", "totalusers", false).value, null);
  s.datasets.push({
    source: "ga4",
    dataset: "period_totals",
    period_start: period.from,
    period_end: period.to,
    rows: [{ totalusers: 250 }],
    metadata: { timezone: "Europe/Lisbon", currency: "EUR" },
    status: "provisional",
    fetched_at: "2026-09-15T02:00:00Z",
  });
  assert.equal(m.metric(s, period, "ga4", "totalusers", false).value, 250);
});
test("Newer exact totals replace additive daily sum; newer daily revision replaces older total", () => {
  const s = empty();
  s.daily = p.dates(period).map((d) => day(d, { total_sales: 10 }));
  s.datasets.push({
    source: "shopify_sales",
    dataset: "period_totals",
    period_start: period.from,
    period_end: period.to,
    rows: [{ total_sales: 80 }],
    metadata: { currency: "EUR", timezone: "Europe/Lisbon" },
    status: "provisional",
    fetched_at: "2026-09-15T02:00:00Z",
  });
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, 80);
  s.datasets[0].fetched_at = "2026-09-14T23:00:00Z";
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, 70);
});
test("Currency mismatch blocks an exact period value", () => {
  const s = empty();
  s.datasets.push({
    source: "shopify_sales",
    dataset: "period_totals",
    period_start: period.from,
    period_end: period.to,
    rows: [{ total_sales: 80 }],
    metadata: { currency: "USD" },
    status: "provisional",
    fetched_at: "2026-09-15T02:00:00Z",
  });
  assert.equal(m.metric(s, period, "shopify_sales", "total_sales").value, null);
});
test("Missing comparison and zero denominator produce no invented growth or MER", () => {
  assert.equal(m.delta(1, null), null);
  assert.equal(m.delta(1, 0), null);
  assert.equal(m.ratio(100, 0), null);
  assert.equal(m.plus(10, null), null);
});
test("Partial payment pending balance uses outstanding amount, not full order total", () => {
  assert.equal(
    m.unpaidAmount({ current_total: 100, received: 70, refunded: 0 }),
    30,
  );
  assert.equal(m.unpaidAmount({ current_total: 100, received: 70 }), null);
  assert.equal(m.unpaidAmount({ current_total: 100, outstanding: 20 }), 20);
});
test("Reconciliation detects alternate aliases and multiple events on one ID without guessing", () => {
  const d = { complete: true, note: "", fetchedAt: null, datasets: [] };
  const o = { ...d, rows: [{ id: "gid://shopify/Order/123", name: "#1001" }] };
  const ga = {
    ...d,
    rows: [
      { transactionid: "123", ecommerce_purchases: 2 },
      { transactionid: "#1001", ecommerce_purchases: 1 },
      { transactionid: "1001", ecommerce_purchases: 1 },
    ],
  };
  const r = m.trackingCheck(o, ga);
  assert.equal(r.events, 4);
  assert.equal(r.matched, 1);
  assert.equal(r.alternate, 1);
  assert.equal(r.repeatedIds, 1);
  assert.equal(r.unknown, 1);
});
test("Incomplete order pagination cannot certify co hort totals", () => {
  const s = empty();
  s.datasets.push({
    source: "shopify",
    dataset: "orders",
    period_start: period.from,
    period_end: period.to,
    rows: [],
    metadata: {},
    status: "provisional",
    fetched_at: "2026-09-15T02:00:00Z",
  });
  assert.equal(m.detail(s, period, "shopify", "orders").complete, false);
});
