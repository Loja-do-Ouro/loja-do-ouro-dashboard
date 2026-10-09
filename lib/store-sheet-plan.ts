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

// Uma loja em que menos de metade dos dias já importados continua na folha não perde nada nesta passagem
// (separador renomeado ou trocado, outra folha, folha cortada por engano): fica um aviso. Colunas mudadas
// tornam o separador ilegível (store-sheet-rules) e contam como separador não lido.
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

  for (const [k, d] of sheet) {
    const reason = protectedDays.get(k);
    // Sem mudanças desde a última importação.
    if (!reason && stored.get(k) === d.hash) continue;
    // Dia com formulário: só vai à BD se ainda tiver registos da folha (que saem).
    if (reason === "form" && !imported.has(k) && !stored.has(k)) continue;
    // Dia corrigido por um Gestor: só se reenvia (para aparecer como mantido) quando a folha mudou.
    if (reason === "edited" && stored.get(k) === d.hash) continue;
    changes.push({ store_code: d.store_code, day: d.day, hash: d.hash, rows: d.rows });
  }

  // Dias que saíram da folha: só nas lojas cujo separador foi lido e em que pelo menos metade dos dias já
  // importados continua na folha.
  const known = new Set([...stored.keys(), ...imported]);
  const before = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const k of known) {
    const code = k.split("|")[0];
    before.set(code, (before.get(code) || 0) + 1);
    if (sheet.has(k)) kept.set(code, (kept.get(code) || 0) + 1);
  }
  const read = new Set(parsedStores);
  const safe = new Set<string>();
  for (const [code, count] of before) {
    const still = kept.get(code) || 0;
    if (!read.has(code)) issues.push({ tab: code, row: null, message: "Separador desta loja não encontrado ou não lido: os dados já importados ficam como estão." });
    else if (still < count * MIN_SHARE_FOR_REMOVALS)
      issues.push({ tab: code, row: null, message: `Só ${still} dos ${count} dia(s) já importados desta loja continuam na folha: nada foi apagado.` });
    else safe.add(code);
  }
  for (const k of known) {
    if (sheet.has(k)) continue;
    const [store_code, day] = k.split("|");
    const reason = protectedDays.get(k);
    // Dia com formulário que ainda tem registos da folha: saem sempre (o formulário ganha), mesmo numa loja
    // sem remoções; a BD só retira os registos da folha desse dia.
    const send = reason === "form" ? imported.has(k) || safe.has(store_code) : reason !== "edited" && safe.has(store_code);
    if (send) changes.push({ store_code, day, hash: EMPTY_HASH, rows: null });
  }
  return { changes, issues };
}
