"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { sendAuctionOutbox, sendResetEmail, sendVerifyEmail, sendWithdrawalEmails } from "@/lib/leilao/emails";
import {
  auctionSession, clearAuctionSession, ipHash, pubSettings, setAuctionSession, siteBase,
} from "@/lib/leilao/site";
import { parseBid, safeNext, type BidResult } from "@/lib/leilao-site-rules";
import { isLocked, recordFailure } from "@/lib/rate-limit";
import { userMessage } from "@/lib/supabase";
import { serverRpc } from "@/lib/support/db";

// Ações do site do leilão. As regras (palavra-passe, limites, idade, quem pode licitar) estão na BD; aqui só se
// lê o formulário, se chama a função e se envia o email. Os formulários usam useActionState: o erro volta ao
// formulário com os valores escritos (nunca a palavra-passe).

export type FormState = { error?: string; ok?: string; values?: Record<string, string> };

const text = (form: FormData, f: string, max = 300) => {
  const v = form.get(f);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAVAILABLE = "O leilão está indisponível neste momento. Tente dentro de momentos.";

// ---------------------------------------------------------------- conta

export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { name: text(form, "name", 120), email: text(form, "email", 254), phone: text(form, "phone", 30), marketing: form.get("marketing") === "on" ? "on" : "" };
  if (form.get("adult") !== "on") return { error: "Para licitar tem de ser maior de idade.", values };
  if (form.get("terms") !== "on") return { error: "Aceite o regulamento, os termos e a política de privacidade.", values };
  const settings = await pubSettings();
  if (!settings) return { error: UNAVAILABLE, values };
  let r: { status: "created" | "pending" | "exists"; name?: string; verify_token?: string };
  try {
    r = await serverRpc("ldo_auc_register", {
      p_email: values.email, p_password: String(form.get("password") || ""), p_name: values.name, p_phone: values.phone || null,
      p_marketing: values.marketing === "on", p_terms_version: settings.terms_version, p_ip_hash: await ipHash(),
    });
  } catch (e) {
    return { error: userMessage(e), values };
  }
  if (r.verify_token) {
    const sent = await sendVerifyEmail(values.email.toLowerCase(), r.name || "", r.verify_token);
    if (!sent.ok) return { error: "Não conseguimos enviar o email de confirmação. Tente dentro de momentos.", values };
  }
  // A mesma resposta quando o email já tem conta (não revela quem é cliente).
  return { ok: `Enviámos um email para ${values.email}. Abra a ligação para confirmar a conta e depois entre.` };
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email", 254);
  const values = { email };
  const base = await siteBase();
  let r: { ok: boolean; reason?: "locked" | "blocked" | "unverified" | "invalid"; session?: string; expires_at?: string; name?: string; verify_token?: string };
  try {
    r = await serverRpc("ldo_auc_login", { p_email: email, p_password: String(form.get("password") || ""), p_ip_hash: await ipHash() });
  } catch (e) {
    return { error: userMessage(e) === "Sem permissão." ? UNAVAILABLE : userMessage(e), values };
  }
  if (!r.ok) {
    if (r.reason === "unverified" && r.verify_token) {
      await sendVerifyEmail(email.toLowerCase(), r.name || "", r.verify_token);
      return { error: "Ainda não confirmou o seu email. Enviámos uma nova ligação de confirmação.", values };
    }
    if (r.reason === "locked") return { error: "Demasiadas tentativas. Aguarde 15 minutos ou recupere a palavra-passe.", values };
    if (r.reason === "blocked") return { error: "Esta conta está suspensa. Fale connosco se precisar de ajuda.", values };
    return { error: "Email ou palavra-passe incorretos.", values };
  }
  await setAuctionSession(r.session!, r.expires_at!);
  redirect(safeNext(form.get("next"), base));
}

export async function logoutAction() {
  const session = await auctionSession();
  const base = await siteBase();
  if (session) await serverRpc("ldo_auc_logout", { p_session: session }).catch(() => undefined);
  await clearAuctionSession();
  redirect(base || "/");
}

export async function resetRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email", 254);
  try {
    const r = await serverRpc<{ ok: boolean; email?: string; name?: string; reset_token?: string }>("ldo_auc_reset_request", {
      p_email: email, p_ip_hash: await ipHash(),
    });
    if (!r.ok) return { error: "Demasiados pedidos. Tente mais tarde.", values: { email } };
    if (r.reset_token && r.email) await sendResetEmail(r.email, r.name || "", r.reset_token);
  } catch {
    return { error: UNAVAILABLE, values: { email } };
  }
  return { ok: `Se ${email} tiver conta no leilão, vai receber um email com a ligação para escolher uma nova palavra-passe (válida 2 horas).` };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const token = text(form, "t", 80);
  const password = String(form.get("password") || "");
  if (password !== String(form.get("password2") || "")) return { error: "As palavras-passe não coincidem." };
  let ok = false;
  try {
    ok = (await serverRpc<{ ok: boolean }>("ldo_auc_reset", { p_reset: token, p_password: password })).ok;
  } catch (e) {
    return { error: userMessage(e) };
  }
  if (!ok) return { error: "A ligação expirou ou já foi usada. Peça uma nova." };
  redirect(`${await siteBase()}/conta/entrar?m=reset`);
}

async function requireSession() {
  const session = await auctionSession();
  if (!session) redirect(`${await siteBase()}/conta/entrar`);
  return session;
}

export async function profileAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const data = {
    name: text(form, "name", 120), phone: text(form, "phone", 30), nif: text(form, "nif", 20), birth_date: text(form, "birth_date", 10),
    marketing: form.get("marketing") === "on",
    address: { line1: text(form, "line1", 200), line2: text(form, "line2", 200), postal_code: text(form, "postal_code", 20), city: text(form, "city", 100) },
  };
  try {
    await serverRpc("ldo_auc_profile_save", { p_session: session, p_data: data });
  } catch (e) {
    return { error: userMessage(e) };
  }
  return { ok: "Dados guardados." };
}

export async function passwordAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const next = String(form.get("new") || "");
  if (next !== String(form.get("new2") || "")) return { error: "As novas palavras-passe não coincidem." };
  try {
    await serverRpc("ldo_auc_password_change", { p_session: session, p_old: String(form.get("old") || ""), p_new: next });
  } catch (e) {
    return { error: userMessage(e) };
  }
  return { ok: "Palavra-passe alterada. As outras sessões foram terminadas." };
}

export async function deleteAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  if (text(form, "confirm", 20).toUpperCase() !== "APAGAR") return { error: "Escreva APAGAR para confirmar." };
  try {
    await serverRpc("ldo_auc_delete_account", { p_session: session, p_password: String(form.get("password") || "") });
  } catch (e) {
    return { error: userMessage(e) };
  }
  await clearAuctionSession();
  redirect(`${await siteBase()}/?m=apagada`);
}

// ---------------------------------------------------------------- licitar e favoritos

export type BidState = { ok: true; result: BidResult } | { ok: false; error: string; login?: boolean };

export async function bidAction(lotId: string, value: string): Promise<BidState> {
  const session = await auctionSession();
  if (!session) return { ok: false, error: "Entre na sua conta para licitar.", login: true };
  const max = parseBid(value);
  if (!UUID.test(lotId) || max === null) return { ok: false, error: "Indique um valor válido em euros." };
  try {
    const result = await serverRpc<BidResult>("ldo_auc_bid", { p_session: session, p_lot: lotId, p_max: max, p_ip_hash: await ipHash() });
    // Avisos (ultrapassado, prolongado) logo a seguir, sem esperar pela verificação de 5 em 5 minutos.
    after(() => sendAuctionOutbox({ budgetMs: 20_000 }).catch(() => undefined));
    return { ok: true, result };
  } catch (e) {
    const msg = userMessage(e);
    return { ok: false, error: msg, login: msg.startsWith("Entre na sua conta") };
  }
}

export async function watchAction(lotId: string): Promise<{ ok: boolean; watching?: boolean; error?: string }> {
  const session = await auctionSession();
  if (!session) return { ok: false, error: "Entre na sua conta para guardar favoritos." };
  if (!UUID.test(lotId)) return { ok: false, error: "Lote inválido." };
  try {
    return { ok: true, watching: await serverRpc<boolean>("ldo_auc_watch_toggle", { p_session: session, p_lot: lotId }) };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

// ---------------------------------------------------------------- livre resolução

// Formulário de livre resolução (botão de desistência): chega à equipa e o cliente recebe a cópia por email.

export async function withdrawalAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { name: text(form, "name", 120), email: text(form, "email", 254), lot: text(form, "lot", 200), received: text(form, "received", 10), message: text(form, "message", 2000) };
  if (!values.name || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(values.email) || !values.lot) {
    return { error: "Indique o nome, o email e o lote ou a peça.", values };
  }
  const key = `withdraw:${await ipHash()}`;
  if (isLocked(key)) return { error: "Já recebemos vários pedidos desta ligação. Escreva-nos para o email de contacto.", values };
  recordFailure(key);
  const settings = await pubSettings();
  const ok = await sendWithdrawalEmails({ ...values, contact: settings?.contact_email || "apoiocliente@lojadoouro.pt" }).catch(() => false);
  if (!ok) return { error: "Não conseguimos enviar a declaração. Tente de novo ou escreva-nos para o email de contacto.", values };
  return { ok: `Declaração enviada. Recebeu uma cópia em ${values.email}, com a data e a hora do envio.` };
}
