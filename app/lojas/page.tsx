import Link from "next/link";
import { redirect } from "next/navigation";
import { localDate, shift, shortDate, validDate } from "@/lib/bi/periods";
import { canEditRecord, homePath, STORE_BACKDATE_DAYS } from "@/lib/permissions";
import { activeOptions, loadOptions, pickStore } from "@/lib/records";
import { count, ITEM_ROWS, label, monthRange, summarizeShop, type ShopSale } from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent, timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { Breakdown, inputAmount, MonthNav, Select, StoreChips, weekday, YesNo } from "@/components/stores";
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
  const [all, rows] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", { p_session: viewer.session, p_store_id: store.id, p_from: from, p_to: to }),
  ]);
  const options = activeOptions(all);
  const editing = typeof q.editar === "string" ? rows.find((r) => r.id === q.editar) || null : null;
  const canEdit = !editing || canEditRecord(viewer, store.id, editing);
  const manager = store.level === "manager";
  const minDate = manager ? undefined : shift(today, -STORE_BACKDATE_DAYS);
  const dayRows = rows.filter((r) => r.sale_date === day);
  const sum = summarizeShop(rows, all);
  const link = (params: Record<string, string>) => `/lojas?${new URLSearchParams({ loja: store.code, mes: month, dia: day, ...params })}`;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const sold = rows.filter((r) => r.sold);
  const items = sold.flatMap((r) => r.items || []);
  const itemRows = Math.max(ITEM_ROWS, (editing?.items.length || 0) + 1);

  return (
    <AppShell viewer={viewer} current="lojas" title="Vendas e atendimentos">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title={`Vendas e atendimentos · ${store.name}`}
        text="Registe cada cliente atendido, com ou sem venda. Substitui a folha “Análise de Vendas”."
      />
      <StoreChips stores={viewer.stores} current={store.id} href={(code) => `/lojas?${new URLSearchParams({ loja: code, mes: month })}`} />
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
              <label>
                Dia
                <input type="date" name="sale_date" required defaultValue={editing?.sale_date || day} max={today} min={minDate} />
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
                <div className="item-rows">
                  {Array.from({ length: itemRows }, (_, i) => {
                    const it = editing?.items[i];
                    return (
                      <div className="item-row" key={i}>
                        <input name={`item_${i}_reference`} maxLength={40} placeholder="Referência" aria-label={`Referência do artigo ${i + 1}`} defaultValue={it?.reference || ""} />
                        <Select name={`item_${i}_material`} options={options.material} value={it?.material} empty="Material…" />
                        <Select name={`item_${i}_type`} options={options.product_type} value={it?.product_type} empty="Tipo de artigo…" />
                      </div>
                    );
                  })}
                </div>
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
              {editing.source === "import" ? "Importado do Excel" : `Registado por ${editing.created_by_name || "—"}`} em {timestamp(editing.created_at)}
              {editing.updated_at ? ` · corrigido por ${editing.updated_by_name || "—"} em ${timestamp(editing.updated_at)}` : ""}.
            </p>
          )}
          {editing && manager && (
            <form action={removeShopSale} className="danger-zone">
              <input type="hidden" name="record_id" value={editing.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="dia" value={day} />
              <button type="submit" className="danger-button">Apagar este registo</button>
              <small>Fica guardado no histórico de alterações.</small>
            </form>
          )}
        </Panel>
        <Panel title={`Resumo do mês`} eyebrow={store.name.toUpperCase()}>
          <MonthNav month={month} today={today} href={(m) => `/lojas?${new URLSearchParams({ loja: store.code, mes: m })}`} />
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
      <Panel title={`Atendimentos de ${shortDate(day)}`} eyebrow={weekday(day).toUpperCase()}>
        <form method="get" className="inline-form">
          <input type="hidden" name="loja" value={store.code} />
          <label>
            Ver outro dia
            <input type="date" name="dia" defaultValue={day} max={today} />
          </label>
          <button type="submit" className="secondary-button">Abrir</button>
        </form>
        <div className="table-scroll" tabIndex={0} aria-label="Atendimentos do dia">
          <table className="left-table nums">
            <thead>
              <tr>
                {["N.º venda", "Resultado", "Valor", "Artigos", "Cliente", "Viu em", "Campanha", "Registado por", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayRows.map((r) => (
                <tr key={r.id} className={r.id === editing?.id ? "selected-row" : ""}>
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
                  <td>{r.source === "import" ? "Excel" : r.created_by_name}</td>
                  <td>
                    <Link href={link({ editar: r.id })}>{canEditRecord(viewer, store.id, r) ? "Corrigir" : "Ver"}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!dayRows.length && <p className="panel-note">Ainda não há atendimentos registados neste dia.</p>}
      </Panel>
      <Panel title="O que aconteceu no mês" eyebrow={`${integer(sum.served)} ATENDIMENTOS`} note="Percentagens sobre as respostas dadas; registos importados do Excel podem não ter todas as respostas.">
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
