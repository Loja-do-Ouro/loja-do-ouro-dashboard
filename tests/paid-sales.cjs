const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../.test-build/bi/paid-sales.js");

const line = (order_name, day, orders, net_sales, total_sales) => ({ order_name, day, orders, net_sales, total_sales });
const byDay = (rows) => Object.fromEntries(rows.map((r) => [r.day, r]));

test("Paid sales count on the order day, without VAT, with the VAT total apart", () => {
  const period = { from: "2026-10-09", to: "2026-10-11" };
  const lines = [
    line("#96082online", "2026-10-09", 1, 145.12, 178.5),
    line("#96086online", "2026-10-10", 1, 1048.29, 1289.4),
    line("#96087online", "2026-10-10", 1, 145.12, 178.5),
    line("#96096online", "2026-10-11", 1, 222.52, 273.7),
  ];
  const d = byDay(p.paidDays(period, lines, [], []));
  assert.deepEqual(Object.keys(d), ["2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.deepEqual([d["2026-10-09"].orders, d["2026-10-09"].net_sales, d["2026-10-09"].total_sales], [1, 145.12, 178.5]);
  assert.deepEqual([d["2026-10-10"].orders, d["2026-10-10"].net_sales, d["2026-10-10"].total_sales], [2, 1193.41, 1467.9]);
  assert.equal(d["2026-10-11"].pending_orders, 0);
});

test("An edit on a later day and a later partial refund both count on the order day", () => {
  const period = { from: "2026-06-20", to: "2026-06-23" };
  const lines = [
    line("#94603online", "2026-06-21", 1, 116.55, 143.36),
    line("#94603online", "2026-06-22", 0, 56, 68.88), // artigo acrescentado no dia seguinte
  ];
  const refunds = [{ order_name: "#94603online", net_sales: -116.55, total_sales: -143.36 }];
  const d = byDay(p.paidDays(period, lines, refunds, []));
  assert.deepEqual([d["2026-06-21"].orders, d["2026-06-21"].net_sales, d["2026-06-21"].total_sales], [1, 56, 68.88]);
  assert.deepEqual([d["2026-06-21"].refunds_net, d["2026-06-21"].refunds_total], [-116.55, -143.36]);
  assert.deepEqual([d["2026-06-22"].orders, d["2026-06-22"].net_sales], [0, 0]);
});

test("Refunds and edits of orders made before the period are left out (they belong to older days)", () => {
  const period = { from: "2026-10-01", to: "2026-10-02" };
  const lines = [line("#95948online", "2026-10-01", 0, 10, 12.3), line("#96010online", "2026-10-01", 1, 61.72, 81.81)];
  const refunds = [{ order_name: "#95948online", net_sales: -98.5, total_sales: -98.5 }];
  const d = byDay(p.paidDays(period, lines, refunds, []));
  assert.deepEqual([d["2026-10-01"].orders, d["2026-10-01"].net_sales, d["2026-10-01"].refunds_net], [1, 61.72, 0]);
});

test("Unpaid orders stay apart, every day of the period has a row, and amounts are rounded to cents", () => {
  const period = { from: "2026-10-09", to: "2026-10-11" };
  const lines = [line("#1", "2026-10-11", 1, 0.1, 0.1), line("#2", "2026-10-11", 1, 0.2, 0.2)];
  const pending = [{ day: "2026-10-10", orders: 1, net_sales: 64.96, total_sales: 85.8 }, { day: "2026-10-11", orders: 1, net_sales: 199.59, total_sales: 255.5 }];
  const rows = p.paidDays(period, lines, [], pending);
  assert.equal(rows.length, 3);
  const d = byDay(rows);
  assert.deepEqual([d["2026-10-09"].orders, d["2026-10-09"].net_sales, d["2026-10-09"].pending_orders], [0, 0, 0]);
  assert.deepEqual([d["2026-10-10"].pending_orders, d["2026-10-10"].pending_net, d["2026-10-10"].pending_total], [1, 64.96, 85.8]);
  assert.equal(d["2026-10-11"].net_sales, 0.3);
});

test("Month chunks cover the period exactly, across months and years", () => {
  assert.deepEqual(p.monthChunks({ from: "2025-12-15", to: "2026-02-03" }), [
    { from: "2025-12-15", to: "2025-12-31" }, { from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: "2026-02-03" },
  ]);
  assert.deepEqual(p.monthChunks({ from: "2026-02-10", to: "2026-02-10" }), [{ from: "2026-02-10", to: "2026-02-10" }]);
  assert.deepEqual(p.monthChunks({ from: "2024-02-01", to: "2024-03-01" }), [{ from: "2024-02-01", to: "2024-02-29" }, { from: "2024-03-01", to: "2024-03-01" }]);
});

test("The overview uses paid sales without VAT; Shopify accounting only feeds the composition", () => {
  const per = require("../.test-build/bi/periods.js");
  const m = require("../.test-build/bi/model.js");
  const period = { from: "2026-10-09", to: "2026-10-11" };
  const row = (source, date, metrics) => ({ source, metric_date: date, metrics, fetched_at: "2026-10-12T01:00:00Z", status: "provisional", run_id: "run" });
  const paid = { "2026-10-09": [1, 145.12, 178.5, 0, 0], "2026-10-10": [7, 2116.01, 2624.5, 1, 85.8], "2026-10-11": [5, 629.11, 791.5, 1, 255.5] };
  const accounting = { "2026-10-09": 3505, "2026-10-10": 1505.4, "2026-10-11": -3670.4 };
  const s = { daily: [], datasets: [], quality: [], reports: [], runs: [], errors: [], mode: "stored" };
  for (const d of per.dates(period)) {
    const [orders, net, total, po, pt] = paid[d];
    s.daily.push(row("shopify_paid", d, { orders, net_sales: net, total_sales: total, pending_orders: po, pending_total: pt }));
    s.daily.push(row("shopify_sales", d, { total_sales: accounting[d], orders: 9 }));
    s.daily.push(row("meta", d, { spend: 100 }), row("google_ads", d, { spend: 50 }));
  }
  const o = m.overview(s, period);
  const c = (n) => Math.round(n * 100) / 100;
  assert.equal(c(o.sales.value), 2890.24);
  assert.equal(o.orders.value, 13);
  assert.equal(Math.round(o.aov.value * 100) / 100, 222.33);
  assert.equal(c(o.salesWithVat.value), 3594.5);
  assert.deepEqual([o.pendingOrders.value, c(o.pendingValue.value)], [2, 341.3]);
  assert.equal(Math.round(o.accounting.value * 100) / 100, 1340);
  assert.equal(Math.round(o.mer * 1000) / 1000, Math.round((2890.24 / 450) * 1000) / 1000);
  // Um dia sem a fonte nova não aparece como zero: fica sem valor.
  s.daily = s.daily.filter((r) => !(r.source === "shopify_paid" && r.metric_date === "2026-10-10"));
  assert.equal(m.overview(s, period).sales.value, null);
  assert.equal(m.overview(s, period).aov.value, null);
});
