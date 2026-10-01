import "server-only";
import { localDate, shift, type Period } from "./periods";
import { number, type Row } from "./model";

// Shopify Admin API, read-only. Requires a custom app token with
// read_reports (ShopifyQL) and read_orders.
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export function shopifyConfigured() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) throw new Error("Ligação Shopify por configurar.");
  let response: Response;
  try {
    response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
  } catch { throw new Error("Consulta Shopify interrompida ou excedeu o tempo disponível."); }
  if (!response.ok) throw new Error(`Shopify indisponível (HTTP ${response.status}).`);
  const json = await response.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length || !json.data) throw new Error(`Shopify recusou a consulta: ${json.errors?.[0]?.message || "sem dados"}.`);
  return json.data;
}

export async function shopSettings() {
  const d = await graphql<{ shop: { ianaTimezone: string; currencyCode: string } }>("query { shop { ianaTimezone currencyCode } }");
  return d.shop;
}

// ShopifyQL returns rows keyed by column name with string values.
export async function shopifyql(query: string): Promise<Row[]> {
  const d = await graphql<{ shopifyqlQuery: { tableData: { rows: Row[] } | null; parseErrors: unknown[] } }>(
    "query ShopifyQL($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }", { q: query });
  if (d.shopifyqlQuery.parseErrors?.length || !d.shopifyqlQuery.tableData) throw new Error("ShopifyQL recusou a consulta.");
  return d.shopifyqlQuery.tableData.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "day" || k === "product_title" ? v : number(v) ?? v])));
}

export const SALES_FIELDS = ["orders", "gross_sales", "discounts", "returns", "net_sales", "taxes", "shipping_charges", "total_sales", "average_order_value"];
export const SESSION_FIELDS = ["sessions", "online_store_visitors", "sessions_with_cart_additions", "sessions_that_reached_checkout", "sessions_that_completed_checkout", "conversion_rate"];
export const FULFILLMENT_FIELDS = ["orders_fulfilled", "orders_shipped", "orders_delivered"];

export function dailyQuery(table: "sales" | "sessions" | "fulfillments", fields: string[], p: Period) {
  return `FROM ${table} SHOW ${fields.join(", ")} TIMESERIES day SINCE ${p.from} UNTIL ${p.to}`;
}
export function totalsQuery(fields: string[], p: Period) {
  return `FROM sales SHOW ${fields.join(", ")} SINCE ${p.from} UNTIL ${p.to}`;
}
export function productsQuery(p: Period) {
  return `FROM sales SHOW orders, net_sales GROUP BY product_title SINCE ${p.from} UNTIL ${p.to} ORDER BY net_sales DESC LIMIT 50`;
}

const ORDERS = `query Orders($after: String, $filter: String!) {
  orders(first: 100, after: $after, sortKey: CREATED_AT, query: $filter) {
    nodes { id name createdAt updatedAt cancelledAt test sourceName displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      totalReceivedSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      totalOutstandingSet { shopMoney { amount currencyCode } }
      shippingAddress { city countryCodeV2 } }
    pageInfo { hasNextPage endCursor } } }`;

type Money = { shopMoney: { amount: string; currencyCode: string } } | null;
type OrderNode = {
  id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; test: boolean; sourceName: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null;
  totalPriceSet: Money; currentTotalPriceSet: Money; totalReceivedSet: Money; totalRefundedSet: Money; totalOutstandingSet: Money;
  shippingAddress: { city: string | null; countryCodeV2: string | null } | null;
};

// Orders created on each Lisbon day of the period, with complete pagination.
// No customer names, emails, phones or full addresses are collected.
export async function ordersByDay(p: Period): Promise<Map<string, Row[]>> {
  const filter = `created_at:>=${shift(p.from, -1)} created_at:<=${shift(p.to, 1)}`;
  const byDay = new Map<string, Row[]>();
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const d: { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await graphql(ORDERS, { after, filter });
    for (const o of d.orders.nodes) {
      const date = localDate(new Date(o.createdAt));
      if (o.test || date < p.from || date > p.to) continue;
      const amount = (m: Money) => number(m?.shopMoney.amount);
      const row: Row = {
        id: o.id, name: o.name, created_at: o.createdAt, created_date: date, updated_at: o.updatedAt, cancelled_at: o.cancelledAt,
        financial_status: o.displayFinancialStatus, fulfillment_status: o.displayFulfillmentStatus, source_name: o.sourceName,
        total: amount(o.totalPriceSet), current_total: amount(o.currentTotalPriceSet), received: amount(o.totalReceivedSet),
        refunded: amount(o.totalRefundedSet), outstanding: amount(o.totalOutstandingSet),
        currency: o.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
        city: o.shippingAddress?.city ?? null, country: o.shippingAddress?.countryCodeV2 ?? null,
      };
      byDay.set(date, [...(byDay.get(date) || []), row]);
    }
    if (!d.orders.pageInfo.hasNextPage) return byDay;
    after = d.orders.pageInfo.endCursor;
  }
  throw new Error("Cobertura incompleta: limite de paginação Shopify atingido.");
}
