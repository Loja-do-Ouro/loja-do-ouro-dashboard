// Site público do leilão (leilao.lojadoouro.pt, e /l no endereço do dashboard enquanto o domínio não está ligado):
// endereços, contagem decrescente, mensagens da licitação e textos dos emails. Sem I/O (testado em tests/leilao-site.cjs).

import { eur, lisbonDateTime } from "./leilao-rules";

// ---------------------------------------------------------------- endereços

// No domínio próprio as páginas vivem na raiz; no dashboard, debaixo de /l.
export const isAuctionHost = (host: string | null | undefined) => /^leilao\./i.test((host || "").trim());
export const siteBaseFor = (host: string | null | undefined) => (isAuctionHost(host) ? "" : "/l");

// Pedido no domínio do leilão → caminho interno (/l/…) ou endereço a corrigir. null = seguir sem mexer.
export function auctionHostRoute(path: string): { rewrite: string } | { redirect: string } | null {
  if (path.startsWith("/api/l/") || path.startsWith("/_next/")) return null;
  // Endereços antigos com /l: o mesmo sem o prefixo.
  if (path === "/l" || path.startsWith("/l/")) return { redirect: path.slice(2) || "/" };
  return { rewrite: path === "/" ? "/l" : `/l${path}` };
}

// Volta depois de entrar: só caminhos do próprio site, nunca outro domínio.
export function safeNext(value: unknown, base: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.length > 300) return `${base}/conta`;
  return v;
}

// ---------------------------------------------------------------- tempo

export type Countdown = { done: boolean; days: number; hours: number; minutes: number; seconds: number };

export function countdown(closeAt: string | null | undefined, nowMs: number): Countdown {
  const left = closeAt ? new Date(closeAt).getTime() - nowMs : 0;
  if (!(left > 0)) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const s = Math.floor(left / 1000);
  return { done: false, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

const pad = (n: number) => String(n).padStart(2, "0");

// "2 d 04:10:05", "04:10:05" ou "10:05".
export function countdownText(c: Countdown): string {
  if (c.done) return "Terminado";
  const clock = c.hours || c.days ? `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}` : `${pad(c.minutes)}:${pad(c.seconds)}`;
  return c.days ? `${c.days} d ${clock}` : clock;
}

// ---------------------------------------------------------------- licitação

export type BidResult = {
  status: "leading" | "outbid"; price: number; max: number; close_at: string; extended: boolean; reserve_met: boolean; min_next: number;
};

// O que o cliente lê logo a seguir a licitar.
export function bidResultText(r: BidResult): { tone: "ok" | "warn"; title: string; text: string } {
  const ext = r.extended ? " Licitou no fim: o lote foi prolongado e todos os licitantes foram avisados." : "";
  const reserve = r.reserve_met ? "" : " O preço de reserva ainda não foi atingido.";
  if (r.status === "leading") {
    return {
      tone: "ok",
      title: "Lidera este lote",
      text: `O preço atual é ${eur(r.price)}. O seu máximo de ${eur(r.max)} fica secreto: só subimos por si o necessário para continuar à frente.${reserve}${ext}`,
    };
  }
  return {
    tone: "warn",
    title: "Foi ultrapassado de imediato",
    text: `Outro licitante tinha um máximo igual ou superior. O preço passou a ${eur(r.price)}; a próxima licitação é de pelo menos ${eur(r.min_next)}.${ext}`,
  };
}

// Valor escrito pelo cliente ("1.250", "1250,50", "1 250 €") → número; inválido → null.
export function parseBid(value: unknown): number | null {
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  let t = raw.replace(/[\s €]/g, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(t)) t = t.replace(",", ".");
  else if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) / 100 : null;
}

// Valores de licitação rápida: o mínimo e os dois incrementos seguintes.
export function quickBids(minNext: number, steps: [number, number][]): number[] {
  const step = (p: number) => {
    let inc = steps[0]?.[1] ?? 1;
    for (const [from, v] of steps) if (p >= from) inc = v;
    return inc;
  };
  const a = minNext;
  const b = a + step(a);
  return [a, b, b + step(b)];
}

// ---------------------------------------------------------------- emails

export type OutboxItem = {
  id: number;
  kind: "outbid" | "extended" | "ending_soon" | "won" | "lost" | "reserve_not_met" | "withdrawn" | "deposit_held" | "paid" | "deposit_captured";
  payload: { price?: number | null; close_at?: string | null; payment_due_at?: string | null; amount?: number | null; expires_at?: string | null; method?: string | null };
  lease: string; email: string; name: string; alias: string; deleted: boolean;
  lot: { title: string; position: number; image: string | null; event_slug: string; event_title: string; current_price: number | null; close_at: string | null } | null;
};

export type EmailText = { subject: string; eyebrow: string; title: string; paragraphs: string[]; button: { label: string; url: string } | null };

export const lotUrl = (siteUrl: string, slug: string, position: number) => `${siteUrl}/${slug}/${position}`;

// Texto de cada aviso da fila (o HTML é montado com brandEmail, que escapa tudo).
export function outboxEmail(item: OutboxItem, siteUrl: string): EmailText | null {
  const l = item.lot;
  if (!l) return null;
  const url = lotUrl(siteUrl, l.event_slug, l.position);
  const price = eur(item.payload.price ?? l.current_price);
  const close = lisbonDateTime(item.payload.close_at ?? l.close_at);
  const hi = `Olá ${item.name || "cliente"},`;
  const lot = `«${l.title}» (lote ${l.position})`;
  switch (item.kind) {
    case "outbid":
      return {
        subject: `Foi ultrapassado: ${l.title}`, eyebrow: "LEILÃO · LICITAÇÃO", title: "Já não lidera este lote",
        paragraphs: [hi, `Outro licitante passou à frente em ${lot}. O preço atual é ${price} e o lote fecha a ${close} (hora de Lisboa).`,
          "Se ainda o quiser, pode licitar de novo ou subir o seu máximo."],
        button: { label: "Licitar de novo", url },
      };
    case "extended":
      return {
        subject: `Prolongado: ${l.title}`, eyebrow: "LEILÃO · PROLONGAMENTO", title: "O lote foi prolongado",
        paragraphs: [hi, `Houve uma licitação nos últimos minutos de ${lot}. Para todos terem tempo de responder, o fecho passou para ${close} (hora de Lisboa).`,
          `Preço atual: ${price}.`],
        button: { label: "Ver o lote", url },
      };
    case "ending_soon":
      return {
        subject: `A terminar: ${l.title}`, eyebrow: "LEILÃO · ÚLTIMA HORA", title: "Este lote está a terminar",
        paragraphs: [hi, `${lot} fecha a ${close} (hora de Lisboa). Preço atual: ${price}.`,
          "Uma licitação nos últimos minutos prolonga o lote, para ninguém perder a oportunidade de responder."],
        button: { label: "Ver o lote", url },
      };
    case "won":
      return {
        subject: `Ganhou: ${l.title}`, eyebrow: "LEILÃO · PARABÉNS", title: "Ganhou este lote",
        paragraphs: [hi, `${lot} é seu por ${price}. Sem comissão do comprador: este é o valor a pagar (IVA incluído, quando aplicável).`,
          `Pague até ${lisbonDateTime(item.payload.payment_due_at)} (hora de Lisboa) na página do lote: Multibanco, MB WAY ou cartão. Depois combinamos consigo a entrega ou o levantamento numa das nossas lojas.`,
          "Se cativou uma caução neste lote, é libertada assim que o pagamento for confirmado.",
          "Tem 14 dias para desistir da compra a partir da entrega, sem indicar motivo (direito de livre resolução)."],
        button: { label: "Pagar o lote", url },
      };
    case "lost":
      return {
        subject: `Lote terminado: ${l.title}`, eyebrow: "LEILÃO · RESULTADO", title: "Desta vez não foi possível",
        paragraphs: [hi, `${lot} terminou por ${price} e foi para outro licitante.`,
          "Obrigado por ter participado. Se ficou com caução, ela é libertada automaticamente."],
        button: { label: "Ver outros lotes", url: siteUrl },
      };
    case "reserve_not_met":
      return {
        subject: `Reserva não atingida: ${l.title}`, eyebrow: "LEILÃO · RESULTADO", title: "O preço de reserva não foi atingido",
        paragraphs: [hi, `A sua licitação de ${price} em ${lot} foi a mais alta, mas ficou abaixo do preço de reserva, por isso o lote não foi vendido.`,
          "Podemos contactá-lo se for possível chegar a acordo. Se ficou com caução, ela é libertada automaticamente."],
        button: null,
      };
    case "deposit_held":
      return {
        subject: `Caução cativa: ${l.title}`, eyebrow: "LEILÃO · CAUÇÃO", title: "Já pode licitar neste lote",
        paragraphs: [hi, `Cativámos ${eur(item.payload.amount)} como caução para ${lot}. O valor fica apenas reservado: não foi cobrado.`,
          "Se não ganhar, a reserva é anulada logo depois do fecho. Se ganhar, é anulada quando o pagamento do lote for confirmado.",
          `A cativação dura até ${lisbonDateTime(item.payload.expires_at)}; se o lote fechar depois disso, pedimos para a renovar.`],
        button: { label: "Licitar agora", url },
      };
    case "paid":
      return {
        subject: `Pagamento recebido: ${l.title}`, eyebrow: "LEILÃO · PAGAMENTO", title: "Pagamento confirmado",
        paragraphs: [hi, `Recebemos o pagamento de ${eur(item.payload.amount ?? l.current_price)} de ${lot}. Obrigado!`,
          "Vamos contactá-lo para combinar a entrega com seguro ou o levantamento numa das nossas lojas. A fatura segue por email.",
          "Tem 14 dias, a contar da entrega, para desistir da compra sem indicar motivo."],
        button: { label: "Ver o lote", url },
      };
    case "deposit_captured":
      return {
        subject: `Caução retida: ${l.title}`, eyebrow: "LEILÃO · CAUÇÃO", title: "A caução foi retida",
        paragraphs: [hi, `O prazo de pagamento de ${lot} terminou sem pagamento, por isso a caução de ${eur(item.payload.amount)} foi cobrada, como previsto no regulamento (ponto 8).`,
          "Se houve um problema com o pagamento, responda a este email e analisamos consigo."],
        button: null,
      };
    case "withdrawn":
      return {
        subject: `Lote retirado: ${l.title}`, eyebrow: "LEILÃO · AVISO", title: "Este lote foi retirado",
        paragraphs: [hi, `${lot} foi retirado do leilão e as licitações deixaram de contar. Lamentamos o incómodo.`,
          "Se ficou com caução, ela é libertada automaticamente."],
        button: { label: "Ver outros lotes", url: siteUrl },
      };
  }
}
