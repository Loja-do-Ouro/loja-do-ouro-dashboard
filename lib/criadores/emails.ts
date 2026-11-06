import "server-only";
import { after } from "next/server";
import { dashboardUrl, emailConfigured, sendEmail } from "@/lib/email";
import { SupabaseError } from "@/lib/supabase";
import {
  accountDeletedText, accountExistsText, creatorEmailHtml, creatorEmailText, ibanConfirmText, metaAlertText, outboxEmail, passwordProblem,
  redact, registerTexts, resetEmailText, revealAlertText, verifyEmailText, type CreatorEmail,
} from "@/lib/criadores-rules";
import {
  creatorsServerConfigured, crAdminDelete, crDeleteAccount, crDeleteCheck, crIbanResend, crLegalPublic, crLogin, crLogout,
  crOutboxClaim, crOutboxDone, crPasswordChange, crReauth, crRegister, crReset, crResetRequest, crStaffAlertRecipients, crVerifyEmail,
  type CrDeleteResult, type CrVerifyResult,
} from "./db";
import { clearCreatorSession, creatorSession, creatorsReady, ipHash, pwnedPassword, PWNED_MESSAGE, setCreatorSession, siteUrl } from "./site";

// Emails da plataforma de criadores (§4.7, Resend + brandEmail) e os fluxos de conta que os enviam. Os textos estão
// em lib/criadores-rules.ts (puros, testados); aqui só se envia.
// - Na hora: sendIbanConfirm [rev. S-A1] e sendAccountDeleted.
// - Logo a seguir à resposta, em after() [rev. S-B2]: confirmação do email (com a variante pending [rev. S-M1]),
//   recuperação e «já tem conta». A action nunca espera pelo envio nem diz se falhou.
// - Fila (ldo_cr_outbox): sendCreatorsOutbox, no tick, com 600 ms entre envios.
// - Aviso aos Super Admin (revelações de IBAN) [rev. S-M8]: sendRevealAlert, em after().
// - Aviso aos Super Admin (fase 3A): sendMetaAlert, quando a leitura dos dados públicos do Instagram para por um erro
//   de token ou de configuração (no máximo um por 24 h, decidido por ldo_cr_public_health).
// Nenhum email sai sem creatorsReady() [rev. S-M4] (em produção, sem CREATORS_URL as ligações iriam para /c do
// dashboard). Nunca lançam erros: devolvem { ok, detail }. Os registos passam por redact().

const GAP_MS = 600;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function creatorsFrom() {
  return process.env.CREATORS_FROM || "Loja do Ouro Criadores <criadores@lojadoouro.pt>";
}
const replyTo = () => process.env.CREATORS_REPLY_TO || "criadores@lojadoouro.pt";

// Emails ligados: Resend configurado e o site pronto.
export function creatorsEmailReady() {
  return emailConfigured() && creatorsReady();
}

type SendResult = { ok: boolean; detail: string; status?: number };
const NOT_READY: SendResult = { ok: false, detail: "Emails da plataforma de criadores parados (CREATORS_URL, chaves ou Resend por configurar)." };

// O logótipo vem sempre do endereço do dashboard: no domínio criadores.* o proxy reescreve /logo-loja-do-ouro.png
// para /c/… (404).
async function send(to: string | string[], t: CreatorEmail, opts: { replyTo?: string } = {}): Promise<SendResult> {
  if (!creatorsEmailReady()) return NOT_READY;
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  return sendEmail(list, t.subject, creatorEmailHtml(t, dashboardUrl()), {
    from: creatorsFrom(), replyTo: opts.replyTo ?? replyTo(), text: creatorEmailText(t),
  });
}

// Constrói e envia; um erro ao montar o texto (ex.: token com formato errado) fica registado e não lança.
async function build(label: string, to: string, make: () => CreatorEmail): Promise<SendResult> {
  let t: CreatorEmail;
  try {
    t = make();
  } catch (e) {
    console.error(`criadores email ${label}`, redact(e));
    return { ok: false, detail: "Não foi possível montar o email." };
  }
  const r = await send(to, t);
  if (!r.ok && r !== NOT_READY) console.error(`criadores email ${label}`, redact(r.detail));
  return r;
}

// Envio em after(): a resposta sai já; o resultado só fica no registo.
function later(task: () => Promise<unknown>) {
  after(() => task().catch((e) => console.error("criadores after", redact(e))));
}

// ---------------------------------------------------------------- emails da conta (sem o nome, rev. S-B3; #t=, rev. S-B11)

export const sendVerifyEmail = (to: string, token: string, opts: { pending?: boolean } = {}) =>
  build("confirmar", to, () => verifyEmailText(siteUrl(), token, opts));
export const sendAccountExists = (to: string) => build("ja-tem-conta", to, () => accountExistsText(siteUrl()));
export const sendResetEmail = (to: string, token: string) => build("recuperar", to, () => resetEmailText(siteUrl(), token));
// Na hora (sem fila): os 4 últimos e a hora do pedido; o URL leva o token depois de #.
export const sendIbanConfirm = (to: string, token: string, last4: string, requestedAt: string = new Date().toISOString()) =>
  build("iban", to, () => ibanConfirmText(siteUrl(), token, last4, requestedAt));
export const sendAccountDeleted = (to: string) => build("conta-apagada", to, () => accountDeletedText());

// Aviso de segurança aos Super Admin ativos com email (S-M8): «{nome} revelou {n} IBAN nas últimas 24 h».
// Sem dados de criadores. Chamar em after() (revealFinance de crypto.ts já o faz).
export async function sendRevealAlert(staffName: string, count: number): Promise<SendResult> {
  if (!emailConfigured() || !creatorsServerConfigured()) return NOT_READY;
  try {
    const to = ((await crStaffAlertRecipients()) || []).map((r) => r.email).filter(Boolean);
    if (!to.length) return { ok: false, detail: "Sem Super Admin com email." };
    const t = revealAlertText(dashboardUrl(), staffName, count);
    const r = await sendEmail(to, t.subject, creatorEmailHtml(t, dashboardUrl()), { from: creatorsFrom(), text: creatorEmailText(t) });
    if (!r.ok) console.error("criadores alerta revelacao", redact(r.detail));
    return r;
  } catch (e) {
    console.error("criadores alerta revelacao", redact(e));
    return { ok: false, detail: "Falhou o aviso aos Super Admin." };
  }
}

// «A leitura dos dados públicos do Instagram parou» (token ou configuração), para os Super Admin ativos com email.
// Sem dados de criadores nem o valor do token.
export async function sendMetaAlert(kind: "token" | "config"): Promise<SendResult> {
  if (!emailConfigured() || !creatorsServerConfigured()) return NOT_READY;
  try {
    const to = ((await crStaffAlertRecipients()) || []).map((r) => r.email).filter(Boolean);
    if (!to.length) return { ok: false, detail: "Sem Super Admin com email." };
    const t = metaAlertText(dashboardUrl(), kind);
    const r = await sendEmail(to, t.subject, creatorEmailHtml(t, dashboardUrl()), { from: creatorsFrom(), text: creatorEmailText(t) });
    if (!r.ok) console.error("criadores alerta meta", redact(r.detail));
    return r;
  } catch (e) {
    console.error("criadores alerta meta", redact(e));
    return { ok: false, detail: "Falhou o aviso aos Super Admin." };
  }
}

// ---------------------------------------------------------------- fila (tick)

// Igual a sendAuctionOutbox: lotes de 20, 600 ms entre envios, para no 429 do Resend (as reservas voltam à fila em
// 2 min). Conta apagada → feito sem enviar; kind desconhecido → falhado com o motivo.
export async function sendCreatorsOutbox({ budgetMs = 25_000 } = {}): Promise<number> {
  if (!creatorsServerConfigured() || !creatorsEmailReady()) return 0;
  const until = Date.now() + budgetMs;
  const base = siteUrl();
  let sent = 0;
  try {
    while (Date.now() < until) {
      const items = (await crOutboxClaim(20)) || [];
      for (const item of items) {
        const done = (ok: boolean, detail: string) => crOutboxDone(item.id, item.lease, ok, redact(detail, 500)).catch(() => undefined);
        if (item.deleted) {
          await done(true, "Conta apagada: não enviado.");
          continue;
        }
        let t: CreatorEmail | null;
        try {
          t = outboxEmail(item, base);
        } catch (e) {
          await done(false, `Não foi possível montar o aviso: ${redact(e)}`);
          continue;
        }
        if (!t) {
          await done(false, `Tipo de aviso desconhecido: ${String(item.kind).slice(0, 60)}`);
          continue;
        }
        if (!item.email) {
          await done(false, "Sem email.");
          continue;
        }
        if (sent) await pause(GAP_MS);
        const r = await send(item.email, t);
        if (r.status === 429) return sent;
        await done(r.ok, r.detail);
        sent++;
        if (Date.now() >= until) return sent;
      }
      if (items.length < 20) break;
    }
  } catch (e) {
    console.error("criadores outbox", redact(e));
  }
  return sent;
}

// ---------------------------------------------------------------- fluxos de conta (server actions do site)

// Erros de validação no formato que userMessage() mostra (22023).
const userError = (message: string) => new SupabaseError(message, 400, "22023");
const CLOSED = "As inscrições ainda não estão abertas. Volte em breve.";

async function assertNotPwned(password: string) {
  if (await pwnedPassword(password)) throw userError(PWNED_MESSAGE);
}

// Registo [rev. S-B2, S-M1, R-B1]. Os documentos são os que a página mostrou (ids de crLegalPublic(null)); as versões
// e os textos das caixas saem daqui (registerTexts), nunca do FormData. Não devolve nada: a página mostra sempre o
// mesmo texto («Enviámos um email…»), seja o email novo, por confirmar, já registado ou acima do limite. O email sai
// em after(). Erros de validação → SupabaseError 22023 (userMessage).
export async function registerCreator(input: {
  email: string; password: string; name: string; termsDoc: string; privacyDoc: string; adult: boolean;
}): Promise<void> {
  if (!creatorsReady()) throw userError(CLOSED);
  const problem = passwordProblem(input.password);
  if (problem) throw userError(problem);
  await assertNotPwned(input.password);
  const legal = await crLegalPublic(null);
  const terms = legal.documents.find((d) => d.id === input.termsDoc && d.kind === "terms");
  const privacy = legal.documents.find((d) => d.id === input.privacyDoc && d.kind === "privacy");
  if (!legal.registrations_open) throw userError(CLOSED);
  if (!terms || !privacy) throw userError("Os Termos ou a Política foram atualizados. Recarregue a página e leia a versão nova.");
  const email = input.email.trim().toLowerCase();
  const r = await crRegister({
    email, password: input.password, name: input.name, termsDoc: terms.id, privacyDoc: privacy.id, adult: input.adult,
    texts: registerTexts(terms.version, privacy.version), ip: await ipHash(),
  });
  if (r.status === "created" || r.status === "pending") {
    const token = r.verify_token;
    const pending = r.status === "pending";
    later(() => sendVerifyEmail(email, token, { pending }));
  } else if (r.status === "exists") {
    later(() => sendAccountExists(email));
  }
  // quiet: 4.º pedido na hora para o mesmo endereço; não envia nada.
}

// Confirmar o email (POST com a palavra-passe do registo, rev. S-M1). Token fora do formato → expired, sem ir à BD.
export async function verifyCreatorEmail(token: string, password: string): Promise<CrVerifyResult> {
  if (!/^[0-9a-f]{64}$/.test(token || "")) return { ok: false, reason: "expired" };
  return crVerifyEmail(token, password, await ipHash());
}

// Entrar: grava o cookie com a sessão nova. Email por confirmar → novo email em after() (no máximo 3 por hora).
export async function loginCreator(email: string, password: string): Promise<{ ok: true } | { ok: false; reason: "locked" | "invalid" | "unverified" }> {
  const r = await crLogin(email.trim().toLowerCase(), password, await ipHash());
  if (r.ok) {
    await setCreatorSession(r.session, r.expires_at);
    return { ok: true };
  }
  if (r.reason === "unverified" && "verify_token" in r && r.verify_token && r.email) {
    const to = r.email;
    const token = r.verify_token;
    later(() => sendVerifyEmail(to, token));
  }
  return { ok: false, reason: r.reason };
}

export async function logoutCreator() {
  const session = await creatorSession();
  if (session) await crLogout(session).catch((e) => console.error("criadores logout", redact(e)));
  await clearCreatorSession();
}

// «Recuperar»: responde sempre o mesmo (salvo rate, 5 pedidos por ligação e hora); o email sai em after().
export async function requestCreatorReset(email: string): Promise<{ ok: true } | { ok: false; reason: "rate" }> {
  const r = await crResetRequest(email.trim().toLowerCase(), await ipHash());
  if (!r.ok) return r;
  if (r.reset_token && r.email) {
    const to = r.email;
    const token = r.reset_token;
    later(() => sendResetEmail(to, token));
  }
  return { ok: true };
}

// Nova palavra-passe com o token do email (#t=). Revoga as sessões; a pessoa entra a seguir.
export async function resetCreatorPassword(token: string, password: string): Promise<{ ok: true } | { ok: false; reason: "expired" }> {
  if (!/^[0-9a-f]{64}$/.test(token || "")) return { ok: false, reason: "expired" };
  const problem = passwordProblem(password);
  if (problem) throw userError(problem);
  await assertNotPwned(password);
  return crReset(token, password);
}

// Mudar a palavra-passe com sessão: as outras sessões terminam e esta recebe uma nova (cookie regravado).
export async function changeCreatorPassword(session: string, oldPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: "password" }> {
  const problem = passwordProblem(newPassword);
  if (problem) throw userError(problem);
  await assertNotPwned(newPassword);
  const r = await crPasswordChange(session, oldPassword, newPassword, await ipHash());
  if (r.ok) await setCreatorSession(r.session, r.expires_at);
  return r.ok ? { ok: true } : r;
}

// «Reenviar o email» do IBAN pendente: novo token e envio na hora.
export async function resendIbanConfirm(session: string): Promise<{ ok: true; sent: boolean } | { ok: false; reason: "nothing_pending" | "rate" }> {
  const r = await crIbanResend(session, await ipHash());
  if (!r.ok) return r;
  const sent = await sendIbanConfirm(r.email, r.confirm_token, r.pending_last4);
  return { ok: true, sent: sent.ok };
}

// Apagar a conta (palavra-passe + «APAGAR» na página). Ordem: confirmar a palavra-passe (conta como tentativa), ver
// se há bloqueio; sem bloqueio, enviar «A sua conta foi apagada» enquanto o endereço existe e só depois apagar.
// Com bloqueio [rev. R-M7], a BD apaga o opcional, deixa um pedido erasure aberto e devolve o motivo (sem email aqui:
// o aviso erasure_blocked segue pela fila). Sucesso → o cookie é apagado.
export async function deleteMyAccount(session: string, password: string): Promise<CrDeleteResult> {
  const ip = await ipHash();
  if (!(await crReauth(session, password, ip))) return { ok: false, reason: "password" };
  const check = await crDeleteCheck(session);
  if (!check.blocked && check.email) await sendAccountDeleted(check.email);
  const r = await crDeleteAccount(session, password, ip);
  if (r.ok) await clearCreatorSession();
  return r;
}

// Apagar pela equipa (Super Admin): a BD devolve o email de antes da anonimização e o aviso sai na hora.
export async function adminDeleteCreator(staffSession: string, creatorId: string, reason: string, requestId: string | null, minor: boolean) {
  const r = await crAdminDelete(staffSession, creatorId, reason, requestId, minor);
  const sent = r.email ? await sendAccountDeleted(r.email) : NOT_READY;
  return { ok: true as const, emailSent: sent.ok };
}
