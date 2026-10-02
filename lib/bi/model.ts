import { dates, type Period } from "./periods";
export type Row = Record<string, unknown>;
export type Daily = {
  source: string;
  metric_date: string;
  metrics: Row;
  fetched_at: string;
  status: string;
  run_id: string;
};
export type Dataset = {
  source: string;
  dataset: string;
  period_start: string;
  period_end: string;
  rows: Row[];
  metadata: Row;
  fetched_at: string;
  status: string;
  run_id: string;
};
export type Quality = {
  id?: string;
  metric_date: string;
  code: string;
  severity: string;
  message: string;
  evidence: Row;
  created_at: string;
  run_id: string;
};
export type Report = {
  id: string;
  period_type: string;
  period_start: string;
  period_end: string;
  version: number;
  title: string;
  summary: string;
  recommendations: {
    priority: string;
    title: string;
    detail: string;
    evidence: string[];
  }[];
  status: string;
  created_at: string;
  run_id: string;
};
export type Store = {
  daily: Daily[];
  datasets: Dataset[];
  quality: Quality[];
  reports: Report[];
  runs: Row[];
  errors: string[];
  mode: "stored" | "live" | "unavailable";
};
export type Metric = {
  value: number | null;
  source: string;
  field: string;
  fetchedAt: string | null;
  note: string;
  coverage: string;
  basis: "period" | "daily" | "missing";
};
export function number(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (
    typeof v === "string" &&
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())
  )
    return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function sum(rows: Row[], field: string): number | null {
  if (!rows.length) return null;
  const ns = rows.map((r) => number(r[field]));
  return ns.some((n) => n === null)
    ? null
    : ns.reduce<number>((a, n) => a + n!, 0);
}
export function ratio(a: number | null, b: number | null): number | null {
  return a === null || b === null || b <= 0 ? null : a / b;
}
export function plus(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}
export function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null || b === 0
    ? null
    : ((a - b) / Math.abs(b)) * 100;
}
const usable = (status: string) => !["failed", "running", "partial"].includes(status);
export function exact(
  store: Store,
  p: Period,
  source: string,
  dataset: string,
): Dataset | null {
  return (
    store.datasets
      .filter(
        (d) =>
          d.source === source &&
          d.dataset === dataset &&
          d.period_start === p.from &&
          d.period_end === p.to &&
          usable(d.status),
      )
      .sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at))[0] ||
    null
  );
}
export function metric(
  store: Store,
  p: Period,
  source: string,
  field: string,
  additive = true,
): Metric {
  const days = dates(p),
    rows = store.daily.filter(
      (r) =>
        r.source === source &&
        r.metric_date >= p.from &&
        r.metric_date <= p.to &&
        usable(r.status),
    );
  const ds = exact(store, p, source, "period_totals");
  const base: Metric = {
    value: null,
    source,
    field,
    fetchedAt: null,
    note: "Sem dados completos para este período.",
    coverage: `${new Set(rows.map((r) => r.metric_date)).size}/${days.length} dias`,
    basis: "missing",
  };
  const newestDaily =
    rows.map((r) => Date.parse(r.fetched_at)).sort((a, b) => b - a)[0] || 0;
  const total = ds?.rows.length === 1 ? number(ds.rows[0][field]) : null;
  // A distinct-user total or official AOV is never replaced by a sum of days.
  if (
    total !== null &&
    ds &&
    (!additive || Date.parse(ds.fetched_at) >= newestDaily)
  ) {
    const mismatch =
      (ds.metadata.currency && ds.metadata.currency !== "EUR") ||
      (ds.metadata.timezone && ds.metadata.timezone !== "Europe/Lisbon");
    if (mismatch)
      return { ...base, note: "Moeda ou fuso incompatível; valor suspenso." };
    return {
      ...base,
      value: total,
      fetchedAt: ds.fetched_at,
      basis: "period",
      coverage: "Período completo",
      note:
        !ds.metadata.timezone || !ds.metadata.currency
          ? "Provisório · moeda/fuso sem evidência no registo."
          : newestDaily > Date.parse(ds.fetched_at)
            ? "Provisório · total do período anterior à última revisão diária."
            : "Provisório · total consultado para o período.",
    };
  }
  if (!additive && days.length > 1)
    return {
      ...base,
      note: "Requer consulta oficial de todo o período; não se somam valores diários.",
    };
  const unique = new Set(rows.map((r) => r.metric_date));
  if (
    rows.length !== days.length ||
    unique.size !== days.length ||
    !days.every((d) => unique.has(d))
  )
    return base;
  const value = sum(
    rows.map((r) => r.metrics),
    field,
  );
  return {
    ...base,
    value,
    basis: value === null ? "missing" : "daily",
    fetchedAt:
      rows
        .map((r) => r.fetched_at)
        .sort()
        .at(-1) || null,
    note:
      value === null
        ? "Campo em falta em pelo menos um dia."
        : "Provisório · cobertura diária completa; recolha não certifica tracking.",
  };
}
export function overview(store: Store, p: Period) {
  const get = (source: string, field: string, additive = true) =>
    metric(store, p, source, field, additive);
  const sales = get("shopify_sales", "total_sales"),
    orders = get("shopify_sales", "orders"),
    aov = get("shopify_sales", "average_order_value", false);
  const meta = get("meta", "spend"),
    google = get("google_ads", "spend"),
    spend = plus(meta.value, google.value);
  const sessions = get("shopify_sessions", "sessions"),
    checkouts = get("shopify_sessions", "sessions_that_reached_checkout"),
    completed = get("shopify_sessions", "sessions_that_completed_checkout");
  return {
    sales,
    orders,
    aov,
    meta,
    google,
    spend,
    mer: ratio(sales.value, spend),
    sessions,
    checkouts,
    completed,
    conversion: ratio(completed.value, sessions.value),
    cart: get("shopify_sessions", "sessions_with_cart_additions"),
    users: get("ga4", "totalusers", false),
    activeUsers: get("ga4", "active_users", false),
    gaSessions: get("ga4", "sessions"),
    gaPurchases: get("ga4", "ecommerce_purchases"),
    gaRevenue: get("ga4", "purchase_revenue"),
    fulfilled: get("shopify_fulfillments", "orders_fulfilled"),
    shipped: get("shopify_fulfillments", "orders_shipped"),
    delivered: get("shopify_fulfillments", "orders_delivered"),
    composition: [
      "gross_sales",
      "discounts",
      "returns",
      "net_sales",
      "taxes",
      "shipping_charges",
    ].map((field) => get("shopify_sales", field)),
  };
}
export type Detail = {
  rows: Row[];
  complete: boolean;
  note: string;
  fetchedAt: string | null;
  datasets: Dataset[];
};
export function detail(
  store: Store,
  p: Period,
  source: string,
  dataset: string,
  allowDaily = false,
): Detail {
  const ds = exact(store, p, source, dataset);
  const valid = (d: Dataset) =>
    d.metadata.complete !== false &&
    (d.metadata.currency === undefined || d.metadata.currency === "EUR") &&
    (d.metadata.timezone === undefined ||
      d.metadata.timezone === "Europe/Lisbon");
  const paginationComplete = (d: Dataset) =>
    !["orders", "abandoned"].includes(dataset) || d.metadata.complete === true;
  if (ds)
    return {
      rows: ds.rows,
      complete: valid(ds) && paginationComplete(ds),
      note:
        valid(ds) && paginationComplete(ds)
          ? "Período completo · dados provisórios"
          : "Cobertura ou metadados incompletos",
      fetchedAt: ds.fetched_at,
      datasets: [ds],
    };
  if (allowDaily) {
    const each = dates(p).map((day) =>
      exact(store, { from: day, to: day }, source, dataset),
    );
    const found = each.filter((d): d is Dataset => !!d);
    return {
      rows: found.flatMap((d) => d.rows),
      complete:
        found.length === each.length &&
        found.every((d) => valid(d) && paginationComplete(d)),
      note: `${found.length}/${each.length} dias recolhidos · versões diárias`,
      fetchedAt:
        found
          .map((d) => d.fetched_at)
          .sort()
          .at(-1) || null,
      datasets: found,
    };
  }
  return {
    rows: [],
    complete: false,
    note: "Sem detalhe para todo o período selecionado.",
    fetchedAt: null,
    datasets: [],
  };
}
export function canonicalOrders(d: Detail): Detail {
  const map = new Map<string, Row>();
  let duplicates = 0;
  for (const r of d.rows) {
    const id = String(r.id || "")
      .split("/")
      .at(-1);
    if (!id) continue;
    if (map.has(id)) {
      duplicates++;
      if (String(r.updated_at || "") <= String(map.get(id)!.updated_at || ""))
        continue;
    }
    map.set(id, r);
  }
  return {
    ...d,
    rows: [...map.values()],
    complete: d.complete && duplicates === 0 && map.size === d.rows.length,
    note:
      d.note +
      (duplicates ? ` · ${duplicates} referências repetidas removidas` : ""),
  };
}
// Order status rules shared by the stored and direct views.
export const isPaid = (r: Row) =>
  !r.cancelled_at && ["PAID", "PARTIALLY_REFUNDED"].includes(String(r.financial_status));
export const isPending = (r: Row) =>
  !r.cancelled_at && ["PENDING", "AUTHORIZED", "PARTIALLY_PAID"].includes(String(r.financial_status));
export const awaitingFulfillment = (r: Row) =>
  isPaid(r) && ["UNFULFILLED", "PARTIALLY_FULFILLED", "UNSHIPPED"].includes(String(r.fulfillment_status));
// Cancelled or voided orders have nothing left to prepare.
export const isClosedWithoutPayment = (r: Row) =>
  !!r.cancelled_at || String(r.financial_status) === "VOIDED";

// One row per campaign: spend, conversions and attributed value summed over
// ads and days. Rows without a valid number keep the campaign total unknown.
export function byCampaign(rows: Row[], fields: string[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.campaign_id || r.campaign || "—");
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.values()]
    .map((g): Row => ({
      campaign: g[0].campaign,
      campaign_id: g[0].campaign_id,
      ads: new Set(g.map((r) => r.ad_id).filter(Boolean)).size,
      ...Object.fromEntries(fields.map((f) => [f, sum(g, f)])),
    }))
    .sort((a, b) => (number(b.spend) || 0) - (number(a.spend) || 0));
}
export function unpaidAmount(r: Row): number | null {
  const explicit = number(r.outstanding);
  if (explicit !== null) return Math.max(0, explicit);
  const total = number(r.current_total),
    received = number(r.received),
    refunded = number(r.refunded);
  return total === null || received === null || refunded === null
    ? null
    : Math.max(0, total - received + refunded);
}
export function latestQuality(store: Store, p: Period): Quality[] {
  const m = new Map<string, Quality>();
  for (const q of [...store.quality].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  ))
    if (
      q.metric_date >= p.from &&
      q.metric_date <= p.to &&
      !m.has(`${q.metric_date}:${q.code}`)
    )
      m.set(`${q.metric_date}:${q.code}`, q);
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return [...m.values()].sort(
    (a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1),
  );
}
export function trackingCheck(orders: Detail, ga: Detail) {
  const aliases = new Map<string, Set<string>>();
  for (const o of orders.rows) {
    const id = String(o.id || "")
      .split("/")
      .at(-1)!;
    for (const a of [id, String(o.name || "")])
      if (a) {
        const ids = aliases.get(a) || new Set<string>();
        ids.add(id);
        aliases.set(a, ids);
      }
  }
  const references = new Map<string, Set<string>>();
  let repeatedIds = 0,
    unknown = 0;
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const r of ga.rows) {
    const ref = String(r.transactionid || r.transaction_id || "");
    if (seen.has(ref)) duplicateRows++;
    seen.add(ref);
    if ((number(r.ecommerce_purchases) || 0) > 1) repeatedIds++;
    const ids = aliases.get(ref);
    if (!ids || ids.size !== 1) {
      unknown++;
      continue;
    }
    const id = [...ids][0];
    const refs = references.get(id) || new Set<string>();
    refs.add(ref);
    references.set(id, refs);
  }
  return {
    events: sum(ga.rows, "ecommerce_purchases"),
    matched: references.size,
    alternate: [...references.values()].filter((s) => s.size > 1).length,
    repeatedIds,
    unknown,
    duplicateRows,
    complete: orders.complete && ga.complete,
  };
}

export function financialEvents(store: Store, p: Period) {
  const datasets = store.datasets
    .filter(
      (d) =>
        d.source === "shopify" &&
        d.dataset === "transactions" &&
        d.period_start <= p.to &&
        d.period_end >= p.from,
    )
    .sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at));
  const seen = new Set<string>(),
    rows: Row[] = [];
  let excluded = 0;
  for (const d of datasets)
    for (const r of d.rows) {
      const id = String(r.id || r.transaction_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // A creation timestamp cannot stand in for the payment processing timestamp.
      if (
        typeof r.processed_at !== "string" ||
        !Number.isFinite(Date.parse(r.processed_at))
      ) {
        excluded++;
        continue;
      }
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Lisbon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(r.processed_at));
      if (date < p.from || date > p.to || r.test === true) continue;
      if (r.currency !== "EUR" || number(r.amount) === null) {
        excluded++;
        continue;
      }
      rows.push({ ...r, date });
    }
  return {
    rows,
    excluded,
    fetchedAt: datasets[0]?.fetched_at || null,
    complete: false,
    note: "Eventos observados nas encomendas recolhidas; não certificam a cobertura de todo o registo financeiro.",
  };
}
export function calculatedChecks(store: Store, p: Period) {
  const s = overview(store, p);
  const checks: { label: string; detail: string; warning: boolean }[] = [];
  for (const [source, dataset, total] of [
    ["meta", "ads", s.meta],
    ["google_ads", "campaigns", s.google],
  ] as const) {
    const d = detail(store, p, source, dataset, true);
    const spend = d.complete ? sum(d.rows, "spend") : null;
    if (spend === null || total.value === null)
      checks.push({
        label: `Investimento ${source === "meta" ? "Meta" : "Google"}`,
        detail: "Sem cobertura suficiente para reconciliar detalhe e total.",
        warning: true,
      });
    else {
      const difference = spend - total.value;
      checks.push({
        label: `Investimento ${source === "meta" ? "Meta" : "Google"}`,
        detail: `Detalhe − total: ${difference.toFixed(4)} €; tolerância 0,02 €. ${d.fetchedAt !== total.fetchedAt ? "Recolhas em momentos diferentes." : ""}`,
        warning: Math.abs(difference) > 0.020001,
      });
    }
  }
  const c = Object.fromEntries(s.composition.map((m) => [m.field, m.value]));
  // The direct connector never supplies the sales report; that is a known
  // limitation of the mode, not a divergence that needs attention.
  if (store.mode === "live" && s.composition.every((m) => m.value === null) && s.sales.value === null) {
    checks.push({
      label: "Composição das vendas Shopify",
      detail: "Não aplicável no modo direto: o conector não fornece o relatório de vendas. Disponível com os fechos guardados.",
      warning: false,
    });
    return checks;
  }
  const net = plus(plus(c.gross_sales, c.discounts), c.returns),
    total = plus(plus(c.net_sales, c.taxes), c.shipping_charges);
  checks.push({
    label: "Composição das vendas Shopify",
    detail:
      net === null ||
      total === null ||
      c.net_sales === null ||
      s.sales.value === null
        ? "Campos insuficientes para reconciliar a composição."
        : `Brutas + descontos + reversões − líquidas: ${(net - c.net_sales).toFixed(2)} €. Líquidas + impostos + portes − total: ${(total - s.sales.value).toFixed(2)} €.`,
    warning:
      net === null ||
      total === null ||
      c.net_sales === null ||
      s.sales.value === null ||
      Math.abs(net - c.net_sales) > 0.020001 ||
      Math.abs(total - s.sales.value) > 0.020001,
  });
  return checks;
}
