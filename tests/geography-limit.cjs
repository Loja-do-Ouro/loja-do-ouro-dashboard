const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../.test-build/bi/model.js");
const p = require("../.test-build/bi/periods.js");

const LIMIT = m.STORED_LIMITS["ga4/geography"];
const range = { from: "2026-10-05", to: "2026-10-11" };
// A week of GA4 cities as Windsor returns them (5439 rows, ~1 MB): a long tail with many ties and a row without sessions.
let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cities = Array.from({ length: 5439 }, (_, i) => ({
  city: `Cidade ${i}`, country: ["Portugal", "Spain", "France", "Brazil"][i % 4],
  sessions: i === 17 ? null : Math.floor(10000 / (1 + Math.floor(random() * 5439))),
  totalusers: 3, ecommerce_purchases: 0, purchase_revenue: 0, property_currency: "EUR", property_timezone: "Europe/Lisbon",
}));
// What Audience shows: the rows by sessions (a stable sort), then the first ones.
const bySessions = (rows) => [...rows].sort((a, b) => (m.number(b.sessions) || 0) - (m.number(a.sessions) || 0));
const close = (rows, metadata) => ({
  daily: [], quality: [], reports: [], runs: [], errors: [], mode: "stored",
  datasets: [{ source: "ga4", dataset: "geography", period_start: range.from, period_end: range.to, rows,
    metadata: { currency: "EUR", timezone: "Europe/Lisbon", ...metadata }, fetched_at: "2026-10-14T01:18:26Z", status: "provisional", run_id: "r" }],
});

test("GA4 geography keeps, in each close, its cities of most sessions and the original row count", () => {
  const kept = m.storedRows("ga4", "geography", cities);
  assert.equal(kept.rows.length, LIMIT.rows);
  assert.deepEqual(kept.metadata, { limit: LIMIT.rows, order_by: "sessions", row_count: 5439, truncated: true });
  // The same top rows as over every city, also when cities tie across the cut; in the source's order.
  const all = bySessions(cities);
  assert.equal(all[LIMIT.rows - 1].sessions, all[LIMIT.rows].sessions);
  assert.deepEqual(bySessions(kept.rows), all.slice(0, LIMIT.rows));
  assert.deepEqual(kept.rows, cities.filter((r) => kept.rows.includes(r)));
  assert.ok(!kept.rows.includes(cities[17]));
  // Far below the 2 MB entry limit of Next's data cache, for a window of any length.
  assert.ok(JSON.stringify(kept.rows).length < 2 * 1024 * 1024 / 20);
});

test("A short GA4 geography and every other dataset are stored as they come", () => {
  const few = cities.slice(0, 120);
  assert.deepEqual(m.storedRows("ga4", "geography", few), {
    rows: few, metadata: { limit: LIMIT.rows, order_by: "sessions", row_count: 120, truncated: false },
  });
  for (const [source, dataset] of [["ga4", "demographics"], ["meta", "geography"], ["shopify", "orders"], ["ga4", "channels"]])
    assert.deepEqual(m.storedRows(source, dataset, cities), { rows: cities, metadata: {} });
});

test("detail() says when a close kept only its top rows, and keeps the period complete", () => {
  const kept = m.storedRows("ga4", "geography", cities);
  const d = m.detail(close(kept.rows, kept.metadata), range, "ga4", "geography");
  assert.equal(d.complete, true);
  assert.equal(d.rows.length, LIMIT.rows);
  assert.equal(d.note, `Período completo · dados provisórios · fecho só com as ${LIMIT.rows} de 5439 linhas com mais sessões`);
  // Closes stored before the limit, or not truncated, read as before.
  assert.equal(m.detail(close(cities, {}), range, "ga4", "geography").note, "Período completo · dados provisórios");
  const few = m.storedRows("ga4", "geography", cities.slice(0, 50));
  assert.equal(m.detail(close(few.rows, few.metadata), range, "ga4", "geography").note, "Período completo · dados provisórios");
  // Read day by day, the note also warns that each day kept only its main rows.
  const day = close(kept.rows, kept.metadata);
  day.datasets[0].period_start = day.datasets[0].period_end = range.from;
  assert.match(m.detail(day, { from: range.from, to: range.from }, "ga4", "geography", true).note, /fecho só com as/);
  assert.match(m.detail(day, { from: range.from, to: p.shift(range.from, 1) }, "ga4", "geography", true).note,
    /^1\/2 dias recolhidos · versões diárias · dias com fecho só das linhas principais$/);
});

test("Audience never shows more cities than the close keeps, and the ingestion applies the limit", () => {
  const root = path.join(__dirname, "..");
  const audience = fs.readFileSync(path.join(root, "components", "dashboard", "audience.tsx"), "utf8");
  const shown = audience.match(/\[\.\.\.geo\.rows\][\s\S]*?\.slice\(\s*0\s*,\s*(\d+)\s*\)/);
  assert.ok(shown, "audience.tsx: tabela de cidades");
  assert.ok(Number(shown[1]) <= LIMIT.rows / 2, `mostra ${shown[1]} de ${LIMIT.rows}`);
  const ingest = fs.readFileSync(path.join(root, "lib", "bi", "ingest.ts"), "utf8");
  assert.match(ingest, /const kept = storedRows\(source, dataset, rows\);[\s\S]*?rows: kept\.rows, metadata: \{ \.\.\.metadata, \.\.\.kept\.metadata \}/);
});
