export type Period = { from: string; to: string };
export type WindowKey = "day" | "week" | "month" | "custom";
export const TIMEZONE = "Europe/Lisbon";

export const BUSINESS_TIMELINE = [
  {
    key: "summer-sales-2026",
    label: "SALDOS VERÃO",
    from: "2026-07-10",
    to: "2026-09-15",
    kind: "promotion",
    note: "Saldos em prata e aço.",
  },
  {
    key: "post-sales-2026",
    label: "PÓS-SALDOS",
    from: "2026-09-16",
    to: null,
    kind: "milestone",
    note: "Fim dos saldos; catálogo sem aço e sem produtos inferiores a 50 €.",
  },
] as const;

export function overlapsPeriod(p: Period, from: string, to: string): boolean {
  return p.from <= to && p.to >= from;
}
export function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function dates(p: Period): string[] {
  const out: string[] = [];
  for (let d = p.from; d <= p.to; d = shift(d, 1)) {
    out.push(d);
    if (out.length > 366) throw new Error("Intervalo demasiado longo");
  }
  return out;
}
export function validDate(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) &&
    new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s
  );
}
export function closedPeriods(now = new Date()) {
  const today = localDate(now),
    yesterday = shift(today, -1);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shift(today, -((weekday + 6) % 7));
  const monthEnd = shift(today.slice(0, 7) + "-01", -1);
  return [
    {
      key: "day" as const,
      label: "Ontem",
      range: { from: yesterday, to: yesterday },
    },
    {
      key: "week" as const,
      label: "Semana anterior",
      range: { from: shift(monday, -7), to: shift(monday, -1) },
    },
    {
      key: "month" as const,
      label: "Mês anterior",
      range: { from: monthEnd.slice(0, 7) + "-01", to: monthEnd },
    },
  ];
}
export function previous(p: Period, key: WindowKey): Period {
  if (
    key === "month" ||
    (p.from.endsWith("-01") && shift(p.to, 1).endsWith("-01"))
  ) {
    const to = shift(p.from, -1);
    return { from: to.slice(0, 7) + "-01", to };
  }
  const count = dates(p).length;
  return { from: shift(p.from, -count), to: shift(p.from, -1) };
}
export function selection(
  q: Record<string, string | string[] | undefined>,
  now = new Date(),
) {
  const windows = closedPeriods(now);
  let key: WindowKey = windows.some((x) => x.key === q.period)
    ? (q.period as WindowKey)
    : "day";
  let range = windows.find((x) => x.key === key)!.range;
  let error: string | null = null;
  if (q.period === "custom") {
    const from = typeof q.from === "string" ? q.from : "",
      to = typeof q.to === "string" ? q.to : "";
    if (
      validDate(from) &&
      validDate(to) &&
      from <= to &&
      to < localDate(now) &&
      (Date.parse(to) - Date.parse(from)) / 86400000 < 366
    ) {
      key = "custom";
      range = { from, to };
    } else
      error =
        "Escolha um intervalo válido, até 366 dias, que termine antes de hoje.";
  }
  return { key, range, previous: previous(range, key), windows, error };
}
// Ingestion window. Default: the last three closed days, so late source
// revisions are picked up. A backfill is limited to 62 complete days.
const REVISION_DAYS = 3;
const MAX_BACKFILL_DAYS = 62;
export function ingestRange(
  q: { from?: string | null; to?: string | null },
  now = new Date(),
): Period {
  const yesterday = shift(localDate(now), -1);
  if (!q.from && !q.to)
    return { from: shift(yesterday, -(REVISION_DAYS - 1)), to: yesterday };
  const from = q.from || "",
    to = q.to || "";
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    to > yesterday ||
    (Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_BACKFILL_DAYS
  )
    throw new Error(
      `Intervalo inválido: até ${MAX_BACKFILL_DAYS} dias completos, terminando no máximo ontem.`,
    );
  return { from, to };
}
export const periodLabel = (p: Period) =>
  p.from === p.to
    ? shortDate(p.from)
    : `${shortDate(p.from)} — ${shortDate(p.to)}`;
export function shortDate(s: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${s}T12:00:00Z`));
}
