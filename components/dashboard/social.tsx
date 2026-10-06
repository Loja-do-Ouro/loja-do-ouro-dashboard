import { dates, type Period } from "@/lib/bi/periods";
import { detail, number, type Row, type Store } from "@/lib/bi/model";
import { integer, percent, text, timestamp } from "./format";
import { Change, DetailNote, Empty, Panel, Table } from "./ui";

// Organic social media from Metricool: Instagram and the Facebook page.
type Series = { days: number; expected: number; rows: Row[]; fetchedAt: string | null };

function series(store: Store, p: Period, source: string): Series {
  const want = new Set(dates(p));
  const rows = store.daily.filter((d) => d.source === source && want.has(d.metric_date)).sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  return {
    days: rows.length,
    expected: want.size,
    rows: rows.map((d) => ({ date: d.metric_date, ...d.metrics })),
    fetchedAt: rows.map((d) => d.fetched_at).sort().at(-1) || null,
  };
}
const total = (s: Series, field: string) => {
  const values = s.rows.map((r) => number(r[field])).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const last = (s: Series, field: string) => {
  for (let i = s.rows.length - 1; i >= 0; i--) {
    const v = number(s.rows[i][field]);
    if (v !== null) return v;
  }
  return null;
};

// Interactions over reach; Metricool's own "engagement" uses a per-brand ratio.
const rate = (r: Row) => {
  const reach = number(r.reach), inter = number(r.interactions);
  return reach && inter !== null ? percent((inter / reach) * 100) : "—";
};

function Stat({ label, value, prev, note, format = integer }: { label: string; value: number | null; prev?: number | null; note: string; format?: (n: number | null) => string }) {
  return (
    <article className="kpi">
      <div className="eyebrow">{label}</div>
      <div className="kpi-value">{format(value)}</div>
      {prev !== undefined && <Change a={value} b={prev} />}
      <p>{note}</p>
    </article>
  );
}

export function Social({ store, range, previous }: { store: Store; range: Period; previous: Period }) {
  const ig = series(store, range, "instagram"), igPrev = series(store, previous, "instagram");
  const fb = series(store, range, "facebook_page"), fbPrev = series(store, previous, "facebook_page");
  const igPosts = detail(store, range, "instagram", "posts"), fbPosts = detail(store, range, "facebook_page", "posts");
  if (!ig.days && !fb.days && !igPosts.datasets.length && !fbPosts.datasets.length)
    return (
      <Panel title="Redes sociais" eyebrow="Metricool">
        <Empty>
          Ainda não há dados do Metricool para este período. A recolha começa depois de configurar METRICOOL_USER_TOKEN no Vercel e
          corre todas as noites; os dias anteriores podem ser recuperados em “Relatórios e qualidade”.
        </Empty>
      </Panel>
    );
  const net = (s: Series) => {
    const g = total(s, "followers_gained"), l = total(s, "followers_lost");
    return g === null && l === null ? null : (g || 0) - (l || 0);
  };
  const interactions = (s: Series) => {
    const a = total(s, "posts_interactions"), b = total(s, "reels_interactions");
    return a === null && b === null ? null : (a || 0) + (b || 0);
  };
  const coverage = (s: Series) => `${s.days}/${s.expected} dias · ${timestamp(s.fetchedAt)}`;
  return (
    <>
      <div className="three-col">
        <Stat label="Seguidores Instagram" value={last(ig, "followers")} prev={last(igPrev, "followers")} note={`No fim do período · ${coverage(ig)}`} />
        <Stat label="Novos seguidores (saldo)" value={net(ig)} prev={net(igPrev)} note="Ganhos menos perdidos no Instagram." />
        <Stat label="Interações Instagram" value={interactions(ig)} prev={interactions(igPrev)} note="Gostos, comentários, guardados e partilhas de posts e reels publicados no período." />
      </div>
      <div className="three-col">
        <Stat label="Alcance dos posts" value={total(ig, "posts_reach")} prev={total(igPrev, "posts_reach")} note="Soma do alcance dos posts publicados no período (orgânico)." />
        <Stat label="Visualizações de reels" value={total(ig, "reels_views")} prev={total(igPrev, "reels_views")} note="Reels publicados no período." />
        <Stat label="Publicações" value={(total(ig, "posts") || 0) + (total(ig, "reels") || 0) || null} prev={(total(igPrev, "posts") || 0) + (total(igPrev, "reels") || 0) || null} note="Posts e reels no Instagram." />
      </div>
      <div className="three-col">
        <Stat label="Seguidores página Facebook" value={last(fb, "followers")} prev={last(fbPrev, "followers")} note={`No fim do período · ${coverage(fb)}`} />
        <Stat label="Impressões Facebook" value={total(fb, "impressions")} prev={total(fbPrev, "impressions")} note="Impressões da página no período." />
        <Stat label="Interações Facebook" value={total(fb, "interactions")} prev={total(fbPrev, "interactions")} note="Interações das publicações da página." />
      </div>
      <div className="two-col">
        <Panel title="Melhores publicações Instagram" eyebrow="Por interações">
          <DetailNote d={igPosts} />
          <Table
            headers={["Publicação", "Tipo", "Alcance", "Interações", "Taxa de interação"]}
            rows={igPosts.rows.slice(0, 15).map((r) => [
              r.url ? <a href={String(r.url)} target="_blank" rel="noreferrer">{text(r.text) || "Ver publicação"}</a> : text(r.text),
              text(r.type),
              integer(number(r.reach)),
              integer(number(r.interactions)),
              rate(r),
            ])}
            empty="Sem publicações recolhidas para este período fechado (só existem para ontem, semana e mês anteriores)."
          />
        </Panel>
        <Panel title="Melhores publicações Facebook" eyebrow="Por interações">
          <DetailNote d={fbPosts} />
          <Table
            headers={["Publicação", "Reações", "Comentários", "Partilhas", "Impressões"]}
            rows={fbPosts.rows.slice(0, 15).map((r) => [
              r.url ? <a href={String(r.url)} target="_blank" rel="noreferrer">{text(r.text) || "Ver publicação"}</a> : text(r.text),
              integer(number(r.reactions)),
              integer(number(r.comments)),
              integer(number(r.shares)),
              integer(number(r.impressions)),
            ])}
            empty="Sem publicações recolhidas para este período fechado (só existem para ontem, semana e mês anteriores)."
          />
        </Panel>
      </div>
      <p className="panel-note">Fonte: Metricool (orgânico). Valores pagos das campanhas estão em “Marketing e canais”. Dados provisórios; as redes podem rever valores nos dias seguintes.</p>
    </>
  );
}
