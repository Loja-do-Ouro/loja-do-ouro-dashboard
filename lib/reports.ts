import "server-only";
import { onlineInvestment } from "./bi/channels";
import { overview } from "./bi/model";
import { liveCommerce } from "./bi/live-model";
import { closedPeriods, localDate, previous, shortDate, type Period } from "./bi/periods";
import { loadPeriods } from "./bi/store";
import { dashboardUrl } from "./email";
import { brandEmail } from "./email-layout";
import { rpc } from "./supabase";
import {
  goldTotals,
  groupOptions,
  missingStores,
  storeTable,
  summarizeShop,
  type GoldEntry,
  type GoldMonthly,
  type Option,
  type RankStore,
  type ShopSale,
} from "./store-records";

export type ReportKind = "daily" | "weekly" | "monthly";
export const REPORT_LABEL: Record<ReportKind, string> = { daily: "Relatório diário", weekly: "Relatório semanal", monthly: "Relatório mensal" };
const WINDOW: Record<ReportKind, "day" | "week" | "month"> = { daily: "day", weekly: "week", monthly: "month" };

type Snapshot = {
  stores: RankStore[];
  options: Option[];
  sales: ShopSale[];
  gold: GoldEntry[];
  gold_monthly: GoldMonthly[];
  recipients: { email: string; name: string }[];
};

export function reportsConfigured() {
  return Boolean(process.env.REPORTS_TOKEN);
}

export async function snapshot(from: string, to: string) {
  return rpc<Snapshot>("ldo_report_snapshot", { p_token: process.env.REPORTS_TOKEN || "", p_from: from, p_to: to });
}

export async function logReport(kind: string, period: Period | null, recipients: string[], status: "sent" | "skipped" | "failed" | "preview", detail: string) {
  await rpc("ldo_report_log_add", {
    p_token: process.env.REPORTS_TOKEN || "",
    p_kind: kind,
    p_from: period?.from || null,
    p_to: period?.to || null,
    p_recipients: recipients,
    p_status: status,
    p_detail: detail,
  }).catch(() => undefined);
}

// Online store: Shopify sales, ads and sessions from the dashboard's own sources.
async function onlineSummary(range: Period, prev: Period) {
  try {
    const store = await loadPeriods([range, prev], range, "overview");
    const s = overview(store, range);
    const p = overview(store, prev);
    const live = store.mode === "live";
    const c = liveCommerce(store, range);
    const cp = liveCommerce(store, prev);
    // Physical-store campaigns are not part of the online budget.
    const inv = onlineInvestment(store, range, s.spend, s.sales.value);
    const invBefore = onlineInvestment(store, prev, p.spend, p.sales.value);
    return {
      available: store.mode !== "unavailable",
      live,
      sales: live ? c.paidValue : s.sales.value,
      salesBefore: live ? cp.paidValue : p.sales.value,
      orders: live ? c.paidCount : s.orders.value,
      ordersBefore: live ? cp.paidCount : p.orders.value,
      spend: inv.online ?? s.spend,
      spendBefore: invBefore.online ?? p.spend,
      onlineOnly: inv.online !== null,
      physicalSpend: inv.physical,
      meta: s.meta.value,
      google: s.google.value,
      sessions: s.sessions.value,
      conversion: s.conversion,
      errors: store.errors,
    };
  } catch (e) {
    return { available: false, live: false, sales: null, salesBefore: null, orders: null, ordersBefore: null, spend: null, spendBefore: null, onlineOnly: false, physicalSpend: null, meta: null, google: null, sessions: null, conversion: null, errors: [e instanceof Error ? e.message : "Fonte indisponível"] };
  }
}

export async function buildReport(kind: ReportKind, now = new Date()) {
  const window = closedPeriods(now).find((w) => w.key === WINDOW[kind])!;
  const range = window.range;
  const prev = previous(range, window.key);
  const [snap, online] = await Promise.all([snapshot(prev.from, range.to), onlineSummary(range, prev)]);
  const options = groupOptions(snap.options);
  const rows = storeTable(snap.stores, snap.sales, snap.gold, snap.gold_monthly, options, range, prev);
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const shop = summarizeShop(snap.sales.filter((r) => inRange(r.sale_date)), options);
  const shopBefore = summarizeShop(snap.sales.filter((r) => r.sale_date >= prev.from && r.sale_date <= prev.to), options);
  const gold = goldTotals(snap.gold, snap.gold_monthly, options, range);
  const goldBefore = goldTotals(snap.gold, snap.gold_monthly, options, prev);
  const missing = kind === "daily" ? missingStores(snap.stores, snap.sales, snap.gold, range.to) : [];
  return { kind, label: REPORT_LABEL[kind], range, prev, online, shop, shopBefore, gold, goldBefore, rows, missing, recipients: snap.recipients };
}

export async function buildMissingAlert(now = new Date()) {
  const day = localDate(now);
  const snap = await snapshot(day, day);
  return { day, missing: missingStores(snap.stores, snap.sales, snap.gold, day), stores: snap.stores.length, recipients: snap.recipients };
}

// ---------------------------------------------------------------- email HTML

const eur = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : new Intl.NumberFormat("pt-PT").format(v));
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(v)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const period = (p: Period) => (p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} — ${shortDate(p.to)}`);

function change(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return `<span style="color:#9a917f">sem comparação</span>`;
  const d = ((a - b) / Math.abs(b)) * 100;
  const color = d >= 0 ? "#2f6b55" : "#b04f41";
  return `<span style="color:${color};font-weight:600">${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))}</span>`;
}

const PETROL = "#1d3e47";
const GOLD = "#b38a4f";

// Mesmo modelo de todos os emails da Loja do Ouro (lib/email-layout.ts).
function shell(baseUrl: string, title: string, subtitle: string, body: string) {
  return brandEmail({
    baseUrl, title, eyebrow: subtitle, body,
    button: { label: "Abrir o dashboard", url: baseUrl },
    footer: "Loja do Ouro · Grupo · relatório automático. Valores provisórios, sujeitos a revisão.",
  });
}

function section(title: string, inner: string) {
  return `<tr><td style="padding:6px 24px 18px"><div style="font-size:15px;font-weight:bold;color:${PETROL};border-bottom:2px solid ${GOLD};padding-bottom:6px;margin-bottom:12px">${esc(title)}</div>${inner}</td></tr>`;
}

function tiles(items: [string, string, string?][]) {
  const cells = items
    .map(
      ([label, value, sub], i) =>
        `<td width="${Math.floor(100 / items.length)}%" valign="top" style="padding:4px"><div style="background:${i === 0 ? PETROL : "#f8f5ef"};border-radius:10px;padding:12px">
<div style="font-size:11px;color:${i === 0 ? "#d9e3e5" : "#8a8371"}">${esc(label)}</div>
<div style="font-size:18px;font-weight:bold;color:${i === 0 ? "#ffffff" : PETROL};margin-top:4px">${value}</div>
${sub ? `<div style="font-size:11px;margin-top:3px;color:${i === 0 ? "#d9e3e5" : "#8a8371"}">${sub}</div>` : ""}</div></td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table>`;
}

function missingBlock(missing: RankStore[], when: string) {
  if (!missing.length)
    return `<div style="background:#e7f2ec;color:#2f6b55;border-radius:10px;padding:12px 14px;font-size:13px">Todas as lojas abertas registaram dados ${esc(when)}.</div>`;
  return `<div style="background:#fbeeea;color:#9a3f33;border-radius:10px;padding:12px 14px;font-size:13px"><b>${missing.length} ${missing.length === 1 ? "loja não registou" : "lojas não registaram"} dados ${esc(when)}:</b> ${missing.map((s) => esc(s.name)).join(", ")}.</div>`;
}

export function renderReport(r: Awaited<ReturnType<typeof buildReport>>, baseUrl: string) {
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank));
  const maxSales = Math.max(1, ...r.rows.map((x) => x.shop.value));
  const ranking = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:12px;border-collapse:collapse">
<tr style="background:#f8f5ef;color:#8a7e66"><th align="left" style="padding:8px">#</th><th align="left" style="padding:8px">Loja</th><th align="right" style="padding:8px">Vendido</th><th align="right" style="padding:8px">vs. anterior</th><th align="right" style="padding:8px">Vendas</th><th align="right" style="padding:8px">Ouro comprado</th></tr>
${r.rows
  .map(
    (x, i) => `<tr style="background:${i % 2 ? "#fcfbf8" : "#ffffff"}">
<td style="padding:8px;border-bottom:1px solid #f2eee6;font-weight:bold;color:${PETROL}">${medal(x.rank)}</td>
<td style="padding:8px;border-bottom:1px solid #f2eee6;font-weight:bold;color:${PETROL}">${esc(x.store.name)}
<div style="height:4px;background:#efe6d6;border-radius:2px;margin-top:4px"><div style="height:4px;width:${Math.round((x.shop.value / maxSales) * 100)}%;background:${GOLD};border-radius:2px"></div></div></td>
<td align="right" style="padding:8px;border-bottom:1px solid #f2eee6">${eur(x.shop.value)}</td>
<td align="right" style="padding:8px;border-bottom:1px solid #f2eee6">${change(x.shop.served ? x.shop.value : null, x.shopBefore.served ? x.shopBefore.value : null)}</td>
<td align="right" style="padding:8px;border-bottom:1px solid #f2eee6">${int(x.shop.sales)}</td>
<td align="right" style="padding:8px;border-bottom:1px solid #f2eee6">${eur(x.gold.totalValue)}</td></tr>`,
  )
  .join("")}</table>`;
  const o = r.online;
  const body = [
    r.kind === "daily" ? section("Registos das lojas", missingBlock(r.missing, "ontem")) : "",
    section(
      "Loja online",
      o.available
        ? tiles([
            [o.live ? "Encomendas pagas (valor)" : "Vendas Shopify", eur(o.sales), change(o.sales, o.salesBefore)],
            ["Encomendas", int(o.orders), change(o.orders, o.ordersBefore)],
            [o.onlineOnly ? "Investimento em anúncios (online)" : "Investimento em anúncios", eur(o.spend), o.onlineOnly ? `Lojas físicas à parte: ${eur(o.physicalSpend)}` : `Meta ${eur(o.meta)} · Google ${eur(o.google)}`],
            ["Sessões", int(o.sessions), `conversão ${pct(o.conversion === null ? null : o.conversion * 100)}`],
          ])
        : `<div style="color:#9a917f;font-size:13px">Dados da loja online indisponíveis neste momento.</div>`,
    ),
    section(
      "Lojas físicas",
      tiles([
        ["Total vendido", eur(r.shop.value), change(r.shop.value, r.shopBefore.value)],
        ["Vendas / atendimentos", `${int(r.shop.sales)} / ${int(r.shop.served)}`, `ticket médio ${eur(r.shop.avgTicket)}`],
        ["Ouro comprado", eur(r.gold.totalValue), `${int(Math.round(r.gold.totalGrams))} g · ${change(r.gold.totalValue, r.goldBefore.totalValue)}`],
        ["Clientes de ouro pela internet", pct(r.gold.digitalShare), `${int(r.gold.digital)} de ${int(r.gold.customers)}`],
      ]),
    ),
    section(`Ranking das lojas · ${period(r.range)}`, ranking),
  ].join("");
  return {
    subject: `${r.label} · ${period(r.range)} · Loja do Ouro`,
    html: shell(baseUrl, `${r.label}`, `${period(r.range)} · comparado com ${period(r.prev)}`, body),
  };
}

export function renderMissingAlert(a: Awaited<ReturnType<typeof buildMissingAlert>>, baseUrl: string) {
  const body = section(
    "Lojas sem registos hoje",
    missingBlock(a.missing, "hoje") +
      `<p style="font-size:12px;color:#8a8f87;margin:12px 0 0">Conta qualquer registo em “Vendas e atendimentos” ou “Compra de ouro”. Lojas fechadas neste dia da semana (Administração → Lojas) não são consideradas.</p>`,
  );
  return {
    subject: `Atenção: ${a.missing.length} ${a.missing.length === 1 ? "loja não comunicou" : "lojas não comunicaram"} os dados de ${shortDate(a.day)}`,
    html: shell(baseUrl, "Lojas sem registos", `Fim do dia · ${shortDate(a.day)}`, body),
  };
}

export function baseUrl() {
  return dashboardUrl();
}
