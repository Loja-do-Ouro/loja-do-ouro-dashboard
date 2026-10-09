import { createHash } from "crypto";
import { parseAmount, storeCode } from "./store-records";

// Regras da importação noturna da Google Sheet "Análise de Vendas" (um separador por loja) para ldo_shop_sales,
// sem depender do servidor (testadas em tests/store-sheet-rules.cjs). São as regras de
// scripts/import-store-excel.py (a importação única de outubro), generalizadas para uma folha que continua a
// crescer: o ano vem das secções de mês, as datas corrigem-se em relação ao mês da secção e ao dia de hoje,
// e nenhum separador ou valor desconhecido faz parar a leitura (fica um aviso em `issues`).
//
// Os valores chegam da API do Sheets (values:batchGet, UNFORMATTED_VALUE + SERIAL_NUMBER): números (as datas
// são dias desde 1899-12-30), texto ou booleanos; células vazias a null; linhas com comprimentos diferentes.
// Colunas A–O: Data, Nº Venda, Referência, Campanha, Material, Tipo, Tipo de Cliente, Onde viu o Produto?,
// Já comprou online?, Valor, Pedido Reposição, Observações, Motivo de NÃO Venda, O que procurava?, (extra).

export type SheetCell = string | number | boolean | null;
export type SheetTab = { title: string; rows: SheetCell[][] };
export type StoreRef = { code: string; name: string };
export type SheetItem = { reference: string | null; material: string | null; product_type: string | null };
export type SheetSale = {
  store_code: string;
  sale_date: string;
  sale_number: string | null;
  sold: boolean;
  total_value: number | null;
  campaign: boolean | null;
  campaign_code: string | null;
  client_type: string | null;
  seen_where: string | null;
  bought_online: boolean | null;
  purpose: string | null;
  restock: string | null;
  no_sale_reason: string | null;
  looking_for: string | null;
  notes: string | null;
  items: SheetItem[];
  // Primeira linha da folha (base 1) que deu este registo; só para diagnóstico.
  row: number;
};
export type SheetIssue = { tab: string; row: number | null; message: string };

// Limites das colunas de ldo_shop_sales (e de ldo_save_shop_sale para os artigos).
export const LIMITS = { sale_number: 40, reference: 40, looking_for: 300, notes: 1000, items: 30, total_value: 9_999_999_999.99 } as const;

// Nome do separador → código da loja, tal como no script (SALES_STORES, linhas 18-23). Só é usado quando o nome
// não corresponde ao nome nem ao código de nenhuma loja; as chaves estão já em plain().
const SALES_STORES: Record<string, string> = {
  ENTRONCAMENTO: "entroncamento", "FIGUEIRA DA FOZ": "figueira-da-foz", "LEIRIA JERICO": "leiria-jerico",
  "LEIRIA CITY": "leiria-city", SANTAREM: "santarem", TOMAR: "tomar", CARTAXO: "cartaxo",
  "TORRES NOVAS": "torres-novas", ABRANTES: "abrantes", COIMBRA: "coimbra", LOURES: "loures",
  BENFICA: "benfica", FATIMA: "fatima",
};
const MONTHS = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const COLS = 15;
// Colunas que, sozinhas, fazem de uma linha um registo. Campanha, tipo de cliente, onde viu e "já comprou online"
// vêm pré-preenchidos nas linhas modelo ("NAO", "NOVO", "LOJA", "NAO") e não contam.
const SUBSTANTIVE = [1, 2, 4, 5, 9, 10, 11, 12, 13, 14];

// ---------------------------------------------------------------- texto

// Maiúsculas, sem acentos nem outros caracteres fora do ASCII, espaços simples (plain(), linhas 36-39).
export function plain(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

const numText = (n: number) => (Number.isInteger(n) && Math.abs(n) < 1e21 ? n.toFixed(0) : String(n));

// Texto da célula, ou null se vazia (text(), linha 43). Só traços ("-----") conta como vazio; booleanos (caixas
// de verificação) leem-se como SIM / NÃO. O carácter nulo é retirado (o Postgres não o aceita em text).
export function cellText(v: unknown): string | null {
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    s = numText(v);
  } else if (typeof v === "boolean") s = v ? "SIM" : "NÃO";
  else return null;
  s = s.replace(/\u0000/g, "").trim();
  return s === "" || /^[-–—\s]+$/.test(s) ? null : s;
}

const plainText = (v: unknown) => {
  const t = cellText(v);
  return t ? plain(t) : "";
};

// Corta por caracteres (como o length() do Postgres), sem partir pares de substituição.
function cut(s: string, max: number): { text: string; cut: boolean } {
  const chars = Array.from(s);
  return chars.length > max ? { text: chars.slice(0, max).join("").trim(), cut: true } : { text: s, cut: false };
}

// ---------------------------------------------------------------- opções (linhas 59-131)

type Rules = readonly (readonly [RegExp, string])[];

function first(t: string, rules: Rules, fallback: string | null = null): string | null {
  for (const [re, code] of rules) if (re.test(t)) return code;
  return fallback;
}

const CAMPAIGN_RULES: Rules = [[/SALDO/, "saldos"], [/VERAO/, "verao"], [/\bFE\b/, "fe"], [/DESCONTO|%/, "desconto"], [/STOCK|SOTCK/, "stock_off"]];
// "OURO" só no início da palavra: "DOURADO" (folheado) e "COURO" não são ouro.
const MATERIAL_RULES: Rules = [[/RELOGIO/, "relogio"], [/\bOURO|\bAU\b/, "ouro"], [/PRATA|PARTA|PRTA|\bAG\b/, "prata"], [/ACO/, "aco"], [/METAL/, "metal_comum"]];
const TYPE_RULES: Rules = [
  [/EARCUFF|BRINCO/, "brincos"], [/ARGOLA/, "argolas"], [/ALIANC/, "aliancas"], [/ESCRAVA/, "escrava"],
  [/PULS|BRACELETE/, "pulseira"], [/FIO|CORRENTE/, "fio"], [/COLAR/, "colar"],
  [/ANEL|ANEIS|SOLITARIO|\bARO\b/, "anel"], [/MEDALHA|MADALHA|\bMED\b/, "medalha"],
  [/CRUZ|CRUCIFIXO|CRUXIFIXO/, "cruz"], [/ESCAPULARIO/, "escapulario"], [/TERCO/, "terco"],
  [/ALFINETE/, "alfinete"], [/BARRA/, "barra"], [/MOEDA|LIBRA/, "moeda"], [/RELOGIO/, "relogio"], [/CONJUNTO/, "conjunto"],
];
const CLIENT_RULES: Rules = [[/NOV/, "novo"], [/HAB|CLIENTE|COLEGA/, "habitual"], [/PASSAGEM/, "passagem"]];
const SEEN_RULES: Rules = [
  [/SITE|ONLINE|NET/, "site"], [/INSTAGRAM|FACEBOOK/, "redes_sociais"], [/CHAT|WHATSAPP|TELEFONE/, "telefone"],
  [/RECOMEND/, "recomendacao"], [/MONTRA|MONRA/, "montra"], [/LOJA|ARMAZEM/, "loja"],
];
const RESTOCK_RULES: Rules = [
  [/SIMILAR|SEMELHANTE|TENHO MAIS|TENHO EM LOJA/, "tenho_similar"], [/PEDIDO|MEDIANTE|SOLICITA/, "a_pedido"],
  [/^X|^SIM|JA PEDI|PEDI UMA/, "pedido"], [/^NAO/, "nao"],
];
const PURPOSE_RULES: Rules = [[/OFERE|OFERTA|FAMILIA/, "oferta"], [/INVESTIMENTO/, "investimento"], [/PROPRI|PESSOAL|PARA SI/, "proprio"]];
const NO_SALE_RULES: Rules = [
  [/TROCA/, "troca"], [/CARO|ABSURDO|SUPERIORES|PRECO ABAIXO/, "caro"], [/TAMANHO|\bNR\b|NAO SERVIA/, "sem_tamanho"],
  [/NAO TENHO|NAO TINHA|NAO HAVIA|SO EXISTE|QUERIA|MANDEI VIR|PERSONALIZADO/, "sem_stock"],
];

const codes = (rules: Rules, ...extra: string[]) => [...new Set([...rules.map(([, c]) => c), ...extra])];

// Todos os códigos que estas regras podem dar, por lista (têm de existir e estar ativos em ldo_options).
export const OPTION_CODES: Record<string, string[]> = {
  campaign: codes(CAMPAIGN_RULES, "desconto", "outra"),
  material: codes(MATERIAL_RULES, "outro"),
  product_type: codes(TYPE_RULES, "outro"),
  client_type: codes(CLIENT_RULES),
  seen_where: codes(SEEN_RULES, "outro"),
  purpose: codes(PURPOSE_RULES),
  restock: codes(RESTOCK_RULES, "pedido"),
  no_sale_reason: codes(NO_SALE_RULES, "outro"),
};

// Campanha (campaign(), linhas 66-74): um número (percentagem) é desconto; "NÃO" e variantes, não; outro texto, sim.
export function mapCampaign(v: SheetCell): { campaign: boolean | null; code: string | null } {
  if (typeof v === "number" && Number.isFinite(v)) return { campaign: true, code: "desconto" };
  const t = plainText(v);
  if (!t) return { campaign: null, code: null };
  if (/^N[AO]+[O ]*$/.test(t) || t.startsWith("NAO")) return { campaign: false, code: null };
  return { campaign: true, code: first(t, CAMPAIGN_RULES, "outra") };
}

// Partes de um campo com vários valores (split_parts(), linhas 87-89): "/", "+", ",", " E ", " - ".
// "/" e "," entre dois algarismos não separam ("BARRA 2,5GR", "1/4 ONÇA").
export function splitParts(v: SheetCell): string[] {
  const t = plainText(v);
  return t ? t.split(/(?<!\d)[/,]|[/,](?!\d)|\+| E | - /).map((p) => p.trim()).filter(Boolean) : [];
}

// Referências (linha 188): separadas por "/", ";", "," ou espaços. Um número lê-se sem casas decimais vazias.
// Quantidades escritas junto das referências ("2 *", "(2UN)", "x3", "x 2", "2 UN", "(2 UNIDADES)"): não são
// referências. As que têm espaço saem antes de separar; as restantes, e as palavras soltas, depois.
const QUANTITY = /^\(?(\d{1,2}\s*(UN|UNID|UNIDADES|X)?|X\s*\d{1,2})\)?$/i;
const QUANTITY_WORD = /^\(?(UNIDADES|UNID|UN|X)\.?\)?$/i;
const QUANTITY_BEFORE = /\(?\b\d{1,2}\s*(?:UNIDADES|UNID|UN|X)\b\.?\)?/gi;
const QUANTITY_AFTER = /\(?\bX\s*\d{1,2}\b\)?/gi;

// Referências de uma célula: separadas por / ; , + e espaços; sem fragmentos só de símbolos ("+", "*", "-") nem
// quantidades.
export function splitRefs(v: SheetCell): string[] {
  const t = cellText(v)?.replace(QUANTITY_BEFORE, " ").replace(QUANTITY_AFTER, " ");
  return t ? t.split(/[/;,+\s]+/).filter((p) => /[\p{L}\p{N}]/u.test(p) && !QUANTITY.test(p) && !QUANTITY_WORD.test(p)) : [];
}

export const mapMaterial = (part: string) => first(plain(part), MATERIAL_RULES, "outro");
export const mapProductType = (part: string) => first(plain(part), TYPE_RULES, "outro");

export function mapClientType(v: SheetCell) {
  const t = plainText(v);
  return t ? first(t, CLIENT_RULES) : null;
}

export function mapSeenWhere(v: SheetCell) {
  const t = plainText(v);
  return t ? first(t, SEEN_RULES, "outro") : null;
}

export function mapYesNo(v: SheetCell): boolean | null {
  const t = plainText(v);
  if (!t) return null;
  return t.startsWith("SIM") ? true : t.startsWith("NA") || t.startsWith("MA") ? false : null;
}

// Reposição (restock(), linhas 111-117): uma data (número de série) quer dizer que foi pedida nesse dia.
export function mapRestock(v: SheetCell) {
  if (typeof v === "number" && Number.isFinite(v)) return "pedido";
  const t = plainText(v);
  return t ? first(t, RESTOCK_RULES) : null;
}

export function mapPurpose(v: SheetCell) {
  const t = plainText(v);
  return t ? first(t, PURPOSE_RULES) : null;
}

export function mapNoSaleReason(v: SheetCell) {
  const t = plainText(v);
  return t ? first(t, NO_SALE_RULES, "outro") : null;
}

const INVALID = "invalid" as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Valor (number(), linhas 46-56), com as regras de parseAmount: "1.234,56", "1 234,56 €", "1234.56".
// Negativos ou acima do que a coluna aceita são inválidos.
export function parseValue(v: SheetCell): number | null | typeof INVALID {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= LIMITS.total_value ? round2(v) : INVALID;
  const t = cellText(v);
  if (t === null) return null;
  const n = parseAmount(t);
  return n === INVALID || n === null ? n : round2(n);
}

// ---------------------------------------------------------------- datas

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const fmt = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

// Data do calendário, ou null se não existir (31/06, 29/02 fora dos bissextos).
function mk(y: number, m: number, d: number): string | null {
  if (![y, m, d].every(Number.isInteger) || y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? fmt(y, m, d) : null;
}

const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

function addDays(iso: string, n: number) {
  const [y, m, d] = parts(iso);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + n);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Número de série do Sheets (dias desde 1899-12-30; a parte decimal são as horas) → data.
export function serialDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n >= 2958466) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000);
  return t.toISOString().slice(0, 10);
}

type DateCell =
  | { kind: "none" }
  | { kind: "serial"; iso: string }
  | { kind: "text"; day: number; month: number; raw: string }
  | { kind: "bad"; raw: string };

// Coluna A: vazia, data de série, data escrita como texto ("25/06", "21/8", "03/10/2026", "2026-10-03"; o ano
// escrito é ignorado, como no script, linha 141), ou outra coisa.
function readDate(v: SheetCell): DateCell {
  const raw = cellText(v);
  if (raw === null) return { kind: "none" };
  if (typeof v === "number") {
    const iso = serialDate(v);
    return iso ? { kind: "serial", iso } : { kind: "bad", raw };
  }
  if (typeof v === "string") {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (iso) return { kind: "text", day: Number(iso[3]), month: Number(iso[2]), raw };
    const dm = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})/.exec(raw);
    if (dm) return { kind: "text", day: Number(dm[1]), month: Number(dm[2]), raw };
  }
  return { kind: "bad", raw };
}

// Cabeçalho de mês na coluna A: "Maio", "SETEMBRO", "Março de 2027", "Janeiro 2027".
export function monthHeader(v: SheetCell): { month: number; year: number | null } | null {
  if (typeof v !== "string") return null;
  const m = /^([A-Z]+)(?:\s*(?:DE|\/|-)?\s*(\d{4}))?$/.exec(plain(v));
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || i < 0) return null;
  const year = m[2] ? Number(m[2]) : null;
  return { month: i + 1, year: year && year >= 2000 ? year : null };
}

// Títulos das colunas B–N na linha "Data" de cada secção (comparados sem acentos). A leitura é por posição: uma
// coluna inserida, apagada ou trocada faz recusar o separador, e nada dessa loja é alterado até ser corrigida.
const HEADERS: readonly (readonly [number, RegExp, string])[] = [
  [1, /VENDA/, "Nº Venda"], [2, /REFER/, "Referência"], [3, /CAMPANHA/, "Campanha"], [4, /MATERIAL/, "Material"],
  [5, /^TIPO$/, "Tipo"], [6, /CLIENTE/, "Tipo de Cliente"], [7, /ONDE/, "Onde viu o Produto?"], [8, /COMPROU|ONLINE/, "Já comprou online?"],
  [9, /VALOR/, "Valor"], [10, /REPOSI/, "Pedido Reposição"], [11, /OBSERV/, "Observações"], [12, /MOTIVO/, "Motivo de NÃO Venda"],
  [13, /PROCURA/, "O que procurava?"],
];
const COLUMN = "ABCDEFGHIJKLMNO";

function checkHeader(r: SheetCell[]) {
  // Uma linha só com "Data" (sem os outros títulos) não diz nada sobre as colunas.
  if (!r.slice(1, 14).some((c) => cellText(c))) return;
  for (const [j, re, label] of HEADERS) {
    if (!re.test(plainText(r[j])))
      throw new Error(`colunas diferentes das esperadas (coluna ${COLUMN[j]}: "${cut(cellText(r[j]) || "", 40).text}" em vez de "${label}"). Nada desta loja foi alterado.`);
  }
}

// Um número inteiro que, lido como data, cai entre dois anos antes e um ano depois de hoje: o Sheets guardou como
// data o que a loja escreveu ("12/5" em vez de "12,5"). Nenhuma venda de loja chega perto destes valores.
function valueLooksLikeDate(v: SheetCell, today: string): string | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  const iso = serialDate(v);
  return iso && iso >= addDays(today, -730) && iso <= addDays(today, 365) ? iso : null;
}

const isHeader = (v: SheetCell) => typeof v === "string" && (plain(v) === "DATA" || plain(v).startsWith("EX"));

// Período em que as datas de uma secção são aceites tal como estão escritas: do dia 1 do mês da secção até à
// véspera do mês da secção seguinte (sem o cabeçalho do mês novo, as datas seguintes continuam a contar), e
// nunca depois de hoje. Uma data corrigida (ano ou dia e mês trocados) tem de cair no próprio mês da secção
// (até `fixHi`), com o ano da secção (`fixYears`), como no script com maio–outubro de 2026. As linhas antes do
// primeiro mês aceitam qualquer data até hoje. `years`: os anos possíveis de uma data escrita sem ano.
type Range = { lo: string; hi: string; fixHi: string; years: number[]; fixYears: number[]; year: number; label: string };

const inRange = (iso: string | null, rg: Range): boolean => !!iso && iso >= rg.lo && iso <= rg.hi;

type Section = { month: number | null; explicit: number | null; dated: boolean; votes: number[]; year: number; range: Range };

const LABELS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function yearsBetween(lo: string, hi: string) {
  const out: number[] = [];
  for (let y = parts(lo)[0]; y <= Math.max(parts(lo)[0], parts(hi)[0]); y++) out.push(y);
  return out;
}

// O ano de cada secção: os meses seguem-se pela ordem da folha e, quando o mês volta atrás, passa-se ao ano
// seguinte. O ano de partida é, à partida, o que põe a última secção com datas no mês mais recente que não
// está no futuro (a folha é preenchida todos os dias); as datas de série das secções (contando também as
// trocadas, em que o dia é o mês da secção) votam e, se forem mais do que PRIOR_VOTES a indicar outro ano,
// mandam elas (um separador abandonado há mais de um ano, ou uma secção futura criada por engano).
// Um ano escrito no cabeçalho ("Janeiro 2027") manda a partir dessa secção.
const PRIOR_VOTES = 2;

function placeSections(sections: Section[], today: string) {
  const [ty, tm] = parts(today);
  const months = sections.filter((s) => s.month !== null);
  const off: number[] = [];
  let k = 0;
  months.forEach((s, i) => {
    if (i > 0 && s.month! < months[i - 1].month!) k++;
    off.push(k);
  });
  let base = 0;
  if (months.length) {
    let i = months.length - 1;
    while (i > 0 && !months[i].dated) i--;
    base = (months[i].month! <= tm ? ty : ty - 1) - off[i];
    const votes = new Map<number, number>([[base, PRIOR_VOTES]]);
    months.forEach((s, j) => {
      for (const y of s.votes) if (fmt(y, s.month!, 1) <= today) votes.set(y - off[j], (votes.get(y - off[j]) || 0) + 1);
    });
    for (const [b, n] of votes) if (n > votes.get(base)!) base = b;
  }
  let shift = 0;
  months.forEach((s, i) => {
    if (s.explicit) shift = s.explicit - (base + off[i]);
    s.year = base + off[i] + shift;
  });
  const start = (s: Section) => fmt(s.year, s.month!, 1);
  sections.forEach((s, i) => {
    if (s.month === null) {
      const next = sections.find((x) => x.month !== null);
      const hi = next && addDays(start(next), -1) < today ? addDays(start(next), -1) : today;
      const y = parts(hi)[0];
      s.year = y;
      s.range = { lo: "0000-00-00", hi, fixHi: hi, years: [y, y - 1], fixYears: [y, y - 1], year: y, label: "antes do primeiro mês" };
      return;
    }
    const lo = start(s);
    const next = sections.slice(i + 1).find((x) => x.month !== null && start(x) > lo);
    const end = next ? addDays(start(next), -1) : today;
    const hi = end < today ? end : today;
    const monthEnd = addDays(fmt(s.month === 12 ? s.year + 1 : s.year, s.month === 12 ? 1 : s.month + 1, 1), -1);
    s.range = {
      lo, hi, fixHi: monthEnd < hi ? monthEnd : hi, years: yearsBetween(lo, hi), fixYears: [s.year], year: s.year,
      label: `${LABELS[s.month - 1]} de ${s.year}`,
    };
  });
}

type Resolved = { date: string; notes: string[]; issue?: string } | { date: null; issue: string };

// Correções da data (parse_date(), linhas 134-153), em relação à secção em vez de maio–outubro de 2026:
// fora do período da secção (ou no futuro) tenta-se o ano da secção, depois dia e mês trocados, depois o dia
// da linha anterior da secção. Sem linha anterior, fica a data escrita se não for futura; senão a linha sai.
function resolveDate(y: number, m: number, d: number, rg: Range, prev: string | null, today: string): Resolved {
  const iso = mk(y, m, d);
  const orig = iso || fmt(y, m, d);
  if (iso && inRange(iso, rg)) return { date: iso, notes: [] };
  const fixable = (fixed: string | null): fixed is string => !!fixed && fixed >= rg.lo && fixed <= rg.fixHi;
  for (const c of rg.fixYears) {
    const fixed = c === y ? null : mk(c, m, d);
    if (fixable(fixed)) return { date: fixed, notes: [`ano corrigido de ${y} para ${c}`] };
  }
  if (d <= 12)
    for (const c of rg.fixYears) {
      const swapped = mk(c, d, m);
      if (fixable(swapped)) return { date: swapped, notes: [`dia e mês trocados (${orig})`] };
    }
  // Secção que só pode estar no futuro (cabeçalho de mês errado): a data escrita, se for válida e não futura, é
  // mais fiável do que a da linha anterior.
  if (rg.lo > rg.hi && iso && iso <= today) return { date: iso, notes: [], issue: `Data ${iso} fora de ${rg.label} (mês ainda por chegar): mantida.` };
  if (prev) return { date: prev, notes: [`data inválida (${orig}), usado o dia da linha anterior`] };
  if (iso && iso <= today) return { date: iso, notes: [], issue: `Data ${iso} fora de ${rg.label}, sem linha anterior no mês: mantida.` };
  return { date: null, issue: `Data ${iso ? "futura" : "inválida"} (${orig}) sem linha anterior no mês: linha ignorada.` };
}

// ---------------------------------------------------------------- lojas

function matchStore(title: string, stores: StoreRef[]): { code: string | null; message?: string } {
  const t = plain(title);
  const levels: ((s: StoreRef) => boolean)[] = [
    (s) => plain(s.name) === t,
    (s) => plain(s.name.replace(/\([^)]*\)/g, " ")) === t,
    (s) => s.code === storeCode(title),
    (s) => s.code === SALES_STORES[t],
  ];
  for (const level of levels) {
    const hits = [...new Set(stores.filter((s) => s && typeof s.code === "string" && typeof s.name === "string" && level(s)).map((s) => s.code))];
    if (hits.length === 1) return { code: hits[0] };
    if (hits.length > 1) return { code: null, message: "Separador corresponde a mais do que uma loja: ignorado." };
  }
  return { code: null, message: "Separador sem loja correspondente: ignorado." };
}

// ---------------------------------------------------------------- leitura

function itemsOf(refs: string[], materials: (string | null)[], types: (string | null)[]): SheetItem[] {
  const count = Math.max(types.length, refs.length, 1);
  const out: SheetItem[] = [];
  for (let i = 0; i < count; i++) {
    const item = {
      reference: i < refs.length ? refs[i] : null,
      material: materials[Math.min(i, materials.length - 1)] ?? null,
      product_type: types[Math.min(i, types.length - 1)] ?? null,
    };
    // Um artigo sem referência, material nem tipo não é um artigo (o formulário também não o guarda).
    if (item.reference || item.material || item.product_type) out.push(item);
  }
  return out;
}

const joinNotes = (...notes: (string | null | undefined)[]) => notes.filter(Boolean).join("; ") || null;

// Junta uma linha à anterior quando são a mesma venda (merge_sales(), linhas 227-246).
function merge(prev: SheetSale, row: SheetSale) {
  prev.items.push(...row.items);
  if (row.total_value) prev.total_value = round2((prev.total_value || 0) + row.total_value);
  prev.sold = prev.sold || row.sold;
  for (const key of ["campaign", "campaign_code", "client_type", "seen_where", "bought_online", "purpose", "restock", "no_sale_reason", "looking_for"] as const) {
    if (prev[key] === null || (key === "campaign" && row[key])) (prev as Record<string, unknown>)[key] = row[key] !== null ? row[key] : prev[key];
  }
  if (row.notes && !(prev.notes || "").includes(row.notes)) prev.notes = joinNotes(prev.notes, row.notes);
}

function parseTab(rows: SheetCell[][], store: string, title: string, today: string, issues: SheetIssue[]): SheetSale[] {
  const issue = (row: number | null, message: string) => issues.push({ tab: title, row, message });
  const grid = rows.map((r) => {
    const raw = Array.isArray(r) ? r : [];
    return Array.from({ length: COLS }, (_, j) => {
      const c = raw[j];
      return typeof c === "string" || typeof c === "boolean" || (typeof c === "number" && Number.isFinite(c)) ? c : null;
    });
  });

  // 1.ª passagem: secções de mês, e as datas de série de cada uma para saber o ano.
  const blank = (): Section => ({ month: null, explicit: null, dated: false, votes: [], year: 0, range: null as unknown as Range });
  const sections: Section[] = [blank()];
  const sectionOf: number[] = [];
  const seenDates = new Map<Section, { month: number; day: number }[]>();
  const nextMonth = (parts(today)[1] % 12) + 1;
  for (const r of grid) {
    const head = monthHeader(r[0]);
    if (head) sections.push({ ...blank(), month: head.month, explicit: head.year });
    const s = sections[sections.length - 1];
    sectionOf.push(sections.length - 1);
    if (!head && typeof r[0] === "string" && plain(r[0]) === "DATA") checkHeader(r);
    if (head || isHeader(r[0])) continue;
    const date = readDate(r[0]);
    // Só datas que já podem ter acontecido dizem em que mês está a folha (não uma secção do mês seguinte criada
    // antes do tempo).
    if (date.kind === "serial" ? date.iso <= today : date.kind === "text" && date.month !== nextMonth) s.dated = true;
    if (date.kind === "serial" && s.month !== null) {
      const [y, m, d] = parts(date.iso);
      if (m === s.month || d === s.month) s.votes.push(y);
    }
    if (s.month !== null && (date.kind === "serial" || date.kind === "text")) {
      const [m, d] = date.kind === "serial" ? parts(date.iso).slice(1) : [date.month, date.day];
      seenDates.set(s, [...(seenDates.get(s) || []), { month: m, day: d }]);
    }
  }
  // Cabeçalho de mês errado (copiado de outro mês e não mudado): se a maioria das datas da secção é de outro mês
  // e menos de metade é do mês do cabeçalho (contando as trocadas), vale o mês das datas.
  for (const [s, list] of seenDates) {
    if (list.length < 3 || s.explicit) continue;
    const own = list.filter((x) => x.month === s.month || x.day === s.month).length;
    const counts = new Map<number, number>();
    for (const x of list) counts.set(x.month, (counts.get(x.month) || 0) + 1);
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top !== s.month && top >= 1 && top <= 12 && n * 2 > list.length && own * 2 < list.length) {
      issue(null, `Cabeçalho "${LABELS[s.month! - 1]}", mas a maioria das datas da secção é de ${LABELS[top - 1]}: usado ${LABELS[top - 1]}.`);
      s.month = top;
    }
  }
  placeSections(sections, today);

  // 2.ª passagem: os registos (sales_rows(), linhas 156-224).
  const out: SheetSale[] = [];
  let last: { sale: SheetSale; material: string | null } | null = null;
  let prevDate: string | null = null;
  grid.forEach((r, i) => {
    const rowNo = i + 1;
    const a = r[0];
    const section = sections[sectionOf[i]];
    if (monthHeader(a)) {
      prevDate = null;
      last = null;
      return;
    }
    if (isHeader(a)) {
      last = null;
      return;
    }
    const t = r.map(cellText);
    if (!t.some(Boolean)) return;

    // Linha só com dados de artigo (referência, material, tipo): mais um artigo da venda de cima (linha 172).
    if (!t[0] && !t[1] && (t[2] || t[4] || t[5]) && ![3, 6, 7, 8, 9, 10, 11, 12, 13].some((j) => t[j]) && last) {
      const { sale, material } = last;
      const types = splitParts(r[5]).map(mapProductType);
      const materials = splitParts(r[4]).map(mapMaterial);
      sale.items.push(...itemsOf(splitRefs(r[2]), materials.length ? materials : [material], types.length ? types : [null]));
      sale.notes = joinNotes(sale.notes, types.includes("outro") ? `tipo: ${t[5]}` : null, t[14]);
      return;
    }
    // Linhas modelo: sem data própria e só com as respostas pré-preenchidas (ou nada além de traços).
    if (!t[0] && !SUBSTANTIVE.some((j) => t[j])) return;

    // Data (parse_date(), linhas 134-153).
    const dateNotes: string[] = [];
    const cell = readDate(a);
    let date: string | null = null;
    if (cell.kind === "none" || cell.kind === "bad") {
      if (cell.kind === "bad") issue(rowNo, prevDate ? "Data não reconhecida: usado o dia da linha anterior." : "Data não reconhecida e sem linha anterior no mês: linha ignorada.");
      else if (!prevDate) issue(rowNo, "Linha sem data e sem linha anterior no mês: ignorada.");
      date = prevDate;
    } else {
      const rg = section.range;
      let y: number, m: number, d: number;
      if (cell.kind === "serial") [y, m, d] = parts(cell.iso);
      else {
        // Texto: o ano é o da secção (ou o seguinte, numa secção que já passou para o ano novo).
        dateNotes.push(`data escrita como texto (${cut(cell.raw, 40).text})`);
        [m, d] = [cell.month, cell.day];
        y = rg.years.find((c) => inRange(mk(c, m, d), rg)) ?? rg.year;
      }
      const res = resolveDate(y, m, d, rg, prevDate, today);
      if (res.issue) issue(rowNo, res.issue);
      if ("notes" in res) dateNotes.push(...res.notes);
      date = res.date;
    }
    // Linha que fica de fora: as linhas de artigo que vierem a seguir não são da venda de cima.
    if (!date) {
      last = null;
      return;
    }
    prevDate = date;
    // Só a data (por exemplo escrita à frente, como título do dia): dá o dia às linhas de baixo, mas não é registo.
    if (!SUBSTANTIVE.some((j) => t[j]) && ![3, 6, 7, 8].some((j) => t[j])) {
      last = null;
      return;
    }

    const notes = [...dateNotes];
    const parsed = parseValue(r[9]);
    const valueDate = valueLooksLikeDate(r[9], today);
    if (parsed === INVALID || valueDate) {
      notes.push(`valor: ${t[9]}`);
      issue(rowNo, valueDate ? `Valor ${t[9]} parece uma data (${valueDate}): fica nas notas, sem valor.` : "Valor não reconhecido: fica nas notas, sem valor.");
    }
    const value = parsed === INVALID || valueDate ? null : parsed;
    const reason = t[12];
    const sold = !reason || !!value;
    const camp = mapCampaign(r[3]);
    const materials = splitParts(r[4]).map(mapMaterial);
    const types = splitParts(r[5]).map(mapProductType);
    const items = itemsOf(splitRefs(r[2]), materials.length ? materials : [null], types.length ? types : [null]);
    if (types.includes("outro")) notes.push(`tipo: ${t[5]}`);
    const obs = t[11];
    const purpose = mapPurpose(r[11]);
    if (obs && (!purpose || plain(obs).length > 25)) notes.push(obs);
    if (reason) notes.push(`motivo: ${reason}`);
    if (t[10] && mapRestock(r[10]) === null) notes.push(`reposição: ${t[10]}`);
    if (t[14]) notes.push(t[14]);
    let seen = mapSeenWhere(r[7]);
    if (!seen && obs && plain(obs).includes("MONTRA")) seen = "montra";
    if (!seen && obs && plain(obs).includes("SITE")) seen = "site";
    let kind = mapClientType(r[6]);
    if (!kind && obs && plain(obs).includes("TURISTA")) kind = "passagem";
    const saleNumber = typeof r[1] === "number" && Number.isFinite(r[1]) ? numText(Math.trunc(r[1])) : t[1];
    const looking = t[13] ? cut(t[13], LIMITS.looking_for) : null;
    if (looking?.cut) issue(rowNo, `"O que procurava?" com mais de ${LIMITS.looking_for} caracteres: cortado.`);
    const numberCut = saleNumber ? cut(saleNumber, LIMITS.sale_number) : null;
    if (numberCut?.cut) issue(rowNo, `Nº de venda com mais de ${LIMITS.sale_number} caracteres: cortado.`);

    const row: SheetSale = {
      store_code: store,
      sale_date: date,
      sale_number: numberCut?.text || null,
      sold,
      total_value: sold ? value : null,
      campaign: camp.campaign,
      campaign_code: camp.code,
      client_type: kind,
      seen_where: seen,
      bought_online: mapYesNo(r[8]),
      purpose,
      restock: mapRestock(r[10]),
      no_sale_reason: mapNoSaleReason(r[12]),
      looking_for: looking?.text || null,
      notes: joinNotes(...notes),
      items,
      row: rowNo,
    };
    // Linhas seguidas com o mesmo nº de venda no mesmo dia são uma venda com vários artigos. Os artigos de
    // continuação que vierem a seguir juntam-se a essa venda, com o material do 1.º artigo desta linha.
    const prev = out[out.length - 1];
    const same = prev && row.sale_number && prev.sale_number === row.sale_number && prev.sale_date === row.sale_date;
    if (same) merge(prev, row);
    else out.push(row);
    last = { sale: same ? prev : row, material: items[0]?.material ?? null };
  });

  // Limites da base de dados.
  return out.map((s) => {
    if (s.items.length > LIMITS.items) {
      issue(s.row, `Mais de ${LIMITS.items} artigos: só ficam os primeiros ${LIMITS.items}.`);
      s.items = s.items.slice(0, LIMITS.items);
    }
    let longRef = false;
    s.items = s.items.map((it) => {
      if (!it.reference) return it;
      const ref = cut(it.reference, LIMITS.reference);
      longRef = longRef || ref.cut;
      return { ...it, reference: ref.text || null };
    });
    if (longRef) issue(s.row, `Referência com mais de ${LIMITS.reference} caracteres: cortada.`);
    if (s.total_value !== null && s.total_value > LIMITS.total_value) {
      issue(s.row, "Valor somado da venda acima do limite: fica nas notas, sem valor.");
      s.notes = joinNotes(s.notes, `valor: ${s.total_value}`);
      s.total_value = null;
    }
    if (s.notes) {
      const notes = cut(s.notes, LIMITS.notes);
      if (notes.cut) issue(s.row, `Notas com mais de ${LIMITS.notes} caracteres: cortadas.`);
      s.notes = notes.text || null;
    }
    return s;
  });
}

// Lê todos os separadores. Cada um corresponde a uma loja pelo nome (sem acentos nem maiúsculas), pelo
// código ou, por fim, pela tabela fixa do script. Um separador sem loja fica de fora com um aviso.
export function parseSalesSheet(
  tabs: SheetTab[],
  o: { stores: StoreRef[]; today: string },
): { sales: SheetSale[]; issues: SheetIssue[]; tabs: { title: string; store_code: string | null; sales: number }[] } {
  if (typeof o?.today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.today) || !mk(...parts(o.today))) throw new TypeError("today tem de ser uma data AAAA-MM-DD.");
  const stores = Array.isArray(o.stores) ? o.stores : [];
  const sales: SheetSale[] = [];
  const issues: SheetIssue[] = [];
  const summary: { title: string; store_code: string | null; sales: number }[] = [];
  const seen = new Map<string, string>();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const title = String(tab?.title ?? "");
    const match = matchStore(title, stores);
    if (!match.code) {
      issues.push({ tab: title, row: null, message: match.message! });
      summary.push({ title, store_code: null, sales: 0 });
      continue;
    }
    if (seen.has(match.code)) {
      issues.push({ tab: title, row: null, message: `A loja já foi lida no separador "${seen.get(match.code)}": ignorado.` });
      summary.push({ title, store_code: null, sales: 0 });
      continue;
    }
    seen.set(match.code, title);
    try {
      const mine = parseTab(Array.isArray(tab.rows) ? tab.rows : [], match.code, title, o.today, issues);
      sales.push(...mine);
      summary.push({ title, store_code: match.code, sales: mine.length });
    } catch (e) {
      // Sem loja no resumo: quem importa trata o separador como não lido e não mexe nos dias desta loja.
      issues.push({ tab: title, row: null, message: `Erro ao ler o separador: ${e instanceof Error ? e.message : String(e)}` });
      summary.push({ title, store_code: null, sales: 0 });
    }
  }
  return { sales, issues, tabs: summary };
}

// ---------------------------------------------------------------- dias

export function dayKey(s: Pick<SheetSale, "store_code" | "sale_date">): string {
  return `${s.store_code}|${s.sale_date}`;
}

export function groupByDay(sales: SheetSale[]): Map<string, SheetSale[]> {
  const out = new Map<string, SheetSale[]>();
  for (const s of sales) {
    const k = dayKey(s);
    const list = out.get(k);
    if (list) list.push(s);
    else out.set(k, [s]);
  }
  return out;
}

// Impressão digital do conteúdo de um dia: não depende da ordem das linhas nem do número da linha na folha,
// por isso só muda quando muda o que foi registado.
export function dayHash(sales: SheetSale[]): string {
  const rows = sales
    .map((s) =>
      JSON.stringify([
        s.store_code, s.sale_date, s.sale_number, s.sold, s.total_value, s.campaign, s.campaign_code, s.client_type,
        s.seen_where, s.bought_online, s.purpose, s.restock, s.no_sale_reason, s.looking_for, s.notes,
        (s.items || []).map((i) => [i.reference, i.material, i.product_type]),
      ]),
    )
    .sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
