import { awaitingFulfillment, detail, isPaid, isPending, number, sum, type Row, type Store } from "./model";
import { localDate, type Period } from "./periods";

// Windsor emits reversal rows (order_count=0) alongside the canonical order.
// These must never be mistaken for another order or its observed balance.
export function normalizeOrders(raw: Row[]) {
  const orders = new Map<string, Row>();
  let conflicts = 0, excluded = 0;
  for (const r of raw) {
    if (number(r.order_count) !== 1) { excluded++; continue; }
    const id = String(r.order_id || "").split("/").at(-1);
    const created = String(r.order_created_at || "");
    if (!id || !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(created) || !Number.isFinite(Date.parse(created))) {
      excluded++; continue;
    }
    const date = localDate(new Date(created));
    const row: Row = {
      id, name: r.order_name, created_at: created, created_date: date, date,
      updated_at: r.order_updated_at, cancelled_at: r.order_cancelled_at,
      financial_status: r.order_financial_status, fulfillment_status: r.order_fulfillment_status,
      current_total: number(r.order_current_total_price), net_payment: number(r.order_net_payment),
      currency: r.order_currency, city: r.order_shipping_address_city, country: r.order_shipping_address_country,
      source_name: r.order_source_name,
      utm_campaign: r.order_customer_last_visit_utm_campaign,
      utm_source: r.order_customer_last_visit_utm_source,
      utm_medium: r.order_customer_last_visit_utm_medium,
    };
    const existing = orders.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) conflicts++;
    if (!existing || String(row.updated_at) > String(existing.updated_at)) orders.set(id, row);
  }
  return { rows: [...orders.values()], conflicts, excluded };
}

export function liveCommerce(store: Store, range: Period) {
  const d = detail(store, range, "shopify_live", "orders");
  const safe = d.datasets.length > 0 && d.datasets.every(x => x.metadata.conflicts === 0)
    && d.rows.every(r => r.currency === "EUR" && number(r.current_total) !== null);
  const paid = d.rows.filter(isPaid);
  const pending = d.rows.filter(isPending);
  const ready = d.rows.filter(awaitingFulfillment);
  const paidValue = safe && d.rows.length ? (paid.length ? sum(paid, "current_total") : 0) : null;
  return {
    ...d, safe, paid, pending, ready, paidValue,
    // Empty connector responses are not proof that a period had no orders.
    count: safe && d.rows.length ? d.rows.length : null,
    paidCount: safe && d.rows.length ? paid.length : null,
    pendingCount: safe && d.rows.length ? pending.length : null,
    readyCount: safe && d.rows.length ? ready.length : null,
    note: "Shopify via Windsor · encomendas recolhidas pela data de criação em Portugal. Estado observado na consulta; cobertura não certificada. Não representa pagamentos ocorridos no período nem o relatório oficial de vendas.",
  };
}
