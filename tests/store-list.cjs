const { test } = require("node:test");
const assert = require("node:assert/strict");
const rec = require("../.test-build/store-records.js");

const TODAY = "2026-10-13"; // terça-feira

test("Week runs Monday to Sunday around the day, and never past today", () => {
  assert.deepEqual(rec.weekRange("2026-10-08", TODAY), { from: "2026-10-05", to: "2026-10-11", last: "2026-10-11" });
  assert.deepEqual(rec.weekRange("2026-10-05", TODAY), { from: "2026-10-05", to: "2026-10-11", last: "2026-10-11" });
  assert.deepEqual(rec.weekRange("2026-10-11", TODAY), { from: "2026-10-05", to: "2026-10-11", last: "2026-10-11" });
  // Semana atual: até hoje.
  assert.deepEqual(rec.weekRange("2026-10-13", TODAY), { from: "2026-10-12", to: "2026-10-13", last: "2026-10-18" });
  // Semana que passa de um mês para o outro.
  assert.deepEqual(rec.weekRange("2026-08-31", TODAY), { from: "2026-08-31", to: "2026-09-06", last: "2026-09-06" });
  assert.deepEqual(rec.weekRange("2026-09-03", TODAY), { from: "2026-08-31", to: "2026-09-06", last: "2026-09-06" });
});

test("List period: the day, the week of the day, or the month of the summary", () => {
  const month = rec.monthRange("2026-08", TODAY);
  assert.deepEqual(rec.listPeriod("dia", "2026-08-31", month, TODAY), { from: "2026-08-31", to: "2026-08-31" });
  assert.deepEqual(rec.listPeriod("semana", "2026-08-31", month, TODAY), { from: "2026-08-31", to: "2026-09-06" });
  assert.deepEqual(rec.listPeriod("mes", "2026-08-31", month, TODAY), { from: "2026-08-01", to: "2026-08-31" });
  const current = rec.monthRange("2026-10", TODAY);
  assert.deepEqual(rec.listPeriod("mes", "2026-10-13", current, TODAY), { from: "2026-10-01", to: "2026-10-13" });
});

test("Previous and next period; no next period after today", () => {
  assert.deepEqual(rec.listNeighbours("dia", "2026-09-01", "2026-09", TODAY), { prev: "2026-08-31", next: "2026-09-02" });
  assert.deepEqual(rec.listNeighbours("dia", "2026-10-13", "2026-10", TODAY), { prev: "2026-10-12", next: null });
  assert.deepEqual(rec.listNeighbours("semana", "2026-09-03", "2026-09", TODAY), { prev: "2026-08-24", next: "2026-09-07" });
  assert.deepEqual(rec.listNeighbours("semana", "2026-10-13", "2026-10", TODAY), { prev: "2026-10-05", next: null });
  // A semana seguinte é a atual: abre em hoje (e não na segunda-feira).
  assert.deepEqual(rec.listNeighbours("semana", "2026-10-08", "2026-10", TODAY), { prev: "2026-09-28", next: "2026-10-13" });
  assert.deepEqual(rec.listNeighbours("mes", "2026-08-31", "2026-08", TODAY), { prev: "2026-07-01", next: "2026-09-01" });
  assert.deepEqual(rec.listNeighbours("mes", "2026-10-13", "2026-10", TODAY), { prev: "2026-09-01", next: null });
  // O mês seguinte é o atual: abre em hoje.
  assert.deepEqual(rec.listNeighbours("mes", "2026-12-31", "2026-12", "2027-01-05"), { prev: "2026-11-01", next: "2027-01-05" });
  assert.deepEqual(rec.listNeighbours("mes", "2026-09-30", "2026-09", TODAY), { prev: "2026-08-01", next: "2026-10-13" });
});

test("Rows of the period, filtered, newest day first and latest registered first within the day", () => {
  const rows = [
    { id: "a", sale_date: "2026-08-30", sold: true, created_at: "2026-08-30T10:00:00Z" },
    { id: "b", sale_date: "2026-08-31", sold: false, created_at: "2026-08-31T09:00:00Z" },
    { id: "c", sale_date: "2026-08-31", sold: true, created_at: "2026-08-31T15:00:00Z" },
    { id: "d", sale_date: "2026-09-02", sold: true, created_at: "2026-09-02T11:00:00Z" },
    { id: "e", sale_date: "2026-09-07", sold: true, created_at: "2026-09-07T11:00:00Z" },
  ];
  assert.deepEqual(rec.listRows(rows, "2026-08-31", "2026-09-06", "todos").map((r) => r.id), ["d", "c", "b"]);
  assert.deepEqual(rec.listRows(rows, "2026-08-31", "2026-09-06", "vendas").map((r) => r.id), ["d", "c"]);
  assert.deepEqual(rec.listRows(rows, "2026-08-31", "2026-09-06", "sem").map((r) => r.id), ["b"]);
  assert.deepEqual(rec.listRows(rows, "2026-08-31", "2026-08-31", "todos").map((r) => r.id), ["c", "b"]);
  assert.equal(rows[0].id, "a", "a lista original não é alterada");
});

test("Unknown view or filter falls back to the day and to everything", () => {
  assert.equal(rec.listView("semana"), "semana");
  assert.equal(rec.listView("mes"), "mes");
  for (const v of ["", "ano", null, undefined, ["mes"]]) assert.equal(rec.listView(v), "dia");
  assert.equal(rec.listShow("vendas"), "vendas");
  assert.equal(rec.listShow("sem"), "sem");
  for (const v of ["", "tudo", null, undefined]) assert.equal(rec.listShow(v), "todos");
});

test("The sale form reads up to 30 article rows and skips empty ones", () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ sold: "sim", total_value: "120,50", campaign: "nao", client_type: "novo", seen_where: "loja", bought_online: "nao", sale_date: "2026-10-13" })) form.set(k, v);
  for (let i = 0; i < 35; i++) {
    if (i === 3) continue; // linha retirada / vazia
    form.set(`item_${i}_reference`, `R${i}`);
    form.set(`item_${i}_material`, "ouro");
    form.set(`item_${i}_type`, "anel");
  }
  const parsed = rec.parseShopSaleForm(form);
  assert.equal(rec.MAX_ITEMS, 30);
  assert.equal(parsed.data.items.length, 29, "30 linhas lidas, uma vazia");
  assert.equal(parsed.data.items[3].reference, "R4");
  assert.ok(!parsed.data.items.some((it) => it.reference === "R30"), "além do máximo não entra");
});

test("Sort parameter: known columns and directions only; a click toggles, another column starts at its most useful order", () => {
  assert.deepEqual(rec.listSort("valor-desc"), { key: "valor", dir: "desc" });
  assert.deepEqual(rec.listSort("numero-asc"), { key: "numero", dir: "asc" });
  for (const bad of ["", "valor", "valor-up", "preco-desc", "valor-desc-x", null, undefined, ["valor-desc"]]) assert.equal(rec.listSort(bad), null, String(bad));
  assert.equal(rec.sortParam({ key: "valor", dir: "asc" }), "valor-asc");
  assert.equal(rec.sortParam(null), null);
  assert.deepEqual(rec.nextSort(null, "valor"), { key: "valor", dir: "desc" }, "valor: do maior para o menor primeiro");
  assert.deepEqual(rec.nextSort({ key: "valor", dir: "desc" }, "valor"), { key: "valor", dir: "asc" });
  assert.deepEqual(rec.nextSort({ key: "valor", dir: "asc" }, "valor"), { key: "valor", dir: "desc" });
  assert.deepEqual(rec.nextSort({ key: "valor", dir: "asc" }, "cliente"), { key: "cliente", dir: "asc" }, "texto: de A a Z primeiro");
  assert.deepEqual(rec.nextSort(null, "dia"), { key: "dia", dir: "asc" }, "dia: do mais antigo primeiro (o habitual já é do mais recente)");
  assert.deepEqual(rec.nextSort({ key: "dia", dir: "desc" }, "dia"), { key: "dia", dir: "asc" });
  for (const k of rec.LIST_SORT_KEYS) assert.ok(rec.listSort(`${k}-asc`), k);
});

test("Sorting the list: numbers as numbers, sale numbers as read, empty values always last, ties keep the usual order", () => {
  const rows = [
    { id: "a", v: 305, n: "9102733", c: "Novo" },
    { id: "b", v: null, n: "", c: null },
    { id: "c", v: 74.9, n: "9003527", c: "habitual" },
    { id: "d", v: 1649.8, n: "900308", c: "Novo" },
    { id: "e", v: 74.9, n: "9003519", c: "Ex-cliente" },
  ];
  const get = (r, k) => (k === "valor" ? r.v : k === "numero" ? r.n : r.c);
  const ids = (sort) => rec.sortListRows(rows, sort, get).map((r) => r.id).join("");
  assert.equal(ids(null), "abcde", "sem ordem: igual");
  assert.equal(ids({ key: "valor", dir: "desc" }), "daceb");
  assert.equal(ids({ key: "valor", dir: "asc" }), "ceadb", "empate (74,90) mantém a ordem habitual; sem valor no fim");
  assert.equal(ids({ key: "numero", dir: "asc" }), "decab", "900308 < 9003519 < 9003527 < 9102733; vazio no fim");
  assert.equal(ids({ key: "cliente", dir: "asc" }), "ecadb", "sem distinguir maiúsculas; vazio no fim");
  assert.equal(rows.map((r) => r.id).join(""), "abcde", "a lista original não é alterada");
});
