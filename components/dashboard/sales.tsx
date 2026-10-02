import type { Period } from "@/lib/bi/periods";
import { liveCommerce } from "@/lib/bi/live-model";
import { awaitingFulfillment, canonicalOrders, detail, financialEvents, isPaid, isPending, number, overview, sum, unpaidAmount, type Store } from "@/lib/bi/model";
import { currency, fulfillmentLabel, integer, percent, statusLabel, text, timestamp } from "./format";
import { DetailNote, Panel, Table } from "./ui";

export function GaActivity({store,range}:{store:Store;range:Period}) {
  const s=overview(store,range);
  const totals=store.datasets.find(d=>d.source==="ga4" && d.dataset==="period_totals" && d.period_start===range.from && d.period_end===range.to)?.rows[0];
  return <div className="pulse-list">{[
    ["Sessões",s.gaSessions.value],
    ["Eventos de adição ao carrinho",number(totals?.add_to_carts)],
    ["Eventos de início de checkout",number(totals?.checkouts)],
    ["Eventos de compra",s.gaPurchases.value],
  ].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{integer(value as number|null)}</strong></div>)}</div>;
}
export function LiveSales({store,range}:{store:Store;range:Period}) {
  const c=liveCommerce(store,range);
  return <>
    <div className="three-col">{[
      ["Encomendas pagas recolhidas",integer(c.paidCount),currency(c.paidValue)],
      ["Pendentes de pagamento",integer(c.pendingCount),"Estado observado das encomendas recolhidas"],
      ["Pagas por preparar",integer(c.readyCount),"Não representa todo o backlog"],
    ].map(([label,value,note])=><article className="kpi" key={label}><div className="eyebrow">{label}</div><div className="kpi-value">{value}</div><p>{note}</p></article>)}</div>
    <Panel title="Encomendas do período" eyebrow="Shopify · consulta operacional" note={c.note}>
      <p className="data-note">Consulta: {timestamp(c.fetchedAt)} · {c.rows.length} encomendas distintas recolhidas. Até 100 apresentadas.</p>
      <Table headers={["Encomenda","Criada em","Pagamento","Preparação","Valor observado","Pagamento líquido observado"]}
        rows={c.rows.slice(0,100).map(r=>[text(r.name),text(r.created_date),statusLabel(r.financial_status),fulfillmentLabel(r),r.currency==="EUR"?currency(number(r.current_total)):"Moeda por confirmar",r.currency==="EUR"?currency(number(r.net_payment)):"—"])} />
    </Panel>
    <div className="two-col"><Panel title="Atividade da loja" eyebrow="GA4"><GaActivity store={store} range={range}/><p className="panel-note">Eventos de compra podem repetir a mesma encomenda. Requerem reconciliação antes de calcular conversão.</p></Panel>
      <Panel title="Indicadores a completar" eyebrow="Relatório oficial Shopify"><div className="quiet-callout">Vendas totais, composição, ticket médio oficial, produtos e sessões Shopify exigem a ligação aos fechos guardados. Os estados acima não substituem movimentos financeiros por data de pagamento.</div><p className="panel-note">Lucro e margem exigem custos confirmados de produtos, taxas e logística.</p></Panel></div>
  </>;
}
export function Sales({ store, range }: { store: Store; range: Period }) {
  if (store.mode === "live") return <LiveSales store={store} range={range} />;
  const s = overview(store, range),
    o = canonicalOrders(detail(store, range, "shopify", "orders", true)),
    ab = detail(store, range, "shopify", "abandoned", true),
    products = detail(store, range, "shopify", "products");
  const paidRows = o.rows.filter(isPaid),
    pendingRows = o.rows.filter(isPending),
    unfulfilled = o.rows.filter(awaitingFulfillment);
  const events = financialEvents(store, range);
  const names = [
    "Vendas brutas",
    "Descontos",
    "Reversões / devoluções",
    "Vendas líquidas",
    "Impostos",
    "Portes",
  ];
  const pendingTotal = sum(
    pendingRows.map((r) => ({ value: unpaidAmount(r) })),
    "value",
  );
  return (
    <>
      <div className="two-col">
        <Panel
          title="Como se compõem as vendas"
          eyebrow="Contabilidade comercial"
          note="Shopify Analytics. As reversões pertencem à data reconhecida em vendas; os pagamentos exigem eventos financeiros."
        >
          <div className="statement">
            {s.composition.map((m, i) => (
              <div key={m.field} className={i === 3 ? "subtotal" : ""}>
                <span>{names[i]}</span>
                <strong>{currency(m.value)}</strong>
              </div>
            ))}
            <div className="statement-total">
              <span>Vendas totais</span>
              <strong>{currency(s.sales.value)}</strong>
            </div>
          </div>
        </Panel>
        <Panel
          title="Pagamento e preparação"
          eyebrow="Encomendas criadas no período"
          note="Estado observado à hora da recolha. Esta coorte não é todo o backlog nem representa pagamentos ocorridos no período."
        >
          <DetailNote d={o} />
          <div className="ops-list">
            {[
              [
                "Pagas",
                o.complete ? integer(paidRows.length) : "—",
                currency(
                  o.complete
                    ? paidRows.length
                      ? sum(paidRows, "current_total")
                      : 0
                    : null,
                ),
              ],
              [
                "Pagamento pendente",
                o.complete ? integer(pendingRows.length) : "—",
                currency(
                  o.complete ? (pendingRows.length ? pendingTotal : 0) : null,
                ),
              ],
              [
                "Pagas por preparar",
                o.complete ? integer(unfulfilled.length) : "—",
                currency(
                  o.complete
                    ? unfulfilled.length
                      ? sum(unfulfilled, "current_total")
                      : 0
                    : null,
                ),
              ],
            ].map(([label, count, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
                <small>{value}</small>
              </div>
            ))}
          </div>
          <div className="quiet-callout">
            Lucro e margem indisponíveis: falta uma base confirmada de custos
            dos produtos, taxas e logística.
          </div>
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Produtos com maior venda líquida" eyebrow="Catálogo">
          <DetailNote d={products} totalAt={s.sales.fetchedAt} />
          <Table
            headers={["Produto", "Encomendas¹", "Venda líquida"]}
            rows={[...products.rows]
              .sort(
                (a, b) =>
                  (number(b.net_sales) || 0) - (number(a.net_sales) || 0),
              )
              .slice(0, 50)
              .map((r) => [
                text(r.product_title),
                integer(number(r.orders)),
                currency(number(r.net_sales)),
              ])}
          />
          <p className="panel-note">
            Até 50 produtos. ¹ Uma encomenda pode incluir vários produtos; estas
            contagens não se somam como encomendas únicas.
          </p>
        </Panel>
        <Panel title="Conversão da loja online" eyebrow="Shopify · sessões">
          <Funnel s={s} />
          <div className="mini-stats">
            <div>
              <span>Checkouts abandonados</span>
              <strong>
                {ab.complete
                  ? integer(ab.rows.filter((r) => !r.completed_at).length)
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Valor observado</span>
              <strong>
                {ab.complete
                  ? currency(
                      ab.rows.filter((r) => !r.completed_at).length
                        ? sum(
                            ab.rows.filter((r) => !r.completed_at),
                            "total",
                          )
                        : 0,
                    )
                  : "—"}
              </strong>
            </div>
          </div>
          <DetailNote d={ab} />
          <p className="panel-note">
            Não equivale a receita perdida. Recolha e recuperação podem ocorrer
            mais tarde.
          </p>
        </Panel>
      </div>
      <Panel
        title="Movimentos financeiros observados"
        eyebrow="Shopify · data de processamento"
      >
        <p className="data-note">
          {events.note} Recolha: {timestamp(events.fetchedAt)}.{" "}
          {events.excluded > 0
            ? `${events.excluded} registos sem data de processamento ou moeda confirmada foram excluídos.`
            : ""}
        </p>
        <Table
          headers={[
            "Processado em",
            "Encomenda",
            "Tipo",
            "Estado",
            "Método",
            "Montante",
          ]}
          rows={events.rows
            .slice(0, 100)
            .map((r) => [
              timestamp(text(r.processed_at)),
              text(r.order_name),
              text(r.kind),
              text(r.status),
              text(r.gateway),
              currency(number(r.amount)),
            ])}
        />
        <p className="panel-note">
          Até 100 eventos. Apenas SALE/CAPTURE com estado SUCCESS são
          recebimentos confirmados; PENDING e AUTHORIZATION não são pagamentos
          concluídos.
        </p>
      </Panel>
      <Panel title="Encomendas do período" eyebrow="Consulta operacional">
        <DetailNote d={o} />
        <Table
          headers={[
            "Encomenda",
            "Criada em",
            "Pagamento",
            "Preparação",
            "Total observado",
            "Recebido observado",
          ]}
          rows={o.rows
            .slice(0, 100)
            .map((r) => [
              text(r.name),
              text(r.created_date),
              statusLabel(r.financial_status),
              fulfillmentLabel(r),
              currency(number(r.current_total)),
              currency(number(r.received)),
            ])}
        />
        {o.rows.length > 100 && (
          <p className="panel-note">
            Primeiras 100 de {o.rows.length} encomendas. Os indicadores usam a
            coorte completa apenas quando a paginação foi confirmada.
          </p>
        )}
      </Panel>
    </>
  );
}
export function Funnel({ s }: { s: ReturnType<typeof overview> }) {
  const stages = [
    ["Sessões", s.sessions.value],
    ["Adição ao carrinho", s.cart.value],
    ["Chegaram ao checkout", s.checkouts.value],
    ["Concluíram o checkout", s.completed.value],
  ] as const;
  return (
    <div className="funnel">
      {stages.map(([label, value], i) => (
        <div key={label}>
          <div className="funnel-label">
            <span>
              <b>0{i + 1}</b>
              {label}
            </span>
            <strong>{integer(value)}</strong>
          </div>
          <div className="funnel-track">
            <i
              style={{
                width:
                  value !== null && s.sessions.value
                    ? `${Math.min(100, Math.max(0, (value / s.sessions.value) * 100))}%`
                    : "0%",
              }}
            />
          </div>
        </div>
      ))}
      <div className="funnel-result">
        <span>Taxa de conversão</span>
        <strong>
          {percent(s.conversion === null ? null : s.conversion * 100)}
        </strong>
      </div>
    </div>
  );
}
