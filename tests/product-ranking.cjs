const { test } = require("node:test");
const assert = require("node:assert/strict");
const rec = require("../.test-build/store-records.js");
const { rankingPeriod, periodParams } = require("../.test-build/ranking-period.js");

let n = 0;
const sale = (store, date, value, items, sold = true) => ({
  id: `s${++n}`, store_id: store, sale_date: date, sold, total_value: sold ? value : null, items,
  sale_number: null, campaign: false, campaign_code: null, client_type: "novo", seen_where: "loja", bought_online: false, purpose: null, restock: null,
  no_sale_reason: sold ? null : "preco", looking_for: null, notes: null, source: "sheet", created_by: "u", created_by_name: null, created_at: `${date}T10:00:00Z`,
  updated_by: null, updated_by_name: null, updated_at: null,
});
const item = (reference, product_type = "fio", material = "prata") => ({ reference, material, product_type });
const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const PREV = { from: "2026-09-01", to: "2026-09-30" };

test("A sale with one article gives it the whole value; several articles split the value equally", () => {
  const sales = [
    sale("A", "2026-10-02", 100, [item("50002606")]),
    sale("A", "2026-10-03", 90, [item("50002606"), item("9033647", "anel", "ouro"), item("50001765")]),
  ];
  const { rows, totals } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  const top = rows[0];
  assert.equal(top.key, "ref:50002606");
  assert.equal(top.units, 2);
  assert.equal(top.sales, 2);
  assert.equal(top.value, 130);
  assert.equal(top.estimated, 30);
  assert.equal(rows.find((r) => r.reference === "9033647").value, 30);
  assert.equal(totals.value, 190);
  assert.equal(totals.units, 4);
  assert.equal(totals.products, 3);
  assert.equal(totals.estimated, 90);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

test("References are grouped without spaces and case; pieces without a reference group by type and material", () => {
  const sales = [
    sale("A", "2026-10-02", 10, [item(" 5000 2140-a ")]),
    sale("A", "2026-10-02", 10, [item("50002140-A")]),
    sale("A", "2026-10-02", 10, [item(null, "anel", "ouro")]),
    sale("A", "2026-10-02", 10, [item("", "anel", "ouro")]),
    sale("A", "2026-10-02", 10, [item(null, "anel", "prata")]),
  ];
  const { rows } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  assert.deepEqual(rows.map((r) => [r.key, r.units]), [["ref:50002140-A", 2], ["sem:anel:ouro", 2], ["sem:anel:prata", 1]]);
  assert.equal(rows[0].reference, "50002140-A");
  assert.equal(rows[1].reference, null);
});

test("Only sold sales of the given stores and period count; sales without articles are reported apart", () => {
  const sales = [
    sale("A", "2026-10-05", 50, [item("1")]),
    sale("B", "2026-10-05", 500, [item("1")]), // loja que a pessoa não gere
    sale("A", "2026-11-01", 70, [item("1")]), // fora do período
    sale("A", "2026-10-05", null, [item("1")], false), // atendimento sem venda
    sale("A", "2026-10-06", 40, []), // venda sem artigos
  ];
  const { rows, totals } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 50);
  assert.deepEqual(rows[0].stores, ["A"]);
  assert.deepEqual(totals.withoutItems, { sales: 1, value: 40 });
  assert.equal(totals.sales, 1);
});

test("Ranking by units puts the most sold pieces first; ties fall back to value", () => {
  const sales = [
    sale("A", "2026-10-02", 500, [item("CARO")]),
    sale("A", "2026-10-02", 20, [item("BARATO")]),
    sale("A", "2026-10-03", 20, [item("BARATO")]),
    sale("B", "2026-10-03", 30, [item("MEDIO")]),
    sale("B", "2026-10-04", 30, [item("MEDIO")]),
  ];
  const ids = new Set(["A", "B"]);
  assert.deepEqual(rec.productRanking(sales, ids, RANGE, PREV, "valor").rows.map((r) => r.reference), ["CARO", "MEDIO", "BARATO"]);
  const byUnits = rec.productRanking(sales, ids, RANGE, PREV, "unidades").rows;
  assert.deepEqual(byUnits.map((r) => r.reference), ["MEDIO", "BARATO", "CARO"]);
  assert.deepEqual(byUnits[0].stores, ["B"]);
});

test("The previous period is matched by piece; new pieces have no comparison", () => {
  const sales = [
    sale("A", "2026-09-10", 40, [item("50002606")]),
    sale("A", "2026-10-10", 60, [item("50002606")]),
    sale("A", "2026-10-11", 10, [item("NOVA")]),
  ];
  const { rows } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  assert.deepEqual(rows[0].before, { units: 1, pricedUnits: 1, value: 40 });
  assert.equal(rows[1].before, null);
});

test("Categories: by type, by material and by both, with distinct pieces and sales", () => {
  const sales = [
    sale("A", "2026-10-02", 100, [item("1", "fio", "ouro"), item("2", "fio", "prata")]),
    sale("A", "2026-10-03", 30, [item("3", "anel", "prata")]),
    sale("A", "2026-10-04", 20, [item("3", "anel", "prata")]),
    sale("A", "2026-10-05", 5, [item("4", null, null)]),
  ];
  const ids = new Set(["A"]);
  const types = rec.categoryRanking(sales, ids, RANGE, PREV, "tipo", "valor").rows;
  assert.deepEqual(types.map((r) => [r.key, r.units, r.value, r.sales, r.products]), [["fio", 2, 100, 1, 2], ["anel", 2, 50, 2, 1], ["", 1, 5, 1, 1]]);
  assert.equal(types[0].estimated, 100);
  const materials = rec.categoryRanking(sales, ids, RANGE, PREV, "material", "valor").rows;
  assert.deepEqual(materials.map((r) => [r.key, r.value]), [["prata", 100], ["ouro", 50], ["", 5]]);
  const both = rec.categoryRanking(sales, ids, RANGE, PREV, "tipo-material", "unidades").rows;
  assert.deepEqual(both.map((r) => [r.key, r.units]), [["anel|prata", 2], ["fio|ouro", 1], ["fio|prata", 1], ["|", 1]]);
  assert.equal(both[0].type, "anel");
  assert.equal(both[0].material, "prata");
});

test("Order parameter: anything other than 'unidades' ranks by value", () => {
  assert.equal(rec.rankBy("unidades"), "unidades");
  assert.equal(rec.rankBy("valor"), "valor");
  assert.equal(rec.rankBy(undefined), "valor");
  assert.equal(rec.rankBy(["unidades"]), "valor");
});

test("Ranking periods: presets, default per tab, custom dates and the previous period", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const yesterday = rankingPeriod({}, "ontem", now);
  assert.equal(yesterday.preset, "ontem");
  assert.deepEqual(yesterday.range, { from: "2026-10-12", to: "2026-10-12" });
  assert.deepEqual(yesterday.prev, { from: "2026-10-11", to: "2026-10-11" });
  const thisMonth = rankingPeriod({}, "este-mes", now);
  assert.deepEqual(thisMonth.range, { from: "2026-10-01", to: "2026-10-13" });
  assert.deepEqual(thisMonth.prev, { from: "2026-09-01", to: "2026-09-13" });
  assert.deepEqual(rankingPeriod({ periodo: "mes" }, "este-mes", now).range, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(rankingPeriod({ periodo: "semana" }, "ontem", now).range, { from: "2026-10-05", to: "2026-10-11" });
  const custom = rankingPeriod({ from: "2026-08-01", to: "2026-08-31", periodo: "ontem" }, "ontem", now);
  assert.equal(custom.preset, "custom");
  assert.deepEqual(custom.prev, { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(periodParams(custom), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(periodParams(thisMonth), { periodo: "este-mes" });
  // Datas inválidas, no futuro ou com mais de um ano voltam ao atalho.
  assert.equal(rankingPeriod({ from: "2026-10-01", to: "2026-10-20" }, "ontem", now).preset, "ontem");
  assert.equal(rankingPeriod({ from: "2025-01-01", to: "2026-10-01" }, "ontem", now).preset, "ontem");
  assert.equal(rankingPeriod({ from: "2026-02-30", to: "2026-03-01" }, "ontem", now).preset, "ontem");
});

test("'Este mês' on the 31st never compares with days of the current month", () => {
  const p = rankingPeriod({ periodo: "este-mes" }, "ontem", new Date("2026-10-31T12:00:00Z"));
  assert.deepEqual(p.range, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(p.prev, { from: "2026-09-01", to: "2026-09-30" });
  const march = rankingPeriod({ periodo: "este-mes" }, "ontem", new Date("2026-03-30T12:00:00Z"));
  assert.deepEqual(march.prev, { from: "2026-02-01", to: "2026-02-28" });
});

test("'Este ano' runs from 1 January to today and compares with the same days of last year", () => {
  const p = rankingPeriod({ periodo: "ano" }, "ontem", new Date("2026-10-13T12:00:00Z"));
  assert.equal(p.preset, "ano");
  assert.deepEqual(p.range, { from: "2026-01-01", to: "2026-10-13" });
  assert.deepEqual(p.prev, { from: "2025-01-01", to: "2025-10-13" });
  const leap = rankingPeriod({ periodo: "ano" }, "ontem", new Date("2028-02-29T12:00:00Z"));
  assert.deepEqual(leap.prev, { from: "2027-01-01", to: "2027-02-28" });
});

test("Sold sales without a value count as units only: no value, no '0,00 €', average over priced units", () => {
  const sales = [
    sale("A", "2026-10-02", 48.5, [item("50001822")]),
    { ...sale("A", "2026-10-03", 0, [item("50001822")]), total_value: null },
    { ...sale("A", "2026-10-04", 0, [item("50001782")]), total_value: null },
  ];
  const { rows, totals } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  const priced = rows.find((r) => r.reference === "50001822");
  assert.equal(priced.units, 2);
  assert.equal(priced.pricedUnits, 1);
  assert.equal(priced.value, 48.5);
  const eur = (n) => `${n.toFixed(2)} €`;
  assert.equal(rec.rankValue(priced, eur), "48.50 €");
  assert.equal(rec.rankAverage(priced, eur), "48.50 €");
  const unpriced = rows.find((r) => r.reference === "50001782");
  assert.equal(rec.rankValue(unpriced, eur), "—");
  assert.equal(rec.rankAverage(unpriced, eur), "—");
  assert.deepEqual(totals.withoutValue, { sales: 2, units: 2 });
  assert.equal(totals.value, 48.5);
});

test("Estimated values and averages carry the '≈' mark; comparison only with a priced previous period", () => {
  const sales = [
    sale("A", "2026-09-10", 0, [item("X")]),
    { ...sale("A", "2026-09-11", 0, [item("Y")]), total_value: null },
    sale("A", "2026-10-02", 100, [item("X")]),
    sale("A", "2026-10-03", 90, [item("X"), item("Y"), item("Z")]),
  ];
  const { rows } = rec.productRanking(sales, new Set(["A"]), RANGE, PREV, "valor");
  const x = rows.find((r) => r.reference === "X");
  const eur = (n) => `${n.toFixed(2)} €`;
  assert.equal(rec.rankValue(x, eur), "≈ 130.00 €");
  assert.equal(rec.rankAverage(x, eur), "≈ 65.00 €");
  // Antes: X vendeu com valor 0 (com valor indicado), Y sem valor indicado.
  assert.equal(rec.rankBefore(x, "valor"), 0);
  const y = rows.find((r) => r.reference === "Y");
  assert.equal(rec.rankBefore(y, "valor"), null);
  assert.equal(rec.rankBefore(y, "unidades"), 1);
  assert.equal(rec.rankBefore(rows.find((r) => r.reference === "Z"), "unidades"), null);
});

test("Rejected custom dates show a message; only a chosen period travels between tabs", () => {
  const { tabPeriodParams } = require("../.test-build/ranking-period.js");
  const now = new Date("2026-10-13T12:00:00Z");
  const bad = rankingPeriod({ from: "2026-10-20", to: "2026-10-01" }, "ontem", now);
  assert.equal(bad.preset, "ontem");
  assert.match(bad.error, /366 dias/);
  assert.equal(rankingPeriod({ from: "2026-10-01" }, "ontem", now).error !== null, true);
  assert.equal(rankingPeriod({ periodo: "mes" }, "ontem", now).error, null);
  assert.deepEqual(tabPeriodParams(rankingPeriod({}, "ontem", now)), {});
  assert.deepEqual(tabPeriodParams(rankingPeriod({ periodo: "invalido" }, "ontem", now)), {});
  // Mudar a ordem ou a loja não transforma o período por defeito numa escolha.
  assert.deepEqual(tabPeriodParams(rankingPeriod({ ordem: "unidades", loja: "benfica" }, "este-mes", now)), {});
  assert.deepEqual(tabPeriodParams(rankingPeriod({ periodo: "mes" }, "este-mes", now)), { periodo: "mes" });
  assert.deepEqual(tabPeriodParams(rankingPeriod({ from: "2026-08-01", to: "2026-08-31" }, "ontem", now)), { from: "2026-08-01", to: "2026-08-31" });
});
