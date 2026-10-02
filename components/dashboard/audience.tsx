import type { Period } from "@/lib/bi/periods";
import { detail, number, overview, type Store } from "@/lib/bi/model";
import { currency, integer, text } from "./format";
import { DetailNote, Kpi, Panel, Table } from "./ui";

export function Audience({ store, range }: { store: Store; range: Period }) {
  const s = overview(store, range),
    geo = detail(store, range, "ga4", "geography"),
    demo = detail(store, range, "ga4", "demographics"),
    mg = detail(store, range, "meta", "geography"),
    md = detail(store, range, "meta", "demographics");
  return (
    <>
      <div className="three-col">
        <Kpi label="Utilizadores GA4" m={s.users} format={integer} />
        <Kpi label="Utilizadores ativos" m={s.activeUsers} format={integer} />
        <Kpi label="Sessões GA4" m={s.gaSessions} format={integer} />
      </div>
      <div className="two-col">
        <Panel title="Procura por região" eyebrow="GA4 · 30 principais cidades">
          <DetailNote d={geo} totalAt={s.gaSessions.fetchedAt} />
          <Table
            headers={[
              "País / cidade",
              "Utilizadores¹",
              "Sessões",
              "Eventos de compra",
            ]}
            rows={[...geo.rows]
              .sort(
                (a, b) => (number(b.sessions) || 0) - (number(a.sessions) || 0),
              )
              .slice(0, 30)
              .map((r) => [
                `${text(r.country)} · ${text(r.city)}`,
                integer(number(r.totalusers)),
                integer(number(r.sessions)),
                integer(number(r.ecommerce_purchases)),
              ])}
          />
        </Panel>
        <Panel title="Perfil de audiência" eyebrow="GA4 · escalões declarados">
          <DetailNote d={demo} totalAt={s.activeUsers.fetchedAt} />
          <Table
            headers={["Idade", "Género", "Utilizadores ativos¹"]}
            rows={demo.rows.map((r) => [
              text(r.age),
              text(r.gender),
              integer(number(r.active_users)),
            ])}
          />
          <p className="panel-note">
            ¹ Utilizadores distintos não se somam entre dias nem entre
            segmentos. “unknown” é informação indisponível; os limiares de
            privacidade podem afetar a cobertura.
          </p>
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Distribuição do investimento" eyebrow="Meta · países">
          <DetailNote d={mg} totalAt={s.meta.fetchedAt} />
          <Table
            headers={[
              "País",
              "Investimento",
              "Impressões",
              "Compras atribuídas",
            ]}
            rows={mg.rows.map((r) => [
              text(r.country),
              currency(number(r.spend)),
              integer(number(r.impressions)),
              integer(number(r.actions_offsite_conversion_fb_pixel_purchase)),
            ])}
          />
        </Panel>
        <Panel title="Públicos dos anúncios" eyebrow="Meta · idade e género">
          <DetailNote d={md} totalAt={s.meta.fetchedAt} />
          <Table
            headers={[
              "Público",
              "Investimento",
              "Impressões",
              "Compras atribuídas",
            ]}
            rows={md.rows.map((r) => [
              `${text(r.age)} · ${text(r.gender)}`,
              currency(number(r.spend)),
              integer(number(r.impressions)),
              integer(number(r.actions_offsite_conversion_fb_pixel_purchase)),
            ])}
          />
        </Panel>
      </div>
      <div className="quiet-callout">
        A localização dos utilizadores GA4 e a localização atribuída aos
        anúncios têm bases distintas. Não calculamos rentabilidade por região
        cruzando estas populações.
      </div>
    </>
  );
}
