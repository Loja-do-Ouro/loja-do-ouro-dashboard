// Vendas pagas por dia da encomenda, a partir das linhas do relatório de vendas da Shopify (ShopifyQL), sem
// dependências do servidor (testado em tests/paid-sales.cjs). As consultas estão em lib/bi/shopify.ts
// (paidSalesByDay).
//
// Definição do dashboard: encomendas não canceladas com o pagamento confirmado (pagas ou reembolsadas em parte), no
// dia português em que foram feitas. Valor sem IVA nem portes (net_sales) e, à parte, com IVA e portes (total_sales).
// Um acrescento por edição noutro dia e um reembolso parcial feito depois contam no dia da encomenda; uma encomenda
// reembolsada na totalidade ou cancelada não entra (já vem excluída pelas consultas). As encomendas por pagar ficam à
// parte e nunca contam como venda.
import { number, type Row } from "./model";
import { shift, type Period } from "./periods";

const cents = (n: number) => Math.round(n * 100) / 100;

// Meses de calendário do período (as consultas por encomenda vão mês a mês, abaixo do limite de linhas).
export function monthChunks(p: Period): Period[] {
  const out: Period[] = [];
  let from = p.from;
  while (from <= p.to) {
    const [y, m] = from.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ from, to: end < p.to ? end : p.to });
    from = shift(end, 1);
  }
  return out;
}

// lines: linhas "order" de encomendas pagas, agrupadas por order_name e day (orders, net_sales, total_sales); o dia
// da encomenda é o da linha que a conta (orders > 0). refunds: reversões de encomendas reembolsadas em parte,
// agrupadas por order_name (net_sales, total_sales negativos). pending: encomendas por pagar, por dia (TIMESERIES).
// Devolve uma linha por dia do período.
export function paidDays(p: Period, lines: Row[], refunds: Row[], pending: Row[]): Row[] {
  const created = new Map<string, string>();
  for (const r of lines) {
    const name = String(r.order_name || ""), day = String(r.day || "");
    if (name && day && (number(r.orders) || 0) > 0 && (!created.has(name) || day < created.get(name)!)) created.set(name, day);
  }
  type Bucket = { orders: number; net: number; total: number; refundsNet: number; refundsTotal: number };
  const days = new Map<string, Bucket>();
  const bucket = (day: string) => {
    if (!days.has(day)) days.set(day, { orders: 0, net: 0, total: 0, refundsNet: 0, refundsTotal: 0 });
    return days.get(day)!;
  };
  for (const r of lines) {
    const day = created.get(String(r.order_name || ""));
    // Acrescento a uma encomenda feita antes do período: pertence a um dia fora deste cálculo.
    if (!day) continue;
    const b = bucket(day);
    b.orders += number(r.orders) || 0;
    b.net += number(r.net_sales) || 0;
    b.total += number(r.total_sales) || 0;
  }
  for (const r of refunds) {
    const day = created.get(String(r.order_name || ""));
    if (!day) continue;
    const b = bucket(day);
    b.refundsNet += number(r.net_sales) || 0;
    b.refundsTotal += number(r.total_sales) || 0;
  }
  const unpaid = new Map(pending.map((r) => [String(r.day || ""), r]));
  const out: Row[] = [];
  for (let day = p.from; day <= p.to; day = shift(day, 1)) {
    const b = days.get(day) || { orders: 0, net: 0, total: 0, refundsNet: 0, refundsTotal: 0 };
    const u = unpaid.get(day);
    out.push({
      day, orders: b.orders, net_sales: cents(b.net + b.refundsNet), total_sales: cents(b.total + b.refundsTotal),
      refunds_net: cents(b.refundsNet), refunds_total: cents(b.refundsTotal),
      pending_orders: number(u?.orders) || 0, pending_net: cents(number(u?.net_sales) || 0), pending_total: cents(number(u?.total_sales) || 0),
    });
  }
  return out;
}
