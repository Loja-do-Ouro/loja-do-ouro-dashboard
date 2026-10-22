// easypay (API 2.0, https://docs.easypay.pt): pedidos de caução (autorização) e de pagamento (venda), e leitura das
// respostas. Sem I/O (testado em tests/easypay.cjs). Cartão e MB WAY permitem cativar (autorizar) e capturar ou
// anular depois; Multibanco só serve para pagar.

export type EasypayEnv = "test" | "prod";
export const easypayBase = (env: EasypayEnv) => (env === "prod" ? "https://api.prod.easypay.pt/2.0" : "https://api.test.easypay.pt/2.0");

export type DepositMethod = "cc" | "mbw";
export type PayMethod = "mb" | "mbw" | "cc";

export const METHOD_LABEL: Record<PayMethod | "manual", string> = {
  mb: "Multibanco", mbw: "MB WAY", cc: "Cartão", manual: "Transferência / loja",
};

// "+351912345678" → indicativo e número, como a easypay os pede. Fora de Portugal vai o número completo.
export function splitPhone(phone: string | null | undefined): { phone_indicative?: string; phone?: string } {
  const p = (phone || "").replace(/[\s().-]/g, "");
  const pt = /^\+351(9\d{8})$/.exec(p);
  if (pt) return { phone_indicative: "+351", phone: pt[1] };
  if (/^\+[1-9]\d{6,14}$/.test(p)) return { phone: p };
  return {};
}

type Customer = { name: string; email: string; phone?: string | null };

function customerBody(c: Customer, phone?: string | null) {
  return {
    name: c.name.slice(0, 120), email: c.email, ...splitPhone(phone ?? c.phone), language: "PT",
  };
}

const money = (n: number) => Math.round(n * 100) / 100;
// Texto do extrato (letras, números e pontuação simples).
export const descriptive = (text: string) => text.replace(/[^\p{L}\p{N} .,:-]/gu, "").slice(0, 120);

// Caução: autorização (cativa o valor, não cobra). key = id da caução na BD (devolvido nas notificações). O texto do
// extrato vai na captura, se houver.
export function authorisationBody(d: { id: string; amount: number; method: DepositMethod; customer: Customer; phone?: string | null }) {
  return {
    type: "authorisation", key: d.id, method: d.method, currency: "EUR", value: money(d.amount),
    customer: customerBody(d.customer, d.phone),
  };
}

// Pagamento do lote: venda. Multibanco com validade até ao fim do prazo de pagamento.
export function saleBody(p: { id: string; amount: number; method: PayMethod; customer: Customer; phone?: string | null; lot: string; dueAt?: string | null }) {
  return {
    type: "sale", key: p.id, method: p.method === "mb" ? "MB" : p.method, currency: "EUR", value: money(p.amount),
    customer: customerBody(p.customer, p.phone),
    capture: { descriptive: descriptive(`Leilão ${p.lot}`), transaction_key: p.id.slice(0, 50) },
    ...(p.method === "mb" && p.dueAt ? { multibanco: { expiration_time: new Date(p.dueAt).toISOString().replace(/\.\d{3}Z$/, "Z") } } : {}),
  };
}

export type Created = { ref: string; url: string | null; entity: string | null; reference: string | null; expires_at: string | null };

// Resposta ao POST /single: id do pagamento, página do cartão, entidade/referência Multibanco.
export function readCreated(json: unknown): Created | null {
  const j = (json || {}) as { status?: string; id?: string; method?: { url?: string; entity?: string; reference?: string }; multibanco?: { expiration_time?: string | null } };
  if (j.status !== "ok" || typeof j.id !== "string" || !j.id) return null;
  const m = j.method || {};
  return {
    ref: j.id,
    url: typeof m.url === "string" && m.url.startsWith("https://") ? m.url : null,
    entity: typeof m.entity === "string" && /^\d{5}$/.test(m.entity) ? m.entity : null,
    reference: typeof m.reference === "string" && /^\d{9}$/.test(m.reference) ? m.reference : null,
    expires_at: typeof j.multibanco?.expiration_time === "string" ? j.multibanco.expiration_time : null,
  };
}

// Erro da easypay em texto (a mensagem vem num array "message").
export function readError(json: unknown, status: number): string {
  const j = (json || {}) as { message?: unknown; error?: unknown };
  const msg = Array.isArray(j.message) ? j.message.filter((m) => typeof m === "string").join(" ") : typeof j.message === "string" ? j.message : "";
  return (msg || `easypay recusou o pedido (${status}).`).slice(0, 300);
}

// Estado lido em GET /single/{id}: pending | authorised | paid | failed (error/deleted contam como failed).
export function readStatus(json: unknown): "pending" | "authorised" | "paid" | "failed" | null {
  const s = ((json || {}) as { payment_status?: string }).payment_status;
  if (s === "authorised" || s === "paid" || s === "pending") return s;
  if (s === "failed" || s === "error" || s === "deleted") return "failed";
  return null;
}

// Notificação da easypay: só o id interessa (o estado é sempre lido na API).
export function notificationId(json: unknown): string | null {
  const id = ((json || {}) as { id?: unknown }).id;
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

// ---------------------------------------------------------------- Checkout (formulário embutido, para o cartão)

export const CHECKOUT_SDK = "https://cdn.easypay.pt/checkout/2.9.1/";

// Sessão do formulário embutido: só cartão; caução = authorisation, lote = sale. key = id do nosso registo (volta no
// GET /single e liga o pagamento à caução ou ao pagamento certo).
export function checkoutBody(c: { id: string; amount: number; type: "authorisation" | "sale"; customer: Customer; description: string }) {
  const value = money(c.amount);
  return {
    type: ["single"],
    payment: {
      methods: ["CC"], type: c.type, currency: "EUR", key: c.id,
      ...(c.type === "sale" ? { capture: { descriptive: descriptive(c.description), transaction_key: c.id.slice(0, 50) } } : {}),
    },
    order: { key: c.id, value, items: [{ description: descriptive(c.description), quantity: 1, key: c.id, value }] },
    customer: customerBody(c.customer),
  };
}

export type CheckoutManifest = { id: string; session: string; config: unknown };

export function readManifest(json: unknown): CheckoutManifest | null {
  const j = (json || {}) as { id?: unknown; session?: unknown; config?: unknown };
  if (typeof j.id !== "string" || !j.id || typeof j.session !== "string" || !j.session) return null;
  return { id: j.id, session: j.session, config: j.config ?? null };
}

// GET /checkout/{id}: id do pagamento criado quando o cliente concluiu (ou null).
export function checkoutPaymentId(json: unknown): string | null {
  const p = ((json || {}) as { payment?: { id?: unknown } }).payment;
  return typeof p?.id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(p.id) ? p.id : null;
}

// key do pagamento (o id do nosso registo, quando fomos nós a criá-lo).
export function readKey(json: unknown): string | null {
  const k = ((json || {}) as { key?: unknown }).key;
  return typeof k === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k) ? k : null;
}
