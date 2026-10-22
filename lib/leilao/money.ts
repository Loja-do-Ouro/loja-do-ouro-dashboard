import "server-only";
import { easypay, easypayConfigured, easypayEnv } from "@/lib/easypay";
import {
  authorisationBody, checkoutBody, checkoutPaymentId, descriptive, readCreated, readKey, readManifest, readStatus, saleBody,
  type CheckoutManifest, type DepositMethod, type PayMethod,
} from "@/lib/easypay-rules";
import { serverConfigured, serverRpc } from "@/lib/support/db";

// Cauções e pagamentos do leilão. A BD decide quem pode cativar/pagar, quanto e o que falta fazer; aqui só se fala
// com a easypay. MB WAY e Multibanco: pedido direto (o cliente aprova no telemóvel ou paga a referência). Cartão:
// formulário embutido da easypay (Checkout) na nossa página. O estado de um pagamento é sempre lido na API da
// easypay (nunca no corpo de uma notificação nem no browser).

export type LotMoney = {
  deposit: { id: string; status: "pending" | "held" | "captured" | "released" | "failed"; amount: number; method: DepositMethod | null; checkout_url: string | null; expires_at: string | null; detail: string | null } | null;
  payment: { id: string; status: "pending" | "paid" | "failed" | "cancelled"; amount: number; method: PayMethod | "manual"; entity: string | null; reference: string | null; checkout_url: string | null; expires_at: string | null; paid_at: string | null; detail: string | null } | null;
};

type Started = {
  status: "new" | "held" | "existing"; id?: string; amount?: number; method?: string; phone?: string | null; name?: string; email?: string;
  lot_title?: string; lot_position?: number; event_slug?: string; due_at?: string | null;
};

// Formulário do cartão para o browser: a sessão (não tem dados do cartão) e se é a sandbox.
export type CardCheckout = { kind: "deposit" | "payment"; id: string; manifest: CheckoutManifest; testing: boolean };

async function openCheckout(kind: "deposit" | "payment", s: Started, type: "authorisation" | "sale", description: string): Promise<CardCheckout> {
  const r = await easypay("POST", "/checkout", checkoutBody({
    id: s.id!, amount: Number(s.amount), type, customer: { name: s.name!, email: s.email! }, description,
  }));
  const manifest = r.ok ? readManifest(r.json) : null;
  if (!manifest) {
    await serverRpc("ldo_auc_provider_created", { p_kind: kind, p_id: s.id, p_ref: null, p_data: { error: r.ok ? "Resposta inesperada da easypay." : r.error } });
    throw new Error(`Não foi possível abrir o pagamento com cartão: ${r.ok ? "resposta inesperada" : r.error}`);
  }
  await serverRpc("ldo_auc_checkout_created", { p_kind: kind, p_id: s.id, p_checkout: manifest.id });
  return { kind, id: s.id!, manifest, testing: easypayEnv() !== "prod" };
}

export async function startDeposit(session: string, lot: string, method: DepositMethod, phone: string): Promise<Started & { card?: CardCheckout }> {
  if (!easypayConfigured()) throw new Error("Os pagamentos ainda não estão ativos. Tente mais tarde.");
  const s = await serverRpc<Started>("ldo_auc_deposit_start", { p_session: session, p_lot: lot, p_method: method, p_phone: phone || null });
  if (s.status !== "new" || !s.id) return s;
  if (method === "cc") return { ...s, card: await openCheckout("deposit", s, "authorisation", `Caução leilão lote ${s.lot_position}`) };
  const r = await easypay("POST", "/single", authorisationBody({
    id: s.id, amount: Number(s.amount), method, customer: { name: s.name!, email: s.email! }, phone: s.phone,
  }));
  const created = r.ok ? readCreated(r.json) : null;
  await serverRpc("ldo_auc_provider_created", {
    p_kind: "deposit", p_id: s.id, p_ref: created?.ref ?? null,
    p_data: created ? { url: created.url } : { error: r.ok ? "Resposta inesperada da easypay." : r.error },
  });
  if (!created) throw new Error(`Não foi possível pedir a caução: ${r.ok ? "resposta inesperada" : r.error}`);
  return s;
}

export async function startPayment(session: string, lot: string, method: PayMethod, phone: string): Promise<Started & { card?: CardCheckout }> {
  if (!easypayConfigured()) throw new Error("Os pagamentos online ainda não estão ativos. Contacte-nos para pagar por transferência.");
  const s = await serverRpc<Started>("ldo_auc_pay_start", { p_session: session, p_lot: lot, p_method: method, p_phone: phone || null });
  if (s.status !== "new" || !s.id) return s;
  if (method === "cc") return { ...s, card: await openCheckout("payment", s, "sale", `Leilão ${s.event_slug} lote ${s.lot_position}`) };
  const r = await easypay("POST", "/single", saleBody({
    id: s.id, amount: Number(s.amount), method, customer: { name: s.name!, email: s.email! }, phone: s.phone,
    lot: `${s.event_slug} lote ${s.lot_position}`, dueAt: s.due_at,
  }));
  const created = r.ok ? readCreated(r.json) : null;
  await serverRpc("ldo_auc_provider_created", {
    p_kind: "payment", p_id: s.id, p_ref: created?.ref ?? null,
    p_data: created ? { url: created.url, entity: created.entity, reference: created.reference, expires_at: created.expires_at } : { error: r.ok ? "Resposta inesperada da easypay." : r.error },
  });
  if (!created) throw new Error(`Não foi possível criar o pagamento: ${r.ok ? "resposta inesperada" : r.error}`);
  return s;
}

// Lê um pagamento na easypay e grava o estado na BD. Pagamentos do formulário do cartão ligam-se ao nosso registo
// pela key (o id da caução ou do pagamento).
export async function syncRef(ref: string) {
  const r = await easypay("GET", `/single/${encodeURIComponent(ref)}`);
  if (!r.ok) return null;
  const status = readStatus(r.json);
  if (!status || status === "pending") return status;
  const key = readKey(r.json);
  if (key) await serverRpc("ldo_auc_provider_sync_key", { p_key: key, p_ref: ref, p_status: status });
  else await serverRpc("ldo_auc_provider_sync", { p_ref: ref, p_status: status });
  return status;
}

// Sessão do formulário do cartão: o pagamento criado quando o cliente concluiu (lido na easypay).
async function syncCheckout(checkoutId: string) {
  const r = await easypay("GET", `/checkout/${encodeURIComponent(checkoutId)}`);
  const ref = r.ok ? checkoutPaymentId(r.json) : null;
  return ref ? syncRef(ref) : null;
}

// O formulário diz que o cartão foi aceite: confirma na easypay (o browser só indica o id; quem decide é a API).
export async function confirmCard(ref: string) {
  return syncRef(ref);
}

// Estado da caução e do pagamento do cliente num lote; pedidos pendentes são confirmados na easypay na hora.
export async function lotMoney(session: string, lot: string, refresh = false): Promise<LotMoney | null> {
  if (refresh && easypayConfigured()) {
    const refs = await serverRpc<string[]>("ldo_auc_pending_refs", { p_session: session, p_lot: lot }).catch(() => []);
    await Promise.all((refs || []).slice(0, 3).map((ref) => syncRef(ref).catch(() => null)));
  }
  return serverRpc<LotMoney | null>("ldo_auc_lot_money", { p_session: session, p_lot: lot });
}

type Job = { kind: "deposit" | "payment"; action: "void" | "capture" | "check"; id: string; ref: string; amount?: number };

// Verificação de 5 em 5 minutos: liberta cauções, retém a do vencedor que não pagou e confirma pedidos pendentes
// (incluindo formulários do cartão concluídos cuja confirmação não chegou).
export async function runAuctionMoney({ budgetMs = 25_000 } = {}) {
  if (!serverConfigured() || !easypayConfigured()) return 0;
  const until = Date.now() + budgetMs;
  let done = 0;
  try {
    const checkouts = (await serverRpc<{ kind: string; id: string; checkout: string }[]>("ldo_auc_checkout_pending")) || [];
    for (const c of checkouts) {
      if (Date.now() > until) break;
      await syncCheckout(c.checkout).catch(() => null);
    }
    const jobs = (await serverRpc<Job[]>("ldo_auc_money_jobs")) || [];
    for (const job of jobs) {
      if (Date.now() > until) break;
      const finish = (ok: boolean, detail: string) =>
        serverRpc("ldo_auc_money_done", { p_kind: job.kind, p_id: job.id, p_action: job.action, p_ok: ok, p_detail: detail }).catch(() => undefined);
      if (job.action === "check") {
        await syncRef(job.ref).catch(() => null);
        await finish(true, "");
      } else if (job.action === "void") {
        const r = await easypay("POST", `/void/${encodeURIComponent(job.ref)}`, { descriptive: descriptive("Caução do leilão libertada"), transaction_key: `void-${job.id}`.slice(0, 50) });
        await finish(r.ok, r.ok ? "Libertada na easypay." : r.error);
      } else {
        const r = await easypay("POST", `/capture/${encodeURIComponent(job.ref)}`, {
          value: Number(job.amount), descriptive: descriptive("Caução do leilão retida"), transaction_key: `cap-${job.id}`.slice(0, 50),
        });
        await finish(r.ok, r.ok ? "Capturada na easypay." : r.error);
      }
      done++;
    }
  } catch (e) {
    console.error("leilao money", e instanceof Error ? e.message : e);
  }
  return done;
}
