"use server";

import { redirect } from "next/navigation";
import {
  crCreatorsList, crCreatorStatus, crDeclaredValidate, crLegalPublish, crLegalSave, crLockdown, crNoteAdd, crPrivacyRegister,
  crPrivacyUpdate, crSettingsGet, crSettingsSave, crStaffMessageSend, type CrPrivacyKind, type CrSettingsInput,
} from "@/lib/criadores/db";
import { revealFinance } from "@/lib/criadores/crypto";
import { adminDeleteCreator } from "@/lib/criadores/emails";
import { PRIVACY_KIND_LABEL, retentionProblem, type FiscalData } from "@/lib/criadores-rules";
import { userMessage } from "@/lib/supabase";
import { requireCreatorsViewer } from "@/lib/viewer";

// Influenciadores (backoffice). Cada ação confirma o nível aqui (requireCreatorsViewer: "manage" para decidir e
// escrever, "finance" para revelar o IBAN; o Super Admin nas partes que só ele faz) e a BD volta a confirmar em cada
// função (cr_require, cr_finance, support_super). Os endereços de volta só levam ids e o resultado, nunca dados
// pessoais. As chamadas à BD passam sempre por lib/criadores/{db,crypto,emails}.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: FormDataEntryValue | null) => (typeof v === "string" && UUID.test(v) ? v : null);
const text = (v: FormDataEntryValue | null, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const go = (path: string, params: Record<string, string>): never => {
  const [base, hash] = path.split("#");
  redirect(`${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams(params)}${hash ? `#${hash}` : ""}`);
};
const ficha = (id: string, tab?: string) => `/influenciadores/criadores/${id}${tab ? `?tab=${tab}` : ""}`;

// Volta para a página de onde veio o formulário, só dentro de /influenciadores (nunca para fora do dashboard).
function back(form: FormData, fallback: string) {
  const v = text(form.get("back"), 300);
  return /^\/influenciadores(?:[/?#][^\s\\]*)?$/.test(v) && !v.includes("//") ? v : fallback;
}

// Super Admin: publicar documentos legais, definições, apagar contas e parar a plataforma.
async function superViewer(backTo: string) {
  const viewer = await requireCreatorsViewer("manage");
  if (!viewer.isSuper) go(backTo, { erro: "Só o Super Admin pode fazer isto." });
  return viewer;
}

// ---------------------------------------------------------------- ficha: decisões, notas, mensagens, números

const DECISIONS = ["approved", "rejected", "suspended", "pending_review", "restricted"] as const;
type Decision = (typeof DECISIONS)[number];
const NEEDS_REASON: readonly Decision[] = ["rejected", "suspended", "restricted"];

export async function setCreatorStatus(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const id = uuid(form.get("id"));
  if (!id) go("/influenciadores/criadores", { erro: "Criador inválido." });
  const status = text(form.get("status")) as Decision;
  if (!DECISIONS.includes(status)) go(ficha(id!), { erro: "Decisão inválida." });
  const reason = text(form.get("reason"), 1000);
  if (NEEDS_REASON.includes(status) && reason.length < 10) go(ficha(id!), { erro: "Explique o motivo (pelo menos 10 caracteres). O criador recebe-o por email." });
  try {
    await crCreatorStatus(viewer.session, id!, status, reason || null);
  } catch (e) {
    go(ficha(id!), { erro: userMessage(e) });
  }
  go(ficha(id!), { ok: `status_${status}` });
}

export async function addCreatorNote(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const id = uuid(form.get("id"));
  if (!id) go("/influenciadores/criadores", { erro: "Criador inválido." });
  const body = text(form.get("body"), 4000);
  if (!body) go(ficha(id!, "notas"), { erro: "Escreva a nota." });
  try {
    await crNoteAdd(viewer.session, id!, body);
  } catch (e) {
    go(ficha(id!, "notas"), { erro: userMessage(e) });
  }
  go(ficha(id!, "notas"), { ok: "note" });
}

export async function sendCreatorMessage(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const id = uuid(form.get("id"));
  if (!id) go("/influenciadores/criadores", { erro: "Criador inválido." });
  const body = text(form.get("body"), 4000);
  if (!body) go(ficha(id!, "mensagens"), { erro: "Escreva a mensagem." });
  try {
    await crStaffMessageSend(viewer.session, id!, body);
  } catch (e) {
    go(ficha(id!, "mensagens"), { erro: userMessage(e) });
  }
  go(ficha(id!, "mensagens"), { ok: "message" });
}

export async function validateCreatorMetric(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const id = uuid(form.get("id"));
  if (!id) go("/influenciadores/criadores", { erro: "Criador inválido." });
  const metric = Number(text(form.get("metric_id"), 20));
  if (!Number.isSafeInteger(metric) || metric <= 0) go(ficha(id!, "redes"), { erro: "Números inválidos." });
  try {
    await crDeclaredValidate(viewer.session, metric, form.get("ok") === "1");
  } catch (e) {
    go(ficha(id!, "redes"), { erro: userMessage(e) });
  }
  go(ficha(id!, "redes"), { ok: "metric" });
}

// ---------------------------------------------------------------- ficha: revelar os dados de pagamento (F8)

export type RevealState = {
  error?: string;
  data?: {
    at: number;
    iban: string | null;
    holder: string | null;
    fiscal: FiscalData | null;
    last4: string | null;
    changedAt: string | null;
    holdUntil: string | null;
    holderMismatch: boolean;
    pendingLast4: string | null;
    warning: string | null;
  };
};

// Com finanças, motivo e a palavra-passe de quem revela [rev. S-M8]. A resposta da ação não fica em cache (POST) e
// o formulário mostra os dados 60 s; a BD regista finance.reveal, limita a 20 por 24 h e avisa à 10.ª.
export async function revealCreatorFinance(_prev: RevealState, form: FormData): Promise<RevealState> {
  const viewer = await requireCreatorsViewer("finance");
  const id = uuid(form.get("id"));
  if (!id) return { error: "Criador inválido." };
  const reason = text(form.get("reason"), 300);
  if (reason.length < 5) return { error: "Indique o motivo (ex.: pagamento da campanha de Natal)." };
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  if (!password) return { error: "Escreva a sua palavra-passe do dashboard." };
  try {
    const r = await revealFinance(viewer.session, viewer.fullName || viewer.username, id, reason, form.get("oob") === "on", password);
    if (!r.ok)
      return {
        error:
          r.reason === "locked"
            ? "Demasiadas tentativas com a palavra-passe errada: a sua conta do dashboard fica bloqueada 15 minutos (também a entrada)."
            : "Palavra-passe errada. Ao fim de 5 tentativas, a sua conta fica bloqueada 15 minutos.",
      };
    return {
      data: {
        at: Date.now(),
        iban: r.iban?.iban ? r.iban.iban.replace(/(.{4})(?=.)/g, "$1 ") : null,
        holder: r.iban?.holder || null,
        fiscal: r.fiscal,
        last4: r.iban_last4,
        changedAt: r.iban_changed_at,
        holdUntil: r.iban_hold_until,
        holderMismatch: r.iban_holder_mismatch,
        pendingLast4: r.iban_pending_last4,
        warning: r.error,
      },
    };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

// ---------------------------------------------------------------- ficha: apagar (Super Admin)

// «Apagar» exige o pedido RGPD de apagamento aberto (identidade confirmada ou feito na plataforma) e respeita os
// bloqueios; «Apagar (menor de idade)» [rev. R-B3] não precisa de pedido nem espera pelas colaborações, mas exige um
// motivo com 10 ou mais caracteres. O aviso «conta apagada» sai para o email de antes da anonimização.
export async function deleteCreatorAccount(form: FormData) {
  const id = uuid(form.get("id"));
  if (!id) go("/influenciadores/criadores", { erro: "Criador inválido." });
  const backTo = ficha(id!, "notas");
  const viewer = await superViewer(backTo);
  const minor = form.get("mode") === "minor";
  const reason = text(form.get("reason"), 1000);
  const request = uuid(form.get("request_id"));
  if (form.get("confirm") !== "on") go(backTo, { erro: "Marque a confirmação: o apagamento não se pode desfazer." });
  if (minor && reason.length < 10) go(backTo, { erro: "Explique o motivo (pelo menos 10 caracteres)." });
  if (!minor && !request) go(backTo, { erro: "Escolha o pedido de apagamento desta pessoa (registe-o primeiro em Privacidade, se chegou por email)." });
  let sent = false;
  try {
    sent = (await adminDeleteCreator(viewer.session, id!, reason, request, minor)).emailSent;
  } catch (e) {
    go(backTo, { erro: userMessage(e) });
  }
  go(ficha(id!, "notas"), { ok: sent ? "deleted" : "deleted_no_email" });
}

// ---------------------------------------------------------------- pedidos RGPD (rev. R-B2)

const PRIVACY_KINDS = Object.keys(PRIVACY_KIND_LABEL) as CrPrivacyKind[];

// Data do formulário (AAAA-MM-DD, hora de Lisboa): hoje → agora (null); outro dia → meio-dia desse dia. A BD aceita
// entre há 30 dias e agora.
function receivedAt(v: string): string | null | undefined {
  if (!v) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return undefined;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  if (v === today) return null;
  if (v > today) return undefined;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export async function registerPrivacyRequest(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const backTo = back(form, "/influenciadores/privacidade");
  const kind = text(form.get("kind")) as CrPrivacyKind;
  if (!PRIVACY_KINDS.includes(kind)) go(backTo, { erro: "Escolha o tipo de pedido." });
  const channel = text(form.get("channel")) === "staff" ? "staff" : "email";
  const when = receivedAt(text(form.get("received_on"), 10));
  if (when === undefined) go(backTo, { erro: "A data de receção tem de estar entre há 30 dias e hoje." });
  const requester = text(form.get("requester"), 300);
  const details = text(form.get("details"), 4000);
  let creatorId = uuid(form.get("creator_id"));
  const email = text(form.get("creator_email"), 254).toLowerCase();
  if (!creatorId && email) {
    let found: string | null = null;
    try {
      found = (await crCreatorsList(viewer.session, { q: email })).items.find((c) => c.email.toLowerCase() === email)?.id || null;
    } catch (e) {
      go(backTo, { erro: userMessage(e) });
    }
    if (!found)
      go(backTo, { erro: "Não há nenhuma conta com este email. Se o pedido é de alguém sem conta, deixe o email em branco e preencha «Quem fez o pedido»." });
    creatorId = found;
  }
  if (!creatorId && requester.length < 3) go(backTo, { erro: "Indique o email da conta ou, para alguém sem conta, quem fez o pedido (nome e contacto)." });
  try {
    await crPrivacyRegister(viewer.session, {
      creatorId, kind, channel, details, receivedAt: when ?? null, requester: requester || null, identityOk: form.get("identity_ok") === "on",
    });
  } catch (e) {
    go(backTo, { erro: userMessage(e) });
  }
  go(creatorId ? ficha(creatorId, "notas") : "/influenciadores/privacidade", { ok: "privacy_registered" });
}

// Um pedido: confirmar a identidade, prorrogar (uma vez, com motivo, dentro do primeiro mês) ou fechar com resposta.
export async function updatePrivacyRequest(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const backTo = back(form, "/influenciadores/privacidade");
  const id = uuid(form.get("id"));
  if (!id) go(backTo, { erro: "Pedido inválido." });
  const op = text(form.get("op"));
  let update: Parameters<typeof crPrivacyUpdate>[2];
  let ok: string;
  if (op === "identity") {
    update = { identityOk: form.get("identity_ok") === "1" };
    ok = "privacy_identity";
  } else if (op === "extend") {
    const reason = text(form.get("extend_reason"), 1000);
    if (reason.length < 10) go(backTo, { erro: "Explique o motivo da prorrogação (pelo menos 10 caracteres). O titular recebe-o por email." });
    update = { extendReason: reason };
    ok = "privacy_extended";
  } else if (op === "close") {
    const response = text(form.get("response"), 4000);
    if (response.length < 5) go(backTo, { erro: "Escreva a resposta dada ao titular." });
    update = { status: text(form.get("status")) === "refused" ? "refused" : "done", response };
    ok = "privacy_closed";
  } else {
    return go(backTo, { erro: "Ação inválida." });
  }
  try {
    await crPrivacyUpdate(viewer.session, id!, update);
  } catch (e) {
    go(backTo, { erro: userMessage(e) });
  }
  go(backTo, { ok });
}

// ---------------------------------------------------------------- definições (Super Admin)

const COMPANY_KEYS = ["company_name", "company_nif", "company_address", "company_registry", "contact_email", "privacy_email"] as const;

// Só as chaves que mudaram vão para a BD (ldo_cr_settings_save grava as presentes); os prazos vão sempre completos.
export async function saveCreatorsSettings(form: FormData) {
  const backTo = "/influenciadores/definicoes";
  const viewer = await superViewer(backTo);
  const section = text(form.get("section"));
  const hash = section === "retention" ? "prazos" : section === "access" ? "inscricoes" : "identificacao";
  let current;
  try {
    current = await crSettingsGet(viewer.session);
  } catch (e) {
    go(`${backTo}#${hash}`, { erro: userMessage(e) });
  }
  const s = current!;
  const data: CrSettingsInput = {};
  if (section === "company") {
    for (const k of COMPANY_KEYS) {
      let v = text(form.get(k), k === "company_address" ? 400 : k.endsWith("email") ? 254 : 200);
      if (k === "company_nif") v = v.replace(/\s/g, "");
      if (k.endsWith("email")) v = v.toLowerCase();
      if (v !== (s[k] ?? "")) data[k] = v;
    }
    if (data.company_nif !== undefined && !/^([0-9]{9})?$/.test(data.company_nif)) go(`${backTo}#${hash}`, { erro: "O NIF da empresa tem 9 algarismos." });
  } else if (section === "access") {
    const open = form.get("registrations_open") === "on";
    const days = Number(text(form.get("session_days"), 4));
    const hold = Number(text(form.get("iban_hold_hours"), 4));
    if (!Number.isInteger(days) || days < 1 || days > 30) go(`${backTo}#${hash}`, { erro: "A sessão dos criadores dura entre 1 e 30 dias." });
    if (!Number.isInteger(hold) || hold < 0 || hold > 336) go(`${backTo}#${hash}`, { erro: "A espera do IBAN vai de 0 a 336 horas." });
    if (open !== s.registrations_open) data.registrations_open = open;
    if (days !== s.session_days) data.session_days = days;
    if (hold !== s.iban_hold_hours) data.iban_hold_hours = hold;
  } else if (section === "retention") {
    // [rev. S-B6] Todas as chaves que a BD tem, inteiras, entre o piso e o teto (a mesma regra de ldo_cr_settings_save).
    const keys = Object.keys(s.retention || {});
    const retention: Record<string, number> = {};
    for (const k of keys) {
      const raw = text(form.get(`ret_${k}`), 8);
      retention[k] = raw === "" ? Number.NaN : Number(raw);
    }
    const problem = retentionProblem(retention, keys);
    if (problem) go(`${backTo}#${hash}`, { erro: problem });
    if (keys.some((k) => retention[k] !== s.retention[k])) data.retention = retention;
  } else {
    go(backTo, { erro: "Secção inválida." });
  }
  if (!Object.keys(data).length) go(`${backTo}#${hash}`, { ok: "settings_unchanged" });
  try {
    await crSettingsSave(viewer.session, data);
  } catch (e) {
    go(`${backTo}#${hash}`, { erro: userMessage(e) });
  }
  go(`${backTo}#${hash}`, { ok: "settings" });
}

// ---------------------------------------------------------------- documentos legais

const LEGAL_KINDS = ["terms", "privacy", "cookies", "meta_data"] as const;

// Rascunhos: quem gere. id vazio = rascunho novo (o tipo só se escolhe ao criar).
export async function saveLegalDocument(form: FormData) {
  const viewer = await requireCreatorsViewer("manage");
  const backTo = "/influenciadores/definicoes#documentos";
  const id = uuid(form.get("id"));
  const kind = text(form.get("kind")) as (typeof LEGAL_KINDS)[number];
  if (!id && !LEGAL_KINDS.includes(kind)) go(backTo, { erro: "Escolha o tipo de documento." });
  const body = typeof form.get("body") === "string" ? String(form.get("body")).replace(/\r\n/g, "\n").slice(0, 200000) : "";
  let saved = "";
  try {
    saved = await crLegalSave(viewer.session, id, {
      ...(id ? {} : { kind }),
      version: text(form.get("version"), 10),
      title: text(form.get("title"), 200),
      body,
      changes_summary: text(form.get("changes_summary"), 2000) || null,
      requires_reacceptance: form.get("requires_reacceptance") === "on",
    });
  } catch (e) {
    go(backTo, { erro: userMessage(e) });
  }
  go(`/influenciadores/definicoes#doc-${saved}`, { ok: id ? "legal_saved" : "legal_created" });
}

// Publicar (Super Admin): retira a versão anterior e avisa os criadores (Termos com nova aceitação e Política).
export async function publishLegalDocument(form: FormData) {
  const backTo = "/influenciadores/definicoes#documentos";
  const viewer = await superViewer(backTo);
  const id = uuid(form.get("id"));
  if (!id) go(backTo, { erro: "Documento inválido." });
  if (form.get("confirm") !== "on") go(`/influenciadores/definicoes#doc-${id}`, { erro: "Marque a confirmação de que o texto foi revisto antes de publicar." });
  let notified = 0;
  try {
    notified = (await crLegalPublish(viewer.session, id!)).notified;
  } catch (e) {
    go(`/influenciadores/definicoes#doc-${id}`, { erro: userMessage(e) });
  }
  go(`/influenciadores/definicoes#doc-${id}`, { ok: "legal_published", n: String(notified) });
}

// ---------------------------------------------------------------- incidente (rev. R-M14)

// «Parar a plataforma»: termina todas as sessões dos criadores e fecha as inscrições (incident.lockdown).
export async function lockdownPlatform(form: FormData) {
  const backTo = "/influenciadores/definicoes#incidente";
  const viewer = await superViewer(backTo);
  const reason = text(form.get("reason"), 500);
  if (reason.length < 10) go(backTo, { erro: "Indique o motivo (pelo menos 10 caracteres): fica na auditoria do incidente." });
  if (form.get("confirm") !== "on") go(backTo, { erro: "Marque a confirmação para parar a plataforma." });
  let n = 0;
  try {
    n = (await crLockdown(viewer.session, reason)).sessions_revoked;
  } catch (e) {
    go(backTo, { erro: userMessage(e) });
  }
  go(backTo, { ok: "lockdown", n: String(n) });
}
