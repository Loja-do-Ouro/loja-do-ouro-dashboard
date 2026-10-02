import Link from "next/link";
import type { Period } from "@/lib/bi/periods";
import type { liveCommerce } from "@/lib/bi/live-model";
import type { overview, Quality, Report, Store } from "@/lib/bi/model";
import { currency, integer, timestamp } from "./format";
import { Funnel, GaActivity } from "./sales";
import { Trend } from "./trend";
import { Change, Icon, Kpi, Panel } from "./ui";

export function Overview({ store, range, s, p, live, cohort, critical, report, href }: {
  store: Store;
  range: Period;
  s: ReturnType<typeof overview>;
  p: ReturnType<typeof overview>;
  live: boolean;
  cohort: ReturnType<typeof liveCommerce>;
  critical: Quality[];
  report?: Report;
  href: (section: string) => string;
}) {
  return (
  <>
    <div className="four-col">
      {live ? <article className="kpi"><div className="eyebrow">Encomendas pagas · valor</div><div className="kpi-value">{currency(cohort.paidValue)}</div><p>Valor observado das encomendas pagas recolhidas. Não é o total de vendas Shopify.</p><small>Shopify via Windsor · {timestamp(cohort.fetchedAt)}</small></article> : <Kpi label="Vendas totais" m={s.sales} prev={p.sales} />}
      {live ? <article className="kpi"><div className="eyebrow">Encomendas recolhidas</div><div className="kpi-value">{integer(cohort.count)}</div><p>{integer(cohort.paidCount)} pagas · {integer(cohort.pendingCount)} pendentes de pagamento</p><small>Coorte pela data de criação · cobertura não certificada</small></article> :
      <Kpi
        label="Encomendas"
        m={s.orders}
        prev={p.orders}
        format={integer}
      />}
      {live ? <Kpi label="Utilizadores GA4" m={s.users} prev={p.users} format={integer} /> :
      <Kpi
        label="Ticket médio"
        m={s.aov}
        prev={p.aov}
        note="Valor oficial Shopify para este período."
      />}
      <article className="kpi dark-kpi">
        <span className="eyebrow">Investimento em anúncios</span>
        <strong className="kpi-value">{currency(s.spend)}</strong>
        <Change a={s.spend} b={p.spend} />
        <p>
          Meta {currency(s.meta.value)} · Google{" "}
          {currency(s.google.value)}
        </p>
        <div className="mer-line">
          <span>Eficiência global · MER</span>
          <b>{s.mer === null ? "—" : `${integer(s.mer)}×`}</b>
        </div>
      </article>
    </div>
    <div className="overview-grid">
      <Panel
        title={live ? "Encomendas e investimento" : "Vendas e investimento"}
        eyebrow="EVOLUÇÃO DO PERÍODO"
        note={live ? "Valor observado das encomendas pagas, agrupado pela data de criação, e custos Meta + Google. Não representa recebimentos por dia. Dias sem encomendas recolhidas ficam sem valor." : "Vendas totais Shopify e custos Meta + Google. Valores em falta não são zero. Totais do período podem ter revisões posteriores às séries diárias."}
      >
        <Trend store={store} range={range} />
      </Panel>
      <Panel title="Da visita à compra" eyebrow="LOJA ONLINE">
        {live ? <GaActivity store={store} range={range} /> : <Funnel s={s} />}
        <p className="panel-note">
          {live ? "GA4 · sessões e eventos, com unidades distintas. Eventos de compra não equivalem a compras únicas; não se calcula uma taxa de conversão com tracking por reconciliar." : "Sessões Shopify. A taxa resulta de sessões com checkout concluído ÷ sessões."}
        </p>
      </Panel>
    </div>
    <div className="overview-grid">
      <Panel
        title="Prioridades para a gestão"
        eyebrow="O QUE MERECE ATENÇÃO"
      >
        <div className="priorities">
          {critical.length > 0 && (
            <Link href={href("quality")}>
              <b className="priority-number">01</b>
              <div>
                <span className="severity">MEDIÇÃO</span>
                <h3>Resolver as divergências de compras</h3>
                <p>{critical[0].message}</p>
              </div>
              <Icon name="arrow" />
            </Link>
          )}
          <Link href={href("sales")}>
            <b className="priority-number">
              {critical.length ? "02" : "01"}
            </b>
            <div>
              <span className="severity">OPERAÇÃO</span>
              <h3>Rever pagamentos e preparação</h3>
              <p>
                Consultar a coorte de encomendas, os valores pendentes
                e os produtos com maior venda líquida.
              </p>
            </div>
            <Icon name="arrow" />
          </Link>
          <Link href={href("quality")}>
            <b className="priority-number">
              {critical.length ? "03" : "02"}
            </b>
            <div>
              <span className="severity">FIABILIDADE</span>
              <h3>Ler o fecho e as suas limitações</h3>
              <p>
                {report
                  ? `Relatório v${report.version} · ${report.status === "partial" ? "parcial" : "provisório"}. Ver recomendações e histórico de revisões.`
                  : "Ainda não existe relatório guardado para estas datas exatas."}
              </p>
            </div>
            <Icon name="arrow" />
          </Link>
        </div>
      </Panel>
      <Panel title="Pulso da operação" eyebrow="PREPARAÇÃO E TRÁFEGO">
        <div className="pulse-list">
          {[
            [
              live ? "Pagas por preparar · recolhidas" : "Encomendas preparadas",
              live ? integer(cohort.readyCount) : integer(s.fulfilled.value),
              live ? "Estado observado da coorte" : "Shopify · fulfillments",
            ],
            [
              live ? "Pendentes de pagamento · recolhidas" : "Encomendas expedidas",
              live ? integer(cohort.pendingCount) : integer(s.shipped.value),
              live ? "Não inclui todo o backlog" : "Estado reportado pela integração",
            ],
            [
              "Utilizadores GA4",
              integer(s.users.value),
              "Total distinto do período",
            ],
            [
              "Eventos de compra GA4",
              integer(s.gaPurchases.value),
              "Não equivale a compras únicas",
            ],
          ].map(([l, v, n]) => (
            <div key={l}>
              <div>
                <span>{l}</span>
                <small>{n}</small>
              </div>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <p className="panel-note">
          Expedições a zero na integração não provam ausência de
          envios físicos. MER não mede lucro.
        </p>
      </Panel>
    </div>
  </>
  );
}
