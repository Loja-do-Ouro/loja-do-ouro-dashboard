const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/store-sheet-rules.js");

// Folha sintética com o formato da API do Sheets (UNFORMATTED_VALUE + SERIAL_NUMBER): datas em número de série,
// valores em número, texto, booleanos; células vazias a null e linhas com comprimentos diferentes.
const S = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
const COLS = ["date", "n", "ref", "camp", "mat", "type", "client", "seen", "online", "value", "restock", "obs", "reason", "looking", "extra"];
const row = (o) => {
  const out = COLS.map((k) => (o[k] === undefined ? null : o[k]));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};
const sale = (o) => row({ camp: "Não", mat: "Prata", type: "Fio", client: "Novo", seen: "Loja", online: "Não", value: 10, ...o });
const month = (name) => [name];
const HEADER = ["Data", "Nº Venda", "Referência", "Campanha", "Material", "Tipo", "Tipo de Cliente", "Onde viu o Produto?", "Ja comprou online?", "Valor", "Pedido Reposição", "Observações", "Motivo de NÃO Venda", "O que procurava?"];
const EXAMPLE = ["Ex:05/04/2026", 1234, 5678, "SIM OU NÃO - SE SIM IDENTIFICAR A MESMA", "Prata", "Fio", "Habitual / Novo", "Loja", "Não", 49.9, "Sim", "Para oferecer"];
const STORES = [
  { code: "loures", name: "Loures" },
  { code: "benfica", name: "Benfica (Premium)" },
  { code: "leiria-jerico", name: "Leiria Jericó" },
  { code: "figueira-da-foz", name: "Figueira da Foz" },
];
const TODAY = "2026-10-09";
const LISTS = { campaign: "campaign_code", client_type: "client_type", seen_where: "seen_where", purpose: "purpose", restock: "restock", no_sale_reason: "no_sale_reason" };
const chars = (s) => Array.from(s || "").length;

// Tudo o que sai tem de caber na BD: códigos conhecidos, tamanhos, valor ≥ 0, nunca no futuro.
function check(s, today) {
  assert.match(s.sale_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(s.sale_date <= today, `data futura ${s.sale_date}`);
  assert.ok(s.sale_number === null || chars(s.sale_number) <= 40);
  assert.ok(s.looking_for === null || chars(s.looking_for) <= 300);
  assert.ok(s.notes === null || chars(s.notes) <= 1000);
  assert.ok(s.total_value === null || (s.total_value >= 0 && s.total_value <= 9_999_999_999.99));
  assert.ok(s.items.length <= 30);
  assert.equal(typeof s.sold, "boolean");
  for (const [list, key] of Object.entries(LISTS)) assert.ok(s[key] === null || r.OPTION_CODES[list].includes(s[key]), `${key}=${s[key]}`);
  for (const it of s.items) {
    assert.ok(it.reference === null || (chars(it.reference) <= 40 && it.reference.length > 0));
    assert.ok(it.material === null || r.OPTION_CODES.material.includes(it.material));
    assert.ok(it.product_type === null || r.OPTION_CODES.product_type.includes(it.product_type));
    assert.ok(it.reference || it.material || it.product_type);
  }
  for (const v of Object.values(s)) if (typeof v === "string") assert.ok(!v.includes("\u0000"));
}

function parse(rows, { today = TODAY, title = "Loures", stores = STORES } = {}) {
  const res = r.parseSalesSheet([{ title, rows }], { stores, today });
  for (const s of res.sales) check(s, today);
  return res;
}
const dates = (res) => res.sales.map((s) => s.sale_date);

test("Secções de mês: cabeçalhos e exemplos saltam-se, datas de série (com horas) viram dias do calendário", () => {
  const rows = [
    month("Maio"), HEADER, EXAMPLE,
    sale({ date: S("2026-05-04"), n: 101, ref: 1234567 }),
    [],
    [null, null, null],
    month("JUNHO"), HEADER, ["EXEMPLO", 1, 2, "Não"],
    sale({ date: S("2026-06-02") + 0.6, n: "FS 1000001", value: 12.5 }),
  ];
  const { sales, issues, tabs } = parse(rows);
  assert.deepEqual(issues, []);
  assert.deepEqual(tabs, [{ title: "Loures", store_code: "loures", sales: 2 }]);
  assert.deepEqual(sales[0], {
    store_code: "loures", sale_date: "2026-05-04", sale_number: "101", sold: true, total_value: 10, campaign: false, campaign_code: null,
    client_type: "novo", seen_where: "loja", bought_online: false, purpose: null, restock: null, no_sale_reason: null, looking_for: null,
    notes: null, items: [{ reference: "1234567", material: "prata", product_type: "fio" }], row: 4,
  });
  assert.deepEqual([sales[1].sale_date, sales[1].sale_number, sales[1].total_value, sales[1].row], ["2026-06-02", "FS 1000001", 12.5, 10]);
  assert.equal(r.serialDate(S("2026-02-28") + 0.99), "2026-02-28");
  assert.equal(r.serialDate(0), null);
  assert.deepEqual(r.monthHeader("  março "), { month: 3, year: null });
  assert.deepEqual(r.monthHeader("Janeiro de 2027"), { month: 1, year: 2027 });
  assert.deepEqual(r.monthHeader("OUTUBRO/2026"), { month: 10, year: 2026 });
  assert.equal(r.monthHeader("Maiores"), null);
  assert.equal(r.monthHeader(5), null);
});

test("O ano vem das secções: passa ao ano seguinte quando o mês volta atrás", () => {
  const rolled = parse([
    month("Novembro"), HEADER, sale({ date: S("2025-11-14") }), sale({ date: "20/11" }),
    month("Dezembro"), sale({ date: "05/12" }),
    month("Janeiro"), sale({ date: "07/01" }),
    month("Fevereiro"), sale({ date: S("2026-02-03") }),
  ], { today: "2026-03-01" });
  assert.deepEqual(dates(rolled), ["2025-11-14", "2025-11-20", "2025-12-05", "2026-01-07", "2026-02-03"]);

  // Sem datas de série: a última secção com datas é a mais recente que não está no futuro.
  const text = parse([month("Novembro"), sale({ date: "10/11" }), month("Dezembro"), sale({ date: "02/12" }), month("Janeiro"), sale({ date: "15/01" })], { today: "2026-01-20" });
  assert.deepEqual(dates(text), ["2025-11-10", "2025-12-02", "2026-01-15"]);
  assert.deepEqual(dates(parse([month("Novembro"), sale({ date: "10/11" })])), ["2025-11-10"]);
  assert.deepEqual(dates(parse([month("Outubro"), sale({ date: "01/10" }), month("Novembro")])), ["2026-10-01"]);

  // Uma data com o ano errado não muda o ano da secção (conta a maioria).
  const vote = parse([month("Maio"), sale({ date: S("2026-05-04") }), sale({ date: S("2027-05-05") }), sale({ date: S("2026-05-06") }), sale({ date: "07/05" })]);
  assert.deepEqual(dates(vote), ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"]);
  // Separador abandonado há mais de um ano: as datas de série (também as trocadas) mostram o ano.
  const old = parse([month("Maio"), sale({ date: S("2025-04-05") }), sale({ date: S("2025-02-05") }), sale({ date: S("2025-03-05") }), sale({ date: "20/05" })]);
  assert.deepEqual(dates(old), ["2025-05-04", "2025-05-02", "2025-05-03", "2025-05-20"]);
  // Poucas datas com o ano errado não chegam para mudar o ano.
  const few = parse([month("Maio"), sale({ date: S("2025-05-04") }), sale({ date: S("2025-05-05") }), sale({ date: "20/05" })]);
  assert.deepEqual(dates(few), ["2026-05-04", "2026-05-05", "2026-05-20"]);
  // Uma secção futura criada por engano não atrasa a folha um ano.
  const ahead = parse([month("Outubro"), sale({ date: S("2026-10-01") }), sale({ date: S("2026-10-02") }), sale({ date: S("2026-10-05") }), month("Dezembro"), sale({ date: S("2026-12-01") })]);
  assert.deepEqual(dates(ahead), ["2026-10-01", "2026-10-02", "2026-10-05"]);
  assert.deepEqual(ahead.issues.map((i) => [i.row, i.message]), [[6, "Data futura (2026-12-01) sem linha anterior no mês: linha ignorada."]]);

  // Ano escrito no cabeçalho.
  const explicit = parse([month("Dezembro 2026"), sale({ date: "03/12" }), month("Janeiro de 2027"), sale({ date: "04/01" })], { today: "2027-01-10" });
  assert.deepEqual(dates(explicit), ["2026-12-03", "2027-01-04"]);
  // Última secção sem o cabeçalho do mês novo: as datas seguintes até hoje contam.
  const forgot = parse([month("Dezembro"), sale({ date: S("2026-12-30") }), sale({ date: S("2027-01-02") }), sale({ date: "03/01" })], { today: "2027-01-05" });
  assert.deepEqual(dates(forgot), ["2026-12-30", "2027-01-02", "2027-01-03"]);
  assert.deepEqual(forgot.sales.map((s) => s.notes), [null, null, "data escrita como texto (03/01)"]);
});

test("Datas escritas como texto: d/m, d/m/aaaa, ano colado ou errado, e AAAA-MM-DD", () => {
  const res = parse([month("Junho"), sale({ date: "25/06" }), sale({ date: "21/6" }), sale({ date: "03/062026" }), sale({ date: "19/06/0206" }), sale({ date: " 2026-06-30 " }), sale({ date: "7.6" })]);
  assert.deepEqual(dates(res), ["2026-06-25", "2026-06-21", "2026-06-03", "2026-06-19", "2026-06-30", "2026-06-07"]);
  assert.deepEqual(res.sales.map((s) => s.notes), [
    "data escrita como texto (25/06)", "data escrita como texto (21/6)", "data escrita como texto (03/062026)",
    "data escrita como texto (19/06/0206)", "data escrita como texto (2026-06-30)", "data escrita como texto (7.6)",
  ]);
  assert.deepEqual(res.issues, []);
});

test("Datas de série com o ano errado: ano da secção, com nota", () => {
  const res = parse([month("Julho"), sale({ date: S("2027-07-20") }), month("Agosto"), sale({ date: S("2025-08-13") }), month("Setembro"), sale({ date: S("2029-09-24") })]);
  assert.deepEqual(dates(res), ["2026-07-20", "2026-08-13", "2026-09-24"]);
  assert.deepEqual(res.sales.map((s) => s.notes), ["ano corrigido de 2027 para 2026", "ano corrigido de 2025 para 2026", "ano corrigido de 2029 para 2026"]);
});

test("Dia e mês trocados: quando a troca cai no mês da secção e não no futuro", () => {
  const res = parse([
    month("Maio"), sale({ date: S("2026-04-05") }),
    month("Junho"), sale({ date: S("2026-11-06") }), sale({ date: "06/13" }),
    month("Julho"), sale({ date: S("2026-08-07") }), sale({ date: S("2026-10-07") }),
    month("Agosto"),
    month("Outubro"), sale({ date: S("2026-02-10") }),
  ]);
  assert.deepEqual(dates(res), ["2026-05-04", "2026-06-11", "2026-06-13", "2026-07-08", "2026-07-10", "2026-10-02"]);
  assert.deepEqual(res.sales.map((s) => s.notes), [
    "dia e mês trocados (2026-04-05)", "dia e mês trocados (2026-11-06)", "data escrita como texto (06/13); dia e mês trocados (2026-13-06)",
    "dia e mês trocados (2026-08-07)", "dia e mês trocados (2026-10-07)", "dia e mês trocados (2026-02-10)",
  ]);
  // A troca que daria uma data futura não serve.
  const future = parse([month("Outubro"), sale({ date: S("2026-10-01") }), sale({ date: S("2026-12-10") })], { today: "2026-10-05" });
  assert.deepEqual(dates(future), ["2026-10-01", "2026-10-01"]);
});

test("Data fora do mês da secção: dia da linha anterior; sem linha anterior fica a data escrita, com aviso", () => {
  const res = parse([
    month("Junho"), sale({ date: S("2026-06-06") }), sale({ date: S("2026-08-08") }), sale({ date: S("2026-05-31") }),
    month("Julho"), sale({ date: S("2026-06-30") }), sale({ date: S("2026-07-02") }),
    // Sem o cabeçalho de setembro, as datas de setembro ficam em agosto (a secção seguinte é outubro).
    month("Agosto"), sale({ date: S("2026-08-20") }), sale({ date: S("2026-09-03") }),
    month("Outubro"), sale({ date: S("2026-10-01") }),
  ]);
  assert.deepEqual(dates(res), ["2026-06-06", "2026-06-06", "2026-06-06", "2026-06-30", "2026-07-02", "2026-08-20", "2026-09-03", "2026-10-01"]);
  assert.equal(res.sales[1].notes, "data inválida (2026-08-08), usado o dia da linha anterior");
  assert.equal(res.sales[2].notes, "data inválida (2026-05-31), usado o dia da linha anterior");
  assert.equal(res.sales[3].notes, null);
  assert.deepEqual(res.issues, [{ tab: "Loures", row: 6, message: "Data 2026-06-30 fora de julho de 2026, sem linha anterior no mês: mantida." }]);
});

test("Datas futuras nunca saem: linha anterior, ou a linha fica de fora com aviso", () => {
  const today = "2026-10-05";
  const res = parse([
    month("Setembro"), sale({ date: S("2026-09-30") }),
    month("Outubro"), sale({ date: S("2026-10-20") }), sale({ date: S("2026-10-03") }), sale({ date: S("2026-10-07") }), sale({ date: "08/10" }), sale({ date: "2026-10-31" }),
    month("Novembro"), sale({ date: S("2026-10-04") }), sale({ date: S("2026-11-02") }),
  ], { today });
  assert.deepEqual(dates(res), ["2026-09-30", "2026-10-03", "2026-10-03", "2026-10-03", "2026-10-03", "2026-10-04", "2026-10-04"]);
  assert.equal(res.sales[2].notes, "data inválida (2026-10-07), usado o dia da linha anterior");
  assert.equal(res.sales[3].notes, "data escrita como texto (08/10); data inválida (2026-10-08), usado o dia da linha anterior");
  assert.deepEqual(res.issues.map((i) => [i.row, i.message]), [
    [4, "Data futura (2026-10-20) sem linha anterior no mês: linha ignorada."],
    [10, "Data 2026-10-04 fora de novembro de 2026, sem linha anterior no mês: mantida."],
  ]);
  assert.equal(res.sales[6].notes, "data inválida (2026-11-02), usado o dia da linha anterior");
});

test("Linhas sem data herdam a da linha anterior do mês; data só por si dá o dia às linhas de baixo", () => {
  const res = parse([
    month("Maio"), HEADER,
    row({ n: 5, value: 20, mat: "Ouro", type: "Anel" }),
    sale({ date: S("2026-05-10"), n: 6 }),
    row({ value: 30, mat: "Prata", type: "Anel", reason: "Achou caro" }),
    row({ date: "ontem", value: 7, type: "Fio" }),
    row({ date: S("2026-05-11") }),
    row({ value: 5, type: "Fio", mat: "Aço" }),
    month("Junho"),
    row({ value: 9, type: "Fio" }),
  ]);
  assert.deepEqual(res.sales.map((s) => [s.sale_date, s.row]), [["2026-05-10", 4], ["2026-05-10", 5], ["2026-05-10", 6], ["2026-05-11", 8]]);
  assert.deepEqual(res.issues.map((i) => [i.row, i.message]), [
    [3, "Linha sem data e sem linha anterior no mês: ignorada."],
    [6, "Data não reconhecida: usado o dia da linha anterior."],
    [10, "Linha sem data e sem linha anterior no mês: ignorada."],
  ]);
});

test("Linhas só com dados de artigo são mais artigos da venda de cima", () => {
  const res = parse([
    month("Maio"), HEADER,
    sale({ date: S("2026-05-04"), n: 7, ref: "111/222", mat: "Ouro", type: "Anel/Brincos", value: 300 }),
    row({ ref: 333 }),
    row({ ref: "444 555", type: "Pulseira" }),
    row({ mat: "Prata", type: "Fio", extra: "gravado" }),
    [],
    row({ type: "Coisa rara" }),
    row({ ref: 666, value: 15 }),
    HEADER,
    row({ ref: 999 }),
  ]);
  assert.equal(res.sales.length, 3);
  const [first, own, afterHeader] = res.sales;
  assert.deepEqual(first.items, [
    { reference: "111", material: "ouro", product_type: "anel" },
    { reference: "222", material: "ouro", product_type: "brincos" },
    { reference: "333", material: "ouro", product_type: null },
    { reference: "444", material: "ouro", product_type: "pulseira" },
    { reference: "555", material: "ouro", product_type: "pulseira" },
    { reference: null, material: "prata", product_type: "fio" },
    { reference: null, material: "ouro", product_type: "outro" },
  ]);
  assert.equal(first.notes, "gravado; tipo: Coisa rara");
  assert.equal(first.total_value, 300);
  // Com valor é um registo próprio (com a data de cima); depois de um cabeçalho já não há venda de cima.
  assert.deepEqual([own.sale_date, own.total_value, own.items], ["2026-05-04", 15, [{ reference: "666", material: null, product_type: null }]]);
  assert.deepEqual([afterHeader.sale_date, afterHeader.sold, afterHeader.total_value, afterHeader.row], ["2026-05-04", true, null, 11]);
  // Continuação depois de duas linhas da mesma venda: material do 1.º artigo da última linha.
  const merged = parse([month("Maio"), sale({ date: S("2026-05-04"), n: 9, mat: "Ouro" }), sale({ date: S("2026-05-04"), n: 9, mat: "Aço" }), row({ ref: 50001 })]);
  assert.deepEqual(merged.sales[0].items.map((i) => i.material), ["ouro", "aco", "aco"]);
  // Depois de uma linha só com a data, uma linha só com referência já não é da venda de cima.
  const dayTitle = parse([month("Maio"), sale({ date: S("2026-05-04"), ref: 50001 }), row({ date: S("2026-05-05") }), row({ ref: 50002 })]);
  assert.deepEqual(dayTitle.sales.map((s) => [s.sale_date, s.items.map((i) => i.reference)]), [["2026-05-04", ["50001"]], ["2026-05-05", ["50002"]]]);
});

test("Linhas seguidas com o mesmo nº de venda no mesmo dia são uma venda", () => {
  const res = parse([
    month("Maio"),
    sale({ date: S("2026-05-04"), n: 7, value: 10, camp: "Não", type: "Fio", obs: "Para oferecer", client: null }),
    sale({ date: S("2026-05-04"), n: 7, value: "15,50", camp: "Saldos", type: "Anel", client: "Habitual", obs: "Cliente pediu embrulho e fatura em nome da empresa" }),
    sale({ date: S("2026-05-04"), n: 8, value: 5 }),
    sale({ date: S("2026-05-04"), n: 7, value: 1 }),
    sale({ date: S("2026-05-05"), n: 7, value: 2 }),
    sale({ date: S("2026-05-05"), value: 3 }),
    sale({ date: S("2026-05-05"), value: 4 }),
    sale({ date: S("2026-05-05"), n: 20, value: null, reason: "Caro" }),
    sale({ date: S("2026-05-05"), n: 20, value: 50 }),
  ]);
  assert.deepEqual(res.sales.map((s) => [s.sale_date, s.sale_number, s.total_value]), [
    ["2026-05-04", "7", 25.5], ["2026-05-04", "8", 5], ["2026-05-04", "7", 1], ["2026-05-05", "7", 2],
    ["2026-05-05", null, 3], ["2026-05-05", null, 4], ["2026-05-05", "20", 50],
  ]);
  const [a] = res.sales;
  assert.deepEqual(a.items.map((i) => i.product_type), ["fio", "anel"]);
  assert.deepEqual([a.campaign, a.campaign_code, a.client_type, a.purpose, a.row], [true, "saldos", "habitual", "oferta", 2]);
  assert.equal(a.notes, "Cliente pediu embrulho e fatura em nome da empresa");
  const last = res.sales[6];
  assert.deepEqual([last.sold, last.no_sale_reason, last.notes], [true, "caro", "motivo: Caro"]);
});

test("Valores: número, texto com € e separador de milhares; inválidos ficam nas notas", () => {
  for (const [v, want] of [
    [49.9, 49.9], [19.999, 20], [0, 0], ["1.234,56 €", 1234.56], ["1 234,56", 1234.56], ["12,5", 12.5], ["€30", 30], ["1234.56", 1234.56],
    ["1.234", 1234], ["2.345.678,9", 2345678.9], ["", null], ["-----", null], [null, null],
    ["abc", "invalid"], [-5, "invalid"], ["-5", "invalid"], [1e13, "invalid"], [true, "invalid"], ["1,234", "invalid"],
  ]) assert.equal(r.parseValue(v), want, String(v));
  const res = parse([month("Maio"), sale({ date: S("2026-05-04"), value: "1.234,56 €" }), sale({ date: S("2026-05-04"), value: "dez euros" }), sale({ date: S("2026-05-04"), value: -20, reason: "Troca" })]);
  assert.deepEqual(res.sales.map((s) => [s.sold, s.total_value, s.notes]), [
    [true, 1234.56, null], [true, null, "valor: dez euros"], [false, null, "valor: -20; motivo: Troca"],
  ]);
  assert.deepEqual(res.issues.map((i) => i.row), [3, 4]);
});

test("Venda ou não: motivo sem valor é não venda; com valor é venda", () => {
  const res = parse([
    month("Maio"),
    sale({ date: S("2026-05-04"), value: null, reason: "Achou caro", looking: "Anel fino" }),
    sale({ date: S("2026-05-04"), value: 0, reason: "Não havia o tamanho" }),
    sale({ date: S("2026-05-04"), value: 80, reason: "Queria outro modelo" }),
    sale({ date: S("2026-05-04"), value: null }),
  ]);
  assert.deepEqual(res.sales.map((s) => [s.sold, s.total_value, s.no_sale_reason, s.looking_for]), [
    [false, null, "caro", "Anel fino"], [false, null, "sem_tamanho", null], [true, 80, "sem_stock", null], [true, null, null, null],
  ]);
  assert.equal(res.sales[0].notes, "motivo: Achou caro");
});

test("Campanha: todos os ramos", () => {
  const c = (v) => { const m = r.mapCampaign(v); return [m.campaign, m.code]; };
  assert.deepEqual(c(0.2), [true, "desconto"]);
  assert.deepEqual(c(NaN), [null, null]);
  assert.deepEqual(c(null), [null, null]);
  assert.deepEqual(c("-----"), [null, null]);
  for (const no of ["Não", "NAO", "nao", "NO", "Na o", "Não, obrigado", false]) assert.deepEqual(c(no), [false, null], String(no));
  assert.deepEqual(c("Saldos / Não"), [true, "saldos"]);
  assert.deepEqual(c("Sim - Verão"), [true, "verao"]);
  assert.deepEqual(c("Sim- Fé"), [true, "fe"]);
  assert.deepEqual(c("Sim - 20 %"), [true, "desconto"]);
  assert.deepEqual(c("Desconto"), [true, "desconto"]);
  assert.deepEqual(c("Stock off"), [true, "stock_off"]);
  assert.deepEqual(c("Sotck off"), [true, "stock_off"]);
  assert.deepEqual(c("Sim"), [true, "outra"]);
  assert.deepEqual(c(true), [true, "outra"]);
});

test("Material e tipo de artigo: todos os ramos e partes separadas", () => {
  for (const [v, want] of [
    ["Relógio Go", "relogio"], ["Ouro", "ouro"], ["AU", "ouro"], ["Prata", "prata"], ["Parta", "prata"], ["Prta", "prata"], ["AG", "prata"],
    ["Aço", "aco"], ["Metal comum", "metal_comum"], ["Metal", "metal_comum"], ["Couro", "outro"], ["Prata dourada", "prata"], ["Titânio", "outro"],
  ]) assert.equal(r.mapMaterial(v), want, v);
  for (const [v, want] of [
    ["Earcuff", "brincos"], ["Brinco", "brincos"], ["Argolas", "argolas"], ["Alianças", "aliancas"], ["Escrava", "escrava"],
    ["Pulseira", "pulseira"], ["Puls", "pulseira"], ["Bracelete", "pulseira"], ["Fio", "fio"], ["Corrente", "fio"], ["Colar", "colar"],
    ["Anel", "anel"], ["Anéis", "anel"], ["Solitário", "anel"], ["Aro", "anel"], ["Medalha", "medalha"], ["Madalha", "medalha"], ["Med", "medalha"],
    ["Cruz", "cruz"], ["Crucifixo", "cruz"], ["Cruxifixo", "cruz"], ["Escapulário", "escapulario"], ["Terço", "terco"], ["Alfinete", "alfinete"],
    ["Barra 1gr", "barra"], ["Moeda", "moeda"], ["Meia libra", "moeda"], ["Relógio", "relogio"], ["Conjunto", "conjunto"], ["Botões de punho", "outro"],
  ]) assert.equal(r.mapProductType(v), want, v);
  assert.deepEqual(r.splitParts("Fio / Medalha"), ["FIO", "MEDALHA"]);
  assert.deepEqual(r.splitParts("Fio + Brincos,Anel"), ["FIO", "BRINCOS", "ANEL"]);
  assert.deepEqual(r.splitParts("Fio e Pulseira - Anel"), ["FIO", "PULSEIRA", "ANEL"]);
  assert.deepEqual(r.splitParts("Fio-Brincos"), ["FIO-BRINCOS"]);
  assert.deepEqual(r.splitParts("Barra 2,5gr / Moeda 1/4 onça"), ["BARRA 2,5GR", "MOEDA 1/4 ONCA"]);
  assert.deepEqual(r.splitParts(null), []);
  assert.deepEqual(r.splitRefs("111/222; 333,444  555"), ["111", "222", "333", "444", "555"]);
  assert.deepEqual(r.splitRefs(1234567), ["1234567"]);
  assert.deepEqual(r.splitRefs("AB.01"), ["AB.01"]);
  // "+" separa; símbolos soltos e quantidades não são referências.
  assert.deepEqual(r.splitRefs("111+222"), ["111", "222"]);
  assert.deepEqual(r.splitRefs("2 * 50001782"), ["50001782"]);
  assert.deepEqual(r.splitRefs("50002473 (2UN)"), ["50002473"]);
  assert.deepEqual(r.splitRefs("9015568 + 9026900 - x2"), ["9015568", "9026900"]);
  // Vários tipos e materiais: um artigo por tipo/referência, o último material repete-se; "outro" guarda o texto.
  const res = parse([month("Maio"), sale({ date: S("2026-05-04"), ref: "50001/50002/50003", mat: "Ouro / Prata", type: "Fio + Coisa" })]);
  assert.deepEqual(res.sales[0].items, [
    { reference: "50001", material: "ouro", product_type: "fio" },
    { reference: "50002", material: "prata", product_type: "outro" },
    { reference: "50003", material: "prata", product_type: "outro" },
  ]);
  assert.equal(res.sales[0].notes, "tipo: Fio + Coisa");
  // Sem artigo nenhum: lista vazia.
  assert.deepEqual(parse([month("Maio"), row({ date: S("2026-05-04"), reason: "Só ver" })]).sales[0].items, []);
});

test("Cliente, onde viu, já comprou online, reposição, finalidade e motivo: todos os ramos", () => {
  for (const [v, want] of [["Novo", "novo"], ["Nova", "novo"], ["Habitual", "habitual"], ["Hab", "habitual"], ["Cliente", "habitual"], ["Colega", "habitual"], ["Passagem", "passagem"], ["Turista", null], [null, null]])
    assert.equal(r.mapClientType(v), want, String(v));
  for (const [v, want] of [
    ["Site", "site"], ["Online", "site"], ["Net", "site"], ["Loja/Site", "site"], ["Instagram", "redes_sociais"], ["Facebook", "redes_sociais"],
    ["Chat", "telefone"], ["WhatsApp", "telefone"], ["Telefone", "telefone"], ["Recomendação", "recomendacao"], ["Montra", "montra"], ["Monra", "montra"],
    ["Loja", "loja"], ["Armazém", "loja"], ["Rádio", "outro"], [null, null],
  ]) assert.equal(r.mapSeenWhere(v), want, String(v));
  for (const [v, want] of [["Sim", true], ["Não", false], ["Mão", false], ["Talvez", null], [true, true], [false, false], [null, null]])
    assert.equal(r.mapYesNo(v), want, String(v));
  for (const [v, want] of [
    [S("2026-07-01"), "pedido"], ["Tenho similar", "tenho_similar"], ["Semelhante", "tenho_similar"], ["Tenho mais", "tenho_similar"], ["Tenho em loja", "tenho_similar"],
    ["Pedido do cliente", "a_pedido"], ["Mediante encomenda", "a_pedido"], ["Solicitado", "a_pedido"], ["X", "pedido"], ["Sim", "pedido"], ["Já pedi", "pedido"],
    ["Pedi uma", "pedido"], ["Não", "nao"], ["Amanhã", null], [null, null],
  ]) assert.equal(r.mapRestock(v), want, String(v));
  for (const [v, want] of [["Para oferecer", "oferta"], ["Oferta", "oferta"], ["Família", "oferta"], ["Investimento", "investimento"], ["Próprio", "proprio"], ["Pessoal", "proprio"], ["Para si", "proprio"], ["Não disse", null]])
    assert.equal(r.mapPurpose(v), want, v);
  for (const [v, want] of [
    ["Troca", "troca"], ["Caro", "caro"], ["Absurdo", "caro"], ["Valores superiores", "caro"], ["Preço abaixo", "caro"], ["Tamanho", "sem_tamanho"], ["Nr", "sem_tamanho"],
    ["Não servia", "sem_tamanho"], ["Não tenho", "sem_stock"], ["Não tinha", "sem_stock"], ["Não havia", "sem_stock"], ["Só existe em ouro", "sem_stock"],
    ["Queria", "sem_stock"], ["Mandei vir", "sem_stock"], ["Personalizado", "sem_stock"], ["Vai pensar", "outro"], [null, null],
  ]) assert.equal(r.mapNoSaleReason(v), want, String(v));

  // Observações: finalidade, notas (sem finalidade ou longas) e o que delas se tira quando falta a resposta.
  const res = parse([
    month("Maio"),
    sale({ date: S("2026-05-04"), obs: "Para oferecer" }),
    sale({ date: S("2026-05-04"), obs: "Para oferecer à afilhada no batizado" }),
    sale({ date: S("2026-05-04"), obs: "Viu na montra", seen: null }),
    sale({ date: S("2026-05-04"), obs: "Viu no site", seen: null }),
    sale({ date: S("2026-05-04"), obs: "Turista", client: null }),
    sale({ date: S("2026-05-04"), restock: "Amanhã", extra: "Extra" }),
  ]);
  assert.deepEqual(res.sales.map((s) => [s.purpose, s.notes, s.seen_where, s.client_type]), [
    ["oferta", null, "loja", "novo"],
    ["oferta", "Para oferecer à afilhada no batizado", "loja", "novo"],
    [null, "Viu na montra", "montra", "novo"],
    [null, "Viu no site", "site", "novo"],
    [null, "Turista", "loja", "passagem"],
    [null, "reposição: Amanhã; Extra", "loja", "novo"],
  ]);
});

test("Todos os códigos possíveis existem em ldo_options", () => {
  // Retrato de ldo_options (todas ativas).
  const DB = {
    campaign: ["saldos", "verao", "fe", "desconto", "stock_off", "outra"],
    material: ["ouro", "prata", "aco", "metal_comum", "relogio", "outro"],
    product_type: ["fio", "brincos", "pulseira", "anel", "medalha", "colar", "argolas", "aliancas", "cruz", "escapulario", "terco", "alfinete", "escrava", "barra", "moeda", "relogio", "conjunto", "outro"],
    client_type: ["novo", "habitual", "passagem"],
    seen_where: ["loja", "montra", "site", "redes_sociais", "telefone", "recomendacao", "outro"],
    purpose: ["oferta", "proprio", "investimento"],
    restock: ["pedido", "tenho_similar", "a_pedido", "nao"],
    no_sale_reason: ["caro", "sem_tamanho", "sem_stock", "troca", "so_ver", "outro"],
  };
  assert.deepEqual(Object.keys(r.OPTION_CODES).sort(), Object.keys(DB).sort());
  for (const [list, codes] of Object.entries(r.OPTION_CODES)) {
    assert.ok(codes.length > 0);
    for (const c of codes) assert.ok(DB[list].includes(c), `${list}.${c}`);
  }
  assert.deepEqual([...r.OPTION_CODES.campaign].sort(), [...DB.campaign].sort());
  assert.deepEqual([...r.OPTION_CODES.product_type].sort(), [...DB.product_type].sort());
});

test("Separadores: loja pelo nome, sem acentos nem maiúsculas, ou pelo código; desconhecidos ficam de fora", () => {
  const tab = (title) => ({ title, rows: [month("Maio"), sale({ date: S("2026-05-04") })] });
  const res = r.parseSalesSheet(
    [tab("Loures"), tab("Benfica"), tab("  leiria  JERICO "), tab("figueira-da-foz"), tab("Resumo"), tab("loures "), tab("Tomar"), { title: null, rows: null }, null],
    { stores: STORES, today: TODAY },
  );
  assert.deepEqual(res.tabs, [
    { title: "Loures", store_code: "loures", sales: 1 },
    { title: "Benfica", store_code: "benfica", sales: 1 },
    { title: "  leiria  JERICO ", store_code: "leiria-jerico", sales: 1 },
    { title: "figueira-da-foz", store_code: "figueira-da-foz", sales: 1 },
    { title: "Resumo", store_code: null, sales: 0 },
    { title: "loures ", store_code: null, sales: 0 },
    { title: "Tomar", store_code: null, sales: 0 },
    { title: "", store_code: null, sales: 0 },
    { title: "", store_code: null, sales: 0 },
  ]);
  assert.deepEqual(res.issues, [
    { tab: "Resumo", row: null, message: "Separador sem loja correspondente: ignorado." },
    { tab: "loures ", row: null, message: 'A loja já foi lida no separador "Loures": ignorado.' },
    { tab: "Tomar", row: null, message: "Separador sem loja correspondente: ignorado." },
    { tab: "", row: null, message: "Separador sem loja correspondente: ignorado." },
    { tab: "", row: null, message: "Separador sem loja correspondente: ignorado." },
  ]);
  assert.deepEqual(res.sales.map((s) => s.store_code), ["loures", "benfica", "leiria-jerico", "figueira-da-foz"]);
  // Loja com outro nome na BD: o código (ou a tabela fixa do script) ainda a encontra.
  const renamed = r.parseSalesSheet([tab("Leiria Jericó"), tab("Fátima")], { stores: [{ code: "leiria-jerico", name: "Loja do Jericó" }, { code: "fatima", name: "Santuário" }], today: TODAY });
  assert.deepEqual(renamed.tabs.map((t) => t.store_code), ["leiria-jerico", "fatima"]);
  // Duas lojas com o mesmo nome: não se adivinha.
  const twice = r.parseSalesSheet([tab("Loures")], { stores: [{ code: "a", name: "Loures" }, { code: "b", name: "LOURES" }], today: TODAY });
  assert.deepEqual([twice.sales.length, twice.issues[0].message], [0, "Separador corresponde a mais do que uma loja: ignorado."]);
});

test("Limites da BD: textos e listas cortados com aviso, sem partir caracteres", () => {
  const refs = Array.from({ length: 35 }, (_, i) => `R${i}`).join("/");
  const res = parse([
    month("Maio"),
    sale({ date: S("2026-05-04"), n: "N".repeat(50), ref: "X".repeat(50), looking: "a".repeat(299) + "😀😀", obs: "b".repeat(1200) }),
    sale({ date: S("2026-05-04"), ref: refs }),
    sale({ date: S("2026-05-04"), obs: "um\u0000dois" }),
  ]);
  const [a, b, c] = res.sales;
  assert.equal(a.sale_number, "N".repeat(40));
  assert.equal(a.items[0].reference, "X".repeat(40));
  assert.equal(a.looking_for, "a".repeat(299) + "😀");
  assert.equal(chars(a.notes), 1000);
  assert.equal(b.items.length, 30);
  assert.equal(b.items[29].reference, "R29");
  assert.equal(c.notes, "umdois");
  assert.deepEqual(res.issues.map((i) => [i.row, i.message]), [
    [2, '"O que procurava?" com mais de 300 caracteres: cortado.'],
    [2, "Nº de venda com mais de 40 caracteres: cortado."],
    [2, "Referência com mais de 40 caracteres: cortada."],
    [2, "Notas com mais de 1000 caracteres: cortadas."],
    [3, "Mais de 30 artigos: só ficam os primeiros 30."],
  ]);
});

test("Linhas modelo (só respostas pré-preenchidas, sem data) não são registos", () => {
  const res = parse([
    month("Outubro"), HEADER,
    sale({ date: S("2026-10-02") }),
    row({ camp: "NAO", client: "NOVO", seen: "LOJA", online: "NAO" }),
    row({ camp: "NAO", online: "NAO" }),
    row({ camp: "NAO" }),
    row({ value: "-----", reason: "------", looking: " — " }),
    row({ date: S("2026-10-03"), camp: "NAO", client: "NOVO", seen: "LOJA", online: "NAO" }),
  ]);
  assert.deepEqual(res.sales.map((s) => [s.sale_date, s.row]), [["2026-10-02", 3], ["2026-10-03", 8]]);
  assert.deepEqual(res.issues, []);
});

test("Dias: chave, agrupamento e impressão digital que não depende da ordem nem do nº da linha", () => {
  const { sales } = parse([month("Maio"), sale({ date: S("2026-05-04"), value: 10 }), sale({ date: S("2026-05-05"), value: 30 }), sale({ date: S("2026-05-04"), value: 20, ref: "50001/50002" })]);
  assert.equal(r.dayKey({ store_code: "loures", sale_date: "2026-05-04" }), "loures|2026-05-04");
  const days = r.groupByDay(sales);
  assert.deepEqual([...days.keys()], ["loures|2026-05-04", "loures|2026-05-05"]);
  assert.deepEqual(days.get("loures|2026-05-04").map((s) => s.total_value), [10, 20]);
  const h = r.dayHash(days.get("loures|2026-05-04"));
  assert.match(h, /^[0-9a-f]{64}$/);

  // As mesmas vendas noutra ordem e noutras linhas: o mesmo dia.
  const moved = parse([month("Maio"), HEADER, [], sale({ date: S("2026-05-04"), value: 20, ref: "50001/50002" }), sale({ date: S("2026-05-04"), value: 10 })]);
  assert.equal(r.dayHash(moved.sales), h);
  assert.equal(r.dayHash([...moved.sales].reverse()), h);
  // Qualquer mudança de conteúdo muda a impressão digital.
  const changed = parse([month("Maio"), sale({ date: S("2026-05-04"), value: 10 }), sale({ date: S("2026-05-04"), value: 20, ref: "50001/50003" })]);
  assert.notEqual(r.dayHash(changed.sales), h);
  const dup = days.get("loures|2026-05-04");
  assert.notEqual(r.dayHash([...dup, dup[0]]), h);
  assert.notEqual(r.dayHash([{ ...dup[0], notes: "x" }, dup[1]]), h);
  assert.notEqual(r.dayHash([{ ...dup[0], items: [] }, dup[1]]), h);
  assert.equal(r.dayHash([{ ...dup[0], row: 999 }, dup[1]]), h);
  assert.equal(r.dayHash([]), r.dayHash([]));
});

test("Nada faz parar a leitura; só uma data de hoje inválida é erro", () => {
  const weird = [
    null, undefined, "x", 5, [undefined, {}, [], NaN, Infinity, -Infinity], [NaN], [Infinity, "x"], [-5], [1e12], [true, false, true],
    [{}], ["Maio"], [S("2026-05-04"), { a: 1 }, [1], NaN, true, false, "Ouro", 7, null, true, -1e308, 1e308, true, Infinity],
    ["Fevereiro"], ["30/02", 1, 2], ["31/04"], ["99/99", 1], [S("2026-02-29")], ["Data"], [S("2026-05-04") + 1e9, 1], [-S("2026-05-04"), 1],
  ];
  const res = parse(weird);
  assert.ok(Array.isArray(res.sales) && Array.isArray(res.issues));
  for (const tabs of [null, undefined, "x", [null], [{}], [{ title: "Loures", rows: "abc" }], [{ title: "Loures", rows: [null, "x"] }]])
    assert.doesNotThrow(() => r.parseSalesSheet(tabs, { stores: STORES, today: TODAY }));
  assert.doesNotThrow(() => r.parseSalesSheet([{ title: "Loures", rows: [] }], { stores: null, today: TODAY }));
  for (const today of ["2026-13-01", "2026-02-30", "hoje", undefined, 20261009]) assert.throws(() => r.parseSalesSheet([], { stores: STORES, today }), TypeError);
});
