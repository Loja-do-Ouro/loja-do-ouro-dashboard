import Link from "next/link";
import { redirect } from "next/navigation";
import { dates, localDate, periodLabel, shift, validDate } from "@/lib/bi/periods";
import { readWindsor, windsorConfigured } from "@/lib/bi/windsor";
import { canCompareStores, homePath, managedStores } from "@/lib/permissions";
import { loadOptions } from "@/lib/records";
import { goldTotals, summarizeShop, type GoldEntry, type GoldMonthly, type ShopSale } from "@/lib/store-records";
import { classify, type ChannelRules } from "@/lib/bi/channels";
import { rpc } from "@/lib/supabase";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent } from "@/components/dashboard/format";
import { Change, Panel } from "@/components/dashboard/ui";
import { AppShell, PageHeading } from "@/components/shell";
import { BarValue } from "@/components/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Comparar lojas · Loja do Ouro" };

const MAX_DAYS = 366;

type AdRow = { source: "meta" | "google_ads"; campaign: string; spend: number; clicks: number };

// Campaign spend for any period, read from Windsor (Meta and Google Ads).
async function adRows(source: AdRow["source"], from: string, to: string): Promise<{ rows: AdRow[]; error: string }> {
  const label = source === "meta" ? "Meta" : "Google Ads";
  if (!windsorConfigured()) return { rows: [], error: `${label} por configurar.` };
  try {
    const r = await readWindsor(source === "meta" ? "facebook" : "google_ads", { from, to }, ["date", "campaign", "spend", "clicks"]);
    return { rows: r.rows.map((x) => ({ source, campaign: String(x.campaign || ""), spend: Number(x.spend) || 0, clicks: Number(x.clicks) || 0 })), error: "" };
  } catch (e) {
    return { rows: [], error: `${label}: ${e instanceof Error ? e.message : "indisponível."}` };
  }
}

export default async function CompareStoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canCompareStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const today = localDate();
  let from = typeof q.from === "string" && validDate(q.from) ? q.from : `${today.slice(0, 7)}-01`;
  let to = typeof q.to === "string" && validDate(q.to) && q.to <= today ? q.to : today;
  let error = "";
  if (from > to || dates({ from, to }).length > MAX_DAYS) {
    error = `Intervalo inválido: escolha até ${MAX_DAYS} dias, com o início antes do fim.`;
    from = `${today.slice(0, 7)}-01`;
    to = today;
  }
  const length = dates({ from, to }).length;
  const prev = { from: shift(from, -length), to: shift(from, -1) };
  const stores = managedStores(viewer);
  const args = { p_session: viewer.session, p_store_id: null, p_from: prev.from, p_to: to };
  const [options, sales, entries, monthly, google, meta, rules] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", args),
    rpcAll<GoldEntry>("ldo_list_gold_entries", args),
    rpcAll<GoldMonthly>("ldo_list_gold_monthly", args),
    adRows("google_ads", from, to),
    adRows("meta", from, to),
    rpc<ChannelRules>("ldo_list_campaign_channels", { p_session: viewer.session }).catch(
      (): ChannelRules => ({ stores: stores.map((s) => ({ id: s.id, name: s.name, keyword: s.ads_keyword || null })), overrides: [] }),
    ),
  ]);
  const adErrors = [google.error, meta.error].filter(Boolean).join(" · ");
  const inRange = (d: string, p: { from: string; to: string }) => d >= p.from && d <= p.to;
  // Only campaigns that belong to a physical store count here; online and shared
  // campaigns are the online budget.
  const spend = new Map<string, { spend: number; meta: number; google: number; clicks: number }>();
  let unassigned = 0;
  for (const r of [...google.rows, ...meta.rows]) {
    const c = classify(r.source, r.campaign, rules);
    if (c.destination !== "store" || !c.storeId) {
      unassigned += r.spend;
      continue;
    }
    const s = spend.get(c.storeId) || { spend: 0, meta: 0, google: 0, clicks: 0 };
    s.spend += r.spend;
    if (r.source === "meta") s.meta += r.spend; else s.google += r.spend;
    s.clicks += r.clicks;
    spend.set(c.storeId, s);
  }
  const table = stores.map((s) => {
    const mine = sales.filter((r) => r.store_id === s.id);
    const shop = summarizeShop(mine.filter((r) => inRange(r.sale_date, { from, to })), options);
    const shopBefore = summarizeShop(mine.filter((r) => inRange(r.sale_date, prev)), options);
    const gold = goldTotals(entries, monthly, options, { store_id: s.id, from, to });
    const goldBefore = goldTotals(entries, monthly, options, { store_id: s.id, ...prev });
    const ad = spend.get(s.id) || null;
    const online = gold.digital + shop.digitalServed;
    return { store: s, shop, shopBefore, gold, goldBefore, ad, online };
  });
  table.sort((a, b) => b.shop.value + b.gold.totalValue - (a.shop.value + a.gold.totalValue));
  const maxShop = Math.max(0, ...table.map((r) => r.shop.value));
  const maxGold = Math.max(0, ...table.map((r) => r.gold.totalValue));
  const maxSpend = Math.max(0, ...table.map((r) => r.ad?.spend || 0));
  const totalSpend = table.reduce((a, r) => a + (r.ad?.spend || 0), 0);
  const partial = table.some((r) => r.gold.partialMonthly);

  return (
    <AppShell viewer={viewer} current="comparar" title="Comparar lojas">
      <PageHeading eyebrow="LOJAS FÍSICAS" title="Comparar lojas" text="Vendas, compra de ouro e investimento em anúncios (Meta e Google) das lojas que gere, face ao período anterior com o mesmo número de dias." />
      <details className="calendar-panel" open={!!error || typeof q.from === "string"}>
        <summary>
          {periodLabel({ from, to })}
          <span>Escolher outras datas</span>
        </summary>
        <form method="get">
          <label>
            Desde
            <input type="date" name="from" required defaultValue={from} max={today} />
          </label>
          <label>
            Até
            <input type="date" name="to" required defaultValue={to} max={today} />
          </label>
          <button type="submit">Comparar <span>→</span></button>
          <p>Compara com {periodLabel(prev)}.</p>
        </form>
        {error && <p role="alert" className="form-error">{error}</p>}
      </details>
      <Panel title="Vendas nas lojas" eyebrow={periodLabel({ from, to })} note="Registos de “Vendas e atendimentos”. “Viram online”: clientes que viram o produto no site ou nas redes sociais.">
        <div className="table-scroll" tabIndex={0} aria-label="Vendas por loja">
          <table className="nums">
            <thead>
              <tr>{["Loja", "Total vendido", "vs. anterior", "Vendas", "Atendimentos", "Taxa de venda", "Ticket médio", "Viram online", "Clientes novos"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.map(({ store, shop, shopBefore }) => (
                <tr key={store.id}>
                  <td><Link href={`/lojas?${new URLSearchParams({ loja: store.code, mes: to.slice(0, 7) })}`}>{store.name}</Link></td>
                  <td><BarValue value={shop.value} max={maxShop}>{currency(shop.value)}</BarValue></td>
                  <td><Change a={shop.served ? shop.value : null} b={shopBefore.served ? shopBefore.value : null} /></td>
                  <td>{integer(shop.sales)}</td>
                  <td>{integer(shop.served)}</td>
                  <td>{percent(shop.conversion)}</td>
                  <td>{currency(shop.avgTicket)}</td>
                  <td>{percent(shop.digitalShare)}</td>
                  <td>{percent(shop.newShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Compra de ouro" eyebrow={periodLabel({ from, to })} note={`Clientes que vieram vender ouro ou fazer contrato. “Vieram pela internet”: Google, redes sociais, site ou outro meio online.${partial ? " Os meses importados do Excel só contam quando o período inclui o mês inteiro." : ""}`}>
        <div className="table-scroll" tabIndex={0} aria-label="Compra de ouro por loja">
          <table className="nums">
            <thead>
              <tr>{["Loja", "Clientes", "Vieram pela internet", "% internet", "Gramas", "Valor pago", "vs. anterior"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.map(({ store, gold, goldBefore }) => (
                <tr key={store.id}>
                  <td><Link href={`/lojas/ouro?${new URLSearchParams({ loja: store.code, mes: to.slice(0, 7) })}`}>{store.name}</Link></td>
                  <td>{integer(gold.customers)}</td>
                  <td>{integer(gold.digital)}</td>
                  <td>{percent(gold.digitalShare)}</td>
                  <td>{integer(gold.totalGrams)}</td>
                  <td><BarValue value={gold.totalValue} max={maxGold}>{currency(gold.totalValue)}</BarValue></td>
                  <td><Change a={gold.customers ? gold.totalValue : null} b={goldBefore.customers ? goldBefore.totalValue : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Anúncios por loja"
        eyebrow={periodLabel({ from, to })}
        note={`Campanhas Meta e Google das lojas físicas: o nome contém a palavra da loja (Administração → Lojas) ou foram atribuídas em Administração → Campanhas. Clientes da internet = compra de ouro vinda da internet + vendas em que o cliente viu o produto online. Não prova que o anúncio trouxe o cliente.${unassigned && viewer.isSuper ? ` Investimento do online e partilhado, fora desta tabela: ${currency(unassigned)}.` : ""}`}
      >
        {adErrors && <p className="form-error">{adErrors}</p>}
        <div className="table-scroll" tabIndex={0} aria-label="Anúncios por loja">
          <table className="nums">
            <thead>
              <tr>{["Loja", "Investimento", "Meta", "Google", "% do investimento", "Cliques", "Clientes da internet", "Custo por cliente da internet", "Ouro comprado (€) por € de anúncio"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.map(({ store, ad, online, gold }) => (
                <tr key={store.id}>
                  <td>{store.name}{!store.ads_keyword && <small className="muted block">sem campanha associada</small>}</td>
                  <td>{ad ? <BarValue value={ad.spend} max={maxSpend}>{currency(ad.spend)}</BarValue> : "—"}</td>
                  <td>{ad ? currency(ad.meta) : "—"}</td>
                  <td>{ad ? currency(ad.google) : "—"}</td>
                  <td>{ad && totalSpend ? percent((ad.spend / totalSpend) * 100) : "—"}</td>
                  <td>{ad ? integer(ad.clicks) : "—"}</td>
                  <td>{integer(online)}</td>
                  <td>{ad && online ? currency(ad.spend / online) : "—"}</td>
                  <td>{ad && ad.spend ? `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(gold.totalValue / ad.spend)} €` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
