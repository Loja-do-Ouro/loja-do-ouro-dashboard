const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const plan = require("../.test-build/bi/read-plan.js");
const m = require("../.test-build/bi/model.js");
const p = require("../.test-build/bi/periods.js");
const ch = require("../.test-build/bi/channels.js");

// Section files and the detail() calls they make (in stored mode, the else branch of a live/stored choice).
const FILES = {
  overview: ["overview.tsx", "trend.tsx"],
  sales: ["sales.tsx"],
  marketing: ["marketing.tsx"],
  social: ["social.tsx"],
  audience: ["audience.tsx"],
  quality: ["quality.tsx"],
};
const source = (section) => FILES[section].map((f) => fs.readFileSync(path.join(__dirname, "..", "components", "dashboard", f), "utf8")).join("\n");
const calls = (section) =>
  [...source(section).matchAll(/detail\(\s*store\s*,\s*range\s*,\s*(?:[^,]*\?\s*"[^"]+"\s*:\s*)?"([^"]+)"\s*,\s*"([^"]+)"\s*(,\s*true)?\s*\)/g)]
    .map(([, s, d, daily]) => ({ source: s, dataset: d, daily: Boolean(daily) }));

test("Every section asks the closes for each dataset its components read", () => {
  for (const section of Object.keys(FILES)) {
    const need = plan.SECTION_NEEDS[section], text = source(section);
    assert.ok(calls(section).length || section === "overview", section);
    for (const c of calls(section)) {
      const name = `${c.source}/${c.dataset}`;
      if (c.daily) assert.ok(need.daily.includes(name), `${section}: ${name} por dias`);
      else assert.ok(need.exact.includes(name) || need.interval.includes(`*/${c.dataset}`), `${section}: ${name}`);
    }
    if (/onlineInvestment\(|adSplit\(|calculatedChecks\(/.test(text))
      for (const name of plan.AD_DATASETS) assert.ok(need.daily.includes(name), `${section}: ${name} (investimento)`);
    if (/financialEvents\(/.test(text)) assert.ok(need.interval.includes("shopify/transactions"), section);
    assert.ok(need.interval.includes(plan.PERIOD_TOTALS), section);
  }
  assert.equal(plan.sectionNeeds("desconhecida"), plan.SECTION_NEEDS.overview);
});

// What the two database functions return (supabase/migrations/20261012140000_ldo_bi_read_by_section.sql).
const name = (d) => `${d.source}/${d.dataset}`;
const usable = (d) => !["failed", "running", "partial"].includes(d.status);
function asRead(full, need, interval, selected) {
  const exactOf = (d) => d.period_start === selected.from && d.period_end === selected.to;
  const inInterval = full.datasets.filter((d) => d.period_start >= interval.from && d.period_end <= interval.to
    && (need.interval.includes(name(d)) || need.interval.includes(`*/${d.dataset}`)));
  const detail = full.datasets.filter((d) => (exactOf(d) && [...need.exact, ...need.daily].includes(name(d)))
    || (d.period_start === d.period_end && d.period_start >= selected.from && d.period_start <= selected.to && need.daily.includes(name(d))
      && !full.datasets.some((e) => name(e) === name(d) && exactOf(e) && usable(e))));
  return { ...full, datasets: [...new Map([...inInterval, ...detail].map((d) => [`${name(d)}|${d.period_start}|${d.period_end}`, d])).values()] };
}

const now = new Date("2026-10-12T12:00:00Z");
const windows = p.closedPeriods(now);
const ds = (dataset, from, to, rows, extra = {}) => ({
  source: dataset.split("/")[0], dataset: dataset.split("/")[1], period_start: from, period_end: to, rows,
  metadata: { complete: true, currency: "EUR", timezone: "Europe/Lisbon" }, fetched_at: "2026-10-12T01:00:00Z", status: "provisional", run_id: "r", ...extra,
});
const ad = (date, spend) => [
  { campaign: "ONLINE", campaign_id: "1", ad_id: "a", date, spend, conversions: 1, conversions_value: 10 },
  { campaign: "LEIRIA · loja", campaign_id: "2", ad_id: "b", date, spend: 1, conversions: 0, conversions_value: 0 },
];
function fullStore() {
  const all = new Map();
  const put = (d) => all.set(`${name(d)}|${d.period_start}|${d.period_end}`, d);
  const days = p.dates({ from: "2026-08-01", to: "2026-10-11" });
  const everyName = [...new Set([...Object.keys(FILES).flatMap((s) => calls(s).map((c) => `${c.source}/${c.dataset}`)), ...plan.AD_DATASETS])];
  // Day, week and month windows of every detail dataset, as the nightly ingestion writes them.
  for (const w of windows) for (const n of everyName) put(ds(n, w.range.from, w.range.to, n.endsWith("ads") || n.endsWith("campaigns") ? ad(w.range.to, 7) : [{ id: `${n}-${w.key}`, sessions: 3 }]));
  // Per-day campaign detail and orders, over the whole interval.
  for (const day of days) {
    for (const n of plan.AD_DATASETS) put(ds(n, day, day, ad(day, 2)));
    put(ds("shopify/orders", day, day, [{ id: `o-${day}`, financial_status: "PAID", fulfillment_status: "FULFILLED", updated_at: day }]));
    put(ds("ga4/period_totals", day, day, [{ sessions: 5, totalusers: 4 }]));
  }
  for (const w of windows) for (const q of [w.range, p.previous(w.range, w.key)])
    for (const n of ["ga4/period_totals", "shopify_sales/period_totals"]) put(ds(n, q.from, q.to, [{ sessions: 9, totalusers: 8, total_sales: 100, net_sales: 80 }]));
  // Old overlapping 3-day windows: transactions are still read, orders_updated never.
  for (const [from, to] of [["2026-09-10", "2026-09-12"], ["2026-09-11", "2026-09-13"], ["2026-09-12", "2026-09-14"]]) {
    put(ds("shopify/transactions", from, to, [{ id: `t-${from}`, processed_at: `${to}T10:00:00Z`, currency: "EUR", amount: "10", kind: "SALE", status: "SUCCESS" }]));
    put(ds("shopify/orders_updated", from, to, [{ id: "x" }]));
  }
  // A custom period whose exact copy failed: the days stand in for it.
  put(ds("meta/ads", "2026-09-02", "2026-09-05", ad("2026-09-05", 99), { status: "failed" }));
  const daily = days.flatMap((day) => [
    { source: "meta", metric_date: day, metrics: { spend: 3 }, fetched_at: "2026-10-12T02:00:00Z", status: "provisional", run_id: "r" },
    { source: "google_ads", metric_date: day, metrics: { spend: 3 }, fetched_at: "2026-10-12T02:00:00Z", status: "provisional", run_id: "r" },
    { source: "shopify_paid", metric_date: day, metrics: { net_sales: 50, orders: 2 }, fetched_at: "2026-10-12T02:00:00Z", status: "provisional", run_id: "r" },
  ]);
  return {
    daily, datasets: [...all.values()], quality: [], reports: [], runs: [], errors: [], mode: "stored",
    channels: { stores: [{ id: "s1", name: "Leiria", keyword: "LEIRIA" }], overrides: [] },
  };
}

test("The reduced read gives every section the same figures as the full read", () => {
  const full = fullStore();
  const selections = [
    ...windows.map((w) => ({ key: w.key, range: w.range })),
    { key: "custom", range: { from: "2026-09-02", to: "2026-09-05" } },
    { key: "custom", range: { from: "2026-09-10", to: "2026-09-14" } },
  ];
  for (const sel of selections) {
    const periods = [...windows.flatMap((w) => [w.range, p.previous(w.range, w.key)]), sel.range, p.previous(sel.range, sel.key)];
    const interval = { from: periods.map((x) => x.from).sort()[0], to: periods.map((x) => x.to).sort().at(-1) };
    for (const section of Object.keys(FILES)) {
      const need = plan.SECTION_NEEDS[section], read = asRead(full, need, interval, sel.range), at = `${section} ${sel.range.from}…${sel.range.to}`;
      assert.ok(read.datasets.length < full.datasets.length, at);
      for (const q of [...periods, ...p.dates(sel.range).map((d) => ({ from: d, to: d }))])
        assert.deepEqual(m.overview(read, q), m.overview(full, q), at);
      for (const c of calls(section))
        assert.deepEqual(m.detail(read, sel.range, c.source, c.dataset, c.daily), m.detail(full, sel.range, c.source, c.dataset, c.daily), `${at} ${c.source}/${c.dataset}`);
      const s = m.overview(full, sel.range);
      if (section === "overview" || section === "marketing")
        assert.deepEqual(ch.onlineInvestment(read, sel.range, s.spend, s.sales.value), ch.onlineInvestment(full, sel.range, s.spend, s.sales.value), at);
      if (section === "quality") assert.deepEqual(m.calculatedChecks(read, sel.range), m.calculatedChecks(full, sel.range), at);
      if (section === "sales") assert.deepEqual(m.financialEvents(read, sel.range), m.financialEvents(full, sel.range), at);
      assert.ok(!read.datasets.some((d) => d.dataset === "orders_updated"), at);
    }
  }
  // The checks above are not vacuous: the month split has both destinations and the failed copy is replaced by days.
  const month = windows[2].range, s = m.overview(full, month);
  const inv = ch.onlineInvestment(asRead(full, plan.SECTION_NEEDS.overview, month, month), month, s.spend, s.sales.value);
  assert.ok(inv.online > 0 && inv.physical > 0);
  const custom = { from: "2026-09-02", to: "2026-09-05" };
  assert.equal(m.detail(asRead(full, plan.SECTION_NEEDS.marketing, custom, custom), custom, "meta", "ads", true).datasets.length, 4);
  assert.equal(m.financialEvents(asRead(full, plan.SECTION_NEEDS.sales, { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-09-10", to: "2026-09-14" }), { from: "2026-09-10", to: "2026-09-14" }).rows.length, 3);
});
