import "server-only";
import { rpc } from "@/lib/supabase";
import { supabaseConfig } from "@/lib/session";
import type { ConsentPurpose, CreatorOutboxItem, CreatorStatus, FiscalData } from "@/lib/criadores-rules";

// Chamadas tipadas às funções ldo_cr_* da migração A (supabase/migrations/20261105100000_ldo_creators_a.sql, §2.4).
// As páginas e as actions nunca chamam o Supabase diretamente: usam estas funções (ou os fluxos de emails.ts e
// crypto.ts, que juntam a cifra e os emails).
// - Site e servidor: p_token = CREATORS_SERVER_TOKEN [rev. S-M3] (nunca o BI_INGEST_TOKEN do apoio, do leilão e do
//   BI). A BD guarda só o SHA-256 em ldo_private.cr_token; sem essa linha, todas recusam (42501).
// - Site: p_session = token do cookie do criador (lib/criadores/site.ts: creatorSession()).
// - Equipa: p_session = viewer.session (cookie ldo_session do dashboard); a BD confirma o nível em cada função.
// - p_ip_hash = ipHash() de lib/criadores/site.ts (64 hex, ou null).
// Os erros chegam como SupabaseError (lib/supabase.ts) com 42501, 22023 ou P0002 e texto em pt-PT para mostrar com
// userMessage(). As recusas que ficam gravadas (palavra-passe errada, bloqueios, limites) não são erros: vêm como
// { ok: false, reason }.

// ---------------------------------------------------------------- ligação

export function creatorsServerConfigured() {
  const c = supabaseConfig();
  return Boolean(c.url && c.key && process.env.CREATORS_SERVER_TOKEN);
}

// Funções de site e de servidor (1.º parâmetro p_token).
export function crServerRpc<T>(fn: string, args: Record<string, unknown> = {}) {
  const token = process.env.CREATORS_SERVER_TOKEN;
  if (!token) throw new Error("Ligação da plataforma de criadores ao Supabase por configurar (CREATORS_SERVER_TOKEN).");
  return rpc<T>(fn, { p_token: token, ...args });
}

// Funções da equipa (1.º parâmetro p_session, a sessão do dashboard).
export function crStaffRpc<T>(session: string, fn: string, args: Record<string, unknown> = {}) {
  return rpc<T>(fn, { p_session: session, ...args });
}

type Ip = string | null;
type Iso = string;

// ---------------------------------------------------------------- tipos comuns

export type CrSteps = { about: boolean; contacts: boolean; content: boolean; networks: boolean; complete: boolean };
export type CrConsentState = Partial<Record<ConsentPurpose, { granted: boolean; at: Iso; document_id: string | null }>>;
export type CrPrivacyPending = { id: string; version: string; changes_summary: string | null } | null;
export type CrPlatform = "instagram" | "tiktok" | "youtube" | "facebook" | "pinterest" | "outra";
export type CrVerification = "declared" | "public" | "verified" | "revoked";
export type CrLegalKind = "terms" | "privacy" | "cookies" | "meta_data" | "campaign_conditions";
export type CrPrivacyKind =
  | "access" | "portability" | "rectification" | "erasure" | "objection" | "restriction" | "human_review" | "withdrawal" | "other";
export type CrPrivacyChannel = "self_service" | "email" | "meta_callback" | "staff";
export type CrPrivacyStatus = "open" | "done" | "refused";
export type CrMetricsInput = {
  followers?: number | string | null; avg_views?: number | string | null; avg_likes?: number | string | null;
  avg_comments?: number | string | null; pt_audience_pct?: number | string | null; engagement_pct?: number | string | null;
};
export type CrCompany = { company_name: string; company_nif: string; company_address: string; company_registry: string; contact_email: string; privacy_email: string } & Record<string, unknown>;

// ---------------------------------------------------------------- site: contas

export type CrRegisterResult = { status: "created" | "pending"; verify_token: string } | { status: "exists" } | { status: "quiet" };
export type CrRegisterTexts = { terms: string; privacy_notice: string; adult: string };

// Preferir registerCreator() de lib/criadores/emails.ts (textos, palavra-passe exposta, email em after()).
export const crRegister = (a: {
  email: string; password: string; name: string; termsDoc: string; privacyDoc: string; adult: boolean; texts: CrRegisterTexts; ip: Ip;
}) => crServerRpc<CrRegisterResult>("ldo_cr_register", {
  p_email: a.email, p_password: a.password, p_name: a.name, p_terms_doc: a.termsDoc, p_privacy_doc: a.privacyDoc,
  p_adult: a.adult, p_texts: a.texts, p_ip_hash: a.ip,
});

export type CrVerifyResult = { ok: true } | { ok: false; reason: "expired" | "password" | "locked" };
export const crVerifyEmail = (verifyToken: string, password: string, ip: Ip) =>
  crServerRpc<CrVerifyResult>("ldo_cr_verify_email", { p_verify: verifyToken, p_password: password, p_ip_hash: ip });

export type CrLoginResult =
  | { ok: true; session: string; expires_at: Iso }
  | { ok: false; reason: "locked" | "invalid" }
  | { ok: false; reason: "unverified"; email?: string; verify_token?: string };
export const crLogin = (email: string, password: string, ip: Ip) =>
  crServerRpc<CrLoginResult>("ldo_cr_login", { p_email: email, p_password: password, p_ip_hash: ip });

export const crLogout = (session: string) => crServerRpc<null>("ldo_cr_logout", { p_session: session });

export type CrResetRequestResult = { ok: true; email?: string; reset_token?: string } | { ok: false; reason: "rate" };
export const crResetRequest = (email: string, ip: Ip) =>
  crServerRpc<CrResetRequestResult>("ldo_cr_reset_request", { p_email: email, p_ip_hash: ip });

export type CrResetResult = { ok: true } | { ok: false; reason: "expired" };
export const crReset = (resetToken: string, password: string) =>
  crServerRpc<CrResetResult>("ldo_cr_reset", { p_reset: resetToken, p_password: password });

export type CrPasswordChangeResult = { ok: true; session: string; expires_at: Iso } | { ok: false; reason: "password" };
export const crPasswordChange = (session: string, oldPassword: string, newPassword: string, ip: Ip) =>
  crServerRpc<CrPasswordChangeResult>("ldo_cr_password_change", { p_session: session, p_old: oldPassword, p_new: newPassword, p_ip_hash: ip });

export const crReauth = (session: string, password: string, ip: Ip) =>
  crServerRpc<boolean>("ldo_cr_reauth", { p_session: session, p_password: password, p_ip_hash: ip });

// ---------------------------------------------------------------- site: estado, perfil e redes

export type CrTask =
  | { kind: "reaccept_terms" }
  | { kind: "privacy_notice"; version: string }
  | { kind: "complete_profile"; steps: CrSteps }
  | { kind: "submit_profile" }
  | { kind: "iban_confirm"; last4: string };

export type CrMe = {
  id: string; email: string; status: CreatorStatus; status_reason: string | null; status_at: Iso | null; created_at: Iso;
  full_name: string | null; display_name: string | null; first_name: string | null; submitted_at: Iso | null;
  onboarding: CrSteps; consents: CrConsentState; reaccept: "terms"[]; privacy_notice_pending: CrPrivacyPending;
  unread_messages: number; iban_pending_last4: string | null; tasks: CrTask[];
  notifications: { kind: string; payload: Record<string, unknown> | null; created_at: Iso }[];
};
// null sem sessão válida.
export const crMe = (session: string) => (session ? crServerRpc<CrMe | null>("ldo_cr_me", { p_session: session }) : Promise.resolve(null));

export type CrDeclaredMetrics = {
  declared_on: string; followers: number | null; avg_views: number | null; avg_likes: number | null; avg_comments: number | null;
  pt_audience_pct: number | null; engagement_pct: number | null; validated: boolean;
};
export type CrSocialAccount = {
  id: string; platform: CrPlatform; handle: string; profile_url: string | null; verification: CrVerification; updated_at: Iso;
  metrics: CrDeclaredMetrics | null;
};
export type CrProfile = {
  full_name: string | null; display_name: string | null; city: string | null; district: string | null; country: string | null;
  bio: string | null; categories: string[]; formats: string[]; languages: string[]; travel_radius_km: number | null;
  portfolio_url: string | null; submitted_at: Iso | null; updated_at: Iso;
};
export type CrProfileGet = {
  status: CreatorStatus; profile: CrProfile | null;
  contacts: { phone: string | null; whatsapp: boolean; preferred: "email" | "telefone" | "whatsapp" | null } | null;
  store_ids: string[]; available_stores: { id: string; code: string; name: string; city: string | null }[];
  social_accounts: CrSocialAccount[]; steps: CrSteps;
};
export const crProfileGet = (session: string) => crServerRpc<CrProfileGet>("ldo_cr_profile_get", { p_session: session });

// Listas já filtradas com pickAllowed (lib/criadores-rules.ts); a BD só confirma o formato e o tamanho.
export type CrProfileStep =
  | { step: "about"; data: { full_name: string; display_name?: string | null; city: string; district?: string | null; country: string; bio?: string | null; languages: string[] } }
  | { step: "contacts"; data: { phone: string | null; whatsapp: boolean; preferred: "email" | "telefone" | "whatsapp" } }
  | { step: "content"; data: { categories: string[]; formats: string[]; store_ids: string[]; travel_radius_km?: number | null; portfolio_url?: string | null } }
  | { step: "networks"; data: { accounts: CrSocialInput[] } };
export const crProfileSave = (session: string, s: CrProfileStep) =>
  crServerRpc<CrSteps>("ldo_cr_profile_save", { p_session: session, p_step: s.step, p_data: s.data });

// texto = consentText("data_truth") (nunca do FormData, rev. R-B1).
export const crProfileSubmit = (session: string, dataTruthText: string, ip: Ip) =>
  crServerRpc<{ ok: true; status: "pending_review" }>("ldo_cr_profile_submit", { p_session: session, p_text: dataTruthText, p_ip_hash: ip });

export type CrSocialInput = { id?: string; platform: CrPlatform; handle: string; profile_url?: string | null; metrics?: CrMetricsInput | null };
export const crSocialSave = (session: string, data: CrSocialInput) =>
  crServerRpc<{ id: string; platform: CrPlatform; handle: string; verification: CrVerification }>("ldo_cr_social_save", { p_session: session, p_data: data });
export const crSocialDelete = (session: string, id: string) => crServerRpc<null>("ldo_cr_social_delete", { p_session: session, p_id: id });

// ---------------------------------------------------------------- site: pagamentos (preferir os fluxos de crypto.ts)

export type CrFinanceGet = {
  fiscal_ct: string | null; fiscal_complete: boolean; iban_last4: string | null; iban_country: string | null;
  iban_changed_at: Iso | null; iban_hold_until: Iso | null; iban_pending_last4: string | null; iban_pending_at: Iso | null;
  declarations: { vat_exempt: { granted: boolean; at: Iso } | null; withholding_waiver: { granted: boolean; at: Iso } | null };
} | null;
export const crFinanceGet = (session: string) => crServerRpc<CrFinanceGet>("ldo_cr_finance_get", { p_session: session });

export type CrFinanceSaveData = {
  fiscal_ct?: string; fiscal_complete?: boolean; iban_ct?: string; iban_last4?: string; iban_country?: string; holder_mismatch?: boolean;
  declarations?: { vat_exempt?: boolean; withholding_waiver?: boolean };
  texts: { iban_owner: string; vat_exempt: string; withholding_waiver: string };
};
export type CrFinanceSaveResult =
  | { ok: false; reason: "password" | "rate" } // rate: 3 IBAN novos/reenvios por hora (partilha o limite de ldo_cr_iban_resend)
  | { ok: true; iban_pending: boolean; pending_last4: string | null; confirm_token: string | null; email: string };
export const crFinanceSave = (session: string, password: string, data: CrFinanceSaveData, ip: Ip) =>
  crServerRpc<CrFinanceSaveResult>("ldo_cr_finance_save", { p_session: session, p_password: password, p_data: data, p_ip_hash: ip });

export type CrIbanConfirmResult =
  | { ok: true; confirmed: true; last4: string; hold_until: Iso }
  | { ok: true; confirmed: false; reset_token: string }
  | { ok: false; reason: "expired" | "nothing_pending" | "suspended" }; // suspended: conta suspensa, o IBAN não muda
// Sem sessão (o token do email prova o acesso à caixa). «Não fui eu» (accept = false) → levar a
// `${siteBase()}/conta/nova-palavra-passe#t=${reset_token}`.
export const crIbanConfirm = (confirmToken: string, accept: boolean, ip: Ip) =>
  crServerRpc<CrIbanConfirmResult>("ldo_cr_iban_confirm", { p_confirm: confirmToken, p_accept: accept, p_ip_hash: ip });

export type CrIbanResendResult = { ok: true; confirm_token: string; pending_last4: string; email: string } | { ok: false; reason: "nothing_pending" | "rate" };
// Preferir resendIbanConfirm() de emails.ts (envia o email na hora).
export const crIbanResend = (session: string, ip: Ip) => crServerRpc<CrIbanResendResult>("ldo_cr_iban_resend", { p_session: session, p_ip_hash: ip });

// ---------------------------------------------------------------- site: consentimentos, legal, mensagens, RGPD

// No PR1 só 'campaign_news'. texto = consentText(purpose).
export const crConsentSet = (session: string, purpose: "campaign_news", granted: boolean, text: string, ip: Ip) =>
  crServerRpc<CrConsentState>("ldo_cr_consent_set", { p_session: session, p_purpose: purpose, p_granted: granted, p_text: text, p_ip_hash: ip });

export type CrLegalDoc = { id: string; kind: CrLegalKind; version: string; title: string; body: string; changes_summary: string | null; published_at: Iso };
export type CrLegalPublicOne = { company: CrCompany; registrations_open: boolean; document: CrLegalDoc | null };
export type CrLegalPublicAll = { company: CrCompany; registrations_open: boolean; documents: Pick<CrLegalDoc, "id" | "kind" | "version" | "title" | "published_at">[] };
// Sem sessão (páginas legais e registo).
export function crLegalPublic(kind: Exclude<CrLegalKind, "campaign_conditions">): Promise<CrLegalPublicOne>;
export function crLegalPublic(kind: null): Promise<CrLegalPublicAll>;
export function crLegalPublic(kind: string | null) {
  return crServerRpc<CrLegalPublicOne | CrLegalPublicAll>("ldo_cr_legal_public", { p_kind: kind });
}

// Termos → texto consentText("terms", {versao}); Política → privacyNoticeUpdateText(versao).
export const crLegalAccept = (session: string, documentId: string, text: string, ip: Ip) =>
  crServerRpc<{ reaccept: "terms"[]; privacy_notice_pending: CrPrivacyPending }>("ldo_cr_legal_accept", {
    p_session: session, p_doc: documentId, p_text: text, p_ip_hash: ip,
  });

export type CrMessage = { id: number; author: "creator" | "staff" | "system"; body: string; ref_kind: string | null; ref_id: string | null; created_at: Iso; read_by_staff_at: Iso | null };
export const crMessagesList = (session: string) => crServerRpc<CrMessage[]>("ldo_cr_messages_list", { p_session: session });
// No PR1 só ref 'geral' ou nenhuma.
export const crMessageSend = (session: string, body: string, refKind: string | null = null, refId: string | null = null) =>
  crServerRpc<{ id: number; created_at: Iso }>("ldo_cr_message_send", { p_session: session, p_body: body, p_ref_kind: refKind, p_ref_id: refId });

export const crPrivacyRequest = (session: string, kind: "objection" | "restriction" | "human_review" | "rectification" | "other", details: string) =>
  crServerRpc<string>("ldo_cr_privacy_request", { p_session: session, p_kind: kind, p_details: details });

export type CrExportData = {
  exported_at: Iso; account: { id: string; email: string } & Record<string, unknown>;
  finance: ({ fiscal_ct: string | null; iban_ct: string | null; fiscal_complete: boolean; iban_last4: string | null } & Record<string, unknown>) | null;
} & Record<string, unknown>;
export type CrExportResult = { ok: false; reason: "password" | "rate" } | { ok: true; data: CrExportData };
// Preferir exportMyData() de crypto.ts (decifra os dados fiscais e o IBAN do próprio).
export const crExport = (session: string, password: string, ip: Ip) =>
  crServerRpc<CrExportResult>("ldo_cr_export", { p_session: session, p_password: password, p_ip_hash: ip });

export const crDeleteCheck = (session: string) =>
  crServerRpc<{ blocked: string | null; first_name: string | null; email: string }>("ldo_cr_delete_check", { p_session: session });
export type CrDeleteResult = { ok: true } | { ok: false; reason: "password" } | { ok: false; reason: "blocked"; detail: string; request_id: string };
// Preferir deleteMyAccount() de emails.ts (envia «conta apagada» antes de apagar).
export const crDeleteAccount = (session: string, password: string, ip: Ip) =>
  crServerRpc<CrDeleteResult>("ldo_cr_delete_account", { p_session: session, p_password: password, p_ip_hash: ip });

// ---------------------------------------------------------------- equipa (backoffice)

export type CrOverview = {
  profiles_pending: number; profiles_changed: number; creators_active: number; creators_approved: number; messages_unread: number;
  privacy_open: number; privacy_due_soon: number; privacy_overdue: number; iban_hold: number; iban_pending: number;
  iban_rejected_30d: number; erasure_waiting: number; erasure_ready: number; registrations_open: boolean;
  legal_published: Partial<Record<CrLegalKind, string>>;
};
export const crOverview = (session: string) => crStaffRpc<CrOverview>(session, "ldo_cr_overview");

export type CrCreatorsFilter = {
  status?: CreatorStatus; q?: string; store_id?: string; platform?: CrPlatform; verified?: "true" | "false"; changed?: "true";
  page?: number; order?: "created" | "name";
};
export type CrCreatorRow = {
  id: string; email: string; full_name: string | null; display_name: string | null; city: string | null; district: string | null;
  status: CreatorStatus; changed_since_review: boolean; created_at: Iso; submitted_at: Iso | null; last_login_at: Iso | null;
  stores_count: number; unread_messages: number; iban_pending: boolean;
  networks: { id: string; platform: CrPlatform; handle: string; verification: CrVerification; followers: number | null; followers_source: "validated" | "declared"; followers_on: string | null }[];
};
export const crCreatorsList = (session: string, filter: CrCreatorsFilter = {}) =>
  crStaffRpc<{ total: number; page: number; page_size: number; items: CrCreatorRow[] }>(session, "ldo_cr_creators_list", { p_filter: filter });

export type CrStaffMessage = {
  id: number; author_kind: "creator" | "staff" | "system"; author: string | null; body: string; ref_kind: string | null; ref_id: string | null;
  created_at: Iso; read_by_creator_at: Iso | null; read_by_staff_at: Iso | null;
};
export type CrPrivacyRequestRow = {
  id: string; creator_id: string | null; creator_email?: string | null; creator_name?: string | null; creator_deleted?: boolean;
  kind: CrPrivacyKind; channel: CrPrivacyChannel; status: CrPrivacyStatus; received_at: Iso; due_at: Iso; extended_until: Iso | null;
  extension_reason: string | null; effective_due: Iso; details: string | null; response: string | null; requester: string | null;
  identity_checked: boolean; handled_by: string | null; handled_at: Iso | null;
};
// Ficha (nunca *_ct). Os blocos variáveis ficam abertos (Record) para as migrações B e C juntarem campos.
export type CrCreatorGet = {
  viewer: { level: "view" | "manage"; finance: boolean; super: boolean };
  creator: {
    id: string; email: string; status: CreatorStatus; status_reason: string | null; status_at: Iso | null; status_by: string | null;
    changed_since_review: boolean; created_at: Iso; email_verified_at: Iso | null; adult_declared_at: Iso | null; last_login_at: Iso | null;
    inactivity_warned_at: Iso | null; deleted_at: Iso | null; delete_reason: string | null;
  };
  profile: (CrProfile & Record<string, unknown>) | null;
  steps: CrSteps;
  contacts: { phone: string | null; whatsapp: boolean; preferred: string | null; updated_at: Iso } | null;
  stores: { id: string; code: string; name: string }[];
  social_accounts: (Omit<CrSocialAccount, "metrics"> & { created_at: Iso; shared_with: number } & {
    metrics: (Omit<CrDeclaredMetrics, "validated"> & { id: number; evidence_file_id: string | null; validated_at: Iso | null; validated_by: string | null })[];
  })[];
  consents: {
    current: CrConsentState;
    history: { id: number; purpose: ConsentPurpose; granted: boolean; document_id: string | null; document_version: string | null; context: Record<string, unknown>; text_shown: string; text_hash: string; created_at: Iso }[];
  };
  notes: { id: number; body: string; created_at: Iso; author: string | null }[];
  messages: CrStaffMessage[];
  finance: {
    fiscal_complete: boolean; iban_last4: string | null; iban_country: string | null; iban_changed_at: Iso | null; iban_hold_until: Iso | null;
    iban_hold: boolean; iban_holder_mismatch: boolean; iban_pending_last4: string | null; iban_pending_at: Iso | null;
    iban_pending_holder_mismatch: boolean; updated_at: Iso;
  } | null;
  audit: { id: number; actor_kind: string; staff: string | null; action: string; target: string | null; details: Record<string, unknown>; created_at: Iso }[];
  privacy_requests: Pick<CrPrivacyRequestRow,
    "id" | "kind" | "channel" | "status" | "received_at" | "due_at" | "extended_until" | "effective_due" | "identity_checked" | "details" | "response" | "handled_at">[];
  delete_blocker: string | null;
};
export const crCreatorGet = (session: string, id: string) => crStaffRpc<CrCreatorGet>(session, "ldo_cr_creator_get", { p_id: id });

// Motivo com 10 ou mais caracteres em rejected/suspended/restricted.
export const crCreatorStatus = (session: string, id: string, status: Exclude<CreatorStatus, "draft" | "deleted">, reason: string | null) =>
  crStaffRpc<{ ok: true; status: CreatorStatus }>(session, "ldo_cr_creator_status", { p_id: id, p_status: status, p_reason: reason });
export const crNoteAdd = (session: string, id: string, body: string) => crStaffRpc<number>(session, "ldo_cr_note_add", { p_id: id, p_body: body });
export const crStaffMessages = (session: string, id: string) => crStaffRpc<CrStaffMessage[]>(session, "ldo_cr_staff_messages", { p_id: id });
export const crStaffMessageSend = (session: string, id: string, body: string, refKind: string | null = null, refId: string | null = null) =>
  crStaffRpc<{ id: number; created_at: Iso }>(session, "ldo_cr_staff_message_send", { p_id: id, p_body: body, p_ref_kind: refKind, p_ref_id: refId });
export const crDeclaredValidate = (session: string, metricId: number, ok: boolean) =>
  crStaffRpc<{ ok: true; validated: boolean }>(session, "ldo_cr_declared_validate", { p_metric_id: metricId, p_ok: ok });

export type CrRevealResult =
  | { ok: false; reason: "password" | "locked" }
  | {
      ok: true; alert: boolean; fiscal_ct: string | null; iban_ct: string | null; iban_last4: string | null; iban_changed_at: Iso | null;
      iban_hold_until: Iso | null; iban_holder_mismatch: boolean; iban_pending_last4: string | null;
    };
// Preferir revealFinance() de crypto.ts (decifra, e avisa os Super Admin à 10.ª revelação).
export const crFinanceReveal = (session: string, creatorId: string, reason: string, oobConfirmed: boolean, password: string) =>
  crStaffRpc<CrRevealResult>(session, "ldo_cr_finance_reveal", {
    p_creator: creatorId, p_reason: reason, p_oob_confirmed: oobConfirmed, p_password: password,
  });

export type CrSettings = CrCompany & {
  registrations_open: boolean; session_days: number; iban_hold_hours: number; retention: Record<string, number>;
  updated_at: Iso; updated_by: string | null; can_edit: boolean; retention_limits: Record<string, { min: number; max: number }>;
};
export const crSettingsGet = (session: string) => crStaffRpc<CrSettings>(session, "ldo_cr_settings_get");
// Só as chaves alteradas; retention sempre completo (validar antes com retentionProblem). Super Admin.
export type CrSettingsInput = Partial<Pick<CrSettings,
  "company_name" | "company_nif" | "company_address" | "company_registry" | "contact_email" | "privacy_email" | "registrations_open" | "session_days" | "iban_hold_hours" | "retention">>;
export const crSettingsSave = (session: string, data: CrSettingsInput) => crStaffRpc<CrSettings>(session, "ldo_cr_settings_save", { p_data: data });

export type CrLegalRow = {
  id: string; kind: CrLegalKind; version: string; title: string; body: string; changes_summary: string | null;
  status: "draft" | "published" | "retired"; requires_reacceptance: boolean; published_at: Iso | null; published_by: string | null;
  created_at: Iso; created_by: string | null; accepted_count: number;
};
export const crLegalList = (session: string) => crStaffRpc<CrLegalRow[]>(session, "ldo_cr_legal_list");
// id null = novo rascunho (kind só ao criar).
export const crLegalSave = (session: string, id: string | null, data: {
  kind?: Exclude<CrLegalKind, "campaign_conditions">; version: string; title: string; body: string; changes_summary?: string | null; requires_reacceptance?: boolean;
}) => crStaffRpc<string>(session, "ldo_cr_legal_save", { p_id: id, p_data: data });
export const crLegalPublish = (session: string, id: string) =>
  crStaffRpc<{ ok: true; notified: number; retired: number }>(session, "ldo_cr_legal_publish", { p_id: id });

// status: '' ou 'all' = todos.
export const crPrivacyList = (session: string, status: CrPrivacyStatus | "all" | "" = "") =>
  crStaffRpc<CrPrivacyRequestRow[]>(session, "ldo_cr_privacy_list", { p_status: status });
export const crPrivacyUpdate = (session: string, id: string, u: {
  status?: CrPrivacyStatus | null; response?: string | null; extendReason?: string | null; identityOk?: boolean | null;
}) => crStaffRpc<{ id: string; status: CrPrivacyStatus; identity_checked: boolean; extended_until: Iso | null; effective_due: Iso }>(
  session, "ldo_cr_privacy_update", {
    p_id: id, p_status: u.status ?? null, p_response: u.response ?? null, p_extend: u.extendReason ?? null, p_identity_ok: u.identityOk ?? null,
  });
export const crPrivacyRegister = (session: string, r: {
  creatorId: string | null; kind: CrPrivacyKind; channel: "email" | "staff"; details: string; receivedAt: Iso | null; requester: string | null; identityOk: boolean;
}) => crStaffRpc<string>(session, "ldo_cr_privacy_register", {
  p_creator: r.creatorId, p_kind: r.kind, p_channel: r.channel, p_details: r.details, p_received_at: r.receivedAt,
  p_requester: r.requester, p_identity_ok: r.identityOk,
});

// Só por POST (rota app/api/influenciadores/export/[id]); nada cifrado no resultado.
export const crAdminExport = (session: string, creatorId: string, requestId: string) =>
  crStaffRpc<Record<string, unknown> & { request_id: string; send_to: string }>(session, "ldo_cr_admin_export", { p_id: creatorId, p_request: requestId });
// Preferir adminDeleteCreator() de emails.ts (envia «conta apagada» ao endereço de antes). Super Admin.
export const crAdminDelete = (session: string, creatorId: string, reason: string, requestId: string | null, minor: boolean) =>
  crStaffRpc<{ ok: true; email: string | null; first_name: string | null }>(session, "ldo_cr_admin_delete", {
    p_id: creatorId, p_reason: reason, p_request: requestId, p_minor: minor,
  });
export const crLockdown = (session: string, reason: string) => crStaffRpc<{ sessions_revoked: number }>(session, "ldo_cr_lockdown", { p_reason: reason });

// Administração → Utilizadores (Super Admin).
export const crSetUserAccess = (session: string, userId: string, level: "none" | "view" | "manage", finance: boolean) =>
  crStaffRpc<null>(session, "ldo_cr_set_user_access", { p_user_id: userId, p_level: level, p_finance: finance });

// ---------------------------------------------------------------- servidor (tick, fila, avisos, rotação)

// Bearer do pg_cron (segredo ldo_creators_tick do Vault). Falha fechada.
export async function crTickCheck(bearer: string): Promise<boolean> {
  if (!/^[A-Za-z0-9]{32,128}$/.test(bearer || "")) return false;
  return (await crServerRpc<boolean>("ldo_cr_tick_check", { p_value: bearer }).catch(() => false)) === true;
}

export type CrOutboxRow = CreatorOutboxItem & { lease: Iso; email: string; status: CreatorStatus; deleted: boolean; created_at: Iso };
export const crOutboxClaim = (limit: number) => crServerRpc<CrOutboxRow[]>("ldo_cr_outbox_claim", { p_limit: limit });
export const crOutboxDone = (id: number, lease: Iso, ok: boolean, detail: string) =>
  crServerRpc<null>("ldo_cr_outbox_done", { p_id: id, p_lease: lease, p_ok: ok, p_detail: detail });
export const crStaffAlertRecipients = () => crServerRpc<{ email: string; name: string }[]>("ldo_cr_staff_alert_recipients");

export type CrResealRow = { t: string; id: string; col: string; aad: string; ct: string };
export const crResealBatch = (from: string, limit = 50) => crServerRpc<CrResealRow[]>("ldo_cr_reseal_batch", { p_from: from, p_limit: limit });
export const crResealPut = (table: string, id: string, col: string, oldValue: string, newValue: string) =>
  crServerRpc<boolean>("ldo_cr_reseal_put", { p_table: table, p_id: id, p_col: col, p_old: oldValue, p_new: newValue });

// Tipo reexportado para quem monta os dados fiscais do formulário.
export type { FiscalData };
