import Link from "next/link";
import { redirect } from "next/navigation";
import { localDate, shift, shortDate, validDate } from "@/lib/bi/periods";
import { canEditRecord, homePath, STORE_BACKDATE_DAYS } from "@/lib/permissions";
import { activeOptions, loadOptions, pickStore } from "@/lib/records";
import {
  count, ITEM_ROWS, label, listNeighbours, listPeriod, listRows, listShow, listView, MAX_ITEMS, monthRange, summarizeShop, type ListShow, type ListView, type ShopSale,
} from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent, timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { Breakdown, inputAmount, monthLabel, MonthNav, Select, StoreChips, weekday, YesNo } from "@/components/stores";
import { ItemRows } from "@/components/item-rows";
import { removeShopSale, saveShopSale } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendas e atendimentos · Loja do Ouro" };

const OK: Record<string, string> = { saved: "Atendimento registado.", updated: "Registo corrigido.", deleted: "Registo apagado." };

export default async function ShopSalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.stores.length) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const store = pickStore(viewer, q.loja);
  const today = localDate();
  const askedDay = typeof q.dia === "string" && validDate(q.dia) && q.dia <= today ? q.dia : null;
  const { month, from, to } = monthRange(typeof q.mes === "string" && q.mes ? q.mes : askedDay?.slice(0, 7), today);
  const day = askedDay && askedDay.startsWith(month) ? askedDay : to;
  // Lista de atendimentos: o dia, a semana (de segunda a domingo, pode passar para o mês ao lado) ou o mês.
  const view = listView(q.vista);
  const show = listShow(q.mostrar);
  const period = listPeriod(view, day, { from, to }, today);
  const [all, fetched] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", {
      p_session: viewer.session, p_store_id: store.id, p_from: period.from < from ? period.from : from, p_to: period.to > to ? period.to : to,
    }),
  ]);
  // Resumo e análises: sempre o mês.
  const rows = fetched.filter((r) => r.sale_date >= from && r.sale_date <= to);
  const options = activeOptions(all);
  const editing = typeof q.editar === "string" ? fetched.find((r) => r.id === q.editar) || null : null;
  const canEdit = !editing || canEditRecord(viewer, store.id, editing);
  const manager = store.level === "manager";
  const minDate = manager ? undefined : shift(today, -STORE_BACKDATE_DAYS);
  // A vista e o filtro da lista mantêm-se ao mudar de loja ou de mês.
  const keep: Record<string, string> = { ...(view !== "dia" ? { vista: view } : {}), ...(show !== "todos" ? { mostrar: show } : {}) };
  const listed = listRows(fetched, period.from, period.to, show);
  const listedSales = listed.filter((r) => r.sold);
  const listedValue = listedSales.reduce((t, r) => t + (Number(r.total_value) || 0), 0);
  const around = listNeighbours(view, day, month, today);
  const sum = summarizeShop(rows, all);
  const link = (params: Record<string, string>) =>
    `/lojas?${new URLSearchParams({ loja: store.code, mes: month, dia: day, ...(view !== "dia" ? { vista: view } : {}), ...(show !== "todos" ? { mostrar: show } : {}), ...params })}`;
  // Outro período na lista (o mês acompanha o dia escolhido).
  const goTo = (d: string, v: ListView = view, m: ListShow = show) =>
    `/lojas?${new URLSearchParams({ loja: store.code, mes: d.slice(0, 7), dia: d, ...(v !== "dia" ? { vista: v } : {}), ...(m !== "todos" ? { mostrar: m } : {}) })}`;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const sold = rows.filter((r) => r.sold);
  const items = sold.flatMap((r) => r.items || []);
  const itemRows = Math.max(ITEM_ROWS, (editing?.items.length || 0) + 1);
  // Data de um registo novo: na vista do dia, o dia aberto (para registar vários seguidos); na semana e no mês, hoje
  // (o dia de referência dessas vistas só serve para navegar).
  const newDate = view === "dia" ? day : today;
  const listTitle = view === "dia" ? `Atendimentos de ${shortDate(day)}`
    : view === "semana" ? `Atendimentos da semana de ${shortDate(period.from)} a ${shortDate(period.to)}`
      : `Atendimentos de ${monthLabel(month).toLowerCase()}`;
  const SHOW_LABEL: Record<ListShow, string> = { todos: "Todos", vendas: "Só vendas", sem: "Só sem venda" };

  return (
    <AppShell viewer={viewer} current="lojas" title="Vendas e atendimentos">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title={`Vendas e atendimentos · ${store.name}`}
        text="Cada cliente atendido, com ou sem venda. Enquanto as lojas usarem a folha “Análise de Vendas”, os dados entram daí todas as madrugadas e antes do alerta das 22h; um dia registado aqui no formulário fica com o formulário."
      />
      <StoreChips stores={viewer.stores} current={store.id} href={(code) => `/lojas?${new URLSearchParams({ loja: code, mes: month, ...keep })}`} />
      <Flash ok={ok} error={error} />
      <div className="two-col sales-entry">
        <Panel title={editing ? "Corrigir atendimento" : "Registar atendimento"} eyebrow={editing ? `REGISTO DE ${shortDate(editing.sale_date)}` : "NOVO CLIENTE"}>
          {canEdit ? (
            <form action={saveShopSale} className="form-grid" key={editing?.id || `novo-${day}-${rows.length}`}>
              <input type="hidden" name="record_id" value={editing?.id || ""} />
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="dia" value={day} />
              {view !== "dia" && <input type="hidden" name="vista" value={view} />}
              {show !== "todos" && <input type="hidden" name="mostrar" value={show} />}
              <label>
                Dia
                <input type="date" name="sale_date" required defaultValue={editing?.sale_date || newDate} max={today} min={minDate} />
              </label>
              <label>
                N.º da venda (talão)
                <input name="sale_number" maxLength={40} autoComplete="off" defaultValue={editing?.sale_number || ""} placeholder="ex.: 9002830" />
              </label>
              <fieldset className="wide">
                <legend>Houve venda?</legend>
                <span className="yes-no">
                  <label><input type="radio" name="sold" value="sim" required defaultChecked={editing ? editing.sold : true} /> Sim, vendeu</label>
                  <label><input type="radio" name="sold" value="nao" defaultChecked={editing ? !editing.sold : false} /> Não vendeu</label>
                </span>
              </fieldset>
              <label>
                Valor da venda (€)
                <input name="total_value" inputMode="decimal" autoComplete="off" placeholder="0,00" defaultValue={inputAmount(editing?.total_value)} />
              </label>
              <label>
                Foi por campanha?
                <select name="campaign" required defaultValue={editing ? (editing.campaign ? editing.campaign_code || options.campaign.at(-1)?.code || "" : editing.campaign === false ? "nao" : "") : ""}>
                  <option value="">Escolher…</option>
                  <option value="nao">Não</option>
                  {options.campaign.map((o) => (
                    <option key={o.code} value={o.code}>Sim — {o.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="wide">
                <legend>Artigos vendidos</legend>
                <ItemRows initial={editing?.items || []} rows={itemRows} max={MAX_ITEMS} materials={options.material} types={options.product_type} />
              </fieldset>
              <label>
                Tipo de cliente
                <Select name="client_type" options={options.client_type} value={editing?.client_type} required />
              </label>
              <label>
                Onde viu o produto?
                <Select name="seen_where" options={options.seen_where} value={editing?.seen_where} required />
              </label>
              <fieldset>
                <legend>Já comprou online?</legend>
                <YesNo name="bought_online" value={editing?.bought_online} required />
              </fieldset>
              <label>
                Para quem é?
                <Select name="purpose" options={options.purpose} value={editing?.purpose} empty="Não sabe / não disse" />
              </label>
              <label className="wide">
                Pedido de reposição
                <Select name="restock" options={options.restock} value={editing?.restock} empty="Escolher…" />
              </label>
              <fieldset className="wide no-sale">
                <legend>Se não vendeu</legend>
                <label>
                  Motivo de não venda
                  <Select name="no_sale_reason" options={options.no_sale_reason} value={editing?.no_sale_reason} />
                </label>
                <label>
                  O que procurava?
                  <input name="looking_for" maxLength={300} defaultValue={editing?.looking_for || ""} placeholder="ex.: anel de prata com pedras azuis" />
                </label>
              </fieldset>
              <label className="wide">
                Observações
                <textarea name="notes" rows={2} maxLength={1000} defaultValue={editing?.notes || ""} />
              </label>
              <div className="wide form-actions">
                <button type="submit">{editing ? "Guardar correção" : "Registar atendimento"}</button>
                {editing && <Link href={link({})}>Cancelar</Link>}
                {!manager && !editing && <small>Pode corrigir o que registou durante 24 horas.</small>}
              </div>
            </form>
          ) : (
            <div className="quiet-callout">Este registo já não pode ser alterado aqui. Para o corrigir, contacte o Gestor da loja.</div>
          )}
          {editing && (
            <p className="panel-note">
              {editing.source === "import" ? "Importado do Excel" : editing.source === "sheet" ? "Importado da folha Análise de Vendas" : `Registado por ${editing.created_by_name || "—"}`} em {timestamp(editing.created_at)}
              {editing.updated_at ? ` · corrigido por ${editing.updated_by_name || "—"} em ${timestamp(editing.updated_at)}` : ""}.
            </p>
          )}
          {editing && manager && (
            <form action={removeShopSale} className="danger-zone">
              <input type="hidden" name="record_id" value={editing.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="dia" value={day} />
              {view !== "dia" && <input type="hidden" name="vista" value={view} />}
              {show !== "todos" && <input type="hidden" name="mostrar" value={show} />}
              <button type="submit" className="danger-button">Apagar este registo</button>
              <small>Fica guardado no histórico de alterações.</small>
            </form>
          )}
        </Panel>
        <Panel title={`Resumo do mês`} eyebrow={store.name.toUpperCase()}>
          <MonthNav month={month} today={today} href={(m) => `/lojas?${new URLSearchParams({ loja: store.code, mes: m, ...keep })}`} />
          <div className="mini-stats two">
            <div><span>Total vendido</span><strong>{currency(sum.value)}</strong></div>
            <div><span>Vendas / atendimentos</span><strong>{sum.sales} / {sum.served}</strong></div>
            <div><span>Ticket médio</span><strong>{currency(sum.avgTicket)}</strong></div>
            <div><span>Taxa de venda</span><strong>{percent(sum.conversion)}</strong></div>
            <div><span>Viram o produto online</span><strong>{percent(sum.digitalShare)}</strong></div>
            <div><span>Clientes novos</span><strong>{percent(sum.newShare)}</strong></div>
            <div><span>Vendas com campanha</span><strong>{percent(sum.campaignShare)}</strong></div>
            <div><span>Já compraram online</span><strong>{percent(sum.boughtOnlineShare)}</strong></div>
          </div>
        </Panel>
      </div>
      <Panel title={listTitle} eyebrow={view === "dia" ? weekday(day).toUpperCase() : view === "semana" ? "SEMANA" : "MÊS"}>
        <div className="list-controls">
          <nav className="segmented" aria-label="Período da lista">
            {(["dia", "semana", "mes"] as ListView[]).map((v) => (
              <Link key={v} href={goTo(day, v)} className={v === view ? "active" : ""} aria-current={v === view ? "page" : undefined}>
                {v === "dia" ? "Dia" : v === "semana" ? "Semana" : "Mês"}
              </Link>
            ))}
          </nav>
          <div className="period-nav">
            <Link className="outline-button" href={goTo(around.prev)} aria-label={view === "dia" ? "Dia anterior" : view === "semana" ? "Semana anterior" : "Mês anterior"}>‹</Link>
            {around.next ? (
              <Link className="outline-button" href={goTo(around.next)} aria-label={view === "dia" ? "Dia seguinte" : view === "semana" ? "Semana seguinte" : "Mês seguinte"}>›</Link>
            ) : (
              <span className="outline-button disabled" aria-hidden="true">›</span>
            )}
          </div>
          <form method="get" className="inline-form">
            <input type="hidden" name="loja" value={store.code} />
            {view !== "dia" && <input type="hidden" name="vista" value={view} />}
            {show !== "todos" && <input type="hidden" name="mostrar" value={show} />}
            <label>
              {view === "mes" ? "Ver o mês do dia" : view === "semana" ? "Ver a semana do dia" : "Ver outro dia"}
              <input type="date" name="dia" defaultValue={day} max={today} />
            </label>
            <button type="submit" className="secondary-button">Abrir</button>
          </form>
          <nav className="segmented small" aria-label="Mostrar">
            {(["todos", "vendas", "sem"] as ListShow[]).map((m) => (
              <Link key={m} href={goTo(day, view, m)} className={m === show ? "active" : ""} aria-current={m === show ? "page" : undefined}>{SHOW_LABEL[m]}</Link>
            ))}
          </nav>
        </div>
        <p className="list-summary">
          {show === "sem"
            ? `${integer(listed.length)} atendimento${listed.length === 1 ? "" : "s"} sem venda`
            : `${integer(listedSales.length)} venda${listedSales.length === 1 ? "" : "s"} · ${currency(listedValue)}${show === "todos" ? ` · ${integer(listed.length - listedSales.length)} sem venda` : ""}`}
        </p>
        <div className="table-scroll" tabIndex={0} aria-label="Atendimentos do período">
          <table className="left-table nums">
            <thead>
              <tr>
                {[...(view === "dia" ? [] : ["Dia"]), "N.º venda", "Resultado", "Valor", "Artigos", "Cliente", "Viu em", "Campanha", "Registado por", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((r) => (
                <tr key={r.id} className={r.id === editing?.id ? "selected-row" : ""}>
                  {view !== "dia" && <td>{shortDate(r.sale_date)}<small className="block muted">{weekday(r.sale_date)}</small></td>}
                  <td>{r.sale_number || "—"}</td>
                  <td>{r.sold ? <span className="pill ok">Venda</span> : <span className="pill warn">{label(all, "no_sale_reason", r.no_sale_reason)}</span>}</td>
                  <td>{r.sold && r.total_value !== null ? currency(Number(r.total_value)) : "—"}</td>
                  <td>
                    {(r.items || []).map((it, i) => (
                      <small key={i} className="block">
                        {[label(all, "product_type", it.product_type), label(all, "material", it.material)].filter((x) => x !== "—").join(" · ") || "—"}
                        {it.reference ? ` (${it.reference})` : ""}
                      </small>
                    ))}
                  </td>
                  <td>{label(all, "client_type", r.client_type)}</td>
                  <td>{label(all, "seen_where", r.seen_where)}</td>
                  <td>{r.campaign ? label(all, "campaign", r.campaign_code) : r.campaign === false ? "Não" : "—"}</td>
                  <td>{r.source === "import" || r.source === "sheet" ? "Folha" : r.created_by_name}</td>
                  <td>
                    <Link href={link({ editar: r.id })}>{canEditRecord(viewer, store.id, r) ? "Corrigir" : "Ver"}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!listed.length && (
          <p className="panel-note">
            {show === "todos" ? "Ainda não há atendimentos registados" : show === "vendas" ? "Não há vendas registadas" : "Não há atendimentos sem venda registados"}
            {view === "dia" ? " neste dia." : view === "semana" ? " nesta semana." : " neste mês."}
          </p>
        )}
      </Panel>
      <Panel title="O que aconteceu no mês" eyebrow={`${integer(sum.served)} ATENDIMENTOS`} note="Percentagens sobre as respostas dadas; registos importados da folha Análise de Vendas podem não ter todas as respostas.">
        <div className="breakdowns">
          <Breakdown title="Onde viu o produto" rows={count(rows, (r) => r.seen_where)} options={all.seen_where} total={rows.filter((r) => r.seen_where).length} />
          <Breakdown title="Tipo de cliente" rows={count(rows, (r) => r.client_type)} options={all.client_type} total={rows.filter((r) => r.client_type).length} />
          <Breakdown title="Material vendido" rows={count(items, (i) => i.material)} options={all.material} total={items.filter((i) => i.material).length} />
          <Breakdown title="Artigos vendidos" rows={count(items, (i) => i.product_type)} options={all.product_type} total={items.filter((i) => i.product_type).length} />
          <Breakdown title="Campanhas" rows={count(sold.filter((r) => r.campaign), (r) => r.campaign_code || "outra")} options={all.campaign} total={sold.length} />
          <Breakdown title="Motivos de não venda" rows={count(rows.filter((r) => !r.sold), (r) => r.no_sale_reason)} options={all.no_sale_reason} total={sum.notSold} />
        </div>
      </Panel>
    </AppShell>
  );
}
