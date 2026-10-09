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

// Apoio ao Cliente: encomendas de um cliente (até 20, mais recentes) com os produtos comprados e o
// telemóvel registado na loja. O telemóvel é um dado protegido de clientes: sem essa autorização na app
// Shopify (e read_customers para o telemóvel da ficha do cliente) as encomendas vêm na mesma, sem ele,
// e phoneNote explica o que falta. Não lê moradas.
type StaffOrderNode = {
  id: string; name: string; createdAt: string; cancelledAt: string | null; displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null; statusPageUrl: string | null; currentTotalPriceSet: Money;
  lineItems: { nodes: { name: string; title: string; variantTitle: string | null; quantity: number; sku: string | null;
    originalUnitPriceSet: Money; image: { url: string } | null }[] };
  phone?: string | null; shippingAddress?: { phone: string | null } | null;
  customer?: { defaultPhoneNumber: { phoneNumber: string } | null } | null;
};
export type StaffOrder = {
  name: string; created_at: string; cancelled: boolean; financial: string | null; fulfillment: string | null;
  total: number | null; currency: string | null; admin_url: string; status_url: string | null; phone: string | null;
  items: { name: string; variant: string | null; quantity: number; sku: string | null; price: number | null; currency: string | null; image: string | null }[];
};
const STAFF_ORDER_BASE = `id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus statusPageUrl
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 30) { nodes { name title variantTitle quantity sku originalUnitPriceSet { shopMoney { amount currencyCode } }
    image { url(transform: { maxWidth: 96, maxHeight: 96 }) } } }`;
// Do mais completo ao mais simples; fica em memória o nível que a Shopify aceitou (revisto a cada 10 min).
const CONTACT_LEVELS = [
  { fields: "phone shippingAddress { phone } customer { defaultPhoneNumber { phoneNumber } }", note: null },
  { fields: "phone shippingAddress { phone }", note: "Telemóvel da ficha de cliente indisponível: a app Shopify do dashboard não tem a autorização read_customers." },
  { fields: "", note: "Telemóvel indisponível: a app Shopify do dashboard ainda não tem acesso aos dados protegidos de clientes (telefone)." },
];
let contactLevel = { index: 0, until: 0 };

async function staffOrders(query: string, first: number): Promise<{ orders: StaffOrder[]; phoneNote: string | null }> {
  let index = contactLevel.until > Date.now() ? contactLevel.index : 0;
  for (;;) {
    const level = CONTACT_LEVELS[index];
    try {
      const d = await graphql<{ orders: { nodes: StaffOrderNode[] } }>(
        `query SupportOrders($q: String!, $n: Int!) { orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) { nodes { ${STAFF_ORDER_BASE} ${level.fields} } } }`,
        { q: query, n: first });
      // O prazo só começa quando o nível muda: passado ele, volta a tentar-se a consulta completa.
      if (index > 0 && (contactLevel.index !== index || contactLevel.until <= Date.now())) contactLevel = { index, until: Date.now() + 10 * 60 * 1000 };
      const store = (process.env.SHOPIFY_STORE_DOMAIN || "").replace(".myshopify.com", "");
      return {
        phoneNote: level.note,
        orders: d.orders.nodes.map((o) => ({
          name: o.name, created_at: o.createdAt, cancelled: Boolean(o.cancelledAt), financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus,
          total: number(o.currentTotalPriceSet?.shopMoney.amount), currency: o.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
          admin_url: `https://admin.shopify.com/store/${store}/orders/${o.id.split("/").pop()}`, status_url: o.statusPageUrl,
          phone: o.phone || o.shippingAddress?.phone || o.customer?.defaultPhoneNumber?.phoneNumber || null,
          items: o.lineItems.nodes.map((l) => ({
            name: l.title || l.name, variant: l.variantTitle && l.variantTitle !== "Default Title" ? l.variantTitle : null, quantity: l.quantity,
            sku: l.sku || null, price: number(l.originalUnitPriceSet?.shopMoney.amount), currency: l.originalUnitPriceSet?.shopMoney.currencyCode ?? null,
            image: l.image?.url || null,
          })),
        })),
      };
    } catch (e) {
      const denied = /access|protected|permission|scope|customer|phone|shippingAddress/i.test(e instanceof Error ? e.message : "");
      if (!denied || index >= CONTACT_LEVELS.length - 1) throw e;
      index++;
    }
  }
}

export async function ordersByEmail(email: string) {
  return staffOrders(`email:"${email.replace(/["\\]/g, "")}"`, 20);
}

// Uma encomenda pelo número (ex.: mencionada pelo cliente na conversa), para a equipa. belongs diz se é do
// email do contacto; se não for, a equipa confirma a identidade antes de partilhar dados.
export async function staffOrderByNumber(number: string, email: string | null) {
  const digits = number.replace(/\D/g, "").slice(0, 12);
  if (!digits) return { order: null, belongs: false, phoneNote: null };
  const name = `name:"#${digits}"`;
  if (email) {
    const own = await staffOrders(`${name} email:"${email.replace(/["\\]/g, "")}"`, 1);
    if (own.orders[0]) return { order: own.orders[0], belongs: true, phoneNote: own.phoneNote };
  }
  const any = await staffOrders(name, 1);
  return { order: any.orders[0] || null, belongs: false, phoneNote: any.phoneNote };
}

// Apoio ao Cliente: produtos, coleções e páginas da loja online para inserir numa resposta.
// Só o que um cliente consegue abrir: produtos ativos/não listados publicados na loja online,
// coleções e páginas publicadas. read_products chega para produtos e coleções; as páginas precisam
// de read_online_store_pages (sem essa autorização ficam de fora, sem erro).
type Money2 = { amount: string; currencyCode: string };
type CatalogProduct = {
  title: string; handle: string; status: string; onlineStoreUrl: string | null;
  featuredMedia: { preview: { image: { url: string; photo: string; altText: string | null } | null } | null } | null;
  priceRangeV2: { minVariantPrice: Money2; maxVariantPrice: Money2 };
  totalInventory: number | null; tracksInventory: boolean;
  variants: { pageInfo: { hasNextPage: boolean }; nodes: { availableForSale: boolean }[] };
};
type CatalogCollection = { title: string; handle: string; image: { url: string } | null };
type CatalogPage = { title: string; handle: string; isPublished: boolean };
// image: miniatura; photo: fotografia para anexar (JPEG até 1600 px, gerada pela Shopify).
export type CatalogItem = { kind: "product" | "collection" | "page"; title: string; url: string; image: string | null; photo: string | null; price: string | null; available: boolean | null };

let storefront: { url: string; pages: boolean; until: number } | null = null;
const PAGE_SCOPES = ["read_online_store_pages", "write_online_store_pages", "read_content", "write_content"];

async function storefrontInfo() {
  if (storefront && storefront.until > Date.now()) return storefront;
  const d = await graphql<{ shop: { primaryDomain: { url: string } | null; url: string }; currentAppInstallation: { accessScopes: { handle: string }[] } }>(
    "query { shop { url primaryDomain { url } } currentAppInstallation { accessScopes { handle } } }");
  const scopes = new Set(d.currentAppInstallation.accessScopes.map((s) => s.handle));
  const pages = PAGE_SCOPES.some((h) => scopes.has(h));
  // Sem a autorização das páginas volta a verificar-se em 2 minutos (pode ter acabado de ser aprovada).
  storefront = { url: (d.shop.primaryDomain?.url || d.shop.url).replace(/\/+$/, ""), pages, until: Date.now() + (pages ? 30 : 2) * 60 * 1000 };
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
  const run = (pages: boolean) => graphql<{ products: { nodes: CatalogProduct[] }; collections: { nodes: CatalogCollection[] }; pages?: { nodes: CatalogPage[] } }>(
    `query Catalog($p: String!, $c: String!${pages ? ", $g: String!" : ""}) {
      products(first: 8, query: $p, sortKey: RELEVANCE) { nodes { title handle status onlineStoreUrl tracksInventory totalInventory
        featuredMedia { preview { image { url(transform: { maxWidth: 320, maxHeight: 320 }) photo: url(transform: { maxWidth: 1600, maxHeight: 1600, preferredContentType: JPG }) altText } } }
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        variants(first: 20) { pageInfo { hasNextPage } nodes { availableForSale } } } }
      collections(first: 4, query: $c, sortKey: RELEVANCE) { nodes { title handle image { url(transform: { maxWidth: 320, maxHeight: 320 }) } } }
      ${pages ? "pages(first: 4, query: $g, sortKey: TITLE) { nodes { title handle isPublished } }" : ""}
    }`,
    {
      p: `(status:active OR status:unlisted) published_status:published ${terms}`,
      c: `published_status:published ${terms}`,
      ...(pages ? { g: `published_status:published ${terms}` } : {}),
    });
  let pages = info.pages;
  let d: Awaited<ReturnType<typeof run>>;
  try {
    d = await run(pages);
  } catch (e) {
    // Uma recusa das páginas não pode impedir a pesquisa de produtos.
    if (!pages) throw e;
    pages = false;
    storefront = { ...info, pages: false, until: Date.now() + 2 * 60 * 1000 };
    d = await run(false);
  }
  const items: CatalogItem[] = [
    ...d.products.nodes.filter((p) => p.onlineStoreUrl).map((p) => ({
      kind: "product" as const, title: p.title, url: p.onlineStoreUrl!, image: p.featuredMedia?.preview?.image?.url || null,
      photo: p.featuredMedia?.preview?.image?.photo || null,
      price: formatPrice(p.priceRangeV2.minVariantPrice, p.priceRangeV2.maxVariantPrice),
      // "Esgotado" só quando todas as variantes foram vistas; lista incompleta = desconhecido.
      available: p.variants.nodes.some((v) => v.availableForSale) ? true : p.variants.nodes.length && !p.variants.pageInfo.hasNextPage ? false : null,
    })),
    ...d.collections.nodes.map((c) => ({ kind: "collection" as const, title: c.title, url: `${info.url}/collections/${c.handle}`, image: c.image?.url || null, photo: null, price: null, available: null })),
    ...(d.pages?.nodes || []).filter((g) => g.isPublished).map((g) => ({ kind: "page" as const, title: g.title, url: `${info.url}/pages/${g.handle}`, image: null, photo: null, price: null, available: null })),
  ];
  return { items, pages };
}

// Foto de um produto para anexar: só ficheiros de lojas no CDN da Shopify, já reduzida pela Shopify,
// sem seguir redirecionamentos e com o tamanho limitado enquanto é lida.
export async function catalogImage(url: string, max = 4 * 1024 * 1024) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "cdn.shopify.com" || !u.pathname.startsWith("/s/files/"))
    throw new Error("Imagem fora do CDN da Shopify recusada.");
  if (!u.searchParams.has("width")) u.searchParams.set("width", "1600");
  const r = await fetch(u, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!r.ok || !r.body) throw new Error(`Imagem do produto indisponível (HTTP ${r.status}).`);
  if (Number(r.headers.get("content-length") || 0) > max) {
    await r.body.cancel();
    throw new Error("Imagem do produto demasiado grande.");
  }
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      throw new Error("Imagem do produto demasiado grande.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------- Assistente de IA do apoio
// Só leituras. Encomendas sempre filtradas pelo email do cliente da conversa (nunca escolhido pela IA).

const money = (m: Money2 | null | undefined) =>
  m ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: m.currencyCode }).format(Number(m.amount)) : null;

export type SupportOrder = {
  numero: string; data: string; cancelada: string | null; pagamento: string | null; envio: string | null; devolucao: string | null;
  total: string | null; portes: string | null; artigos: string[]; pagina_do_cliente: string | null;
  expedicoes?: { estado: string | null; enviada: string; entregue: string | null; entrega_prevista: string | null; seguimento: { transportadora: string | null; numero: string | null; url: string | null }[] }[];
};
type AiOrderNode = {
  name: string; createdAt: string; cancelledAt: string | null; cancelReason: string | null; displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null; returnStatus: string | null; statusPageUrl: string | null;
  currentTotalPriceSet: { shopMoney: Money2 } | null; shippingLine: { title: string } | null;
  lineItems: { nodes: { name: string; quantity: number }[] };
  fulfillments?: { displayStatus: string | null; createdAt: string; deliveredAt: string | null; estimatedDeliveryAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
};
const ORDER_FIELDS = `name createdAt cancelledAt cancelReason displayFinancialStatus displayFulfillmentStatus returnStatus statusPageUrl
  currentTotalPriceSet { shopMoney { amount currencyCode } } shippingLine { title } lineItems(first: 15) { nodes { name quantity } }`;
const FULFILLMENT_FIELDS_AI = "fulfillments(first: 5) { displayStatus createdAt deliveredAt estimatedDeliveryAt trackingInfo(first: 3) { company number url } }";
// Sem autorização para as expedições, as encomendas são lidas sem elas (não falha a consulta toda).
let fulfillmentsDenied = false;

const emailFilter = (email: string) => `email:"${email.replace(/["\\]/g, "")}"`;

async function aiOrders(query: string, first: number): Promise<SupportOrder[]> {
  const run = (withFulfillments: boolean) => graphql<{ orders: { nodes: AiOrderNode[] } }>(
    `query AiOrders($q: String!, $n: Int!) { orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) {
      nodes { ${ORDER_FIELDS} ${withFulfillments ? FULFILLMENT_FIELDS_AI : ""} } } }`, { q: query, n: first });
  let d: { orders: { nodes: AiOrderNode[] } };
  try {
    d = await run(!fulfillmentsDenied);
  } catch (e) {
    if (fulfillmentsDenied || !/fulfil|access|permission|scope/i.test(e instanceof Error ? e.message : "")) throw e;
    fulfillmentsDenied = true;
    d = await run(false);
  }
  return d.orders.nodes.map((o) => ({
    numero: o.name, data: o.createdAt, cancelada: o.cancelledAt ? `${o.cancelledAt}${o.cancelReason ? ` (${o.cancelReason})` : ""}` : null,
    pagamento: o.displayFinancialStatus, envio: o.displayFulfillmentStatus, devolucao: o.returnStatus === "NO_RETURN" ? null : o.returnStatus,
    total: money(o.currentTotalPriceSet?.shopMoney), portes: o.shippingLine?.title ?? null,
    artigos: o.lineItems.nodes.map((l) => `${l.quantity} × ${l.name}`),
    pagina_do_cliente: o.statusPageUrl,
    ...(o.fulfillments ? {
      expedicoes: o.fulfillments.map((f) => ({
        estado: f.displayStatus, enviada: f.createdAt, entregue: f.deliveredAt, entrega_prevista: f.estimatedDeliveryAt,
        seguimento: f.trackingInfo.map((t) => ({ transportadora: t.company, numero: t.number, url: t.url })),
      })),
    } : {}),
  }));
}

// Encomendas recentes (até 10) dos emails do cliente da conversa.
export async function supportCustomerOrders(emails: string[]) {
  const out: SupportOrder[] = [];
  for (const email of emails.slice(0, 2)) out.push(...(await aiOrders(emailFilter(email), 10)));
  const seen = new Set<string>();
  return out.filter((o) => !seen.has(o.numero) && seen.add(o.numero)).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10);
}

// Uma encomenda pelo número. Os detalhes só saem se a encomenda for de um dos emails do cliente;
// caso contrário diz-se apenas se existe (sem dados de outra pessoa).
export async function supportOrderByNumber(number: string, emails: string[]) {
  const digits = number.replace(/\D/g, "").slice(0, 12);
  if (!digits) return { encontrada: false, nota: "Número de encomenda inválido." };
  const name = `name:"#${digits}"`;
  for (const email of emails.slice(0, 2)) {
    const [o] = await aiOrders(`${name} ${emailFilter(email)}`, 1);
    if (o) return { encontrada: true, deste_cliente: true, encomenda: o };
  }
  const exists = await graphql<{ orders: { nodes: { name: string }[] } }>(
    "query AiOrderExists($q: String!) { orders(first: 1, query: $q) { nodes { name } } }", { q: name });
  if (!exists.orders.nodes.length) return { encontrada: false, nota: `Não existe a encomenda #${digits}.` };
  return {
    encontrada: true, deste_cliente: false,
    nota: emails.length
      ? `A encomenda #${digits} existe mas não está no email deste cliente. Não divulgar dados da encomenda sem confirmar a identidade (por exemplo, pedir o email usado na compra e associá-lo no painel Cliente).`
      : `A encomenda #${digits} existe, mas este contacto não tem email associado. Peça o email usado na compra e associe-o no painel Cliente para confirmar.`,
  };
}

// Detalhe de um produto publicado na loja online (pelo handle do URL /products/<handle>).
export async function supportProduct(handle: string) {
  type Variant = { title: string; price: string; compareAtPrice: string | null; availableForSale: boolean };
  const d = await graphql<{ product: {
    title: string; handle: string; status: string; onlineStoreUrl: string | null; productType: string; vendor: string; tags: string[];
    description: string; priceRangeV2: { minVariantPrice: Money2; maxVariantPrice: Money2 }; options: { name: string; values: string[] }[];
    variants: { pageInfo: { hasNextPage: boolean }; nodes: Variant[] };
  } | null; shop: { currencyCode: string } }>(
    `query AiProduct($identifier: ProductIdentifierInput!) {
      product: productByIdentifier(identifier: $identifier) {
        title handle status onlineStoreUrl productType vendor tags description(truncateAt: 2500)
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        options { name values }
        variants(first: 60) { pageInfo { hasNextPage } nodes { title price compareAtPrice availableForSale } }
      }
      shop { currencyCode } }`, { identifier: { handle } });
  const p = d.product;
  // Só o que um cliente consegue ver na loja.
  if (!p || !p.onlineStoreUrl || !["ACTIVE", "UNLISTED"].includes(p.status)) return null;
  const cur = d.shop.currencyCode;
  return {
    titulo: p.title, url: p.onlineStoreUrl, tipo: p.productType || null, marca: p.vendor || null, etiquetas: p.tags.slice(0, 20),
    descricao: p.description, preco: formatPrice(p.priceRangeV2.minVariantPrice, p.priceRangeV2.maxVariantPrice),
    opcoes: p.options.map((o) => ({ nome: o.name, valores: o.values.slice(0, 40) })),
    variantes: p.variants.nodes.map((v) => ({
      variante: v.title, preco: money({ amount: v.price, currencyCode: cur }),
      preco_antes: v.compareAtPrice ? money({ amount: v.compareAtPrice, currencyCode: cur }) : null, disponivel: v.availableForSale,
    })),
    mais_variantes: p.variants.pageInfo.hasNextPage,
  };
}

// Informação pública da loja para o assistente: nome, domínio, contacto, políticas e páginas publicadas.
// Cada parte falha sozinha (as políticas pedem read_legal_policies; as páginas read_online_store_pages).
export type StoreInfo = {
  name: string; url: string; email: string | null;
  policies: { title: string; url: string; text: string }[];
  pages: { title: string; url: string; text: string }[];
  missing: string[];
};
let storeInfo: { value: StoreInfo; until: number } | null = null;

export async function supportStoreInfo(toText: (html: string) => string): Promise<StoreInfo> {
  if (storeInfo && storeInfo.until > Date.now()) return storeInfo.value;
  const info = await storefrontInfo();
  const shop = await graphql<{ shop: { name: string; contactEmail: string | null } }>("query { shop { name contactEmail } }");
  const missing: string[] = [];
  let policies: StoreInfo["policies"] = [];
  try {
    const p = await graphql<{ shop: { shopPolicies: { title: string; body: string; url: string }[] } }>(
      "query { shop { shopPolicies { title body url } } }");
    policies = p.shop.shopPolicies.map((x) => ({ title: x.title, url: x.url, text: toText(x.body).slice(0, 12000) })).filter((x) => x.text)
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    missing.push("políticas da loja (autorização read_legal_policies)");
  }
  const pages: StoreInfo["pages"] = [];
  if (info.pages) {
    try {
      const p = await graphql<{ pages: { nodes: { title: string; handle: string; body: string; isPublished: boolean }[] } }>(
        `query { pages(first: 60, query: "published_status:published", sortKey: TITLE) { nodes { title handle body isPublished } } }`);
      let total = 0;
      for (const g of p.pages.nodes) {
        if (!g.isPublished) continue;
        const text = toText(g.body).slice(0, 6000);
        if (!text || total + text.length > 60000) continue;
        total += text.length;
        pages.push({ title: g.title, url: `${info.url}/pages/${g.handle}`, text });
      }
    } catch {
      missing.push("páginas da loja");
    }
  } else missing.push("páginas da loja (autorização read_online_store_pages)");
  const value = { name: shop.shop.name, url: info.url, email: shop.shop.contactEmail, policies, pages, missing };
  // 30 minutos; com partes em falta, volta a tentar em 5 (uma autorização pode ter acabado de ser aprovada).
  storeInfo = { value, until: Date.now() + (missing.length ? 5 : 30) * 60 * 1000 };
  return value;
}
