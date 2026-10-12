const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../.test-build/bi/paid-sales.js");

const line = (order_name, day, orders, net_sales, total_sales, taxes = 0, shipping_charges = 0) => ({ order_name, day, orders, net_sales, total_sales, taxes, shipping_charges });
const rev = (order_name, net_sales, total_sales, taxes = 0, shipping_charges = 0) => ({ order_name, net_sales, total_sales, taxes, shipping_charges });
const byDay = (rows) => Object.fromEntries(rows.map((r) => [r.day, r]));
const c = (n) => Math.round(n * 100) / 100;

test("Paid sales count on the order day, without VAT, with the VAT total apart", () => {
  const period = { from: "2026-10-09", to: "2026-10-11" };
  const lines = [
    line("#96082online", "2026-10-09", 1, 145.12, 178.5, 33.38),
    line("#96086online", "2026-10-10", 1, 1048.29, 1289.4, 241.11),
    line("#96087online", "2026-10-10", 1, 145.12, 178.5, 33.38),
    line("#96096online", "2026-10-11", 1, 222.52, 273.7, 51.18),
  ];
  const d = byDay(p.paidDays(period, lines, [], []));
  assert.deepEqual(Object.keys(d), ["2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.deepEqual([d["2026-10-09"].orders, d["2026-10-09"].net_sales, d["2026-10-09"].total_sales], [1, 145.12, 178.5]);
  assert.deepEqual([d["2026-10-10"].orders, d["2026-10-10"].net_sales, d["2026-10-10"].total_sales], [2, 1193.41, 1467.9]);
  assert.equal(d["2026-10-11"].pending_orders, 0);
});

test("An edit that removes items from a paid order (no refund) counts on the order day", () => {
  // Caso real: encomenda de 15/03 editada a 16/03 (2 artigos retirados), continua paga.
  const period = { from: "2026-03-15", to: "2026-03-16" };
  const lines = [line("#93264online", "2026-03-15", 1, 4446.95, 5268.5, 821.55)];
  const d = byDay(p.paidDays(period, lines, [rev("#93264online", -1724.59, -1920, -195.41)], []));
  assert.deepEqual([d["2026-03-15"].orders, d["2026-03-15"].net_sales, d["2026-03-15"].total_sales], [1, 2722.36, 3348.5]);
  assert.deepEqual([d["2026-03-16"].orders, d["2026-03-16"].net_sales], [0, 0]);
});

test("An exchange by edit (item removed and another added later) counts once, on the order day", () => {
  const period = { from: "2025-12-12", to: "2025-12-15" };
  const lines = [line("#91729online", "2025-12-12", 1, 1184, 1184), line("#91729online", "2025-12-15", 0, 1884, 1884)];
  const d = byDay(p.paidDays(period, lines, [rev("#91729online", -1184, -1184)], []));
  assert.deepEqual([d["2025-12-12"].orders, d["2025-12-12"].net_sales, d["2025-12-12"].total_sales], [1, 1884, 1884]);
  assert.equal(d["2025-12-15"].net_sales, 0);
});

test("A refund by amount (no items, no VAT in the report) is taken without VAT in the order's proportion", () => {
  // Caso real: 80,08 € sem IVA + 18,42 € de IVA + 5,90 € de portes; reembolso de 98,50 € por valor.
  const period = { from: "2026-09-24", to: "2026-09-24" };
  const lines = [line("#95948online", "2026-09-24", 1, 80.08, 104.4, 18.42, 5.9)];
  const [d] = p.paidDays(period, lines, [rev("#95948online", -98.5, -98.5)], []);
  assert.deepEqual([d.net_sales, d.total_sales, d.adjustments_net, d.adjustments_total], [0, 5.9, -80.08, -98.5]);
  // A encomenda ficou sem valor sem IVA: não conta como encomenda paga.
  assert.equal(d.orders, 0);
  // Um reembolso parcial por valor: só a parte proporcional sai do valor sem IVA.
  const [e] = p.paidDays({ from: "2026-06-03", to: "2026-06-03" }, [line("#94359online", "2026-06-03", 1, 635.77, 782, 146.23)], [rev("#94359online", -94, -94)], []);
  assert.deepEqual([e.orders, c(e.net_sales)], [1, c(635.77 - 94 * (635.77 / (635.77 + 146.23)))]);
});

test("Orders worth 0 € without VAT (offers, 100 % discount) do not count as paid orders", () => {
  const period = { from: "2026-04-13", to: "2026-04-13" };
  const lines = [line("#93595online", "2026-04-13", 1, 0, 5.9, 0, 5.9), line("#93596online", "2026-04-13", 1, 50, 61.5, 11.5)];
  const [d] = p.paidDays(period, lines, [], []);
  assert.deepEqual([d.orders, d.net_sales, d.total_sales], [1, 50, 67.4]);
});

test("Changes to orders made before the period are left out (they belong to older days)", () => {
  const period = { from: "2026-10-01", to: "2026-10-02" };
  const lines = [line("#95948online", "2026-10-01", 0, 10, 12.3), line("#96010online", "2026-10-01", 1, 61.72, 81.81)];
  const d = byDay(p.paidDays(period, lines, [rev("#95948online", -98.5, -98.5)], []));
  assert.deepEqual([d["2026-10-01"].orders, d["2026-10-01"].net_sales, d["2026-10-01"].adjustments_net], [1, 61.72, 0]);
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

test("Month chunks and halves cover the period exactly", () => {
  assert.deepEqual(p.monthChunks({ from: "2025-12-15", to: "2026-02-03" }), [
    { from: "2025-12-15", to: "2025-12-31" }, { from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: "2026-02-03" },
  ]);
  assert.deepEqual(p.monthChunks({ from: "2026-02-10", to: "2026-02-10" }), [{ from: "2026-02-10", to: "2026-02-10" }]);
  assert.deepEqual(p.monthChunks({ from: "2024-02-01", to: "2024-03-01" }), [{ from: "2024-02-01", to: "2024-02-29" }, { from: "2024-03-01", to: "2024-03-01" }]);
  assert.deepEqual(p.halves({ from: "2026-11-01", to: "2026-11-30" }), [{ from: "2026-11-01", to: "2026-11-15" }, { from: "2026-11-16", to: "2026-11-30" }]);
  assert.deepEqual(p.halves({ from: "2026-11-01", to: "2026-11-02" }), [{ from: "2026-11-01", to: "2026-11-01" }, { from: "2026-11-02", to: "2026-11-02" }]);
  assert.equal(p.halves({ from: "2026-11-01", to: "2026-11-01" }), null);
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
  assert.equal(c(o.sales.value), 2890.24);
  assert.equal(o.orders.value, 13);
  assert.equal(c(o.aov.value), 222.33);
  assert.equal(c(o.salesWithVat.value), 3594.5);
  assert.deepEqual([o.pendingOrders.value, c(o.pendingValue.value)], [2, 341.3]);
  assert.equal(c(o.accounting.value), 1340);
  assert.equal(Math.round(o.mer * 1000) / 1000, Math.round((2890.24 / 450) * 1000) / 1000);
  // Um dia sem a fonte nova não aparece como zero: fica sem valor.
  s.daily = s.daily.filter((r) => !(r.source === "shopify_paid" && r.metric_date === "2026-10-10"));
  assert.equal(m.overview(s, period).sales.value, null);
  assert.equal(m.overview(s, period).aov.value, null);
  // Antes da primeira recolha da fonte nova, a nota diz o que fazer.
  s.daily = s.daily.filter((r) => r.source !== "shopify_paid");
  assert.match(m.overview(s, period).sales.note, /ainda não recolhidas/);
});
