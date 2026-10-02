// Daily sales of the physical stores. Fields are provisional until the stores'
// Excel template arrives; keep this file the single place that lists them.

export type Sale = {
  id: string;
  sale_date: string;
  total_sales: number;
  receipts: number | null;
  items: number | null;
  cash: number | null;
  card: number | null;
  other_payment: number | null;
  notes: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export const SALE_FIELDS = [
  { name: "total_sales", label: "Total de vendas (€, IVA incluído)", kind: "amount", required: true },
  { name: "receipts", label: "N.º de talões / vendas", kind: "count", required: false },
  { name: "items", label: "N.º de artigos vendidos", kind: "count", required: false },
  { name: "cash", label: "Numerário (€)", kind: "amount", required: false },
  { name: "card", label: "Multibanco / cartão (€)", kind: "amount", required: false },
  { name: "other_payment", label: "Outros pagamentos (€)", kind: "amount", required: false },
] as const;

const INVALID = "invalid" as const;

// Accepts "1234,56", "1.234,56", "1234.56" and "1 234,56 €".
export function parseAmount(value: unknown): number | null | typeof INVALID {
  let v = String(value ?? "").replace(/[\s€ ]/g, "");
  if (!v) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if ((v.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(v)) v = v.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return INVALID;
  const n = Number(v);
  return Number.isFinite(n) && n <= 9_999_999_999 ? n : INVALID;
}

export function parseCount(value: unknown): number | null | typeof INVALID {
  const v = String(value ?? "").replace(/[\s.]/g, "");
  if (!v) return null;
  if (!/^\d{1,9}$/.test(v)) return INVALID;
  return Number(v);
}

export function parseSaleForm(form: FormData) {
  const values: Record<string, number | null> = {};
  for (const f of SALE_FIELDS) {
    const parsed = f.kind === "amount" ? parseAmount(form.get(f.name)) : parseCount(form.get(f.name));
    if (parsed === INVALID) return { error: `Valor inválido em “${f.label}”.` };
    if (f.required && parsed === null) return { error: `Preencha “${f.label}”.` };
    values[f.name] = parsed;
  }
  const notes = String(form.get("notes") || "").trim().slice(0, 1000);
  return { values, notes };
}

const pad = (n: number) => String(n).padStart(2, "0");

// A calendar month as a period, ending today at the latest.
export function monthRange(month: unknown, today: string) {
  const m = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && `${month}-01` <= today ? month : today.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const last = `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}`;
  return { month: m, from: `${m}-01`, to: last < today ? last : today };
}

export function shiftMonth(month: string, delta: number) {
  const [y, mo] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function daysDesc(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${to}T12:00:00Z`); d.toISOString().slice(0, 10) >= from; d.setUTCDate(d.getUTCDate() - 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}

// Difference between the payment split and the total; null when no split was given.
export function paymentGap(s: Pick<Sale, "total_sales" | "cash" | "card" | "other_payment">) {
  const parts = [s.cash, s.card, s.other_payment];
  if (parts.every((p) => p === null || p === undefined)) return null;
  const sum = parts.reduce<number>((a, p) => a + Number(p || 0), 0);
  return Math.round((sum - Number(s.total_sales)) * 100) / 100;
}

export function summarize(rows: Pick<Sale, "total_sales" | "receipts" | "items">[]) {
  const total = rows.reduce((a, r) => a + Number(r.total_sales || 0), 0);
  const withReceipts = rows.filter((r) => r.receipts !== null && r.receipts !== undefined);
  const receipts = withReceipts.reduce((a, r) => a + Number(r.receipts), 0);
  const receiptSales = withReceipts.reduce((a, r) => a + Number(r.total_sales || 0), 0);
  const items = rows.reduce((a, r) => a + Number(r.items || 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    days: rows.length,
    receipts: withReceipts.length ? receipts : null,
    items: rows.some((r) => r.items !== null && r.items !== undefined) ? items : null,
    // Average ticket only over days that reported receipts.
    avgTicket: receipts > 0 ? Math.round((receiptSales / receipts) * 100) / 100 : null,
    avgDay: rows.length ? Math.round((total / rows.length) * 100) / 100 : null,
  };
}

// Short code for a store's address in links, e.g. "Figueira da Foz" → "figueira-da-foz".
export function storeCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
