import "server-only";
import { easypay, easypayConfigured } from "@/lib/easypay";
import {
  authorisationBody, descriptive, readCreated, readStatus, saleBody, type DepositMethod, type PayMethod,
} from "@/lib/easypay-rules";
import { serverConfigured, serverRpc } from "@/lib/support/db";

// Cauções e pagamentos do leilão. A BD decide quem pode cativar/pagar, quanto e o que falta fazer; aqui só se fala
// com a easypay. O estado de um pedido é sempre lido na API da easypay (nunca no corpo de uma notificação).

export type LotMoney = {
  deposit: { id: string; status: "pending" | "held" | "captured" | "released" | "failed"; amount: number; method: DepositMethod | null; checkout_url: string | null; expires_at: string | null; detail: string | null } | null;
  payment: { id: string; status: "pending" | "paid" | "failed" | "cancelled"; amount: number; method: PayMethod | "manual"; entity: string | null; reference: string | null; checkout_url: string | null; expires_at: string | null; paid_at: string | null; detail: string | null } | null;
};

type Started = {
  status: "new" | "held" | "existing"; id?: string; amount?: number; method?: string; phone?: string | null; name?: string; email?: string;
  lot_title?: string; lot_position?: number; event_slug?: string; due_at?: string | null;
};

export async function startDeposit(session: string, lot: string, method: DepositMethod, phone: string) {
  if (!easypayConfigured()) throw new Error("Os pagamentos ainda não estão ativos. Tente mais tarde.");
  const s = await serverRpc<Started>("ldo_auc_deposit_start", { p_session: session, p_lot: lot, p_method: method, p_phone: phone || null });
  if (s.status !== "new" || !s.id) return s;
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

export async function startPayment(session: string, lot: string, method: PayMethod, phone: string) {
  if (!easypayConfigured()) throw new Error("Os pagamentos online ainda não estão ativos. Contacte-nos para pagar por transferência.");
  const s = await serverRpc<Started>("ldo_auc_pay_start", { p_session: session, p_lot: lot, p_method: method, p_phone: phone || null });
  if (s.status !== "new" || !s.id) return s;
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

// Lê o estado na easypay e grava-o na BD.
export async function syncRef(ref: string) {
  const r = await easypay("GET", `/single/${encodeURIComponent(ref)}`);
  if (!r.ok) return null;
  const status = readStatus(r.json);
  if (!status || status === "pending") return status;
  await serverRpc("ldo_auc_provider_sync", { p_ref: ref, p_status: status });
  return status;
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

// Verificação de 5 em 5 minutos: liberta cauções, retém a do vencedor que não pagou e confirma pedidos pendentes.
export async function runAuctionMoney({ budgetMs = 25_000 } = {}) {
  if (!serverConfigured() || !easypayConfigured()) return 0;
  const until = Date.now() + budgetMs;
  let done = 0;
  try {
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
