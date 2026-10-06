import type { Period } from "@/lib/bi/periods";
import { byCampaign, detail, number, overview, type Row, type Store } from "@/lib/bi/model";
import { currency, integer, text } from "./format";
import { DetailNote, Empty, Icon, Kpi, Panel, Table } from "./ui";
import { DESTINATION_LABEL, onlineInvestment } from "@/lib/bi/channels";

const CAMPAIGN_LIMIT = 50;
const META_VALUES = ["spend", "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase"];
const GOOGLE_VALUES = ["spend", "conversions", "conversions_value"];

export function Marketing({ store, range }: { store: Store; range: Period }) {
  const s = overview(store, range),
    meta = detail(store, range, "meta", "ads", true),
    google = detail(store, range, "google_ads", "campaigns", true),
    actions = detail(store, range, "google_ads", "conversion_actions", true),
    channels = detail(store, range, "ga4", "channels"),
    newsletters = detail(store,range,"klaviyo","campaigns"),
    flows = detail(store,range,"klaviyo","flows"),
    seo = detail(store,range,"searchconsole","period_totals"),
    merchant = detail(store,range,"google_merchant","status");
  const inv = onlineInvestment(store, range, s.spend, s.sales.value);
  // Detail rows are per ad and day; the tables show one line per campaign.
  const metaCampaigns = byCampaign(meta.rows, META_VALUES),
    googleCampaigns = byCampaign(google.rows, GOOGLE_VALUES);
  const rows = (campaigns: Row[], [conversions, value]: string[], ads: boolean) =>
    campaigns.slice(0, CAMPAIGN_LIMIT).map((r) => [
      <span>
        {text(r.campaign)}
        {ads && number(r.ads) ? (
          <small className="table-subtitle">{integer(number(r.ads))} anúncios</small>
        ) : null}
      </span>,
      currency(number(r.spend)),
      integer(number(r[conversions])),
      currency(number(r[value])),
    ]);
  const headers = ["Campanha", "Investimento", "Conversões¹", "Valor atribuído"];
  const limitNote = (n: number) =>
    n > CAMPAIGN_LIMIT ? ` · ${CAMPAIGN_LIMIT} de ${n} campanhas, por investimento` : ` · ${n} campanhas`;
  return (
    <>
      <div className="three-col">
        <Kpi label="Investimento Meta" m={s.meta} />
        <Kpi label="Investimento Google" m={s.google} />
        <article className="kpi dark-kpi">
          <span className="eyebrow">{inv.mer !== null ? "Eficiência online · MER" : "Eficiência global · MER"}</span>
          <strong className="kpi-value">
            {(inv.mer ?? s.mer) === null ? "—" : `${integer(inv.mer ?? s.mer)}×`}
          </strong>
          <p>
            {inv.mer !== null
              ? `Vendas totais Shopify ÷ investimento online (${currency(inv.online)}). Exclui as campanhas das lojas físicas. Não mede lucro nem ROAS atribuído.`
              : "Vendas totais Shopify ÷ investimento Meta + Google, sem separar lojas físicas (detalhe de campanhas incompleto). Não mede lucro nem ROAS atribuído."}
          </p>
        </article>
      </div>
      <div className="two-col">
        <Panel title="Investimento por destino" eyebrow="Online · lojas físicas" note={`Classificação: a campanha com o nome de uma loja (palavra-chave em Administração → Lojas) é dessa loja; as restantes são do online; exceções em Administração → Campanhas.${inv.split.note ? ` ${inv.split.note}` : ""}`}>
          <Table
            headers={["", "Online", "Lojas físicas", "Partilhado"]}
            rows={[
              ["Meta", currency(inv.split.bySource.meta?.online ?? null), currency(inv.split.bySource.meta?.store ?? null), currency(inv.split.bySource.meta?.shared ?? null)],
              ["Google Ads", currency(inv.split.bySource.google_ads?.online ?? null), currency(inv.split.bySource.google_ads?.store ?? null), currency(inv.split.bySource.google_ads?.shared ?? null)],
              [<strong key="t">Total (campanhas)</strong>, <strong key="o">{currency(inv.split.online)}</strong>, <strong key="s">{currency(inv.split.store)}</strong>, <strong key="h">{currency(inv.split.shared)}</strong>],
            ]}
          />
          <h3>Por loja física</h3>
          <Table
            headers={["Loja", "Meta", "Google", "Total"]}
            rows={inv.split.byStore.map((r) => [r.name, currency(r.meta), currency(r.google), currency(r.total)])}
            empty="Sem campanhas de lojas físicas neste período."
          />
        </Panel>
        <Panel title="Campanhas e destino" eyebrow="Classificação">
          <Table
            headers={["Campanha", "Origem", "Destino", "Investimento"]}
            rows={inv.split.campaigns.filter((c) => c.spend > 0).slice(0, 60).map((c) => [
              text(c.campaign),
              c.source === "meta" ? "Meta" : "Google",
              <span key="d">{c.destination === "store" ? c.storeName || "Loja física" : DESTINATION_LABEL[c.destination]}{c.rule === "manual" ? <small className="table-subtitle">definido manualmente</small> : null}</span>,
              currency(c.spend),
            ])}
            empty="Sem detalhe de campanhas para este período."
          />
        </Panel>
      </div>
      <div className="notice">
        <Icon name="check" />
        <span>
          As conversões atribuídas às plataformas podem sobrepor-se. Não se
          somam Meta, Google e GA4 como compras únicas. Aumentos de investimento
          exigem primeiro um diagnóstico de tracking.
        </span>
      </div>
      <div className="two-col">
        <Panel title="Campanhas Meta" eyebrow="Atribuição da plataforma">
          <DetailNote d={meta} totalAt={s.meta.fetchedAt} />
          <p className="data-note">Somado por campanha{limitNote(metaCampaigns.length)}</p>
          <Table headers={headers} rows={rows(metaCampaigns, META_VALUES.slice(1), true)} />
          <p className="panel-note">
            ¹ Compras website, atribuição predefinida de 7 dias clique / 1 dia
            visualização. Inclui encomendas ainda pendentes.
          </p>
        </Panel>
        <Panel title="Campanhas Google" eyebrow="Atribuição da plataforma">
          <DetailNote d={google} totalAt={s.google.fetchedAt} />
          <p className="data-note">Somado por campanha{limitNote(googleCampaigns.length)}</p>
          <Table headers={headers} rows={rows(googleCampaigns, GOOGLE_VALUES.slice(1), false)} />
          <p className="panel-note">
            ¹ Ações configuradas para a métrica conversions, de várias
            categorias. O investimento principal vem exclusivamente dos totais.
          </p>
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Ações de conversão Google">
          <DetailNote d={actions} />
          <Table
            headers={["Ação", "Categoria", "Conversões", "Valor atribuído"]}
            rows={actions.rows
              .slice(0, 100)
              .map((r) => [
                text(r.conversion_action_name),
                text(r.conversion_action_category),
                integer(number(r.conversions)),
                currency(number(r.conversions_value)),
              ])}
          />
          <p className="panel-note">
            Duas ações PURCHASE podem referir a mesma compra. Custos nunca são
            somados por ação de conversão.
          </p>
        </Panel>
        <Panel title="Origem das sessões" eyebrow="GA4 · fonte / meio">
          <DetailNote d={channels} totalAt={s.gaSessions.fetchedAt} />
          <Table
            headers={["Origem", "Sessões", "Eventos de compra", "Receita GA4"]}
            rows={[...channels.rows]
              .sort(
                (a, b) => (number(b.sessions) || 0) - (number(a.sessions) || 0),
              )
              .slice(0, 30)
              .map((r) => [
                text(r.session_source_medium),
                integer(number(r.sessions)),
                integer(number(r.ecommerce_purchases)),
                currency(number(r.purchase_revenue)),
              ])}
          />
          <p className="panel-note">
            30 principais origens. Referências de pagamento podem indicar
            problemas de atribuição; a causa requer diagnóstico.
          </p>
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Newsletters e automações" eyebrow="CRM">
          {store.mode === "live" || newsletters.datasets.length || flows.datasets.length ? <>
            <h3>Campanhas · Klaviyo</h3>
            <Table headers={["Campanha","Destinatários","Conversões atribuídas"]} rows={newsletters.rows.filter(r=>r.campaign).slice(0,30).map(r=>[text(r.campaign),integer(number(r.campaign_report_recipients)),integer(number(r.campaign_report_conversions))])} />
            <h3>Automações · Klaviyo</h3>
            <Table headers={["Automação","Destinatários","Conversões atribuídas"]} rows={flows.rows.filter(r=>r.flow_name).slice(0,30).map(r=>[text(r.flow_name),integer(number(r.flow_recipients)),integer(number(r.flow_conversions))])}/>
            <p className="panel-note">Até 30 linhas por conjunto. Atribuição Klaviyo, sem reconciliação financeira Shopify. O período pode depender do envio e da janela de atribuição; não certifica compras únicas nem pagas nas datas selecionadas.</p>
          </> : <Empty>
            Sem relatório Klaviyo reconciliado com Shopify guardado para este
            período. Não se atribuem vendas a newsletters por simples
            correspondência de nomes ou URLs.
          </Empty>}
          <p className="panel-note">
            Campanhas e emails automáticos devem ser analisados separadamente,
            com as encomendas e o estado de pagamento observado.
          </p>
        </Panel>
        <Panel
          title="Pesquisa, Shopping e Stories"
          eyebrow="Crescimento orgânico"
        >
          {store.mode === "live" || seo.datasets.length || merchant.datasets.length ? <>
            <h3>Pesquisa orgânica · período selecionado</h3>
            <Table headers={["Cliques","Impressões","Posição média"]} rows={seo.rows.length===1?[[integer(number(seo.rows[0].clicks)),integer(number(seo.rows[0].impressions)),integer(number(seo.rows[0].position))]]:[]} />
            <h3>Shopping · estado observado na consulta</h3>
            <Table headers={["País","Ativos","Reprovados","Pendentes"]} rows={merchant.rows.filter(r=>String(r.product_status_country)==="PT" && String(r.product_status_reporting_context)==="SHOPPING_ADS").map(r=>["Portugal",integer(number(r.product_status_active_count)),integer(number(r.product_status_disapproved_count)),integer(number(r.product_status_pending_count))])} />
            <p className="panel-note">Merchant Center: fotografia do estado na consulta, sem histórico certificado do período selecionado. Stories: sem cobertura confirmada.</p>
          </> : <Empty>
            Os fechos disponíveis não incluem cobertura confirmada de Search
            Console, Merchant Center e Stories neste período.
          </Empty>}
          <p className="panel-note">
            Sem cobertura, não se apresentam zeros nem recomendações para
            alterar a frequência de publicação.
          </p>
        </Panel>
      </div>
    </>
  );
}
