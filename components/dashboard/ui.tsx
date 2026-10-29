import { delta, type Detail, type Metric } from "@/lib/bi/model";
import { currency, percent, timestamp } from "./format";

export function Icon({ name = "grid" }: { name?: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    sales: "M3 20h18 M6 16v-5 M12 16V5 M18 16V8",
    bag: "M5 7h14l1 14H4L5 7 M9 8V6a3 3 0 0 1 6 0v2",
    ads: "M3 10v4h4l10 5V5L7 10H3 M7 14l2 6h3",
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6",
    check: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6",
    arrow: "M5 12h14 M14 7l5 5-5 5",
    calendar: "M5 5h14v16H5z M8 2v6 M16 2v6 M5 10h14",
    exit: "M10 3H4v18h6 M10 12h11 M17 8l4 4-4 4",
    trophy: "M8 4h8v5a4 4 0 0 1-8 0V4 M8 6H4a3 3 0 0 0 4 4 M16 6h4a3 3 0 0 1-4 4 M12 13v4 M8 21h8 M9 17h6v4H9z",
    mail: "M3 5h18v14H3z M3 6l9 7 9-7",
    heart: "M12 20s-7-4.4-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.6-9 9-9 9",
    chat: "M4 5h16v11H9l-5 4V5 M8 9h8 M8 12h5",
    plug: "M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0V8 M12 17v4",
    // Ícones próprios para cada opção do menu (na coluna de ícones do tablet não há nomes).
    store: "M3 4h18l-1 6H4L3 4 M4 10v10h16V10 M9 20v-6h6v6",
    pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21 M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
    sheet: "M4 3h16v18H4z M4 9h16 M4 15h16 M10 3v18",
    compare: "M7 20V4 M3 8l4-4 4 4 M17 4v16 M13 16l4 4 4-4",
    list: "M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18",
    target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M12 12h.01",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    key: "M7.5 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M11 12.5L20.5 3 M15.5 8l3 3 M18.5 5l2 2",
    gavel: "M14 3l7 7 M11 6l7 7 M12.5 4.5l-5 5 M17.5 9.5l-5 5 M10 12l-7 7 M3 21h9",
    // Botão do menu lateral (recolher e mostrar), na barra de cima.
    panel: "M4 4h16v16H4z M9 4v16",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {<path d={paths[name] || paths.grid} />}
    </svg>
  );
}
export function Change({ a, b }: { a: number | null; b: number | null }) {
  const d = delta(a, b);
  return (
    <span className={`change ${d === null ? "muted" : d >= 0 ? "up" : "down"}`}>
      {d === null
        ? "Sem comparação"
        : `${d >= 0 ? "↗" : "↘"} ${percent(Math.abs(d))}`}
    </span>
  );
}
export function Kpi({
  label,
  m,
  prev,
  format = currency,
  note,
}: {
  label: string;
  m: Metric;
  prev?: Metric;
  format?: (n: number | null) => string;
  note?: string;
}) {
  return (
    <article className="kpi">
      <div className="eyebrow">{label}</div>
      <div className="kpi-value">{format(m.value)}</div>
      {prev && <Change a={m.value} b={prev.value} />}
      <p>{note || m.note}</p>
      <details className="metric-source">
        <summary>
          {m.source
            .replace("shopify_sales", "Shopify")
            .replace("shopify_paid", "Shopify")
            .replace("shopify_sessions", "Shopify")}{" "}
          · {m.value === null ? "Indisponível" : "Provisório"}
        </summary>
        <span>
          {m.coverage} · {timestamp(m.fetchedAt)}
          <br />
          {m.field}
          <br />
          {m.note}
        </span>
      </details>
    </article>
  );
}
export function Empty({ children }: { children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name="check" />
      <p>{children || "Sem dados para todo o período selecionado."}</p>
    </div>
  );
}
export function Panel({
  title,
  eyebrow,
  children,
  note,
  id,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  note?: string;
  id?: string;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`} id={id}>
      <div className="panel-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
      {note && <p className="panel-note">{note}</p>}
    </section>
  );
}
export function Table({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  return rows.length ? (
    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Tabela com deslocamento horizontal"
    >
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>{empty}</Empty>
  );
}
export function DetailNote({ d, totalAt }: { d: Detail; totalAt?: string | null }) {
  return (
    <p className="data-note">
      {d.note} · {timestamp(d.fetchedAt)}
      {totalAt &&
      d.fetchedAt &&
      Date.parse(totalAt) > Date.parse(d.fetchedAt) + 60000
        ? " · Detalhe anterior à versão do total; reconciliação pendente."
        : ""}
    </p>
  );
}
