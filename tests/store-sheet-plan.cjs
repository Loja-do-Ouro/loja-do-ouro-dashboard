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

test("Days that left the sheet are removed, unless the store tab is missing or shrank to less than half", () => {
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
  assert.ok(issues.some((i) => i.tab === "loures" && /menos de metade/.test(i.message)));
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
  const changed = p.planSheetChanges([day("tomar", "2026-10-02", H("z"))], ["tomar"], st).changes;
  assert.ok(changed.some((c) => c.day === "2026-10-02" && c.rows));
});
