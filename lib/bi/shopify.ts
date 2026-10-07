import "server-only";
import { localDate, shift, type Period } from "./periods";
import { number, type Row } from "./model";

// Shopify Admin API, read-only, through an app created in the Shopify Dev Dashboard
// (scopes read_orders, read_all_orders, read_products, read_reports). The app's
// Client ID and secret are exchanged for a 24-hour token (client credentials grant).
// A fixed SHOPIFY_ADMIN_TOKEN from an older admin-created app is still accepted.
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export function shopifyConfigured() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && (process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)));
}

let cached: { token: string; until: number } | null = null;

async function accessToken(domain: string): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cached && cached.until > Date.now()) return cached.token;
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Ligação Shopify por configurar.");
  let r: Response;
  try {
    r = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
    });
  } catch { throw new Error("Pedido de acesso à Shopify interrompido."); }
  const body = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !body.access_token)
    throw new Error(`Shopify recusou o acesso da app (${body.error_description || body.error || `HTTP ${r.status}`}).`);
  // Renew ten minutes before the 24-hour expiry.
  cached = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in || 86399) - 600) * 1000 };
  return cached.token;
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyConfigured()) throw new Error("Ligação Shopify por configurar.");
  const token = await accessToken(domain);
  let response: Response;
  try {
    response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
  } catch { throw new Error("Consulta Shopify interrompida ou excedeu o tempo disponível."); }
  if (response.status === 401) cached = null;
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

// Without approved access to protected customer data, Shopify refuses the address;
// orders are then read without city and country.
const ORDERS_NO_ADDRESS = ORDERS.replace("\n      shippingAddress { city countryCodeV2 } }", " }");
let addressDenied = false;

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
    type Page = { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    let d: Page;
    try {
      d = await graphql<Page>(addressDenied ? ORDERS_NO_ADDRESS : ORDERS, { after, filter });
    } catch (e) {
      if (addressDenied || !/shippingAddress|access|protected|permission/i.test(e instanceof Error ? e.message : "")) throw e;
      addressDenied = true;
      d = await graphql<Page>(ORDERS_NO_ADDRESS, { after, filter });
    }
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

// Apoio ao Cliente: encomendas de um email associado manualmente a uma conversa (até 20, mais recentes).
// Só número, data, total e estados; não lê moradas nem outros dados pessoais. Shopify pode recusar
// o filtro por email sem acesso aprovado a dados protegidos de clientes: o erro é devolvido tal como vem.
export async function ordersByEmail(email: string) {
  type Node = { id: string; name: string; createdAt: string; cancelledAt: string | null; displayFinancialStatus: string | null; displayFulfillmentStatus: string | null; currentTotalPriceSet: Money };
  const d = await graphql<{ orders: { nodes: Node[] } }>(
    `query SupportOrders($q: String!) { orders(first: 20, sortKey: CREATED_AT, reverse: true, query: $q) {
      nodes { id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount currencyCode } } } } }`,
    { q: `email:"${email.replace(/["\\]/g, "")}"` });
  return d.orders.nodes.map((o) => ({
    name: o.name, created_at: o.createdAt, cancelled: Boolean(o.cancelledAt), financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus,
    total: number(o.currentTotalPriceSet?.shopMoney.amount), currency: o.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
    admin_url: `https://admin.shopify.com/store/${(process.env.SHOPIFY_STORE_DOMAIN || "").replace(".myshopify.com", "")}/orders/${o.id.split("/").pop()}`,
  }));
}

// Apoio ao Cliente: produtos, coleções e páginas da loja online para inserir numa resposta.
// Só o que um cliente consegue abrir: produtos ativos/não listados publicados na loja online,
// coleções e páginas publicadas. read_products chega para produtos e coleções; as páginas precisam
// de read_online_store_pages (sem essa autorização ficam de fora, sem erro).
type Money2 = { amount: string; currencyCode: string };
type CatalogProduct = {
  title: string; handle: string; status: string; onlineStoreUrl: string | null;
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
  priceRangeV2: { minVariantPrice: Money2; maxVariantPrice: Money2 };
  totalInventory: number | null; tracksInventory: boolean;
  variants: { nodes: { availableForSale: boolean }[] };
};
type CatalogCollection = { title: string; handle: string; image: { url: string } | null };
type CatalogPage = { title: string; handle: string; isPublished: boolean };
export type CatalogItem = { kind: "product" | "collection" | "page"; title: string; url: string; image: string | null; price: string | null; available: boolean | null };

let storefront: { url: string; scopes: Set<string>; until: number } | null = null;

async function storefrontInfo() {
  if (storefront && storefront.until > Date.now()) return storefront;
  const d = await graphql<{ shop: { primaryDomain: { url: string } | null; url: string }; currentAppInstallation: { accessScopes: { handle: string }[] } }>(
    "query { shop { url primaryDomain { url } } currentAppInstallation { accessScopes { handle } } }");
  storefront = {
    url: (d.shop.primaryDomain?.url || d.shop.url).replace(/\/+$/, ""),
    scopes: new Set(d.currentAppInstallation.accessScopes.map((s) => s.handle)),
    until: Date.now() + 30 * 60 * 1000,
  };
  return storefront;
}

// O texto escrito nunca é interpretado como filtro de pesquisa (status:, published_status:, ...).
export function catalogTerms(text: string) {
  return text.replace(/[:\\()"'*]+/g, " ").replace(/\b(AND|OR|NOT)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const formatPrice = (min: Money2, max: Money2) => {
  const f = (m: Money2) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: m.currencyCode }).format(Number(m.amount));
  return Number(min.amount) === Number(max.amount) ? f(min) : `${f(min)} – ${f(max)}`;
};

export async function searchCatalog(text: string): Promise<{ items: CatalogItem[]; pages: boolean }> {
  const terms = catalogTerms(text);
  if (!terms) return { items: [], pages: false };
  const info = await storefrontInfo();
  const pages = info.scopes.has("read_online_store_pages") || info.scopes.has("read_content");
  const d = await graphql<{ products: { nodes: CatalogProduct[] }; collections: { nodes: CatalogCollection[] }; pages?: { nodes: CatalogPage[] } }>(
    `query Catalog($p: String!, $c: String!${pages ? ", $g: String!" : ""}) {
      products(first: 8, query: $p, sortKey: RELEVANCE) { nodes { title handle status onlineStoreUrl tracksInventory totalInventory
        featuredMedia { preview { image { url(transform: { maxWidth: 320, maxHeight: 320 }) altText } } }
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        variants(first: 20) { nodes { availableForSale } } } }
      collections(first: 4, query: $c, sortKey: RELEVANCE) { nodes { title handle image { url(transform: { maxWidth: 320, maxHeight: 320 }) } } }
      ${pages ? "pages(first: 4, query: $g, sortKey: TITLE) { nodes { title handle isPublished } }" : ""}
    }`,
    {
      p: `(status:active OR status:unlisted) published_status:published ${terms}`,
      c: `published_status:published ${terms}`,
      ...(pages ? { g: `published_status:published ${terms}` } : {}),
    });
  const items: CatalogItem[] = [
    ...d.products.nodes.filter((p) => p.onlineStoreUrl).map((p) => ({
      kind: "product" as const, title: p.title, url: p.onlineStoreUrl!, image: p.featuredMedia?.preview?.image?.url || null,
      price: formatPrice(p.priceRangeV2.minVariantPrice, p.priceRangeV2.maxVariantPrice),
      available: p.variants.nodes.length ? p.variants.nodes.some((v) => v.availableForSale) : null,
    })),
    ...d.collections.nodes.map((c) => ({ kind: "collection" as const, title: c.title, url: `${info.url}/collections/${c.handle}`, image: c.image?.url || null, price: null, available: null })),
    ...(d.pages?.nodes || []).filter((g) => g.isPublished).map((g) => ({ kind: "page" as const, title: g.title, url: `${info.url}/pages/${g.handle}`, image: null, price: null, available: null })),
  ];
  return { items, pages };
}

// Foto de um produto para anexar (só do CDN da Shopify).
export async function catalogImage(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "cdn.shopify.com") throw new Error("Imagem fora do CDN da Shopify recusada.");
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Imagem do produto indisponível (HTTP ${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}
