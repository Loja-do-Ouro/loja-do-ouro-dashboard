const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const a = require("../.test-build/bi/ad-days.js");
const ch = require("../.test-build/bi/channels.js");
const m = require("../.test-build/bi/model.js");
const p = require("../.test-build/bi/periods.js");

const ds = (source, dataset, day, rows, extra = {}) => ({
  source, dataset, period_start: day, period_end: day, rows,
  metadata: { complete: true, daily: true, timezone: "Europe/Lisbon", currency: "EUR", ...(extra.metadata || {}) },
  fetched_at: "2026-11-04T01:18:40Z", status: extra.status || "provisional", run_id: "r",
});
const days = (from, to) => p.dates({ from, to });
const october = { from: "2026-10-01", to: "2026-10-31" };

test("The lookback starts on the 1st of the month before the range's last month and is never a stored window", () => {
  assert.deepEqual(a.adLookback({ from: "2026-11-01", to: "2026-11-03" }), { from: "2026-10-01", to: "2026-11-03" });
  // On 1 Nov the closed "Mês anterior" is October: still inside the lookback.
  assert.deepEqual(a.adLookback({ from: "2026-10-29", to: "2026-10-31" }), { from: "2026-09-01", to: "2026-10-31" });
  assert.deepEqual(a.adLookback({ from: "2027-01-01", to: "2027-01-03" }), { from: "2026-12-01", to: "2027-01-03" });
  assert.equal(a.adLookback({ from: "2026-08-01", to: "2026-10-10" }), null, "a backfill that already covers the lookback");
  // Every nightly range of a year: the lookback covers "Mês anterior" and spans two months (never a day, week or month).
  for (let today = "2026-01-01"; today <= "2026-12-31"; today = p.shift(today, 1)) {
    const now = new Date(`${today}T12:00:00Z`), range = p.ingestRange({}, now), lb = a.adLookback(range);
    const month = p.closedPeriods(now)[2].range;
    assert.ok(lb.from <= month.from && lb.to >= month.to, today);
    assert.notEqual(lb.from.slice(0, 7), lb.to.slice(0, 7), today);
    assert.ok(p.dates(lb).length > 7, today);
  }
});

test("Each night asks the range's days and the earlier days without campaign detail (31 Oct 2026)", () => {
  // As stored on 4 Nov 2026: Meta without 31 Oct and 1 Nov (HTTP 400, then three-day queries out of time).
  const stored = [
    ...days("2026-10-01", "2026-10-30").map((d) => ds("meta", "ads", d, [{ campaign: "CBO", spend: 1 }])),
    ...days("2026-11-02", "2026-11-03").map((d) => ds("meta", "ads", d, [{ campaign: "CBO", spend: 1 }])),
    ...days("2026-10-01", "2026-11-03").map((d) => ds("google_ads", "campaigns", d, [{ campaign: "PMAX", spend: 1 }])),
  ];
  const range = { from: "2026-11-01", to: "2026-11-03" };
  const meta = a.adDays(range, stored, "meta", "ads");
  assert.deepEqual(meta.days, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-10-31"]);
  assert.deepEqual(meta.gaps, ["2026-10-31"]);
  assert.deepEqual(a.adDays(range, stored, "google_ads", "campaigns"), { days: ["2026-11-01", "2026-11-02", "2026-11-03"], gaps: [] });
  // Without the stored read nothing is guessed: only the range.
  assert.deepEqual(a.adDays(range, null, "meta", "ads"), { days: ["2026-11-01", "2026-11-02", "2026-11-03"], gaps: [] });
});

test("Unusable days count as missing, newest first and at most the limit per night", () => {
  const range = { from: "2026-11-01", to: "2026-11-03" };
  // 10–24 Oct not stored, 29 Oct incomplete, 30 Oct from a failed write; a day with no rows is a confirmed empty day.
  const stored = [
    ...days("2026-10-01", "2026-10-09"), ...days("2026-10-25", "2026-10-28"), "2026-10-31",
  ].map((d) => ds("meta", "ads", d, []));
  stored.push(ds("meta", "ads", "2026-10-29", [], { metadata: { complete: false } }));
  stored.push(ds("meta", "ads", "2026-10-30", [], { status: "failed" }));
  const plan = a.adDays(range, stored, "meta", "ads");
  assert.deepEqual(plan.gaps.slice(0, 3), ["2026-10-30", "2026-10-29", "2026-10-24"]);
  assert.equal(plan.gaps.length, 17);
  assert.equal(plan.days.length, 3 + a.AD_GAP_LIMIT);
  assert.deepEqual(plan.days.slice(3), plan.gaps.slice(0, a.AD_GAP_LIMIT));
});

test("October 2026 splits into online and physical stores once 31 Oct is stored, and says which day is missing before", () => {
  const channels = { stores: [{ id: "lou", name: "Loures", keyword: "LOURES" }, { id: "fat", name: "Fátima", keyword: "FATIMA" }], overrides: [] };
  const meta = (d) => ds("meta", "ads", d, [{ campaign: "Remarketing (value)", spend: 20 }, { campaign: "[MSG] COMPRA E VENDA - LOURES - 17KM", spend: 10 }]);
  const google = (d) => ds("google_ads", "campaigns", d, [{ campaign: "NEW PMAX", spend: 15 }, { campaign: "FATIMA MAX", spend: 5 }]);
  const store = { daily: [], quality: [], reports: [], runs: [], errors: [], mode: "stored", channels, datasets: [
    ...days("2026-10-01", "2026-10-30").map(meta),
    ...days("2026-10-01", "2026-10-31").map(google),
  ] };
  const before = ch.onlineInvestment(store, october, 31 * 50, 20000);
  assert.equal(before.online, null);
  assert.equal(before.physical, null);
  assert.match(before.split.note, /^Meta: 30\/31 dias recolhidos · versões diárias \(em falta: 31\/10\)$/);
  store.datasets.push(meta("2026-10-31"));
  const after = ch.onlineInvestment(store, october, 31 * 50, 20000);
  assert.equal(after.physical, 31 * 15);
  assert.equal(after.online, 31 * 35);
  assert.equal(after.split.note, "");
  assert.deepEqual(after.split.byStore.map((s) => [s.name, s.meta, s.google]), [["Loures", 310, 0], ["Fátima", 0, 155]]);
});

test("Missing days are listed in the detail and in short form", () => {
  const store = { daily: [], quality: [], reports: [], runs: [], errors: [], mode: "stored", datasets: [
    ds("meta", "ads", "2026-10-01", []), ds("meta", "ads", "2026-10-03", [], { metadata: { complete: false } }),
  ] };
  assert.deepEqual(m.detail(store, { from: "2026-10-01", to: "2026-10-04" }, "meta", "ads", true).missing, ["2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(ch.missingDays(["2026-10-31"]), "31/10");
  assert.equal(ch.missingDays(["2026-10-31", "2026-11-01"]), "31/10 e 1/11");
  assert.equal(ch.missingDays(["2026-10-01", "2026-10-02", "2026-10-03"]), "1/10, 2/10 e 3/10");
  assert.equal(ch.missingDays(days("2026-10-01", "2026-10-07")), "1/10, 2/10, 3/10 e mais 4");
});

test("The collection asks campaign detail one day at a time, from adDays", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "bi", "ingest.ts"), "utf8");
  assert.match(source, /adDays\(range, storedAds, d\.source, d\.dataset\)/);
  assert.match(source, /readWindsor\(d\.connector, \{ from: day, to: day \}, d\.fields, \{ fresh: true \}\)/);
  assert.doesNotMatch(source, /readWindsor\(d\.connector, range, d\.fields/, "no multi-day query of campaign detail");
});
