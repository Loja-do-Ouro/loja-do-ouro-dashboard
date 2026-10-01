import type { Period } from "@/lib/bi/periods";
import { calculatedChecks, canonicalOrders, detail, latestQuality, overview, trackingCheck, type Store } from "@/lib/bi/model";
import { integer, timestamp } from "./format";
import { DetailNote, Empty, Panel, Table } from "./ui";

export function QualityView({ store, range }: { store: Store; range: Period }) {
  const s = overview(store, range),
    checks = latestQuality(store, range),
    o = canonicalOrders(detail(store, range, store.mode === "live" ? "shopify_live" : "shopify", "orders", true)),
    ga = detail(store, range, "ga4", "transactions"),
    recon = trackingCheck(o, ga);
  const reports = store.reports
    .filter((r) => r.period_start === range.from && r.period_end === range.to)
    .sort((a, b) => b.version - a.version);
  return (
    <>
      <Panel
        title="Reconciliação de compras"
        eyebrow="GA4 × Shopify"
        note="Correspondências exatas entre nome da encomenda e último componente do GID. Referências ambíguas ficam por resolver. A divergência não demonstra a causa."
      >
        <div className="mini-stats four">
          {[
            ["Eventos GA4 no detalhe", integer(recon.events)],
            [
              "Encomendas correspondidas",
              ga.rows.length ? integer(recon.matched) : "—",
            ],
            [
              "Com referências alternativas",
              ga.rows.length ? integer(recon.alternate) : "—",
            ],
            [
              "IDs com vários eventos",
              ga.rows.length ? integer(recon.repeatedIds) : "—",
            ],
          ].map(([l, v]) => (
            <div key={l}>
              <span>{l}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <DetailNote d={ga} totalAt={s.gaPurchases.fetchedAt} />
        <DetailNote d={o} />
        <p className="panel-note">
          {recon.complete
            ? "Cobertura recolhida para o período; tracking não certificado."
            : "Reconciliação incompleta."}{" "}
          {recon.unknown} referências não correspondidas/ambíguas;{" "}
          {recon.duplicateRows} linhas com ID repetido.
        </p>
      </Panel>
      <Panel
        title="Verificação dos valores apresentados"
        eyebrow="Controlos sobre esta consulta"
      >
        <Table
          headers={["Controlo", "Resultado", "Estado"]}
          rows={calculatedChecks(store, range).map((c) => [
            c.label,
            c.detail,
            c.warning ? "Requer atenção" : "Dentro da tolerância",
          ])}
        />
        <p className="panel-note">
          A concordância aritmética não certifica o tracking nem demonstra
          ausência de duplicação.
        </p>
      </Panel>
      <Panel
        title="Cobertura dos indicadores"
        eyebrow="Fonte e momento de recolha"
      >
        <Table
          headers={[
            "Indicador",
            "Fonte",
            "Cobertura",
            "Recolhido em",
            "Estado",
          ]}
          rows={[
            s.sales,
            s.aov,
            s.meta,
            s.google,
            s.sessions,
            s.users,
            s.fulfilled,
          ].map((m) => [
            m.field,
            m.source,
            m.coverage,
            timestamp(m.fetchedAt),
            m.value === null ? "Indisponível" : m.note,
          ])}
        />
      </Panel>
      <Panel
        title="Alertas e controlos guardados"
        eyebrow="Histórico de qualidade"
      >
        <p className="panel-note">
          É mostrado o controlo mais recente por data e código. Controlos
          anteriores à última revisão de dados exigem nova verificação.
        </p>
        {checks.length ? (
          checks.map((q, i) => (
            <details
              className={`quality-item ${q.severity}`}
              key={`${q.code}-${i}`}
            >
              <summary>
                <span className="severity">
                  {q.severity === "critical"
                    ? "Crítico"
                    : q.severity === "warning"
                      ? "Atenção"
                      : "Informação"}
                </span>
                <span>{q.message}</span>
                <small>{q.metric_date}</small>
              </summary>
              <div>
                <p>
                  {q.code} · {timestamp(q.created_at)}
                </p>
                <pre>{JSON.stringify(q.evidence, null, 2)}</pre>
              </div>
            </details>
          ))
        ) : (
          <Empty>
            Sem controlos guardados para este período. Isto não significa que os
            dados estejam validados.
          </Empty>
        )}
      </Panel>
      <Panel title="Relatórios e revisões" eyebrow="Histórico preservado">
        {reports.length ? (
          reports.map((r, i) => (
            <details className="report" key={r.id} open={i === 0}>
              <summary>
                <span>{r.title}</span>
                <small>
                  v{r.version} ·{" "}
                  {r.status === "partial" ? "Parcial" : "Provisório"} ·{" "}
                  {timestamp(r.created_at)}
                </small>
              </summary>
              <p>{r.summary}</p>
              {r.recommendations?.map((a, j) => (
                <div className="report-recommendation" key={j}>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                  {a.evidence?.length > 0 && (
                    <small>{a.evidence.join(" · ")}</small>
                  )}
                </div>
              ))}
            </details>
          ))
        ) : (
          <Empty>Não existe relatório guardado para estas datas exatas.</Empty>
        )}
      </Panel>
    </>
  );
}
