import { redirect } from "next/navigation";
import { dates, localDate, periodLabel, shift, validDate } from "@/lib/bi/periods";
import { canCompareStores, homePath, managedStores } from "@/lib/permissions";
import { summarize, type Sale } from "@/lib/store-sales";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent } from "@/components/dashboard/format";
import { Change, Panel } from "@/components/dashboard/ui";
import { AppShell, PageHeading } from "@/components/shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comparar lojas · Loja do Ouro" };

const MAX_DAYS = 366;
type Row = Pick<Sale, "sale_date" | "total_sales" | "receipts" | "items"> & { store_id: string };

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
  const rows = await rpcAll<Row>("ldo_compare_sales", { p_session: viewer.session, p_from: prev.from, p_to: to });
  const inRange = (r: Row, p: { from: string; to: string }) => r.sale_date >= p.from && r.sale_date <= p.to;
  const table = stores.map((s) => {
    const mine = rows.filter((r) => r.store_id === s.id);
    return { store: s, now: summarize(mine.filter((r) => inRange(r, { from, to }))), before: summarize(mine.filter((r) => inRange(r, prev))) };
  });
  const totalNow = summarize(rows.filter((r) => inRange(r, { from, to })));
  const totalBefore = summarize(rows.filter((r) => inRange(r, prev)));
  table.sort((a, b) => b.now.total - a.now.total);

  return (
    <AppShell viewer={viewer} current="comparar" title="Comparar lojas">
      <PageHeading eyebrow="LOJAS FÍSICAS" title="Comparar lojas" text="Vendas lançadas pelas lojas que gere, face ao período anterior com o mesmo número de dias." />
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
      <div className="mini-stats four compare-totals">
        <div><span>Total das lojas</span><strong>{currency(totalNow.total)}</strong><Change a={totalNow.total} b={totalBefore.total || null} /></div>
        <div><span>Talões</span><strong>{integer(totalNow.receipts)}</strong></div>
        <div><span>Ticket médio</span><strong>{currency(totalNow.avgTicket)}</strong></div>
        <div><span>Dias lançados</span><strong>{totalNow.days} / {length * stores.length}</strong></div>
      </div>
      <Panel title="Por loja" eyebrow={periodLabel({ from, to })} note="Dias sem lançamento não contam nas médias. Ticket médio só nos dias com n.º de talões.">
        <div className="table-scroll" tabIndex={0} aria-label="Comparação de lojas">
          <table>
            <thead>
              <tr>
                {["Loja", "Vendas", "vs. anterior", "% do total", "Dias lançados", "Talões", "Ticket médio", "Artigos", "Média por dia"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map(({ store, now, before }) => (
                <tr key={store.id}>
                  <td>
                    <a href={`/lojas?${new URLSearchParams({ loja: store.code, mes: to.slice(0, 7) })}`}>{store.name}</a>
                  </td>
                  <td>{currency(now.total)}</td>
                  <td><Change a={now.days ? now.total : null} b={before.days ? before.total : null} /></td>
                  <td>{totalNow.total ? percent((now.total / totalNow.total) * 100) : "—"}</td>
                  <td>
                    {now.days} / {length}
                    {now.days < length && <span className="pill warn">{length - now.days} por lançar</span>}
                  </td>
                  <td>{integer(now.receipts)}</td>
                  <td>{currency(now.avgTicket)}</td>
                  <td>{integer(now.items)}</td>
                  <td>{currency(now.avgDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
