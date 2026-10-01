import { BUSINESS_TIMELINE, dates, overlapsPeriod, type Period } from "@/lib/bi/periods";
import { liveCommerce } from "@/lib/bi/live-model";
import { overview, sum, type Store } from "@/lib/bi/model";
import { currency, integer } from "./format";
import { Empty, Icon, Table } from "./ui";

export function BusinessTimelineContext({
  range,
  previousRange,
}: {
  range: Period;
  previousRange: Period;
}) {
  const summerSale = BUSINESS_TIMELINE[0];
  const postSale = BUSINESS_TIMELINE[1];
  const selectedTouchesSale = overlapsPeriod(
    range,
    summerSale.from,
    summerSale.to,
  );
  const previousTouchesSale = overlapsPeriod(
    previousRange,
    summerSale.from,
    summerSale.to,
  );
  const crossesBoundary = selectedTouchesSale && range.to >= postSale.from;
  const postSalePeriod = range.from >= postSale.from;

  if (!selectedTouchesSale && !postSalePeriod && !previousTouchesSale) return null;

  return (
    <div className="notice timeline-notice">
      <Icon name="calendar" />
      <span>
        {crossesBoundary ? (
          <>
            <strong>Saldos Verão · 10 jul–15 set.</strong> Este intervalo atravessa
            o fim dos saldos em 15/09 e o início do período pós-saldos em 16/09.
            A comparação deve separar os dois regimes comerciais.
          </>
        ) : selectedTouchesSale ? (
          <>
            <strong>Saldos Verão · 10 jul–15 set.</strong> Promoção apenas em prata
            e aço. Este período não deve ser usado como baseline normal para o
            pós-saldos.
          </>
        ) : (
          <>
            <strong>Pós-saldos · desde 16 set.</strong> Catálogo sem aço e sem
            produtos inferiores a 50 €.{" "}
            {previousTouchesSale
              ? "O período anterior inclui dias de saldos; a variação não representa uma comparação normalizada."
              : "Comparar preferencialmente com outros períodos pós-saldos."}
          </>
        )}
      </span>
    </div>
  );
}
export function Trend({ store, range }: { store: Store; range: Period }) {
  const cohort = liveCommerce(store, range);
  const points = dates(range).map((date) => {
    const s = overview(store, { from: date, to: date });
    const observed = cohort.paid.filter(r => r.date === date);
    return { date, sales: store.mode === "live" ? (cohort.safe && observed.length ? sum(observed,"current_total") : null) : s.sales.value, spend: s.spend };
  });
  const values = points
    .flatMap((p) => [p.sales, p.spend])
    .filter((n): n is number => n !== null);
  if (!values.length) return <Empty />;
  const max = Math.max(1, ...values),
    min = Math.min(0, ...values),
    span = max - min;
  const height = (v: number) => ((max - v) / span) * 155 + 12;
  const step = 800 / points.length,
    bar = Math.min(24, step * 0.32),
    zero = height(0);
  const summerSale = BUSINESS_TIMELINE[0],
    postSale = BUSINESS_TIMELINE[1],
    saleIndexes = points
      .map((p, i) =>
        p.date >= summerSale.from && p.date <= summerSale.to ? i : -1,
      )
      .filter((i) => i >= 0),
    saleStart = saleIndexes.length ? saleIndexes[0] : null,
    saleEnd = saleIndexes.length ? saleIndexes[saleIndexes.length - 1] : null,
    saleBandWidth =
      saleStart !== null && saleEnd !== null
        ? (saleEnd - saleStart + 1) * step
        : 0,
    postSaleIndex = points.findIndex((p) => p.date === postSale.from);
  return (
    <>
      <div className="legend">
        <span>
          <i className="gold-dot" />
          {store.mode === "live" ? "Valor das encomendas pagas recolhidas" : "Vendas totais"}
        </span>
        <span>
          <i className="dark-dot" />
          Investimento em anúncios
        </span>
        {saleStart !== null && (
          <span>
            <i className="sale-dot" />
            Saldos Verão
          </span>
        )}
        <small>Mesma escala em euros</small>
      </div>
      <div className="chart-scroll">
        <svg
          role="img"
          aria-label="Valores Shopify e investimento Meta mais Google, numa única escala em euros"
          viewBox="0 0 900 210"
          className="trend-chart"
        >
          {saleStart !== null && saleEnd !== null && (
            <g>
              <rect
                x={90 + saleStart * step}
                y="6"
                width={saleBandWidth}
                height="180"
                rx="4"
                fill="#f7f0e4"
              />
              {saleBandWidth > 110 && (
                <text
                  x={90 + saleStart * step + 8}
                  y="20"
                  className="timeline-label"
                >
                  SALDOS VERÃO
                </text>
              )}
            </g>
          )}
          {postSaleIndex >= 0 && (
            <g>
              <line
                x1={90 + postSaleIndex * step + step / 2}
                x2={90 + postSaleIndex * step + step / 2}
                y1="6"
                y2="186"
                className="timeline-boundary"
              />
              <text
                x={90 + postSaleIndex * step + step / 2 + 5}
                y="32"
                className="timeline-label"
              >
                16/09 · PÓS-SALDOS
              </text>
            </g>
          )}
          {[max, (max + min) / 2, min].map((v, i) => (
            <g key={i}>
              <line
                x1="85"
                x2="890"
                y1={height(v)}
                y2={height(v)}
                stroke="#e8e5df"
                strokeDasharray="3 4"
              />
              <text x="75" y={height(v) + 4} textAnchor="end">
                {integer(v)} €
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = 90 + i * step + step / 2;
            return (
              <g key={p.date}>
                {[
                  { v: p.sales, dx: -bar, color: "#b68d4a" },
                  { v: p.spend, dx: 2, color: "#263f3b" },
                ].map((a, j) =>
                  a.v === null ? (
                    <text key={j} x={x + a.dx} y={zero - 5}>
                      ·
                    </text>
                  ) : (
                    <rect
                      key={j}
                      x={x + a.dx}
                      y={Math.min(height(a.v), zero)}
                      width={Math.max(2, bar - 2)}
                      height={Math.abs(zero - height(a.v))}
                      rx="2"
                      fill={a.color}
                    >
                      <title>
                        {p.date} ·{" "}
                        {j === 0
                          ? (store.mode === "live" ? "Shopify · encomendas pagas recolhidas" : "Shopify total_sales")
                          : "Meta + Google spend"}
                        : {currency(a.v)}
                      </title>
                    </rect>
                  ),
                )}
                {(points.length < 10 ||
                  i % Math.ceil(points.length / 8) === 0) && (
                  <text x={x} y="196" textAnchor="middle">
                    {p.date.slice(8)}/{p.date.slice(5, 7)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="chart-data">
        <summary>Ver os valores do gráfico</summary>
        <Table
          headers={["Data", store.mode === "live" ? "Encomendas pagas · valor" : "Vendas Shopify", "Meta + Google"]}
          rows={points.map((p) => [
            p.date,
            currency(p.sales),
            currency(p.spend),
          ])}
        />
      </details>
    </>
  );
}
