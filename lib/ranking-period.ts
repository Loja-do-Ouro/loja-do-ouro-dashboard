import { closedPeriods, dates, localDate, previous, shift, validDate, type Period } from "./bi/periods";

// Períodos dos rankings das lojas físicas (lojas, produtos e categorias): os mesmos atalhos e as mesmas datas à
// escolha, sempre comparados com o período anterior do mesmo tamanho.
export const RANKING_PRESETS = [
  ["ontem", "Ontem"],
  ["semana", "Semana anterior"],
  ["mes", "Mês anterior"],
  ["este-mes", "Este mês"],
  ["ano", "Este ano"],
] as const;
export type RankingPreset = (typeof RANKING_PRESETS)[number][0];

type Query = Record<string, string | string[] | undefined>;

export function rankingPeriod(q: Query, fallback: RankingPreset = "ontem", now = new Date()) {
  const today = localDate(now);
  const windows = closedPeriods(now);
  // Datas à escolha: válidas, por ordem, até hoje e no máximo 366 dias (contados sem percorrer o intervalo, que
  // `dates` recusa acima desse tamanho).
  const custom =
    typeof q.from === "string" && typeof q.to === "string" && validDate(q.from) && validDate(q.to) && q.from <= q.to && q.to <= today &&
    (Date.parse(`${q.to}T12:00:00Z`) - Date.parse(`${q.from}T12:00:00Z`)) / 86_400_000 + 1 <= 366;
  const preset: RankingPreset | "custom" = custom ? "custom" : (RANKING_PRESETS.find(([k]) => k === q.periodo)?.[0] ?? fallback);
  let range: Period;
  let prev: Period;
  if (custom) {
    range = { from: q.from as string, to: q.to as string };
    const len = dates(range).length;
    // A whole calendar month is compared with the whole month before it.
    const wholeMonth = range.from.endsWith("-01") && shift(range.to, 1).endsWith("-01") && range.from.slice(0, 7) === range.to.slice(0, 7);
    const prevStart = `${shift(range.from, -1).slice(0, 7)}-01`;
    prev = wholeMonth ? { from: prevStart, to: shift(range.from, -1) } : { from: shift(range.from, -len), to: shift(range.from, -1) };
  } else if (preset === "este-mes") {
    range = { from: `${today.slice(0, 7)}-01`, to: today };
    const len = dates(range).length;
    const prevStart = `${shift(range.from, -1).slice(0, 7)}-01`;
    // Os mesmos dias do mês anterior, sem passar do fim desse mês (31 de outubro compara com 1–30 de setembro).
    const prevEnd = shift(prevStart, len - 1);
    prev = { from: prevStart, to: prevEnd < range.from ? prevEnd : shift(range.from, -1) };
  } else if (preset === "ano") {
    // De 1 de janeiro até hoje, comparado com o mesmo intervalo do ano anterior (29 de fevereiro conta como dia 28).
    range = { from: `${today.slice(0, 4)}-01-01`, to: today };
    const year = String(Number(today.slice(0, 4)) - 1);
    const sameDay = `${year}${today.slice(4)}`;
    prev = { from: `${year}-01-01`, to: validDate(sameDay) ? sameDay : `${year}-02-28` };
  } else {
    const w = windows[preset === "semana" ? 1 : preset === "mes" ? 2 : 0];
    range = w.range;
    prev = previous(w.range, w.key);
  }
  // Datas enviadas mas recusadas: mostra-se o atalho, com o aviso do motivo.
  const error = !custom && (q.from !== undefined || q.to !== undefined)
    ? "Escolha datas válidas até hoje, com a primeira antes da segunda e no máximo 366 dias."
    : null;
  // Período escolhido pela pessoa (e não o de cada separador por defeito): é o que passa para os outros separadores.
  const explicit = custom || RANKING_PRESETS.some(([k]) => k === q.periodo);
  return { today, preset, custom, range, prev, error, explicit };
}

// Parâmetros do período para manter ao mudar de separador, de loja ou de ordem.
export const periodParams = (p: { preset: RankingPreset | "custom"; range: Period }): Record<string, string> =>
  p.preset === "custom" ? { from: p.range.from, to: p.range.to } : { periodo: p.preset };

// Ao mudar de separador: só o período que a pessoa escolheu; sem escolha, cada separador abre no seu.
export const tabPeriodParams = (p: { preset: RankingPreset | "custom"; range: Period; explicit: boolean }) => (p.explicit ? periodParams(p) : {});
