const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../.test-build/store-sheet-plan.js");

const H = (c) => c.repeat(64);
const day = (store_code, d, hash, rows = [{ n: 1 }]) => ({ store_code, day: d, hash, rows });
const state = (o = {}) => ({ days: [], imported: [], protected: [], ...o });
const keys = (changes) => changes.map((c) => `${c.store_code}|${c.day}|${c.rows === null ? "sai" : c.rows.length}`).sort();

test("Only new or changed days are sent; unchanged days are left alone", () => {
  const sheet = [day("tomar", "2026-10-01", H("a")), day("tomar", "2026-10-02", H("b")), day("tomar", "2026-10-03", H("c"))];
  const st = state({ days: [{ store_code: "tomar", day: "2026-10-01", hash: H("a") }, { store_code: "tomar", day: "2026-10-02", hash: H("x") }] });
  const { changes, issues } = p.planSheetChanges(sheet, ["tomar"], st);
  assert.deepEqual(keys(changes), ["tomar|2026-10-02|1", "tomar|2026-10-03|1"]);
  assert.deepEqual(issues, []);
});

test("October import days (no fingerprint yet) are replaced by the sheet version", () => {
  const sheet = [day("benfica", "2026-06-01", H("a"))];
  const st = state({ imported: [{ store_code: "benfica", day: "2026-06-01" }] });
  assert.deepEqual(keys(p.planSheetChanges(sheet, ["benfica"], st).changes), ["benfica|2026-06-01|1"]);
});

test("Days that left the sheet are removed, unless the store tab is missing or kept less than half of its days", () => {
  const st = state({
    days: [
      { store_code: "tomar", day: "2026-10-01", hash: H("a") }, { store_code: "tomar", day: "2026-10-02", hash: H("b") },
      { store_code: "loures", day: "2026-10-01", hash: H("a") }, { store_code: "loures", day: "2026-10-02", hash: H("b") }, { store_code: "loures", day: "2026-10-03", hash: H("c") },
      { store_code: "coimbra", day: "2026-10-01", hash: H("a") },
    ],
  });
  // tomar: 1 de 2 dias continua (metade: pode apagar o outro); loures: 1 de 3 (menos de metade: nada sai); coimbra: separador em falta.
  const sheet = [day("tomar", "2026-10-01", H("a")), day("loures", "2026-10-01", H("a"))];
  const { changes, issues } = p.planSheetChanges(sheet, ["tomar", "loures"], st);
  assert.deepEqual(keys(changes), ["tomar|2026-10-02|sai"]);
  assert.equal(issues.length, 2);
  assert.ok(issues.some((i) => i.tab === "loures" && /continuam na folha/.test(i.message)));
  assert.ok(issues.some((i) => i.tab === "coimbra" && /não encontrado/.test(i.message)));
});

test("Form days and days corrected by a manager are protected", () => {
  const st = state({
    days: [{ store_code: "tomar", day: "2026-10-02", hash: H("b") }, { store_code: "tomar", day: "2026-10-04", hash: H("d") }],
    imported: [{ store_code: "tomar", day: "2026-10-01" }, { store_code: "tomar", day: "2026-10-02" }, { store_code: "tomar", day: "2026-10-04" }],
    protected: [
      { store_code: "tomar", day: "2026-10-01", reason: "form" }, // ainda tem registos da folha: vai à BD (saem)
      { store_code: "tomar", day: "2026-10-03", reason: "form" }, // só formulário: nada a fazer
      { store_code: "tomar", day: "2026-10-02", reason: "edited" }, // corrigido e a folha não mudou: nada
      { store_code: "tomar", day: "2026-10-04", reason: "edited" }, // corrigido e saiu da folha: nunca apagado
    ],
  });
  const sheet = [day("tomar", "2026-10-01", H("a")), day("tomar", "2026-10-02", H("b")), day("tomar", "2026-10-03", H("c"))];
  const { changes } = p.planSheetChanges(sheet, ["tomar"], st);
  assert.deepEqual(keys(changes), ["tomar|2026-10-01|1"]);
  // A folha mudou num dia corrigido: vai à BD, que o mantém e o mostra no relatório.
  const changed = p.planSheetChanges([day("tomar", "2026-10-01", H("a")), day("tomar", "2026-10-02", H("z")), day("tomar", "2026-10-03", H("c"))], ["tomar"], st).changes;
  assert.ok(changed.some((c) => c.day === "2026-10-02" && c.rows));
});

test("A sheet with as many days but different ones removes nothing (it must keep half of the imported days)", () => {
  const old = Array.from({ length: 10 }, (_, i) => ({ store_code: "tomar", day: `2026-09-${String(i + 1).padStart(2, "0")}`, hash: H("a") }));
  const sheet = Array.from({ length: 10 }, (_, i) => day("tomar", `2026-10-${String(i + 1).padStart(2, "0")}`, H("b")));
  const { changes, issues } = p.planSheetChanges(sheet, ["tomar"], state({ days: old }));
  assert.equal(changes.filter((c) => c.rows === null).length, 0);
  // Os dias depois do último já importado (um período novo) entram.
  assert.equal(changes.length, 10);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Só 0 dos 10/);
});

test("A suspended store keeps its days: nothing removed, changed or added up to the last imported day", () => {
  // Separador ordenado ou deslocado: os dias mudam de sítio dentro do período já importado.
  const old = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-09-01", "2026-09-02", "2026-09-03"].map((d) => ({ store_code: "tomar", day: d, hash: H("a") }));
  const sheet = [day("tomar", "2025-08-03", H("b")), day("tomar", "2025-09-01", H("b")), day("tomar", "2026-08-03", H("c")), day("tomar", "2026-10-07", H("d"))];
  const { changes, issues } = p.planSheetChanges(sheet, ["tomar"], state({ days: old }));
  assert.deepEqual(keys(changes), ["tomar|2026-10-07|1"]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Só 1 dos 6 .* até 2026-09-03 \(3 dia\(s\) da folha ficaram por importar\)\./);
});

test("Form days that still have sheet records are always sent, even when the store tab is missing or below half", () => {
  const st = state({
    days: [{ store_code: "tomar", day: "2026-10-07", hash: H("a") }, { store_code: "tomar", day: "2026-10-08", hash: H("b") }, { store_code: "tomar", day: "2026-10-06", hash: H("c") }],
    imported: [{ store_code: "tomar", day: "2026-10-07" }, { store_code: "tomar", day: "2026-10-08" }, { store_code: "tomar", day: "2026-10-06" }],
    protected: [{ store_code: "tomar", day: "2026-10-08", reason: "form" }],
  });
  // Separador em falta: só o dia do formulário vai à BD (para os registos da folha saírem).
  assert.deepEqual(keys(p.planSheetChanges([], [], st).changes), ["tomar|2026-10-08|sai"]);
  // Separador lido mas só com 1 de 3 dias: idem.
  assert.deepEqual(keys(p.planSheetChanges([day("tomar", "2026-10-06", H("c"))], ["tomar"], st).changes), ["tomar|2026-10-08|sai"]);
});

test("A day protected for both reasons is treated as a form day", () => {
  const st = state({
    days: [{ store_code: "tomar", day: "2026-10-02", hash: H("b") }],
    imported: [{ store_code: "tomar", day: "2026-10-02" }],
    protected: [{ store_code: "tomar", day: "2026-10-02", reason: "edited" }, { store_code: "tomar", day: "2026-10-02", reason: "form" }],
  });
  assert.deepEqual(keys(p.planSheetChanges([day("tomar", "2026-10-02", H("b"))], ["tomar"], st).changes), ["tomar|2026-10-02|1"]);
});
