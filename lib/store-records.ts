// Records the physical stores fill in, replacing their two Excel files:
// - "Análise de Vendas": one record per customer served, with or without a sale.
// - "Eficácia das campanhas de marketing": one record per gold purchase customer
//   (used gold sold to the store, or a pawn contract), with how they heard of us.
// Option codes come from ldo_options, managed by the Super Admin.

export type OptionList =
  | "campaign" | "material" | "product_type" | "client_type" | "seen_where"
  | "purpose" | "restock" | "no_sale_reason" | "heard_from";
export type Option = { list: OptionList; code: string; label: string; sort_order: number; active: boolean; digital: boolean };
export type Options = Record<OptionList, Option[]>;

export type Item = { reference: string | null; material: string | null; product_type: string | null };
export type ShopSale = {
  id: string;
  store_id: string;
  sale_date: string;
  sale_number: string | null;
  sold: boolean;
  total_value: number | null;
  campaign: boolean | null;
  campaign_code: string | null;
  client_type: string | null;
  seen_where: string | null;
  bought_online: boolean | null;
  purpose: string | null;
  restock: string | null;
  no_sale_reason: string | null;
  looking_for: string | null;
  notes: string | null;
  items: Item[];
  source: "form" | "import" | "sheet";
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export const KARATS = ["9", "14", "18", "19", "22", "24"] as const;
export type Karat = (typeof KARATS)[number];
type KaratFields = { [K in Karat as `grams_${K}`]: number | null } & { [K in Karat as `value_${K}`]: number | null };
export type GoldOperation = "used" | "pawn";
export const OPERATIONS: Record<GoldOperation, string> = { used: "Venda de ouro usado", pawn: "Contrato (penhor)" };

export type GoldEntry = KaratFields & {
  id: string;
  store_id: string;
  entry_date: string;
  operation: GoldOperation;
  heard_from: string | null;
  closed: boolean;
  notes: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};
export type GoldMonthly = KaratFields & {
  store_id: string;
  month: string;
  operation: GoldOperation;
  visitors: number | null;
  digital_visitors: number | null;
};

const INVALID = "invalid" as const;

export function groupOptions(rows: Option[]): Options {
  const out = {} as Options;
  for (const list of ["campaign", "material", "product_type", "client_type", "seen_where", "purpose", "restock", "no_sale_reason", "heard_from"] as OptionList[])
    out[list] = rows.filter((o) => o.list === list).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  return out;
}

export function label(options: Options, list: OptionList, code: string | null | undefined) {
  if (!code) return "—";
  return options[list]?.find((o) => o.code === code)?.label || code;
}

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

// Grams keep up to two decimals, typed with a comma or a point ("19,91").
export function parseGrams(value: unknown): number | null | typeof INVALID {
  const v = String(value ?? "").replace(/[\sg]/gi, "").replace(",", ".");
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return INVALID;
  return Number(v);
}

const yesNo = (v: FormDataEntryValue | null) => (v === "sim" ? true : v === "nao" ? false : null);
const str = (form: FormData, key: string) => String(form.get(key) || "").trim();

export const ITEM_ROWS = 4;
// Linhas de artigos num atendimento (o formulário acrescenta linhas até aqui; a BD aceita o mesmo máximo).
export const MAX_ITEMS = 30;

// Form → payload for ldo_save_shop_sale. Required here: result, value when sold,
// reason when not sold, client type, where the product was seen, and the two yes/no.
export function parseShopSaleForm(form: FormData) {
  const sold = form.get("sold") === "sim" ? true : form.get("sold") === "nao" ? false : null;
  if (sold === null) return { error: "Indique se houve venda." };
  const value = parseAmount(form.get("total_value"));
  if (value === INVALID) return { error: "Valor da venda inválido." };
  if (sold && !value) return { error: "Indique o valor da venda." };
  if (!sold && !str(form, "no_sale_reason")) return { error: "Indique o motivo de não venda." };
  const campaignChoice = str(form, "campaign");
  if (!campaignChoice) return { error: "Indique se a venda foi por campanha." };
  if (!str(form, "client_type")) return { error: "Indique o tipo de cliente." };
  if (!str(form, "seen_where")) return { error: "Indique onde viu o produto." };
  const boughtOnline = yesNo(form.get("bought_online"));
  if (boughtOnline === null) return { error: "Indique se já comprou online." };
  const items: Item[] = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    const item = {
      reference: str(form, `item_${i}_reference`).slice(0, 40) || null,
      material: str(form, `item_${i}_material`) || null,
      product_type: str(form, `item_${i}_type`) || null,
    };
    if (item.reference || item.material || item.product_type) items.push(item);
  }
  if (sold && !items.length) return { error: "Indique pelo menos um artigo (material e tipo)." };
  return {
    data: {
      sale_date: str(form, "sale_date"),
      sale_number: str(form, "sale_number").slice(0, 40),
      sold,
      total_value: sold ? value : null,
      campaign: campaignChoice !== "nao",
      campaign_code: campaignChoice === "nao" ? null : campaignChoice,
      client_type: str(form, "client_type"),
      seen_where: str(form, "seen_where"),
      bought_online: boughtOnline,
      purpose: str(form, "purpose") || null,
      restock: str(form, "restock") || null,
      no_sale_reason: sold ? null : str(form, "no_sale_reason"),
      looking_for: str(form, "looking_for").slice(0, 300) || null,
      notes: str(form, "notes").slice(0, 1000) || null,
      items,
    },
  };
}

// Form → payload for ldo_save_gold_entry.
export function parseGoldForm(form: FormData) {
  const operation = str(form, "operation");
  if (operation !== "used" && operation !== "pawn") return { error: "Escolha venda de ouro usado ou contrato." };
  if (!str(form, "heard_from")) return { error: "Indique como o cliente conheceu a Loja do Ouro." };
  const closed = yesNo(form.get("closed"));
  if (closed === null) return { error: "Indique se fechou negócio." };
  const data: Record<string, unknown> = {
    entry_date: str(form, "entry_date"),
    operation,
    heard_from: str(form, "heard_from"),
    closed,
    notes: str(form, "notes").slice(0, 1000) || null,
  };
  let any = false;
  for (const k of KARATS) {
    const g = parseGrams(form.get(`grams_${k}`));
    const v = parseAmount(form.get(`value_${k}`));
    if (g === INVALID || v === INVALID) return { error: `Valor inválido em ${k} quilates.` };
    if ((g === null) !== (v === null)) return { error: `Em ${k} quilates indique as gramas e o valor pago.` };
    data[`grams_${k}`] = g;
    data[`value_${k}`] = v;
    any = any || g !== null;
  }
  if (closed && !any) return { error: "Negócio fechado: indique as gramas e o valor de pelo menos um quilate." };
  return { data };
}

const pad = (n: number) => String(n).padStart(2, "0");

// A calendar month as a period, ending today at the latest.
export function monthRange(month: unknown, today: string) {
  const m = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && `${month}-01` <= today ? month : today.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const last = `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}`;
  return { month: m, from: `${m}-01`, to: last < today ? last : today, last };
}

export function shiftMonth(month: string, delta: number) {
  const [y, mo] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const share = (part: number, total: number) => (total ? (part / total) * 100 : null);

export function count<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) out.set(k, (out.get(k) || 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

export function summarizeShop(rows: ShopSale[], options: Options) {
  const sales = rows.filter((r) => r.sold);
  const value = sales.reduce((a, r) => a + Number(r.total_value || 0), 0);
  const digital = new Set(options.seen_where.filter((o) => o.digital).map((o) => o.code));
  const answered = (k: keyof ShopSale) => rows.filter((r) => r[k] !== null && r[k] !== undefined);
  return {
    served: rows.length,
    sales: sales.length,
    notSold: rows.length - sales.length,
    conversion: share(sales.length, rows.length),
    value: round2(value),
    avgTicket: sales.length ? round2(value / sales.length) : null,
    campaignShare: share(rows.filter((r) => r.campaign).length, answered("campaign").length),
    newShare: share(rows.filter((r) => r.client_type === "novo").length, answered("client_type").length),
    digitalShare: share(rows.filter((r) => r.seen_where && digital.has(r.seen_where)).length, answered("seen_where").length),
    digitalServed: rows.filter((r) => r.seen_where && digital.has(r.seen_where)).length,
    boughtOnlineShare: share(rows.filter((r) => r.bought_online).length, answered("bought_online").length),
  };
}

type GoldTotals = { grams: Record<Karat, number>; value: Record<Karat, number>; customers: number; digital: number; closed: number | null };

function emptyTotals(): GoldTotals {
  return { grams: Object.fromEntries(KARATS.map((k) => [k, 0])) as Record<Karat, number>, value: Object.fromEntries(KARATS.map((k) => [k, 0])) as Record<Karat, number>, customers: 0, digital: 0, closed: 0 };
}

function addKarats(t: GoldTotals, r: KaratFields) {
  for (const k of KARATS) {
    t.grams[k] += Number(r[`grams_${k}`] || 0);
    t.value[k] += Number(r[`value_${k}`] || 0);
  }
}

// Gold purchase totals for one store and operation over a period. Months with
// individual records use them; earlier months fall back to the imported monthly
// totals, but only when the whole month is inside the period.
export function goldTotals(
  entries: GoldEntry[],
  monthly: GoldMonthly[],
  options: Options,
  filter: { store_id?: string; operation?: GoldOperation; from: string; to: string },
) {
  const digital = new Set(options.heard_from.filter((o) => o.digital).map((o) => o.code));
  const matches = (r: { store_id: string; operation: GoldOperation }) =>
    (!filter.store_id || r.store_id === filter.store_id) && (!filter.operation || r.operation === filter.operation);
  const mine = entries.filter((e) => matches(e) && e.entry_date >= filter.from && e.entry_date <= filter.to);
  const covered = new Set(mine.map((e) => `${e.store_id}|${e.operation}|${e.entry_date.slice(0, 7)}`));
  const t = emptyTotals();
  let fromMonthly = false;
  let partialMonthly = false;
  for (const e of mine) {
    t.customers += 1;
    if (e.heard_from && digital.has(e.heard_from)) t.digital += 1;
    if (e.closed) t.closed! += 1;
    addKarats(t, e);
  }
  for (const m of monthly) {
    if (!matches(m) || covered.has(`${m.store_id}|${m.operation}|${m.month.slice(0, 7)}`)) continue;
    const start = m.month;
    const end = monthRange(m.month.slice(0, 7), "9999-12-31").last;
    if (end < filter.from || start > filter.to) continue;
    if (start < filter.from || end > filter.to) {
      partialMonthly = true;
      continue;
    }
    fromMonthly = true;
    t.customers += m.visitors || 0;
    t.digital += m.digital_visitors || 0;
    addKarats(t, m);
  }
  // The Excel did not record whether each visit closed a deal.
  if (fromMonthly) t.closed = null;
  const grams = KARATS.reduce((a, k) => a + t.grams[k], 0);
  const value = KARATS.reduce((a, k) => a + t.value[k], 0);
  return {
    ...t,
    totalGrams: round2(grams),
    totalValue: round2(value),
    digitalShare: share(t.digital, t.customers),
    fromMonthly,
    partialMonthly,
  };
}

// Keyword match between a store and its Google Ads campaign names, ignoring case and accents.
export function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

export function campaignStore(campaign: string, stores: { id: string; ads_keyword?: string | null }[]) {
  const name = normalize(campaign);
  const hits = stores.filter((s) => s.ads_keyword && name.includes(normalize(s.ads_keyword)));
  // The longest keyword wins ("LEIRIA CITY" over "LEIRIA").
  return hits.sort((a, b) => (b.ads_keyword || "").length - (a.ads_keyword || "").length)[0]?.id || null;
}

// Short code for a store's address in links, e.g. "Figueira da Foz" → "figueira-da-foz".
export function storeCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function optionCode(value: string) {
  return storeCode(value).replace(/-/g, "_").slice(0, 40);
}

export type RankStore = { id: string; code: string; name: string; ads_keyword?: string | null; closed_weekdays?: number[] };
export type Period2 = { from: string; to: string };

// One row per store for a period and the one before it, ranked by what the store sold.
export function storeTable(
  stores: RankStore[],
  sales: ShopSale[],
  entries: GoldEntry[],
  monthly: GoldMonthly[],
  options: Options,
  range: Period2,
  prev: Period2,
  by: "sales" | "gold" = "sales",
) {
  const inRange = (d: string, p: Period2) => d >= p.from && d <= p.to;
  const rows = stores.map((store) => {
    const mine = sales.filter((r) => r.store_id === store.id);
    const shop = summarizeShop(mine.filter((r) => inRange(r.sale_date, range)), options);
    const shopBefore = summarizeShop(mine.filter((r) => inRange(r.sale_date, prev)), options);
    const gold = goldTotals(entries, monthly, options, { store_id: store.id, ...range });
    const goldBefore = goldTotals(entries, monthly, options, { store_id: store.id, ...prev });
    return { store, shop, shopBefore, gold, goldBefore, rank: 0 };
  });
  const key = (r: (typeof rows)[number]) => (by === "gold" ? r.gold.totalValue : r.shop.value);
  rows.sort((a, b) => key(b) - key(a) || b.shop.served - a.shop.served || a.store.name.localeCompare(b.store.name));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

// Active stores open that day without any sale/visit or gold purchase record.
export function missingStores(stores: RankStore[], sales: Pick<ShopSale, "store_id" | "sale_date">[], entries: Pick<GoldEntry, "store_id" | "entry_date">[], day: string) {
  const reported = new Set([
    ...sales.filter((s) => s.sale_date === day).map((s) => s.store_id),
    ...entries.filter((e) => e.entry_date === day).map((e) => e.store_id),
  ]);
  return stores.filter((s) => !(s.closed_weekdays || []).includes(weekdayOf(day)) && !reported.has(s.id));
}

// ---------------------------------------------------------------- lista de atendimentos por período
export type ListView = "dia" | "semana" | "mes";
export type ListShow = "todos" | "vendas" | "sem";
export const LIST_VIEWS: ListView[] = ["dia", "semana", "mes"];
export const listView = (v: unknown): ListView => (v === "semana" || v === "mes" ? v : "dia");
export const listShow = (v: unknown): ListShow => (v === "vendas" || v === "sem" ? v : "todos");

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Semana de segunda a domingo que contém o dia (até hoje, no máximo).
export function weekRange(day: string, today: string) {
  const monday = addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
  const sunday = addDays(monday, 6);
  return { from: monday, to: sunday < today ? sunday : today, last: sunday };
}

// Período da lista: o dia, a semana desse dia ou o mês (o mesmo do resumo).
export function listPeriod(view: ListView, day: string, month: { from: string; to: string }, today: string) {
  if (view === "mes") return { from: month.from, to: month.to };
  if (view === "semana") {
    const w = weekRange(day, today);
    return { from: w.from, to: w.to };
  }
  return { from: day, to: day };
}

// Período anterior e seguinte da lista, como dia de referência (o mês acompanha o dia). Nunca depois de hoje; o
// período que contém hoje é sempre aberto em hoje.
export function listNeighbours(view: ListView, day: string, month: string, today: string) {
  if (view === "mes") {
    const prev = shiftMonth(month, -1), next = shiftMonth(month, 1);
    return { prev: `${prev}-01`, next: next > today.slice(0, 7) ? null : next === today.slice(0, 7) ? today : `${next}-01` };
  }
  if (view === "semana") {
    const monday = weekRange(day, today).from;
    const nextMonday = addDays(monday, 7);
    return { prev: addDays(monday, -7), next: nextMonday > today ? null : addDays(nextMonday, 6) >= today ? today : nextMonday };
  }
  const next = addDays(day, 1);
  return { prev: addDays(day, -1), next: next <= today ? next : null };
}

// Registos de um período, filtrados (todos, só vendas ou só sem venda), do mais recente para o mais antigo.
export function listRows<T extends { sale_date: string; sold: boolean; created_at: string }>(rows: T[], from: string, to: string, show: ListShow) {
  return rows
    .filter((r) => r.sale_date >= from && r.sale_date <= to && (show === "todos" || (show === "vendas" ? r.sold : !r.sold)))
    .sort((a, b) => (a.sale_date === b.sale_date ? b.created_at.localeCompare(a.created_at) : b.sale_date.localeCompare(a.sale_date)));
}

// Ordem da lista (?ordem=coluna-asc|desc). Sem ordem escolhida: o dia mais recente primeiro.
export type ListSortKey = "dia" | "numero" | "resultado" | "valor" | "artigos" | "cliente" | "viu" | "campanha" | "registo";
export type ListSort = { key: ListSortKey; dir: "asc" | "desc" } | null;
export const LIST_SORT_KEYS: ListSortKey[] = ["dia", "numero", "resultado", "valor", "artigos", "cliente", "viu", "campanha", "registo"];
// Primeiro clique numa coluna: valores, números e quantidades do maior para o menor; texto de A a Z. O dia começa do
// mais antigo (a ordem habitual já é do mais recente).
const FIRST_DIR: Record<ListSortKey, "asc" | "desc"> = {
  dia: "asc", numero: "desc", resultado: "asc", valor: "desc", artigos: "desc", cliente: "asc", viu: "asc", campanha: "asc", registo: "asc",
};

export function listSort(v: unknown): ListSort {
  const m = typeof v === "string" ? /^([a-z]+)-(asc|desc)$/.exec(v) : null;
  return m && (LIST_SORT_KEYS as string[]).includes(m[1]) ? { key: m[1] as ListSortKey, dir: m[2] as "asc" | "desc" } : null;
}
export const sortParam = (s: ListSort) => (s ? `${s.key}-${s.dir}` : null);
// Clique num título: a mesma coluna inverte a ordem; outra coluna começa na ordem mais útil.
export const nextSort = (current: ListSort, key: ListSortKey): ListSort =>
  current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIR[key] };

// Ordena as linhas já filtradas. Valores em falta (ex.: valor de um atendimento sem venda) ficam sempre no fim; em
// caso de empate mantém-se a ordem habitual. Texto e números de venda comparados como se lêem ("9003388" > "900308").
export function sortListRows<T>(rows: T[], sort: ListSort, valueOf: (row: T, key: ListSortKey) => string | number | null): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  const collator = new Intl.Collator("pt-PT", { numeric: true, sensitivity: "base" });
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row, sort.key) }))
    .sort((a, b) => {
      const na = a.v === null || a.v === "", nb = b.v === null || b.v === "";
      if (na || nb) return na === nb ? a.i - b.i : na ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c ? c * sign : a.i - b.i;
    })
    .map((x) => x.row);
}

// ---------------------------------------------------------------- ranking de produtos e categorias
// Os artigos de um atendimento não têm preço próprio. O valor de cada artigo é o valor da venda dividido pelo número
// de artigos dessa venda: exato quando a venda tem um só artigo, estimado (partes iguais) quando tem vários. Cada
// linha de artigo conta como uma unidade. Vendas sem valor indicado (há algumas vindas da folha) contam nas unidades,
// mas não no valor nem no valor médio.
export type RankBy = "valor" | "unidades";
export const rankBy = (v: unknown): RankBy => (v === "unidades" ? "unidades" : "valor");

// Referência como se escreve no catálogo: sem espaços e em maiúsculas ("5000 2606" e "50002606" são a mesma peça).
export const normalizeRef = (ref: string | null | undefined) => String(ref ?? "").replace(/\s+/g, "").toUpperCase() || null;

export type SoldItem = { saleId: string; storeId: string; ref: string | null; type: string | null; material: string | null; value: number; split: boolean; priced: boolean };

// Artigos vendidos no período, só das lojas indicadas (as que a pessoa gere).
export function soldItems(sales: ShopSale[], storeIds: Set<string>, p: Period2): SoldItem[] {
  const out: SoldItem[] = [];
  for (const s of sales) {
    if (!s.sold || !storeIds.has(s.store_id) || s.sale_date < p.from || s.sale_date > p.to || !s.items?.length) continue;
    const priced = s.total_value !== null && s.total_value !== undefined;
    const each = priced ? Number(s.total_value) / s.items.length : 0;
    for (const i of s.items)
      out.push({ saleId: s.id, storeId: s.store_id, ref: normalizeRef(i.reference), type: i.product_type || null, material: i.material || null, value: each, split: s.items.length > 1, priced });
  }
  return out;
}

export type RankRow = {
  key: string;
  reference: string | null;
  type: string | null;
  material: string | null;
  units: number;
  // Unidades de vendas com valor indicado (as únicas que entram no valor médio).
  pricedUnits: number;
  sales: number;
  value: number;
  // Parte do valor que vem de vendas com vários artigos (dividida em partes iguais).
  estimated: number;
  stores: string[];
  products: number;
  before: { units: number; pricedUnits: number; value: number } | null;
  rank: number;
};

type Acc = { units: number; pricedUnits: number; sales: Set<string>; value: number; estimated: number; stores: Set<string>; refs: Set<string>; types: Map<string, number>; materials: Map<string, number>; first: SoldItem };

function accumulate(items: SoldItem[], keyOf: (i: SoldItem) => string) {
  const out = new Map<string, Acc>();
  for (const i of items) {
    const k = keyOf(i);
    let a = out.get(k);
    if (!a) out.set(k, (a = { units: 0, pricedUnits: 0, sales: new Set(), value: 0, estimated: 0, stores: new Set(), refs: new Set(), types: new Map(), materials: new Map(), first: i }));
    a.units += 1;
    if (i.priced) a.pricedUnits += 1;
    a.sales.add(i.saleId);
    a.value += i.value;
    if (i.split) a.estimated += i.value;
    a.stores.add(i.storeId);
    a.refs.add(i.ref ?? `sem:${i.type ?? ""}:${i.material ?? ""}`);
    if (i.type) a.types.set(i.type, (a.types.get(i.type) || 0) + 1);
    if (i.material) a.materials.set(i.material, (a.materials.get(i.material) || 0) + 1);
  }
  return out;
}

// O valor mais frequente (em empate, o que apareceu primeiro).
const mostFrequent = (m: Map<string, number>) => {
  let best: string | null = null, n = 0;
  for (const [k, c] of m) if (c > n) [best, n] = [k, c];
  return best;
};

const sortRank = (rows: RankRow[], by: RankBy) => {
  const collator = new Intl.Collator("pt-PT", { numeric: true, sensitivity: "base" });
  rows.sort((a, b) =>
    (by === "unidades" ? b.units - a.units || b.value - a.value : b.value - a.value || b.units - a.units) || b.sales - a.sales || collator.compare(a.key, b.key));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
};

function rank(now: SoldItem[], before: SoldItem[], keyOf: (i: SoldItem) => string, by: RankBy): RankRow[] {
  const prev = accumulate(before, keyOf);
  const rows = [...accumulate(now, keyOf)].map(([key, a]): RankRow => {
    const b = prev.get(key);
    return {
      key,
      reference: a.first.ref,
      type: mostFrequent(a.types),
      material: mostFrequent(a.materials),
      units: a.units,
      pricedUnits: a.pricedUnits,
      sales: a.sales.size,
      value: round2(a.value),
      estimated: round2(a.estimated),
      stores: [...a.stores],
      products: a.refs.size,
      before: b ? { units: b.units, pricedUnits: b.pricedUnits, value: round2(b.value) } : null,
      rank: 0,
    };
  });
  return sortRank(rows, by);
}

// Uma linha por peça (referência). Sem referência, as peças agrupam-se por tipo e material.
export const productKey = (i: Pick<SoldItem, "ref" | "type" | "material">) => (i.ref ? `ref:${i.ref}` : `sem:${i.type ?? ""}:${i.material ?? ""}`);

export type CategoryDim = "tipo" | "material" | "tipo-material";
export const categoryKey = (dim: CategoryDim) => (i: Pick<SoldItem, "type" | "material">) =>
  dim === "tipo" ? i.type ?? "" : dim === "material" ? i.material ?? "" : `${i.type ?? ""}|${i.material ?? ""}`;

export function rankingTotals(items: SoldItem[], sales: ShopSale[], storeIds: Set<string>, p: Period2) {
  const withoutItems = sales.filter((s) => s.sold && storeIds.has(s.store_id) && s.sale_date >= p.from && s.sale_date <= p.to && !s.items?.length);
  const unpriced = items.filter((i) => !i.priced);
  return {
    units: items.length,
    value: round2(items.reduce((a, i) => a + i.value, 0)),
    estimated: round2(items.reduce((a, i) => a + (i.split ? i.value : 0), 0)),
    sales: new Set(items.map((i) => i.saleId)).size,
    products: new Set(items.map(productKey)).size,
    // Vendas registadas sem artigos: o valor não entra em nenhum produto nem categoria.
    withoutItems: { sales: withoutItems.length, value: round2(withoutItems.reduce((a, s) => a + Number(s.total_value || 0), 0)) },
    // Vendas com artigos mas sem valor indicado: as unidades contam, o valor não.
    withoutValue: { sales: new Set(unpriced.map((i) => i.saleId)).size, units: unpriced.length },
  };
}

export function productRanking(sales: ShopSale[], storeIds: Set<string>, range: Period2, prev: Period2, by: RankBy) {
  const items = soldItems(sales, storeIds, range);
  return { rows: rank(items, soldItems(sales, storeIds, prev), productKey, by), totals: rankingTotals(items, sales, storeIds, range) };
}

export function categoryRanking(sales: ShopSale[], storeIds: Set<string>, range: Period2, prev: Period2, dim: CategoryDim, by: RankBy) {
  const items = soldItems(sales, storeIds, range);
  return { rows: rank(items, soldItems(sales, storeIds, prev), categoryKey(dim), by), totals: rankingTotals(items, sales, storeIds, range) };
}

// Valor de uma linha: "—" sem nenhuma unidade com valor; "≈" quando parte vem de vendas com vários artigos.
export const rankValue = (r: Pick<RankRow, "value" | "estimated" | "pricedUnits">, money: (n: number) => string) =>
  r.pricedUnits ? `${r.estimated > 0 ? "≈ " : ""}${money(r.value)}` : "—";
// Valor médio por unidade, só com as unidades que têm valor.
export const rankAverage = (r: Pick<RankRow, "value" | "estimated" | "pricedUnits">, money: (n: number) => string) =>
  r.pricedUnits ? `${r.estimated > 0 ? "≈ " : ""}${money(Math.round((r.value / r.pricedUnits) * 100) / 100)}` : "—";
// Comparação com o período anterior na métrica da ordem (null quando não há termo de comparação).
export const rankBefore = (r: Pick<RankRow, "before">, by: RankBy) =>
  !r.before ? null : by === "unidades" ? r.before.units : r.before.pricedUnits ? r.before.value : null;
