const { test } = require("node:test");
const assert = require("node:assert/strict");
const perm = require("../.test-build/permissions.js");
const rec = require("../.test-build/store-records.js");

const store = (id, level) => ({ id, code: id, name: id, level });
const superAdmin = { id: "s", isSuper: true, online: true, stores: [store("a", "manager"), store("b", "manager")] };
const online = { id: "o", isSuper: false, online: true, stores: [] };
const manager = { id: "m", isSuper: false, online: false, stores: [store("a", "manager"), store("b", "store")] };
const shop = { id: "l", isSuper: false, online: false, stores: [store("a", "store")] };
const nobody = { id: "n", isSuper: false, online: false, stores: [] };

test("Each profile lands where it has access", () => {
  assert.equal(perm.homePath(superAdmin), "/");
  assert.equal(perm.homePath(online), "/");
  assert.equal(perm.homePath(manager), "/lojas");
  assert.equal(perm.homePath(shop), "/lojas");
  assert.equal(perm.homePath(nobody), null);
  assert.equal(perm.canSeeOnline(manager), false);
});

test("Only the Super Admin and Gestores manage users; only the Super Admin manages stores", () => {
  assert.equal(perm.canManageUsers(superAdmin), true);
  assert.equal(perm.canManageUsers(manager), true);
  assert.equal(perm.canManageUsers(shop), false);
  assert.equal(perm.canManageUsers(online), false);
  assert.equal(perm.canManageStores(manager), false);
  assert.equal(perm.canManageStores(superAdmin), true);
});

test("A Gestor grants only the Loja level, and only in the stores they manage", () => {
  assert.deepEqual(perm.grantableLevels(superAdmin, "z"), ["store", "manager"]);
  assert.deepEqual(perm.grantableLevels(manager, "a"), ["store"]);
  assert.deepEqual(perm.grantableLevels(manager, "b"), []);
  assert.deepEqual(perm.grantableLevels(shop, "a"), []);
});

test("Loja corrects its own entry for 24 hours; Gestor corrects any entry", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const mine = { created_by: "l", created_at: "2026-10-02T08:00:00Z" };
  const old = { created_by: "l", created_at: "2026-10-01T10:00:00Z" };
  const other = { created_by: "x", created_at: "2026-10-02T08:00:00Z" };
  assert.equal(perm.canEditRecord(shop, "a", null, now), true);
  assert.equal(perm.canEditRecord(shop, "a", mine, now), true);
  assert.equal(perm.canEditRecord(shop, "a", old, now), false);
  assert.equal(perm.canEditRecord(shop, "a", other, now), false);
  assert.equal(perm.canEditRecord(manager, "a", old, now), true);
  assert.equal(perm.canEditRecord(manager, "b", other, now), false);
  assert.equal(perm.canEditRecord(shop, "b", null, now), false);
  // Once the Gestor corrected it, the Loja can no longer overwrite it.
  assert.equal(perm.canEditRecord(shop, "a", { ...mine, updated_by: "m" }, now), false);
  assert.equal(perm.canEditRecord(shop, "a", { ...mine, updated_by: "l" }, now), true);
});

const form = (o) => ({ get: (k) => (k in o ? o[k] : null) });
const opt = (list, code, digital = false) => ({ list, code, label: code, sort_order: 1, active: true, digital });
const options = rec.groupOptions([
  opt("seen_where", "loja"), opt("seen_where", "site", true), opt("heard_from", "google", true), opt("heard_from", "cliente"),
]);

test("Amounts and grams are read in the Portuguese format", () => {
  assert.equal(rec.parseAmount("1234,56"), 1234.56);
  assert.equal(rec.parseAmount("1.234,56"), 1234.56);
  assert.equal(rec.parseAmount("1 234,5 €"), 1234.5);
  assert.equal(rec.parseAmount("1234.56"), 1234.56);
  assert.equal(rec.parseAmount("1.234"), 1234);
  assert.equal(rec.parseAmount(""), null);
  assert.equal(rec.parseAmount("-5"), "invalid");
  assert.equal(rec.parseAmount("12,345"), "invalid");
  assert.equal(rec.parseGrams("19,91"), 19.91);
  assert.equal(rec.parseGrams("3.5 g"), 3.5);
  assert.equal(rec.parseGrams("x"), "invalid");
});

test("The sales form asks for the questions of the Excel and keeps the articles", () => {
  const base = { sold: "sim", total_value: "235", campaign: "nao", client_type: "novo", seen_where: "loja", bought_online: "nao", item_0_material: "ouro", item_0_type: "brincos" };
  assert.ok("error" in rec.parseShopSaleForm(form({ ...base, sold: null })));
  assert.ok("error" in rec.parseShopSaleForm(form({ ...base, total_value: "" })));
  assert.ok("error" in rec.parseShopSaleForm(form({ ...base, client_type: "" })));
  assert.ok("error" in rec.parseShopSaleForm(form({ ...base, bought_online: null })));
  assert.ok("error" in rec.parseShopSaleForm(form({ ...base, item_0_material: "", item_0_type: "" })));
  const ok = rec.parseShopSaleForm(form({ ...base, campaign: "saldos", item_1_reference: "50001281", item_1_type: "fio" })).data;
  assert.equal(ok.total_value, 235);
  assert.equal(ok.campaign, true);
  assert.equal(ok.campaign_code, "saldos");
  assert.equal(ok.items.length, 2);
  const noSale = rec.parseShopSaleForm(form({ ...base, sold: "nao", total_value: "", item_0_material: "", item_0_type: "" }));
  assert.ok("error" in noSale, "a no-sale needs a reason");
  const withReason = rec.parseShopSaleForm(form({ ...base, sold: "nao", total_value: "10", no_sale_reason: "caro" })).data;
  assert.equal(withReason.total_value, null);
  assert.equal(withReason.no_sale_reason, "caro");
});

test("The gold form needs how the customer heard of us and grams with value", () => {
  const base = { entry_date: "2026-10-01", operation: "used", heard_from: "google", closed: "sim", grams_19: "17,91", value_19: "1.500" };
  assert.equal(rec.parseGoldForm(form(base)).data.grams_19, 17.91);
  assert.equal(rec.parseGoldForm(form(base)).data.value_19, 1500);
  assert.ok("error" in rec.parseGoldForm(form({ ...base, heard_from: "" })));
  assert.ok("error" in rec.parseGoldForm(form({ ...base, value_19: "" })));
  assert.ok("error" in rec.parseGoldForm(form({ ...base, grams_19: "", value_19: "" })), "closed deal without gold");
  assert.ok("data" in rec.parseGoldForm(form({ ...base, closed: "nao", grams_19: "", value_19: "" })));
});

test("Shop summary: conversion, ticket and share that saw the product online", () => {
  const r = (sold, value, seen, kind) => ({ sold, total_value: value, seen_where: seen, client_type: kind, campaign: false, bought_online: false, items: [] });
  const s = rec.summarizeShop([r(true, 100, "site", "novo"), r(true, 50, "loja", "habitual"), r(false, null, "loja", "novo"), r(true, 30, null, null)], options);
  assert.equal(s.served, 4);
  assert.equal(s.sales, 3);
  assert.equal(s.value, 180);
  assert.equal(s.avgTicket, 60);
  assert.equal(s.conversion, 75);
  assert.equal(Math.round(s.digitalShare), 33);
  assert.equal(Math.round(s.newShare), 67);
});

test("Gold totals use individual records and fall back to the imported months", () => {
  const k = (o) => ({ grams_9: null, value_9: null, grams_14: null, value_14: null, grams_18: null, value_18: null, grams_19: null, value_19: null, grams_22: null, value_22: null, grams_24: null, value_24: null, ...o });
  const entries = [
    k({ store_id: "a", operation: "used", entry_date: "2026-10-01", heard_from: "google", closed: true, grams_19: 10, value_19: 700 }),
    k({ store_id: "a", operation: "used", entry_date: "2026-10-02", heard_from: "cliente", closed: false }),
  ];
  const monthly = [
    k({ store_id: "a", operation: "used", month: "2026-09-01", visitors: 60, digital_visitors: 8, grams_19: 474.57, value_19: 40555 }),
    k({ store_id: "a", operation: "used", month: "2026-10-01", visitors: 99, digital_visitors: 99, grams_19: 1, value_19: 1 }),
  ];
  const oct = rec.goldTotals(entries, monthly, options, { store_id: "a", from: "2026-10-01", to: "2026-10-31" });
  assert.equal(oct.customers, 2, "individual records win over an imported month");
  assert.equal(oct.digital, 1);
  assert.equal(oct.closed, 1);
  assert.equal(oct.totalValue, 700);
  const sep = rec.goldTotals(entries, monthly, options, { store_id: "a", from: "2026-09-01", to: "2026-09-30" });
  assert.equal(sep.customers, 60);
  assert.equal(sep.totalGrams, 474.57);
  assert.equal(sep.closed, null);
  const half = rec.goldTotals(entries, monthly, options, { store_id: "a", from: "2026-09-15", to: "2026-09-30" });
  assert.equal(half.customers, 0);
  assert.equal(half.partialMonthly, true);
});

test("Google Ads campaigns are matched to stores by keyword, ignoring case and accents", () => {
  const stores = [{ id: "foz", ads_keyword: "FOZ" }, { id: "fat", ads_keyword: "Fátima" }, { id: "lei", ads_keyword: "LEIRIA" }, { id: "lc", ads_keyword: "LEIRIA CITY" }, { id: "x", ads_keyword: null }];
  assert.equal(rec.campaignStore("FOZ - 10km", stores), "foz");
  assert.equal(rec.campaignStore("FATIMA MAX", stores), "fat");
  assert.equal(rec.campaignStore("Leiria City - 5km", stores), "lc");
  assert.equal(rec.campaignStore("Branded", stores), null);
});

test("Months end today at the latest; codes are made from names", () => {
  assert.deepEqual(rec.monthRange("2026-09", "2026-10-02"), { month: "2026-09", from: "2026-09-01", to: "2026-09-30", last: "2026-09-30" });
  assert.deepEqual(rec.monthRange("2026-11", "2026-10-02"), { month: "2026-10", from: "2026-10-01", to: "2026-10-02", last: "2026-10-31" });
  assert.equal(rec.monthRange("2024-02", "2026-10-02").to, "2024-02-29");
  assert.equal(rec.shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(rec.monthsBetween("2026-08-15", "2026-10-02"), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(rec.storeCode("Figueira da Foz "), "figueira-da-foz");
  assert.equal(rec.optionCode("Campanha Dia da Mãe"), "campanha_dia_da_mae");
});

test("Store ranking orders every store by sales or gold and keeps stores without data", () => {
  const stores = [{ id: "a", code: "a", name: "Abrantes" }, { id: "b", code: "b", name: "Benfica" }, { id: "c", code: "c", name: "Coimbra" }];
  const sale = (store_id, sale_date, value) => ({ store_id, sale_date, sold: value !== null, total_value: value, seen_where: null, client_type: null, campaign: false, bought_online: false, items: [] });
  const sales = [sale("a", "2026-10-01", 100), sale("b", "2026-10-01", 300), sale("b", "2026-09-30", 50), sale("a", "2026-09-30", 900)];
  const gold = [{ store_id: "a", operation: "used", entry_date: "2026-10-01", heard_from: "google", closed: true, grams_9: null, value_9: null, grams_14: null, value_14: null, grams_18: null, value_18: null, grams_19: 5, value_19: 400, grams_22: null, value_22: null, grams_24: null, value_24: null }];
  const range = { from: "2026-10-01", to: "2026-10-01" };
  const prev = { from: "2026-09-30", to: "2026-09-30" };
  const bySales = rec.storeTable(stores, sales, gold, [], options, range, prev);
  assert.deepEqual(bySales.map((r) => [r.store.id, r.rank]), [["b", 1], ["a", 2], ["c", 3]]);
  assert.equal(bySales[0].shop.value, 300);
  assert.equal(bySales[0].shopBefore.value, 50);
  const byGold = rec.storeTable(stores, sales, gold, [], options, range, prev, "gold");
  assert.equal(byGold[0].store.id, "a");
  assert.equal(byGold[0].gold.totalValue, 400);
});

test("Missing-data alert skips closed weekdays and stores that recorded sales or gold", () => {
  const stores = [{ id: "a", name: "A", closed_weekdays: [0] }, { id: "b", name: "B", closed_weekdays: [0] }, { id: "c", name: "C" }, { id: "d", name: "D", closed_weekdays: [0] }];
  const sales = [{ store_id: "a", sale_date: "2026-10-01" }, { store_id: "b", sale_date: "2026-09-30" }];
  const entries = [{ store_id: "d", entry_date: "2026-10-01" }];
  assert.deepEqual(rec.missingStores(stores, sales, entries, "2026-10-01").map((s) => s.id), ["b", "c"]);
  // 2026-10-04 is a Sunday: only the store open on Sundays is missing.
  assert.deepEqual(rec.missingStores(stores, sales, entries, "2026-10-04").map((s) => s.id), ["c"]);
});

test("Ad campaigns go to a physical store by keyword, otherwise online; manual choices win", () => {
  const ch = require("../.test-build/bi/channels.js");
  const rules = {
    stores: [{ id: "lei", name: "Leiria Jericó", keyword: "JERICO" }, { id: "lc", name: "Leiria City", keyword: "LEIRIA CITY" }, { id: "fat", name: "Fátima", keyword: "FATIMA" }, { id: "x", name: "Sem", keyword: null }],
    overrides: [{ source: "google_ads", campaign: "Branded", channel: "shared", store_id: null }, { source: "meta", campaign: "Promo Natal", channel: "store", store_id: "lc" }],
  };
  assert.deepEqual(ch.classify("meta", "[MSG] COMPRA E VENDA - FÁTIMA - 17KM", rules), { destination: "store", storeId: "fat", storeName: "Fátima", rule: "keyword" });
  assert.equal(ch.classify("google_ads", "Leiria City - 5km", rules).storeId, "lc");
  assert.equal(ch.classify("google_ads", "NEW PMAX", rules).destination, "online");
  assert.equal(ch.classify("google_ads", "Branded", rules).destination, "shared");
  assert.equal(ch.classify("meta", "Branded", rules).destination, "online", "a manual choice is per source");
  assert.equal(ch.classify("meta", "Promo Natal", rules).storeName, "Leiria City");
  const split = ch.splitRows("meta", [
    { campaign: "CBO - REELS", spend: "100.5" }, { campaign: "CBO - REELS", spend: 20 },
    { campaign: "[MSG] COMPRA E VENDA - FATIMA", spend: 30.25 }, { campaign: "Sem gasto", spend: null },
  ], rules);
  const by = Object.fromEntries(split.map((c) => [c.campaign, c]));
  assert.equal(by["CBO - REELS"].spend, 120.5);
  assert.equal(by["[MSG] COMPRA E VENDA - FATIMA"].destination, "store");
  assert.equal(by["Sem gasto"].spend, 0);
});

test("Online investment excludes physical-store and shared campaigns, and stays unknown without detail", () => {
  const ch = require("../.test-build/bi/channels.js");
  const ds = (source, dataset, day, rows) => ({ source, dataset, period_start: day, period_end: day, rows, metadata: { complete: true, daily: true, timezone: "Europe/Lisbon", currency: "EUR" }, fetched_at: "2026-10-06T00:00:00Z", status: "provisional", run_id: "r" });
  const channels = { stores: [{ id: "lou", name: "Loures", keyword: "LOURES" }], overrides: [{ source: "google_ads", campaign: "Branded", channel: "shared", store_id: null }] };
  const store = { daily: [], quality: [], reports: [], runs: [], errors: [], mode: "stored", channels, datasets: [
    ds("meta", "ads", "2026-10-01", [{ campaign: "CBO", spend: 300 }, { campaign: "[MSG] LOURES", spend: 50 }]),
    ds("google_ads", "campaigns", "2026-10-01", [{ campaign: "PMAX", spend: 100 }, { campaign: "Loures - 5km", spend: 20 }, { campaign: "Branded", spend: 30 }]),
  ] };
  const p = { from: "2026-10-01", to: "2026-10-01" };
  const inv = ch.onlineInvestment(store, p, 500, 4000);
  assert.equal(inv.physical, 70);
  assert.equal(inv.shared, 30);
  assert.equal(inv.online, 400);
  assert.equal(inv.mer, 10);
  assert.deepEqual(inv.split.byStore.map((s) => [s.name, s.meta, s.google, s.total]), [["Loures", 50, 20, 70]]);
  const missing = ch.onlineInvestment(store, { from: "2026-10-01", to: "2026-10-02" }, 900, 4000);
  assert.equal(missing.online, null, "a day without campaign detail leaves the split unknown");
  assert.equal(ch.onlineInvestment({ ...store, channels: undefined }, p, 500, 4000).online, null);
});
