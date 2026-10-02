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
