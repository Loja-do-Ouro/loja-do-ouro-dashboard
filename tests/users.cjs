const { test } = require("node:test");
const assert = require("node:assert/strict");
const perm = require("../.test-build/permissions.js");
const sales = require("../.test-build/store-sales.js");

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
  assert.equal(perm.canEditSale(shop, "a", null, now), true);
  assert.equal(perm.canEditSale(shop, "a", mine, now), true);
  assert.equal(perm.canEditSale(shop, "a", old, now), false);
  assert.equal(perm.canEditSale(shop, "a", other, now), false);
  assert.equal(perm.canEditSale(manager, "a", old, now), true);
  assert.equal(perm.canEditSale(manager, "b", other, now), false);
  assert.equal(perm.canEditSale(shop, "b", null, now), false);
  // Once the Gestor corrected it, the Loja can no longer overwrite it.
  assert.equal(perm.canEditSale(shop, "a", { ...mine, updated_by: "m" }, now), false);
  assert.equal(perm.canEditSale(shop, "a", { ...mine, updated_by: "l" }, now), true);
});

test("Amounts are read in the Portuguese format", () => {
  assert.equal(sales.parseAmount("1234,56"), 1234.56);
  assert.equal(sales.parseAmount("1.234,56"), 1234.56);
  assert.equal(sales.parseAmount("1 234,5 €"), 1234.5);
  assert.equal(sales.parseAmount("1234.56"), 1234.56);
  assert.equal(sales.parseAmount("1.234"), 1234);
  assert.equal(sales.parseAmount(""), null);
  assert.equal(sales.parseAmount("-5"), "invalid");
  assert.equal(sales.parseAmount("12,345"), "invalid");
  assert.equal(sales.parseAmount("abc"), "invalid");
  assert.equal(sales.parseCount("1.200"), 1200);
  assert.equal(sales.parseCount("3,5"), "invalid");
});

test("The sales form requires the total and rejects bad values", () => {
  const form = (o) => ({ get: (k) => o[k] ?? null });
  assert.ok("error" in sales.parseSaleForm(form({})));
  assert.ok("error" in sales.parseSaleForm(form({ total_sales: "10", receipts: "x" })));
  const ok = sales.parseSaleForm(form({ total_sales: "1.050,00", receipts: "12", notes: "  feriado " }));
  assert.equal(ok.values.total_sales, 1050);
  assert.equal(ok.values.receipts, 12);
  assert.equal(ok.values.cash, null);
  assert.equal(ok.notes, "feriado");
});

test("Months end today at the latest and summaries ignore missing receipts", () => {
  assert.deepEqual(sales.monthRange("2026-09", "2026-10-02"), { month: "2026-09", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(sales.monthRange("2026-11", "2026-10-02"), { month: "2026-10", from: "2026-10-01", to: "2026-10-02" });
  assert.deepEqual(sales.monthRange("lixo", "2026-02-10"), { month: "2026-02", from: "2026-02-01", to: "2026-02-10" });
  assert.equal(sales.monthRange("2024-02", "2026-10-02").to, "2024-02-29");
  assert.equal(sales.shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(sales.daysDesc("2026-09-29", "2026-10-01"), ["2026-10-01", "2026-09-30", "2026-09-29"]);
  const s = sales.summarize([
    { total_sales: 100, receipts: 4, items: 5 },
    { total_sales: 50, receipts: null, items: null },
  ]);
  assert.deepEqual(s, { total: 150, days: 2, receipts: 4, items: 5, avgTicket: 25, avgDay: 75 });
  assert.equal(sales.paymentGap({ total_sales: 100, cash: 40, card: 50, other_payment: null }), -10);
  assert.equal(sales.paymentGap({ total_sales: 100, cash: null, card: null, other_payment: null }), null);
  assert.equal(sales.storeCode("Figueira da Foz "), "figueira-da-foz");
  assert.equal(sales.storeCode("Santarém (Premium)"), "santarem-premium");
});
