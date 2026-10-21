import "server-only";
import type { PsBrand, PsKlaviyoMember, PsLocale } from "@/lib/private-selection-rules";
import { encryptionProblem, seal } from "@/lib/support/crypto";
import { serverRpc, sessionRpc } from "@/lib/support/db";

// Funções ldo_ps_* (supabase/migrations/20261021120000_ldo_private_selection.sql). As da equipa levam a sessão e a
// BD confirma o acesso (Super Admin ou Loja Online); as das rotas públicas e das filas levam o token do servidor.

// Contexto da cifra da senha partilhada (dados autenticados do AES-GCM): só abre com este mesmo texto.
export const PS_PASSWORD_CONTEXT = "private-selection:password";

// ---------------------------------------------------------------- equipa (sessão)

export type PsMember = {
  id: string; name: string; email: string; phone: string; locale: PsLocale; brand: PsBrand;
  source: "form" | "admin"; status: "active" | "removed"; consent_marketing: boolean;
  created_at: string; created_by_name: string | null; removed_at: string | null; removed_by_name: string | null;
  email_due_at: string | null; email_sent_at: string | null; email_attempts: number; email_detail: string | null;
  klaviyo_action: "upsert" | "remove" | null; klaviyo_synced_at: string | null; klaviyo_subscribed_at: string | null;
  klaviyo_attempts: number; klaviyo_detail: string | null;
  last_login_at: string | null;
};
export type PsSettings = {
  has_password: boolean; password_changed_at: string | null; password_changed_by_name: string | null;
  delay_minutes: number; session_days: number; entry_path: string;
};

// Membros (mais recentes primeiro) e o estado da senha; nunca a senha, o hash nem a cifra.
export function psList(session: string) {
  return sessionRpc<{ members: PsMember[]; settings: PsSettings }>(session, "ldo_ps_list");
}

// Cria o membro ou volta a ativar um removido; o email com a senha sai já.
export function psAdd(session: string, m: { name: string; email: string; phone: string; locale: PsLocale; brand: PsBrand }) {
  return sessionRpc<{ id: string; reactivated: boolean }>(session, "ldo_ps_add", {
    p_name: m.name, p_email: m.email, p_phone: m.phone, p_locale: m.locale, p_brand: m.brand,
  });
}

// Pedidos de pessoas removidas (mesmo email, outra forma do endereço ou mesmo telemóvel) que esperam pela equipa
// (supabase/migrations/20261021160000_ldo_ps_blocked.sql).
export type PsBlockedReason = "removed_email" | "removed_mailbox" | "removed_phone";
export type PsBlocked = {
  id: string; email: string; name: string; phone: string; locale: PsLocale; brand: PsBrand; consent_marketing: boolean;
  reason: PsBlockedReason; attempts: number; created_at: string; last_at: string;
  removed_email: string | null; removed_name: string | null; removed_at: string | null; removed_by_name: string | null;
};

export function psBlockedList(session: string) {
  return sessionRpc<PsBlocked[]>(session, "ldo_ps_blocked_list");
}

// Aceitar: membro ativo e email com a senha já (como "Adicionar pessoa"). Ignorar: o pedido sai da lista.
export function psBlockedResolve(session: string, id: string, accept: boolean) {
  return sessionRpc<{ accepted: boolean; member_id: string | null }>(session, "ldo_ps_blocked_resolve", { p_id: id, p_accept: accept });
}

export function psRemove(session: string, id: string) {
  return sessionRpc<null>(session, "ldo_ps_remove", { p_id: id });
}

export function psResend(session: string, id: string) {
  return sessionRpc<null>(session, "ldo_ps_resend", { p_id: id });
}

// Klaviyo parada depois de 5 falhas: a ação pendente (juntar ou tirar da lista) volta à fila, sem mexer no membro.
export function psKlaviyoRetry(session: string, id: string) {
  return sessionRpc<null>(session, "ldo_ps_klaviyo_retry", { p_id: id });
}

// Nova senha: a BD guarda o bcrypt (para a entrada) e esta cifra (só para os emails), termina as sessões da loja e,
// com notifyAll, volta a enviar o email a todos os membros ativos. Sem SUPPORT_ENCRYPTION_KEY válida não grava.
export async function psSetPassword(session: string, password: string, notifyAll: boolean) {
  const problem = encryptionProblem();
  if (problem) throw new Error(`Não foi possível cifrar a senha: ${problem}`);
  return sessionRpc<null>(session, "ldo_ps_set_password", {
    p_password: password, p_password_ct: seal(password, PS_PASSWORD_CONTEXT), p_notify_all: notifyAll,
  });
}

export function psSetSettings(session: string, entryPath: string) {
  return sessionRpc<null>(session, "ldo_ps_set_settings", { p_entry_path: entryPath });
}

// ---------------------------------------------------------------- servidor (token): rotas públicas

// created, existing, requeued ou blocked: só para o servidor (a rota responde sempre "pedido recebido").
export type PsRequestStatus = "created" | "existing" | "requeued" | "blocked";

export function psRequest(r: {
  name: string; email: string; phone: string; locale: PsLocale; brand: PsBrand; origin: string | null;
  consent: boolean; ipHash: string; ipPrefixHash: string; clientKey: string;
}) {
  return serverRpc<{ status: PsRequestStatus }>("ldo_ps_request", {
    p_name: r.name, p_email: r.email, p_phone: r.phone, p_locale: r.locale, p_brand: r.brand, p_origin: r.origin,
    p_consent: r.consent, p_ip_hash: r.ipHash, p_ip_prefix_hash: r.ipPrefixHash, p_client_key: r.clientKey,
  });
}

// name: só o primeiro nome (a senha é partilhada: entrar não prova quem é a pessoa).
export type PsLogin = { ok: true; token: string; expires_at: string; name: string } | { ok: false; reason: "invalid" | "locked" };

export function psLogin(email: string, password: string, ipPrefixHash: string) {
  return serverRpc<PsLogin>("ldo_ps_login", { p_email: email, p_password: password, p_ip_prefix_hash: ipPrefixHash });
}

// session: o token que a loja guardou (a BD só tem o hash).
export function psSession(session: string) {
  return serverRpc<{ ok: boolean; name?: string; expires_at?: string }>("ldo_ps_session", { p_session: session });
}

export function psLogout(session: string) {
  return serverRpc<null>("ldo_ps_logout", { p_session: session });
}

// ---------------------------------------------------------------- servidor (token): filas

// Emails com a senha na hora de sair, reservados por 2 minutos (password_ct: cifra com PS_PASSWORD_CONTEXT). Só uma
// passagem de cada vez recebe emails. lease: a reserva, tal como a BD a deu (texto, para não perder os
// microssegundos); o resultado só conta com ela.
export type PsEmailJob = {
  id: string; lease: string; name: string; email: string; locale: string; brand: string; password_ct: string; entry_path: string;
};

export function psEmailClaim(limit: number) {
  return serverRpc<PsEmailJob[]>("ldo_ps_email_claim", { p_limit: limit });
}

// detail: id do Resend ou o motivo da falha (a BD guarda 500 caracteres).
export function psEmailDone(job: Pick<PsEmailJob, "id" | "lease">, ok: boolean, detail: string) {
  return serverRpc<null>("ldo_ps_email_done", { p_id: job.id, p_lease: job.lease, p_ok: ok, p_detail: detail });
}

// Ações pendentes na Klaviyo, reservadas por 2 minutos (lease como nos emails). subscribe: este upsert também
// inscreve no marketing (só uma vez por consentimento).
export type PsKlaviyoJob = PsKlaviyoMember & { id: string; lease: string; action: "upsert" | "remove"; subscribe: boolean };

export function psKlaviyoClaim(limit: number) {
  return serverRpc<PsKlaviyoJob[]>("ldo_ps_klaviyo_claim", { p_limit: limit });
}

export function psKlaviyoDone(job: Pick<PsKlaviyoJob, "id" | "lease" | "action">, ok: boolean, detail: string) {
  return serverRpc<null>("ldo_ps_klaviyo_done", { p_id: job.id, p_lease: job.lease, p_action: job.action, p_ok: ok, p_detail: detail });
}
