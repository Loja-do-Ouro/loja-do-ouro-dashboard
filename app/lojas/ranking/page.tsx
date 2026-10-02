import Link from "next/link";
import { redirect } from "next/navigation";
import { closedPeriods, dates, localDate, periodLabel, previous, shift, validDate, type Period } from "@/lib/bi/periods";
import { canCompareStores, homePath, managedStores } from "@/lib/permissions";
import { loadOptions } from "@/lib/records";
import { missingStores, storeTable, type GoldEntry, type GoldMonthly, type ShopSale } from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent } from "@/components/dashboard/format";
import { Change, Icon, Panel } from "@/components/dashboard/ui";
import { AppShell, PageHeading } from "@/components/shell";
import { BarValue } from "@/components/stores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ranking das lojas · Loja do Ouro" };

const PRESETS = [
  ["ontem", "Ontem"],
  ["semana", "Semana anterior"],
  ["mes", "Mês anterior"],
  ["este-mes", "Este mês"],
] as const;
const MEDALS = ["🥇", "🥈", "🥉"];

export default async function RankingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canCompareStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const today = localDate();
  const windows = closedPeriods();
  const custom = typeof q.from === "string" && typeof q.to === "string" && validDate(q.from) && validDate(q.to) && q.from <= q.to && q.to <= today && dates({ from: q.from, to: q.to }).length <= 366;
  const preset = custom ? "custom" : (PRESETS.find(([k]) => k === q.periodo)?.[0] ?? "ontem");
  let range: Period;
  let prev: Period;
  if (custom) {
    range = { from: q.from as string, to: q.to as string };
    const len = dates(range).length;
    // A whole calendar month is compared with the whole month before it.
    const wholeMonth = range.from.endsWith("-01") && shift(range.to, 1).endsWith("-01") && range.from.slice(0, 7) === range.to.slice(0, 7);
    const prevStart = `${shift(range.from, -1).slice(0, 7)}-01`;
    prev = wholeMonth ? { from: prevStart, to: shift(range.from, -1) } : { from: shift(range.from, -len), to: shift(range.from, -1) };
  } else if (preset === "este-mes") {
    range = { from: `${today.slice(0, 7)}-01`, to: today };
    const len = dates(range).length;
    const prevStart = `${shift(range.from, -1).slice(0, 7)}-01`;
    prev = { from: prevStart, to: shift(prevStart, len - 1) };
  } else {
    const w = windows[preset === "semana" ? 1 : preset === "mes" ? 2 : 0];
    range = w.range;
    prev = previous(w.range, w.key);
  }
  const by = q.ordem === "ouro" ? "gold" : "sales";
  const stores = managedStores(viewer);
  const args = { p_session: viewer.session, p_store_id: null, p_from: prev.from < range.from ? prev.from : range.from, p_to: range.to };
  const [options, sales, entries, monthly] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", args),
    rpcAll<GoldEntry>("ldo_list_gold_entries", args),
    rpcAll<GoldMonthly>("ldo_list_gold_monthly", args),
  ]);
  const rows = storeTable(stores, sales, entries, monthly, options, range, prev, by);
  const missing = range.from === range.to ? missingStores(stores, sales, entries, range.to) : [];
  const metric = (r: (typeof rows)[number]) => (by === "gold" ? r.gold.totalValue : r.shop.value);
  const metricBefore = (r: (typeof rows)[number]) => (by === "gold" ? (r.goldBefore.customers ? r.goldBefore.totalValue : null) : r.shopBefore.served ? r.shopBefore.value : null);
  const max = Math.max(0, ...rows.map(metric));
  const total = rows.reduce((a, r) => a + metric(r), 0);
  const link = (params: Record<string, string>) => `/lojas/ranking?${new URLSearchParams({ ...(custom ? { from: range.from, to: range.to } : { periodo: preset }), ...(by === "gold" ? { ordem: "ouro" } : {}), ...params })}`;

  return (
    <AppShell viewer={viewer} current="ranking" title="Ranking das lojas">
      <PageHeading eyebrow="LOJAS FÍSICAS" title="Ranking das lojas" text={`Todas as lojas ordenadas por ${by === "gold" ? "valor de ouro comprado" : "valor vendido"} · ${periodLabel(range)}, comparado com ${periodLabel(prev)}.`} />
      <div className="ranking-filters">
        <nav className="chips" aria-label="Período">
          {PRESETS.map(([k, l]) => (
            <Link key={k} className={preset === k ? "chip active" : "chip"} href={`/lojas/ranking?${new URLSearchParams({ periodo: k, ...(by === "gold" ? { ordem: "ouro" } : {}) })}`}>{l}</Link>
          ))}
        </nav>
        <nav className="chips" aria-label="Ordenar por">
          <Link className={by === "sales" ? "chip active" : "chip"} href={link({ ordem: "vendas" })}>Por vendas</Link>
          <Link className={by === "gold" ? "chip active" : "chip"} href={link({ ordem: "ouro" })}>Por compra de ouro</Link>
        </nav>
      </div>
      <details className="calendar-panel" open={custom}>
        <summary>
          <Icon name="calendar" />
          Escolher outras datas<span>{periodLabel(range)}</span>
        </summary>
        <form method="get">
          {by === "gold" && <input type="hidden" name="ordem" value="ouro" />}
          <label>Desde<input type="date" name="from" required defaultValue={range.from} max={today} /></label>
          <label>Até<input type="date" name="to" required defaultValue={range.to} max={today} /></label>
          <button type="submit">Ver ranking <span>→</span></button>
        </form>
      </details>
      {range.from === range.to && (
        <div role="status" className={missing.length ? "notice error-notice" : "notice ok-notice"}>
          <Icon name="check" />
          <span>
            {missing.length
              ? `${missing.length} ${missing.length === 1 ? "loja não registou" : "lojas não registaram"} dados neste dia: ${missing.map((s) => s.name).join(", ")}.`
              : "Todas as lojas abertas registaram dados neste dia."}
          </span>
        </div>
      )}
      <div className="podium">
        {rows.slice(0, 3).map((r, i) => (
          <article key={r.store.id} className={`podium-card place-${i + 1}`}>
            <span className="podium-medal" aria-hidden="true">{MEDALS[i]}</span>
            <span className="podium-place">{i + 1}.º lugar</span>
            <h2>{r.store.name}</h2>
            <strong>{currency(metric(r))}</strong>
            <Change a={metric(r) || null} b={metricBefore(r)} />
            <small>{by === "gold" ? `${integer(r.gold.customers)} clientes · ${percent(r.gold.digitalShare)} pela internet` : `${integer(r.shop.sales)} vendas · ticket ${currency(r.shop.avgTicket)}`}</small>
          </article>
        ))}
      </div>
      <Panel title={`Todas as ${rows.length} lojas`} eyebrow="CLASSIFICAÇÃO" note="Vendas: registos de “Vendas e atendimentos”. Ouro: “Compra de ouro” (os meses importados só contam quando o período inclui o mês inteiro).">
        <div className="table-scroll" tabIndex={0} aria-label="Ranking das lojas">
          <table className="nums ranking-table">
            <thead>
              <tr>
                {["#", "Loja", by === "gold" ? "Ouro comprado" : "Total vendido", "vs. anterior", "% do total", "Vendas", "Ticket médio", "Taxa de venda", by === "gold" ? "Total vendido" : "Ouro comprado", "Clientes ouro", "% internet"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.store.id}>
                  <td><span className={`rank-badge r${Math.min(r.rank, 4)}`}>{r.rank}</span></td>
                  <td><Link href={`/lojas?${new URLSearchParams({ loja: r.store.code, mes: range.to.slice(0, 7) })}`}>{r.store.name}</Link></td>
                  <td><BarValue value={metric(r)} max={max}>{currency(metric(r))}</BarValue></td>
                  <td><Change a={metric(r) || null} b={metricBefore(r)} /></td>
                  <td>{total ? percent((metric(r) / total) * 100) : "—"}</td>
                  <td>{integer(r.shop.sales)}</td>
                  <td>{currency(r.shop.avgTicket)}</td>
                  <td>{percent(r.shop.conversion)}</td>
                  <td>{currency(by === "gold" ? r.shop.value : r.gold.totalValue)}</td>
                  <td>{integer(r.gold.customers)}</td>
                  <td>{percent(r.gold.digitalShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
