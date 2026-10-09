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

// Uma loja cuja folha passou a ter menos de metade dos dias já importados não perde nada nesta passagem
// (separador renomeado, colunas mudadas, folha cortada por engano): fica um aviso.
export const MIN_SHARE_FOR_REMOVALS = 0.5;
const EMPTY_HASH = "0".repeat(64);
const key = (d: { store_code: string; day: string }) => `${d.store_code}|${d.day}`;

export function planSheetChanges<R>(sheetDays: PlanDay<R>[], parsedStores: Iterable<string>, state: PlanState): { changes: PlanChange<R>[]; issues: PlanIssue[] } {
  const stored = new Map(state.days.map((d) => [key(d), d.hash]));
  const imported = new Set(state.imported.map(key));
  const protectedDays = new Map(state.protected.map((d) => [key(d), d.reason]));
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

  // Dias que saíram da folha: só nas lojas cujo separador foi lido e não encolheu para menos de metade.
  const known = new Set([...stored.keys(), ...imported]);
  const before = new Map<string, number>();
  for (const k of known) before.set(k.split("|")[0], (before.get(k.split("|")[0]) || 0) + 1);
  const now = new Map<string, number>();
  for (const d of sheet.values()) now.set(d.store_code, (now.get(d.store_code) || 0) + 1);
  const read = new Set(parsedStores);
  const safe = new Set<string>();
  for (const [code, count] of before) {
    const current = now.get(code) || 0;
    if (!read.has(code)) issues.push({ tab: code, row: null, message: "Separador desta loja não encontrado na folha: os dados já importados ficam como estão." });
    else if (current < count * MIN_SHARE_FOR_REMOVALS)
      issues.push({ tab: code, row: null, message: `A folha tem agora ${current} dia(s) desta loja, menos de metade dos ${count} já importados: nada foi apagado.` });
    else safe.add(code);
  }
  for (const k of known) {
    if (sheet.has(k)) continue;
    const [store_code, day] = k.split("|");
    if (safe.has(store_code) && protectedDays.get(k) !== "edited") changes.push({ store_code, day, hash: EMPTY_HASH, rows: null });
  }
  return { changes, issues };
}
