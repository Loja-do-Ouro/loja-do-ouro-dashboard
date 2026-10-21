import "server-only";
import { dashboardUrl, emailConfigured, sendEmail } from "@/lib/email";
import {
  addProfilesToList, findProfileId, importProfile, klaviyoWriteConfigured, privateSelectionListId, removeProfilesFromList, subscribeProfiles,
} from "@/lib/klaviyo-write";
import { privateSelectionEmail } from "@/lib/private-selection-email";
import {
  entryUrl, klaviyoProfilePayload, klaviyoSubscriptionPayload, normalizePhone, PS_BRANDS, psLang, type PsBrand,
} from "@/lib/private-selection-rules";
import { encryptionConfigured, open } from "@/lib/support/crypto";
import { serverConfigured } from "@/lib/support/db";
import {
  PS_PASSWORD_CONTEXT, psEmailClaim, psEmailDone, psKlaviyoClaim, psKlaviyoDone, type PsEmailJob, type PsKlaviyoJob,
} from "./db";

// Filas da Private Selection (na BD): o email com a senha e a lista do Klaviyo. Correm na verificação automática
// de 5 em 5 minutos (app/api/support/webhooks/tick) e, depois da resposta, nos pedidos do formulário e na página
// da equipa. Podem correr ao mesmo tempo (cada membro fica reservado 2 minutos; os emails, uma passagem de cada vez)
// e nunca lançam erros: o que falha fica no membro (email_detail / klaviyo_detail) e volta a ser tentado 30 minutos
// depois, até 5 vezes.

const BATCH = 10;
// O Resend aceita poucos pedidos por segundo: um email de cada vez, com uma pausa entre eles (a BD só deixa uma
// passagem enviar de cada vez).
const EMAIL_GAP_MS = 600;
const DEFAULT_BUDGET_MS = 25_000;

// Remetente com o nome da marca do membro; o domínio lojadoouro.pt é o verificado no Resend para as duas marcas.
export function privateSelectionFrom(brand: PsBrand) {
  if (brand === "gsp") return process.env.PRIVATE_SELECTION_FROM_GSP || `${PS_BRANDS.gsp.name} <privateselection@lojadoouro.pt>`;
  return process.env.PRIVATE_SELECTION_FROM_LDO || `${PS_BRANDS.ldo.name} <privateselection@lojadoouro.pt>`;
}
export function privateSelectionReplyTo() {
  return process.env.PRIVATE_SELECTION_REPLY_TO || "apoiocliente@lojadoouro.pt";
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback).slice(0, 400);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

// Lotes de 10 até a fila esvaziar, o tempo acabar (budgetMs) ou each pedir para parar (false).
async function drain<T extends { id: string }>(
  budgetMs: number, claim: (limit: number) => Promise<T[]>, each: (job: T) => Promise<boolean | void>,
) {
  const until = Date.now() + budgetMs;
  let done = 0;
  while (Date.now() < until) {
    const jobs = (await claim(BATCH)) || [];
    for (const job of jobs) {
      if ((await each(job)) === false) return done;
      done++;
    }
    if (jobs.length < BATCH) break;
  }
  return done;
}

// ---------------------------------------------------------------- email com a senha

// Sem Resend ou sem a chave da cifra nada é reservado: os emails ficam na fila até à configuração estar completa.
export async function sendDuePrivateSelectionEmails({ budgetMs = DEFAULT_BUDGET_MS } = {}) {
  if (!serverConfigured() || !emailConfigured() || !encryptionConfigured()) return 0;
  try {
    const base = dashboardUrl();
    // Todos os emails de um lote levam a mesma senha: decifrada uma vez e só em memória.
    const passwords = new Map<string, string>();
    let first = true;
    return await drain<PsEmailJob>(budgetMs, psEmailClaim, async (job) => {
      if (!first) await pause(EMAIL_GAP_MS);
      first = false;
      const r: Sent = await sendOne(job, base, passwords).catch((e) => ({ ok: false, detail: message(e, "Envio interrompido.") }));
      // Resend a pedir para esperar (429): não conta como tentativa. A passagem pára e os emails reservados voltam à
      // fila quando a reserva acaba (2 minutos); até lá nenhuma outra passagem envia.
      if (r.status === 429) return false;
      await psEmailDone(job, r.ok, r.detail).catch(() => undefined);
    });
  } catch (e) {
    console.error("private-selection email", message(e, "Fila indisponível."));
    return 0;
  }
}

type Sent = { ok: boolean; detail: string; status?: number };

async function sendOne(job: PsEmailJob, base: string, passwords: Map<string, string>): Promise<Sent> {
  let password = passwords.get(job.password_ct);
  if (password === undefined) {
    try {
      password = open(job.password_ct, PS_PASSWORD_CONTEXT);
    } catch {
      return { ok: false, detail: "Não foi possível decifrar a senha (a SUPPORT_ENCRYPTION_KEY mudou?). Defina a senha de novo." };
    }
    passwords.set(job.password_ct, password);
  }
  const { brand, locale } = psLang(job.brand, job.locale);
  const mail = privateSelectionEmail({
    baseUrl: base, brand, locale, name: job.name, email: job.email, password, entryUrl: entryUrl(brand, locale, job.entry_path),
  });
  return sendEmail([job.email], mail.subject, mail.html, {
    from: privateSelectionFrom(brand), replyTo: privateSelectionReplyTo(), text: mail.text, timeoutMs: 8000,
  });
}

// ---------------------------------------------------------------- Klaviyo

// Sem KLAVIYO_WRITE_API_KEY ou sem a lista nada é reservado: as ações ficam na fila para quando forem configuradas.
export async function syncPrivateSelectionKlaviyo({ budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const listId = privateSelectionListId();
  if (!serverConfigured() || !klaviyoWriteConfigured() || !listId) return 0;
  try {
    return await drain<PsKlaviyoJob>(budgetMs, psKlaviyoClaim, async (job) => {
      let ok = true;
      let detail: string;
      try {
        detail = job.action === "remove" ? await klaviyoRemove(job, listId) : await klaviyoUpsert(job, listId);
      } catch (e) {
        ok = false;
        detail = message(e, "Klaviyo indisponível.");
      }
      await psKlaviyoDone(job, ok, detail).catch(() => undefined);
    });
  } catch (e) {
    console.error("private-selection klaviyo", message(e, "Fila indisponível."));
    return 0;
  }
}

// Perfil (com marca, língua, origem e data do pedido), lista para todos e, só com a caixa do marketing marcada e uma
// só vez (job.subscribe), a inscrição nos emails de marketing: uma edição da equipa nunca volta a inscrever quem
// saiu nos emails da Klaviyo. O nome do formulário (não confirmado) só entra num perfil novo; o de um perfil que a
// Klaviyo já tem (cliente, subscritor) fica como está. O telemóvel só segue se estiver no formato internacional.
async function klaviyoUpsert(job: PsKlaviyoJob, listId: string) {
  const member = { ...job, phone: normalizePhone(job.phone) };
  const names = job.source !== "form" || !(await findProfileId(job.email));
  const profile = await importProfile(klaviyoProfilePayload(member, { names }));
  await addProfilesToList(listId, [profile]);
  const subscription = job.subscribe === true ? klaviyoSubscriptionPayload(member, listId) : null;
  if (subscription) await subscribeProfiles(subscription);
  return subscription ? `Na lista; inscrição no marketing enviada (perfil ${profile}).` : `Na lista (perfil ${profile}).`;
}

// Só sai da lista: o perfil (e o consentimento que tenha) fica na Klaviyo.
async function klaviyoRemove(job: PsKlaviyoJob, listId: string) {
  const profile = await findProfileId(job.email);
  if (!profile) return "Sem perfil na Klaviyo: nada a tirar da lista.";
  await removeProfilesFromList(listId, [profile]);
  return `Fora da lista (perfil ${profile}).`;
}

// Passagem pelas duas filas, para correr em after() (pedidos do formulário e página da equipa).
export async function sweepPrivateSelection() {
  await Promise.all([sendDuePrivateSelectionEmails(), syncPrivateSelectionKlaviyo()]);
}
