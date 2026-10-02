import Link from "next/link";
import { percent } from "@/components/dashboard/format";
import type { StoreAccess } from "@/lib/permissions";
import type { Option } from "@/lib/store-records";

export const monthLabel = (m: string) => {
  const label = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));
  return label[0].toUpperCase() + label.slice(1);
};
const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const monthShort = (m: string) => `${SHORT_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const weekday = (d: string) => new Intl.DateTimeFormat("pt-PT", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
export const inputAmount = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2, useGrouping: false }).format(Number(v));

export function StoreChips({ stores, current, href }: { stores: StoreAccess[]; current: string; href: (code: string) => string }) {
  if (stores.length < 2) return null;
  return (
    <nav className="chips" aria-label="Escolher loja">
      {stores.map((s) => (
        <Link key={s.id} href={href(s.code)} className={s.id === current ? "chip active" : "chip"} aria-current={s.id === current ? "page" : undefined}>
          {s.name}
        </Link>
      ))}
    </nav>
  );
}

export function MonthNav({ month, today, href }: { month: string; today: string; href: (m: string) => string }) {
  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  return (
    <div className="month-nav">
      <Link className="outline-button" href={href(prev)}>‹ {monthLabel(prev)}</Link>
      <strong>{monthLabel(month)}</strong>
      {month < today.slice(0, 7) ? <Link className="outline-button" href={href(next)}>{monthLabel(next)} ›</Link> : <span />}
    </div>
  );
}

// Answers of one question in a period, most frequent first.
export function Breakdown({ title, rows, options, total }: { title: string; rows: [string, number][]; options: Option[]; total: number }) {
  return (
    <div className="breakdown">
      <h3>{title}</h3>
      {rows.length ? (
        <ul>
          {rows.slice(0, 8).map(([code, n]) => (
            <li key={code}>
              <span>{options.find((o) => o.code === code)?.label || code}</span>
              <b>{n}</b>
              <small>{percent(total ? (n / total) * 100 : null)}</small>
              <i style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sem respostas.</p>
      )}
    </div>
  );
}

export function Select({ name, options, value, required, empty = "Escolher…" }: { name: string; options: Option[]; value?: string | null; required?: boolean; empty?: string }) {
  const known = options.some((o) => o.code === value);
  return (
    <select name={name} defaultValue={value || ""} required={required}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>{o.label}</option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  );
}

export function YesNo({ name, value, required }: { name: string; value: boolean | null | undefined; required?: boolean }) {
  return (
    <span className="yes-no">
      <label><input type="radio" name={name} value="sim" defaultChecked={value === true} required={required} /> Sim</label>
      <label><input type="radio" name={name} value="nao" defaultChecked={value === false} /> Não</label>
    </span>
  );
}

// A number with a bar proportional to the largest value of its column.
export function BarValue({ value, max, children }: { value: number; max: number; children: React.ReactNode }) {
  return (
    <span className="bar-value">
      <i style={{ width: `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
