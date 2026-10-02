import Link from "next/link";
import { redirect } from "next/navigation";
import { localDate, shift, shortDate, validDate } from "@/lib/bi/periods";
import { canEditSale, homePath, STORE_BACKDATE_DAYS } from "@/lib/permissions";
import { daysDesc, monthRange, paymentGap, SALE_FIELDS, shiftMonth, summarize, type Sale } from "@/lib/store-sales";
import { rpc } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { deleteSale, saveSale } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendas diárias · Loja do Ouro" };

const OK: Record<string, string> = { saved: "Vendas guardadas.", deleted: "Registo apagado." };
const monthLabel = (m: string) => {
  const label = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));
  return label[0].toUpperCase() + label.slice(1);
};
const weekday = (d: string) => new Intl.DateTimeFormat("pt-PT", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const amountInput = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, useGrouping: false }).format(v);

export default async function StoreSalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.stores.length) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const store = viewer.stores.find((s) => s.code === q.loja) || viewer.stores[0];
  const today = localDate();
  const { month, from, to } = monthRange(q.mes, today);
  const day = typeof q.data === "string" && validDate(q.data) && q.data <= today ? q.data : today;

  const sales = await rpc<Sale[]>("ldo_store_sales_list", { p_session: viewer.session, p_store_id: store.id, p_from: from, p_to: to });
  const current =
    day >= from && day <= to
      ? sales.find((s) => s.sale_date === day) || null
      : (await rpc<Sale[]>("ldo_store_sales_list", { p_session: viewer.session, p_store_id: store.id, p_from: day, p_to: day }))[0] || null;
  const manager = store.level === "manager";
  const tooOld = !manager && day < shift(today, -STORE_BACKDATE_DAYS);
  const editable = !tooOld && canEditSale(viewer, store.id, current);
  const byDay = new Map(sales.map((s) => [s.sale_date, s]));
  const sum = summarize(sales);
  const days = daysDesc(from, to);
  const link = (params: Record<string, string>) => `/lojas?${new URLSearchParams({ loja: store.code, mes: month, ...params })}`;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="lojas" title="Vendas diárias">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title={`Vendas diárias · ${store.name}`}
        text={manager ? "Lançar, consultar e corrigir as vendas de cada dia." : "Lançar as vendas do dia e consultar o histórico da loja."}
      />
      {viewer.stores.length > 1 && (
        <nav className="chips" aria-label="Escolher loja">
          {viewer.stores.map((s) => (
            <Link key={s.id} href={`/lojas?${new URLSearchParams({ loja: s.code, mes: month })}`} className={s.id === store.id ? "chip active" : "chip"} aria-current={s.id === store.id ? "page" : undefined}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      <Flash ok={ok} error={error} />
      <div className="two-col sales-entry">
        <Panel title={current ? `Registo de ${shortDate(day)}` : `Lançar ${shortDate(day)}`} eyebrow={weekday(day).toUpperCase()}>
          <form method="get" className="inline-form">
            <input type="hidden" name="loja" value={store.code} />
            <input type="hidden" name="mes" value={month} />
            <label>
              Dia
              <input type="date" name="data" defaultValue={day} max={today} required />
            </label>
            <button type="submit" className="secondary-button">Abrir dia</button>
          </form>
          {editable ? (
            <form action={saveSale} className="form-grid" key={`${store.id}-${day}-${current?.updated_at || current?.created_at || ""}`}>
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="data" value={day} />
              {SALE_FIELDS.map((f) => (
                <label key={f.name} className={f.name === "total_sales" ? "wide" : ""}>
                  {f.label}
                  <input
                    name={f.name}
                    inputMode={f.kind === "amount" ? "decimal" : "numeric"}
                    autoComplete="off"
                    required={f.required}
                    placeholder={f.kind === "amount" ? "0,00" : "0"}
                    defaultValue={f.kind === "amount" ? amountInput(current?.[f.name]) : (current?.[f.name] ?? "").toString()}
                  />
                </label>
              ))}
              <label className="wide">
                Observações
                <textarea name="notes" rows={2} maxLength={1000} defaultValue={current?.notes || ""} />
              </label>
              <div className="wide form-actions">
                <button type="submit">{current ? "Guardar correção" : "Guardar vendas"}</button>
                {!manager && <small>Depois de guardar, pode corrigir durante 24 horas. Depois disso, peça ao Gestor.</small>}
              </div>
            </form>
          ) : (
            <div className="quiet-callout">
              {tooOld
                ? `Dias com mais de ${STORE_BACKDATE_DAYS} dias só podem ser lançados pelo Gestor da loja.`
                : "Este dia já foi lançado. Para o corrigir, contacte o Gestor da loja."}
            </div>
          )}
          {current && (
            <p className="panel-note">
              Lançado por {current.created_by_name || "—"} em {timestamp(current.created_at)}
              {current.updated_at ? ` · corrigido por ${current.updated_by_name || "—"} em ${timestamp(current.updated_at)}` : ""}.
            </p>
          )}
          {current && manager && (
            <form action={deleteSale} className="danger-zone">
              <input type="hidden" name="sale_id" value={current.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="data" value={day} />
              <button type="submit" className="danger-button">Apagar este registo</button>
              <small>Fica guardado no histórico de alterações.</small>
            </form>
          )}
        </Panel>
        <Panel title={monthLabel(month)} eyebrow="RESUMO DO MÊS">
          <div className="mini-stats two">
            <div><span>Total de vendas</span><strong>{currency(sum.total)}</strong></div>
            <div><span>Dias lançados</span><strong>{sum.days} / {days.length}</strong></div>
            <div><span>Talões</span><strong>{integer(sum.receipts)}</strong></div>
            <div><span>Ticket médio</span><strong>{currency(sum.avgTicket)}</strong></div>
            <div><span>Artigos</span><strong>{integer(sum.items)}</strong></div>
            <div><span>Média por dia lançado</span><strong>{currency(sum.avgDay)}</strong></div>
          </div>
          <p className="panel-note">Valores lançados pela loja. Os campos são provisórios até ao modelo final.</p>
        </Panel>
      </div>
      <Panel title="Histórico do mês" eyebrow={store.name.toUpperCase()}>
        <div className="month-nav">
          <Link className="outline-button" href={link({ mes: shiftMonth(month, -1) })}>‹ {monthLabel(shiftMonth(month, -1))}</Link>
          <strong>{monthLabel(month)}</strong>
          {month < today.slice(0, 7) ? (
            <Link className="outline-button" href={link({ mes: shiftMonth(month, 1) })}>{monthLabel(shiftMonth(month, 1))} ›</Link>
          ) : (
            <span />
          )}
        </div>
        <div className="table-scroll" tabIndex={0} aria-label="Histórico de vendas do mês">
          <table className="nowrap-first">
            <thead>
              <tr>
                {["Dia", "Vendas", "Talões", "Ticket médio", "Artigos", "Numerário", "Multibanco", "Outros", "Lançado por", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const s = byDay.get(d);
                const gap = s ? paymentGap(s) : null;
                const open = link({ data: d });
                return (
                  <tr key={d} className={d === day ? "selected-row" : ""}>
                    <td>
                      {shortDate(d)} <small className="muted">{weekday(d)}</small>
                    </td>
                    {s ? (
                      <>
                        <td>
                          {currency(Number(s.total_sales))}
                          {gap !== null && Math.abs(gap) >= 0.01 && <span className="pill warn" title="A soma dos pagamentos não coincide com o total">Pagamentos {gap > 0 ? "+" : ""}{currency(gap)}</span>}
                        </td>
                        <td>{integer(s.receipts)}</td>
                        <td>{s.receipts ? currency(Number(s.total_sales) / s.receipts) : "—"}</td>
                        <td>{integer(s.items)}</td>
                        <td>{currency(s.cash === null ? null : Number(s.cash))}</td>
                        <td>{currency(s.card === null ? null : Number(s.card))}</td>
                        <td>{currency(s.other_payment === null ? null : Number(s.other_payment))}</td>
                        <td>
                          {s.created_by_name || "—"}
                          {s.updated_at && <small className="muted"> · corrigido por {s.updated_by_name}</small>}
                        </td>
                        <td><Link href={open}>{canEditSale(viewer, store.id, s) ? "Corrigir" : "Ver"}</Link></td>
                      </>
                    ) : (
                      <>
                        <td><span className="pill">Por lançar</span></td>
                        <td colSpan={7} />
                        <td><Link href={open}>Lançar</Link></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
