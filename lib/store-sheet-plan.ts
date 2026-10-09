// Folha das lojas: decide, loja a loja e dia a dia, o que a importação envia à base de dados (sem dependências do
// servidor; testado em tests/store-sheet-plan.cjs). A base de dados volta a confirmar cada dia ao aplicar
// (formulário e correções de Gestores) na mesma transação.

export type PlanDay<R> = { store_code: string; day: string; hash: string; rows: R[] };
export type PlanState = {
  days: { store_code: string; day: string; hash: string }[];
  imported: { store_code: string; day: string }[];
  protected: { store_code: string; day: string; reason: "form" | "edited" }[];
};
export type PlanChange<R> = { store_code: string; day: string; hash: string; rows: R[] | null };
export type PlanIssue = { tab: string; row: number | null; message: string };

// Uma loja em que menos de metade dos dias já importados continua na folha (separador renomeado, trocado ou
// ordenado, outra folha, folha cortada por engano) fica suspensa nesta passagem: nada é apagado nem alterado até
// ao último dia já importado; só entram os dias depois dele (uma folha nova de um período novo) e os dias com
// formulário. Colunas mudadas tornam o separador ilegível (store-sheet-rules) e contam como separador não lido.
export const MIN_SHARE_FOR_REMOVALS = 0.5;
const EMPTY_HASH = "0".repeat(64);
const key = (d: { store_code: string; day: string }) => `${d.store_code}|${d.day}`;

export function planSheetChanges<R>(sheetDays: PlanDay<R>[], parsedStores: Iterable<string>, state: PlanState): { changes: PlanChange<R>[]; issues: PlanIssue[] } {
  const stored = new Map(state.days.map((d) => [key(d), d.hash]));
  const imported = new Set(state.imported.map(key));
  // Uma razão por dia; se vierem as duas, o formulário ganha (como na base de dados).
  const protectedDays = new Map<string, "form" | "edited">();
  for (const d of state.protected) if (protectedDays.get(key(d)) !== "form") protectedDays.set(key(d), d.reason);
  const sheet = new Map(sheetDays.map((d) => [key(d), d]));
  const changes: PlanChange<R>[] = [];
  const issues: PlanIssue[] = [];

  // Lojas seguras: separador lido e pelo menos metade dos dias já importados ainda na folha.
  const known = new Set([...stored.keys(), ...imported]);
  const before = new Map<string, number>();
  const kept = new Map<string, number>();
  const lastKnown = new Map<string, string>();
  for (const k of known) {
    const [code, day] = k.split("|");
    before.set(code, (before.get(code) || 0) + 1);
    if (sheet.has(k)) kept.set(code, (kept.get(code) || 0) + 1);
    if (day > (lastKnown.get(code) || "")) lastKnown.set(code, day);
  }
  const read = new Set(parsedStores);
  const suspended = new Map<string, string>(); // loja → mensagem
  const safe = new Set<string>();
  for (const [code, count] of before) {
    const still = kept.get(code) || 0;
    if (!read.has(code)) issues.push({ tab: code, row: null, message: "Separador desta loja não encontrado ou não lido: os dados já importados ficam como estão." });
    else if (still < count * MIN_SHARE_FOR_REMOVALS) suspended.set(code, `Só ${still} dos ${count} dia(s) já importados desta loja continuam na folha: nada foi apagado nem alterado até ${lastKnown.get(code)}`);
    else safe.add(code);
  }

  const held = new Map<string, number>();
  for (const [k, d] of sheet) {
    const reason = protectedDays.get(k);
    // Sem mudanças desde a última importação.
    if (!reason && stored.get(k) === d.hash) continue;
    // Dia com formulário: só vai à BD se ainda tiver registos da folha (que saem).
    if (reason === "form" && !imported.has(k) && !stored.has(k)) continue;
    // Dia corrigido por um Gestor: só se reenvia (para aparecer como mantido) quando a folha mudou.
    if (reason === "edited" && stored.get(k) === d.hash) continue;
    // Loja suspensa: só os dias com formulário e os dias depois do último já importado.
    if (suspended.has(d.store_code) && reason !== "form" && d.day <= lastKnown.get(d.store_code)!) {
      held.set(d.store_code, (held.get(d.store_code) || 0) + 1);
      continue;
    }
    changes.push({ store_code: d.store_code, day: d.day, hash: d.hash, rows: d.rows });
  }
  for (const [code, message] of suspended)
    issues.push({ tab: code, row: null, message: `${message}${held.get(code) ? ` (${held.get(code)} dia(s) da folha ficaram por importar)` : ""}.` });

  // Dias que saíram da folha: só nas lojas seguras.
  for (const k of known) {
    if (sheet.has(k)) continue;
    const [store_code, day] = k.split("|");
    const reason = protectedDays.get(k);
    // Dia com formulário que ainda tem registos da folha: saem sempre (o formulário ganha), mesmo numa loja
    // suspensa ou sem separador; a BD só retira os registos da folha desse dia.
    const send = reason === "form" ? imported.has(k) || safe.has(store_code) : reason !== "edited" && safe.has(store_code);
    if (send) changes.push({ store_code, day, hash: EMPTY_HASH, rows: null });
  }
  return { changes, issues };
}
