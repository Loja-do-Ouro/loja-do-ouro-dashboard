// Vendas pagas por dia da encomenda, a partir das linhas do relatório de vendas da Shopify (ShopifyQL), sem
// dependências do servidor (testado em tests/paid-sales.cjs). As consultas estão em lib/bi/shopify.ts
// (paidSalesByDay).
//
// Definição do dashboard: encomendas não canceladas com o pagamento confirmado (pagas ou reembolsadas em parte), no
// dia português em que foram feitas. Valor sem IVA nem portes (net_sales) e, à parte, com IVA e portes (total_sales).
// Tudo o que muda a encomenda depois — acrescentos e remoções por edição, trocas, reembolsos parciais — conta no dia
// da encomenda; uma encomenda reembolsada na totalidade ou cancelada não entra (já vem excluída pelas consultas). Uma
// encomenda que fica a 0 € sem IVA (oferta, teste, reembolso por valor) não conta como encomenda paga. As encomendas
// por pagar ficam à parte e nunca contam como venda.
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

// Metade de um período (para repartir uma consulta que chegou ao limite de linhas); null se for um só dia.
export function halves(p: Period): [Period, Period] | null {
  if (p.from >= p.to) return null;
  const days = Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000) + 1;
  const mid = shift(p.from, Math.floor(days / 2) - 1);
  return [{ from: p.from, to: mid }, { from: shift(mid, 1), to: p.to }];
}

// Uma reversão só "por valor" (sem artigos) vem da Shopify com net_sales = total_sales e sem IVA: o valor sem IVA
// passa a ser o mesmo montante na proporção sem IVA da própria encomenda.
function reversalNet(r: Row, order: { net: number; taxes: number }) {
  const net = number(r.net_sales) || 0, total = number(r.total_sales) || 0;
  const byAmount = (number(r.taxes) || 0) === 0 && (number(r.shipping_charges) || 0) === 0 && net !== 0 && Math.abs(net - total) < 0.005;
  if (!byAmount || order.taxes <= 0 || order.net + order.taxes <= 0) return net;
  return total * (order.net / (order.net + order.taxes));
}

// lines: linhas "order" de encomendas pagas, agrupadas por order_name e day (orders, net_sales, total_sales, taxes,
// shipping_charges); o dia da encomenda é o da linha que a conta (orders > 0). reversals: linhas "reversal" das mesmas
// encomendas (pagas ou reembolsadas em parte), agrupadas por order_name. pending: encomendas por pagar, por dia
// (TIMESERIES). Devolve uma linha por dia do período.
export function paidDays(p: Period, lines: Row[], reversals: Row[], pending: Row[]): Row[] {
  type Order = { day: string; orders: number; net: number; total: number; taxes: number; revNet: number; revTotal: number };
  const orders = new Map<string, Order>();
  for (const r of lines) {
    const name = String(r.order_name || ""), day = String(r.day || "");
    if (!name || !day || (number(r.orders) || 0) <= 0) continue;
    const o = orders.get(name);
    if (!o || day < o.day) orders.set(name, { ...(o || { orders: 0, net: 0, total: 0, taxes: 0, revNet: 0, revTotal: 0 }), day });
  }
  for (const r of lines) {
    const o = orders.get(String(r.order_name || ""));
    // Acrescento a uma encomenda feita antes do período: pertence a um dia fora deste cálculo.
    if (!o) continue;
    o.orders += number(r.orders) || 0;
    o.net += number(r.net_sales) || 0;
    o.total += number(r.total_sales) || 0;
    o.taxes += number(r.taxes) || 0;
  }
  for (const r of reversals) {
    const o = orders.get(String(r.order_name || ""));
    if (!o) continue;
    o.revNet += reversalNet(r, o);
    o.revTotal += number(r.total_sales) || 0;
  }
  type Day = { orders: number; net: number; total: number; revNet: number; revTotal: number };
  const days = new Map<string, Day>();
  for (const o of orders.values()) {
    const d = days.get(o.day) || { orders: 0, net: 0, total: 0, revNet: 0, revTotal: 0 };
    d.net += o.net + o.revNet;
    d.total += o.total + o.revTotal;
    d.revNet += o.revNet;
    d.revTotal += o.revTotal;
    // Só conta como encomenda paga a que ainda vale alguma coisa sem IVA.
    if (o.orders > 0 && o.net + o.revNet > 0.005) d.orders += 1;
    days.set(o.day, d);
  }
  const unpaid = new Map(pending.map((r) => [String(r.day || ""), r]));
  const out: Row[] = [];
  for (let day = p.from; day <= p.to; day = shift(day, 1)) {
    const d = days.get(day) || { orders: 0, net: 0, total: 0, revNet: 0, revTotal: 0 };
    const u = unpaid.get(day);
    out.push({
      day, orders: d.orders, net_sales: cents(d.net), total_sales: cents(d.total),
      adjustments_net: cents(d.revNet), adjustments_total: cents(d.revTotal),
      pending_orders: number(u?.orders) || 0, pending_net: cents(number(u?.net_sales) || 0), pending_total: cents(number(u?.total_sales) || 0),
    });
  }
  return out;
}
