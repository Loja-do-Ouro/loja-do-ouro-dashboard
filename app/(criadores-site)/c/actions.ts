"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  CATEGORIES, CONSENT_TEXT, CONTACT_PREFERENCES, FORMATS, LANGUAGES, MAX_CATEGORIES, MAX_FORMATS, MAX_LANGUAGES, PLATFORMS,
  VAT_REGIME_LABEL, cleanName, consentText, fiscalIssue, httpsUrl, ibanProblem, lisbonDateTime, normalizeHandle,
  normalizePhone, passwordProblem, pickAllowed, privacyNoticeUpdateText, validEmail, validName,
  type ContactPreference, type FiscalData, type Platform, type VatRegime,
} from "@/lib/criadores-rules";
import { safeNext } from "@/lib/criadores-site-rules";
import { userMessage } from "@/lib/supabase";
import { saveFinance } from "@/lib/criadores/crypto";
import {
  crConsentSet, crIbanConfirm, crLegalAccept, crLegalPublic, crMessageSend, crPrivacyRequest, crProfileGet, crProfileSave,
  crProfileSubmit, crSocialDelete, crSocialSave, type CrMetricsInput, type CrSocialAccount, type CrSocialInput,
} from "@/lib/criadores/db";
import {
  changeCreatorPassword, deleteMyAccount, loginCreator, logoutCreator, registerCreator, requestCreatorReset, resendIbanConfirm,
  resetCreatorPassword, verifyCreatorEmail,
} from "@/lib/criadores/emails";
import { clearCreatorSession, ipHash, loadCreator, siteBase } from "@/lib/criadores/site";

// Server actions do site dos criadores (§4.3, useActionState como app/(leilao-site)/l/actions.ts). As regras estão na
// BD e em lib/criadores/*; aqui só se lê o formulário, se chama a função e se escolhe o texto da resposta.
// - [rev. R-B1] Os textos dos consentimentos e das declarações saem SEMPRE de CONSENT_TEXT (consentText,
//   privacyNoticeUpdateText, ou registerTexts dentro de registerCreator). Do formulário só se lê se a caixa foi
//   marcada («on»), nunca um texto.
// - [rev. S-B2] O registo e a recuperação respondem sempre o mesmo texto; o email sai em after() (lib/criadores/emails).
// - [rev. S-B11] Os tokens dos emails chegam num campo escondido (lidos do #t= no browser), nunca na query string.
// - As palavras-passe nunca voltam ao formulário.

export type FormValues = Record<string, string | string[]>;
// field: o campo a que o erro diz respeito (o formulário marca-o com aria-invalid e liga-o ao aviso).
export type FormState = { error?: string; ok?: string; values?: FormValues; go?: string; field?: string };

// O React limpa o formulário depois de cada envio: num erro, o que foi escrito volta ao formulário (menos as
// palavras-passe e os tokens dos emails), para a pessoa não ter de escrever tudo outra vez.
const NOT_KEPT = new Set(["password", "password2", "old", "new", "new2", "token"]);
function snapshot(form: FormData): FormValues {
  const out: FormValues = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== "string" || NOT_KEPT.has(k) || k.startsWith("$ACTION")) continue;
    const val = v.slice(0, 4000);
    const prev = out[k];
    out[k] = prev === undefined ? val : Array.isArray(prev) ? [...prev, val] : [prev, val];
  }
  return out;
}
const fail = (form: FormData, error: string, field?: string): FormState => ({ error, values: snapshot(form), ...(field ? { field } : {}) });

const field = (form: FormData, name: string, max = 300) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const secret = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, 200) : "";
};
const checked = (form: FormData, name: string) => form.get(name) === "on";

// Erro das ações de conta (entrar, registo, confirmação, recuperação): as mensagens da BD passam como estão; uma falha
// técnica não diz «Não foi possível guardar» (aqui não se guarda nada) mas o que não foi possível fazer.
const GENERIC_ERROR = userMessage(null);
function siteError(e: unknown, fallback: string): string {
  const msg = userMessage(e);
  if (msg === GENERIC_ERROR) return fallback;
  if (msg === "Sem permissão.") return "A plataforma está indisponível neste momento. Tente dentro de momentos.";
  return msg;
}
const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_HELP = "Escreva o nome só com letras (pode usar espaço, hífen, apóstrofo e ponto), como no documento de identificação.";

async function requireSession() {
  const base = await siteBase();
  const c = await loadCreator();
  if (!c) redirect(`${base}/conta/entrar`);
  return { ...c, base };
}

// ---------------------------------------------------------------- conta

export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { name: field(form, "name", 120), email: field(form, "email", 254) };
  if (!validName(values.name)) return fail(form, NAME_HELP);
  if (!validEmail(values.email)) return fail(form, "Confirme o email: falta o «@» ou o domínio.");
  const password = secret(form, "password");
  const problem = passwordProblem(password);
  if (problem) return fail(form, problem);
  if (!checked(form, "adult")) return fail(form, "A plataforma é só para maiores de 18 anos: confirme a sua idade.");
  if (!checked(form, "terms")) return fail(form, "Para criar a conta, aceite os Termos de participação.");
  if (!checked(form, "privacy")) return fail(form, "Confirme que leu a Política de Privacidade.");
  try {
    await registerCreator({
      email: values.email, password, name: cleanName(values.name),
      termsDoc: field(form, "terms_doc", 40), privacyDoc: field(form, "privacy_doc", 40), adult: true,
    });
  } catch (e) {
    return fail(form, siteError(e, "Não foi possível criar a conta agora. Tente dentro de momentos."));
  }
  // A mesma resposta para um email novo, por confirmar, já registado ou acima do limite (rev. S-B2).
  return {
    ok: `Enviámos um email para ${values.email.toLowerCase()}. Abra a ligação e confirme com a palavra-passe que escolheu. Se o email não chegar em 10 minutos, veja a pasta de spam ou registe-se de novo.`,
  };
}

export async function verifyEmailAction(_: FormState, form: FormData): Promise<FormState> {
  const token = field(form, "token", 80);
  if (!TOKEN.test(token)) return fail(form, "Ligação incompleta: abra-a de novo a partir do email.");
  let r;
  try {
    r = await verifyCreatorEmail(token, secret(form, "password"));
  } catch (e) {
    return fail(form, siteError(e, "Não foi possível confirmar o email agora. Tente dentro de momentos."));
  }
  if (!r.ok) {
    if (r.reason === "password") {
      return { error: "Palavra-passe errada. Se não fez este registo, ignore o email; se se esqueceu da palavra-passe, use «Recuperar a palavra-passe»." };
    }
    if (r.reason === "locked") return fail(form, "Demasiadas tentativas. Recupere a palavra-passe: a recuperação também confirma o email.");
    return fail(form, "Esta ligação já foi usada ou expirou (é válida 48 horas). Entre com o email e a palavra-passe: se a conta ainda não estiver confirmada, enviamos uma ligação nova.");
  }
  redirect(`${await siteBase()}/conta/entrar?m=confirmado`);
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email", 254);
  const base = await siteBase();
  let r;
  try {
    r = await loginCreator(email, secret(form, "password"));
  } catch (e) {
    return fail(form, siteError(e, "Não foi possível entrar agora. Tente dentro de momentos."));
  }
  if (!r.ok) {
    if (r.reason === "unverified") return fail(form, "Ainda não confirmou o email. Enviámos uma ligação nova (veja também a pasta de spam).");
    if (r.reason === "locked") return fail(form, "Demasiadas tentativas: a entrada ficou bloqueada. Para a desbloquear, use «Recuperar a palavra-passe».");
    return fail(form, "Email ou palavra-passe incorretos.");
  }
  redirect(safeNext(form.get("next"), base));
}

export async function logoutAction() {
  await logoutCreator();
  redirect((await siteBase()) || "/");
}

export async function resetRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email", 254);
  if (!validEmail(email)) return fail(form, "Confirme o email.");
  try {
    const r = await requestCreatorReset(email);
    if (!r.ok) return fail(form, "Já pediu várias ligações nesta hora. Tente mais tarde.");
  } catch (e) {
    return fail(form, siteError(e, "Não foi possível enviar a ligação agora. Tente dentro de momentos."));
  }
  return { ok: `Se ${email.toLowerCase()} tiver conta na plataforma de criadores, vai receber um email com a ligação para escolher uma palavra-passe nova (válida durante 2 horas). Veja também a pasta de spam.` };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const token = field(form, "token", 80);
  const password = secret(form, "password");
  if (!TOKEN.test(token)) return fail(form, "Ligação incompleta: abra-a de novo a partir do email.");
  if (password !== secret(form, "password2")) return fail(form, "As duas palavras-passe não são iguais.");
  let r;
  try {
    r = await resetCreatorPassword(token, password);
  } catch (e) {
    return fail(form, siteError(e, "Não foi possível mudar a palavra-passe agora. Tente dentro de momentos."));
  }
  if (!r.ok) return fail(form, "Esta ligação já foi usada ou expirou (é válida 2 horas). Peça uma nova em «Recuperar a palavra-passe».");
  redirect(`${await siteBase()}/conta/entrar?m=reset`);
}

// Ligação do email de confirmação do IBAN (rev. S-A1): «Confirmar este IBAN» ou «Não fui eu». «Não fui eu» termina
// todas as sessões (a BD) e leva a escolher uma palavra-passe nova com o token devolvido, no fragmento (rev. S-B11):
// a navegação é feita pelo browser (go), para o token nunca passar por um redirect do servidor.
export async function ibanDecisionAction(_: FormState, form: FormData): Promise<FormState> {
  const token = field(form, "token", 80);
  const accept = field(form, "decisao", 20) === "confirmar";
  if (!TOKEN.test(token)) return fail(form, "Ligação incompleta: abra-a de novo a partir do email.");
  let r;
  try {
    r = await crIbanConfirm(token, accept, await ipHash());
  } catch (e) {
    return fail(form, userMessage(e));
  }
  if (!r.ok) {
    if (r.reason === "nothing_pending") return fail(form, "Não há nenhum IBAN à espera de confirmação. Se já confirmou ou recusou, não precisa de fazer mais nada.");
    if (r.reason === "suspended") return fail(form, "Com a conta suspensa não é possível mudar o IBAN. Fale connosco em Mensagens.");
    return fail(form, "Esta ligação já foi usada ou expirou (é válida 48 horas). Entre na conta e, em Pagamentos, carregue em «Reenviar o email».");
  }
  if (r.confirmed) {
    return { ok: `IBAN terminado em ${r.last4} confirmado. Passa a valer para os pagamentos a partir de ${lisbonDateTime(r.hold_until)} (72 horas de espera, por segurança).` };
  }
  await clearCreatorSession();
  const base = await siteBase();
  return {
    ok: "Apagámos o IBAN pedido e terminámos todas as sessões. Escolha agora uma palavra-passe nova.",
    go: `${base}/conta/nova-palavra-passe#t=${r.reset_token}`,
  };
}

// Termos novos com «exige nova aceitação» (rev. R-M6: só os Termos bloqueiam). O documento tem de ser o publicado
// que a página mostrou; o texto gravado sai de CONSENT_TEXT com a versão publicada.
export async function acceptTermsAction(_: FormState, form: FormData): Promise<FormState> {
  const { session, base } = await requireSession();
  if (!checked(form, "aceito")) return fail(form, "Marque a caixa para aceitar os Termos.");
  try {
    const legal = await crLegalPublic("terms");
    const doc = legal.document;
    if (!doc || doc.id !== field(form, "doc", 40)) return fail(form, "Os Termos foram atualizados entretanto. Recarregue a página e leia a versão nova.");
    await crLegalAccept(session, doc.id, consentText("terms", { versao: doc.version }), await ipHash());
  } catch (e) {
    return fail(form, userMessage(e));
  }
  redirect(`${base}/painel`);
}

// «Tomei conhecimento» da Política nova (não bloqueia nada). Formulário simples na faixa do topo.
export async function privacyNoticeAction(form: FormData) {
  const c = await loadCreator();
  const pending = c?.me.privacy_notice_pending;
  if (!c || !pending || pending.id !== field(form, "doc", 40)) return;
  try {
    await crLegalAccept(c.session, pending.id, privacyNoticeUpdateText(pending.version), await ipHash());
  } catch {
    // a faixa continua à vista e a pessoa pode tentar de novo
  }
  refresh();
}

// ---------------------------------------------------------------- perfil (onboarding e /perfil)

// Erro de preenchimento dos números (texto para a pessoa, sem ir à BD).
class InputError extends Error {}
const failure = (e: unknown) => (e instanceof InputError ? e.message : userMessage(e));

const intOrNull = (raw: string, label: string): number | null => {
  const v = raw.replace(/[\s.  ]/g, "");
  if (!v) return null;
  if (!/^[0-9]{1,10}$/.test(v)) throw new InputError(`${label}: escreva só algarismos.`);
  return Number(v);
};
const pctOrNull = (raw: string, label: string): number | null => {
  const v = raw.replace(/[\s%]/g, "").replace(",", ".");
  if (!v) return null;
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(v) || Number(v) > 100) throw new InputError(`${label}: escreva uma percentagem de 0 a 100.`);
  return Number(v);
};
const sameMetric = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);

// Números declarados de uma conta. Só seguem para a BD quando mudam: números novos voltam a precisar de validação.
function metricsFrom(form: FormData, prefix: string, current: CrSocialAccount | undefined, onlyFollowers: boolean): CrMetricsInput | null {
  const m: CrMetricsInput = { followers: intOrNull(field(form, `${prefix}followers`, 20), "Seguidores") };
  if (!onlyFollowers) {
    m.avg_views = intOrNull(field(form, `${prefix}avg_views`, 20), "Visualizações médias");
    m.avg_likes = intOrNull(field(form, `${prefix}avg_likes`, 20), "Gostos médios");
    m.avg_comments = intOrNull(field(form, `${prefix}avg_comments`, 20), "Comentários médios");
    m.pt_audience_pct = pctOrNull(field(form, `${prefix}pt_audience_pct`, 10), "Audiência em Portugal");
    m.engagement_pct = pctOrNull(field(form, `${prefix}engagement_pct`, 10), "Interação média");
  }
  const old = current?.metrics;
  const keys = Object.keys(m) as (keyof CrMetricsInput)[];
  const empty = keys.every((k) => m[k] === null);
  if (empty && !old) return null;
  const changed = keys.some((k) => !sameMetric(m[k] as number | null, old ? (old[k as keyof typeof old] as number | null) : null));
  if (!changed) return null;
  if (onlyFollowers && old) {
    // No onboarding só se escreve o número de seguidores: os outros números declarados mantêm-se.
    return { ...m, avg_views: old.avg_views, avg_likes: old.avg_likes, avg_comments: old.avg_comments, pt_audience_pct: old.pt_audience_pct, engagement_pct: old.engagement_pct };
  }
  return m;
}

type Step = "about" | "contacts" | "content" | "networks";
const STEP_N: Record<Step, number> = { about: 1, contacts: 2, content: 3, networks: 4 };
const ONBOARDING_PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube"];

// Um passo do perfil. Com onboarding=1 segue para o passo seguinte (bem-vindo); senão fica na página com «Guardado».
export async function profileStepAction(_: FormState, form: FormData): Promise<FormState> {
  const { session, base } = await requireSession();
  const step = field(form, "step", 20) as Step;
  const onboarding = field(form, "onboarding", 2) === "1";
  try {
    if (step === "about") {
      const fullName = cleanName(field(form, "full_name", 120));
      if (!validName(fullName)) return fail(form, NAME_HELP);
      const city = field(form, "city", 100);
      if (!city) return fail(form, "Indique a cidade onde vive.");
      const languages = pickAllowed(form.getAll("languages"), LANGUAGES, MAX_LANGUAGES);
      if (!languages.length) return fail(form, "Escolha pelo menos um idioma em que publica.");
      const country = field(form, "country", 2).toUpperCase() || "PT";
      await crProfileSave(session, {
        step: "about",
        data: {
          full_name: fullName, display_name: field(form, "display_name", 80) || null, city, district: field(form, "district", 60) || null,
          country, bio: field(form, "bio", 1500) || null, languages,
        },
      });
    } else if (step === "contacts") {
      const raw = field(form, "phone", 30);
      const phone = raw ? normalizePhone(raw) : null;
      if (!phone) return fail(form, "Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).");
      const preferred = (CONTACT_PREFERENCES as readonly string[]).includes(field(form, "preferred", 20))
        ? (field(form, "preferred", 20) as ContactPreference) : "email";
      await crProfileSave(session, { step: "contacts", data: { phone, whatsapp: checked(form, "whatsapp"), preferred } });
    } else if (step === "content") {
      const categories = pickAllowed(form.getAll("categories"), CATEGORIES, MAX_CATEGORIES);
      const formats = pickAllowed(form.getAll("formats"), FORMATS, MAX_FORMATS);
      if (!categories.length) return fail(form, "Escolha pelo menos um tema.");
      if (!formats.length) return fail(form, "Escolha pelo menos um formato.");
      const storeIds = form.getAll("store_ids").filter((v): v is string => typeof v === "string" && UUID.test(v)).slice(0, 50);
      const radius = field(form, "travel_radius_km", 5);
      if (radius && !/^[0-9]{1,3}$/.test(radius)) return fail(form, "Indique a distância em quilómetros (de 0 a 500).");
      const portfolioRaw = field(form, "portfolio_url", 300);
      const portfolio = portfolioRaw ? httpsUrl(portfolioRaw) : null;
      if (portfolioRaw && !portfolio) return fail(form, "O portefólio tem de ser um endereço completo, a começar por https://.");
      await crProfileSave(session, {
        step: "content",
        data: { categories, formats, store_ids: storeIds, travel_radius_km: radius ? Number(radius) : null, portfolio_url: portfolio },
      });
    } else if (step === "networks") {
      const current = (await crProfileGet(session)).social_accounts;
      const accounts: CrSocialInput[] = [];
      for (const platform of ONBOARDING_PLATFORMS) {
        const raw = field(form, `${platform}_handle`, 120);
        if (!raw) continue;
        const handle = normalizeHandle(raw);
        if (!handle) return fail(form, `${platform === "instagram" ? "Instagram" : platform === "tiktok" ? "TikTok" : "YouTube"}: escreva o nome de utilizador sem espaços (letras, números, ponto, hífen ou _).`);
        const existing = current.find((a) => a.platform === platform);
        const urlRaw = field(form, `${platform}_url`, 300);
        const url = urlRaw ? httpsUrl(urlRaw) : null;
        if (urlRaw && !url) return fail(form, "O endereço do perfil tem de começar por https://.");
        const metrics = metricsFrom(form, `${platform}_`, existing, true);
        accounts.push({ ...(existing ? { id: existing.id } : {}), platform, handle, profile_url: url, ...(metrics ? { metrics } : {}) });
      }
      if (!accounts.length && !current.length) return fail(form, "Indique pelo menos uma rede onde publica.");
      if (accounts.length) await crProfileSave(session, { step: "networks", data: { accounts } });
    } else {
      return fail(form, "Passo desconhecido.");
    }
  } catch (e) {
    return fail(form, failure(e));
  }
  if (onboarding) {
    const n = STEP_N[step];
    redirect(n < 4 ? `${base}/bem-vindo?passo=${n + 1}` : `${base}/bem-vindo?passo=4&m=guardado#enviar`);
  }
  refresh();
  return { ok: "Guardado." };
}

// Enviar o perfil para revisão, com a declaração de veracidade (texto de CONSENT_TEXT, nunca do formulário).
export async function submitProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const { session, base } = await requireSession();
  if (!checked(form, "verdade")) return fail(form, "Para enviar, confirme a declaração de veracidade.");
  try {
    await crProfileSubmit(session, CONSENT_TEXT.data_truth, await ipHash());
  } catch (e) {
    return fail(form, userMessage(e));
  }
  redirect(`${base}/painel?m=enviado`);
}

// ---------------------------------------------------------------- redes declaradas (/redes)

export async function socialSaveAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const id = field(form, "id", 40);
  const platform = field(form, "platform", 20) as Platform;
  if (!(PLATFORMS as readonly string[]).includes(platform)) return fail(form, "Escolha a rede.");
  const handle = normalizeHandle(field(form, "handle", 120));
  if (!handle) return fail(form, "Escreva o nome de utilizador sem espaços (letras, números, ponto, hífen ou _).");
  const urlRaw = field(form, "profile_url", 300);
  const url = urlRaw ? httpsUrl(urlRaw) : null;
  if (urlRaw && !url) return fail(form, "O endereço do perfil tem de começar por https://.");
  try {
    const current = (await crProfileGet(session)).social_accounts;
    const existing = id ? current.find((a) => a.id === id) : current.find((a) => a.platform === platform);
    if (id && !existing) return fail(form, "Esta conta já não existe. Recarregue a página.");
    const metrics = metricsFrom(form, "", existing, false);
    await crSocialSave(session, { ...(existing ? { id: existing.id } : {}), platform, handle, profile_url: url, ...(metrics ? { metrics } : {}) });
  } catch (e) {
    return fail(form, failure(e));
  }
  refresh();
  return { ok: "Conta guardada. Os números ficam como declarados por si, até a equipa os validar." };
}

export async function socialDeleteAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const id = field(form, "id", 40);
  if (!UUID.test(id)) return fail(form, "Conta inválida.");
  try {
    await crSocialDelete(session, id);
  } catch (e) {
    return fail(form, userMessage(e));
  }
  refresh();
  return { ok: "Conta apagada, com os números declarados." };
}

// ---------------------------------------------------------------- mensagens

export async function messageAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const body = field(form, "body", 4000);
  if (body.length < 2) return fail(form, "Escreva a mensagem.");
  try {
    await crMessageSend(session, body);
  } catch (e) {
    return fail(form, userMessage(e));
  }
  refresh();
  return { ok: "Mensagem enviada. A equipa responde aqui e avisa-o por email." };
}

// ---------------------------------------------------------------- pagamentos (F3, rev. S-A1)

// Dados fiscais e IBAN, com a palavra-passe. A cifra, a comparação do titular com o nome fiscal e o email de
// confirmação do IBAN (na hora) ficam em saveFinance (lib/criadores/crypto.ts). Os textos das declarações
// (iban_owner, vat_exempt, withholding_waiver) saem de CONSENT_TEXT lá dentro.
export async function financeAction(_: FormState, form: FormData): Promise<FormState> {
  const { session, me } = await requireSession();
  const keep = ["fiscal_name", "nif", "fiscal_address", "tax_country", "vat_regime", "withholding_waiver", "activity_code", "holder"];
  const values: Record<string, string> = {};
  for (const k of keep) values[k] = field(form, k, k === "fiscal_address" ? 400 : 200);
  const waiver = values.withholding_waiver;
  const anyFiscal = ["fiscal_name", "nif", "fiscal_address"].some((k) => values[k]);
  let fiscal: FiscalData | null = null;
  if (anyFiscal) {
    const vat = values.vat_regime in VAT_REGIME_LABEL ? (values.vat_regime as VatRegime) : undefined;
    const candidate = {
      fiscal_name: values.fiscal_name, nif: values.nif, fiscal_address: values.fiscal_address, tax_country: (values.tax_country || "PT").toUpperCase(),
      vat_regime: vat, withholding_waiver: waiver === "sim" ? true : waiver === "nao" ? false : undefined, activity_code: values.activity_code || null,
    };
    const issue = fiscalIssue(candidate);
    if (issue) return fail(form, issue.message, issue.field ?? undefined);
    fiscal = candidate as FiscalData;
  }
  const ibanRaw = field(form, "iban", 60);
  let iban: { iban: string; holder: string } | null = null;
  if (ibanRaw) {
    const problem = ibanProblem(ibanRaw);
    if (problem) return fail(form, problem, "iban");
    if (values.holder.length < 2) return fail(form, "Indique o titular da conta, como aparece no banco.", "holder");
    if (!checked(form, "iban_owner")) return fail(form, "Confirme que é titular da conta com este IBAN.", "iban_owner");
    iban = { iban: ibanRaw, holder: values.holder };
  }
  if (!fiscal && !iban) return fail(form, "Não há nada para guardar: preencha os dados fiscais ou indique um IBAN.");
  const password = secret(form, "password");
  if (!password) return fail(form, "Escreva a sua palavra-passe para guardar.", "password");
  let r;
  try {
    r = await saveFinance(session, { creatorId: me.id, password, fiscal, iban });
  } catch (e) {
    return fail(form, userMessage(e));
  }
  if (!r.ok) {
    if (r.reason === "rate") return fail(form, "Já pediu várias confirmações de IBAN nesta hora. Os dados não foram guardados: tente mais tarde.");
    return fail(form, "Palavra-passe errada. Os dados não foram guardados.", "password");
  }
  refresh();
  const parts: string[] = [];
  if (fiscal) parts.push(r.fiscalComplete ? "Dados fiscais guardados." : "Dados fiscais guardados, mas ainda incompletos.");
  if (iban && r.ibanPending) {
    parts.push(r.emailSent
      ? `Enviámos um email para ${me.email} para confirmar o IBAN terminado em ${r.pendingLast4}. Até confirmar, continua a valer o anterior; depois, os pagamentos esperam 72 horas.`
      : `O IBAN terminado em ${r.pendingLast4} ficou à espera de confirmação, mas não conseguimos enviar o email agora. Carregue em «Reenviar o email» daqui a pouco.`);
  }
  return { ok: parts.join(" ") };
}

export async function ibanResendAction(_: FormState): Promise<FormState> {
  const { session, me } = await requireSession();
  let r;
  try {
    r = await resendIbanConfirm(session);
  } catch (e) {
    return { error: userMessage(e) };
  }
  if (!r.ok) {
    return { error: r.reason === "rate" ? "Já reenviámos o email várias vezes nesta hora. Tente mais tarde." : "Não há nenhum IBAN à espera de confirmação." };
  }
  return r.sent
    ? { ok: `Email reenviado para ${me.email}. A ligação anterior deixou de valer.` }
    : { error: "Não conseguimos enviar o email agora. Tente dentro de momentos." };
}

// ---------------------------------------------------------------- definições

export async function campaignNewsAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const granted = checked(form, "avisos");
  try {
    await crConsentSet(session, "campaign_news", granted, CONSENT_TEXT.campaign_news, await ipHash());
  } catch (e) {
    return fail(form, userMessage(e));
  }
  refresh();
  return { ok: granted ? "Vai receber por email os avisos de campanhas novas." : "Deixou de receber os avisos de campanhas novas." };
}

export async function passwordAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const next = secret(form, "new");
  if (next !== secret(form, "new2")) return fail(form, "As duas palavras-passe novas não são iguais.");
  let r;
  try {
    r = await changeCreatorPassword(session, secret(form, "old"), next);
  } catch (e) {
    return fail(form, userMessage(e));
  }
  if (!r.ok) return fail(form, "A palavra-passe atual não está certa.");
  return { ok: "Palavra-passe mudada. As sessões noutros dispositivos foram terminadas." };
}

const PRIVACY_KINDS = ["objection", "restriction", "human_review", "rectification", "other"] as const;

export async function privacyRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireSession();
  const kind = field(form, "kind", 20) as (typeof PRIVACY_KINDS)[number];
  const details = field(form, "details", 4000);
  if (!PRIVACY_KINDS.includes(kind)) return fail(form, "Escolha o tipo de pedido.");
  if (details.length < 10) return fail(form, "Explique o pedido em poucas palavras (pelo menos 10 caracteres).");
  try {
    await crPrivacyRequest(session, kind, details);
  } catch (e) {
    return fail(form, userMessage(e));
  }
  return { ok: "Pedido registado. Respondemos por email no prazo de um mês (prorrogável por mais dois em casos complexos, com aviso)." };
}

export async function deleteAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const { session, base } = await requireSession();
  if (field(form, "confirm", 20).toUpperCase() !== "APAGAR") return fail(form, "Escreva APAGAR para confirmar.");
  let r;
  try {
    r = await deleteMyAccount(session, secret(form, "password"));
  } catch (e) {
    return fail(form, userMessage(e));
  }
  if (!r.ok) {
    if (r.reason === "password") return fail(form, "Palavra-passe errada. A conta não foi apagada.");
    // [rev. R-M7] Colaboração a decorrer: a conta fica, o opcional já foi apagado e há um pedido aberto.
    refresh();
    return {
      error: `Não apagámos a conta porque tem uma colaboração a decorrer: ${r.detail} Já apagámos o que dependia da sua autorização (os avisos de campanhas novas). Guardamos o resto enquanto a colaboração durar e apagamos quando terminar. Respondemos por email no prazo de um mês. Se não concordar, pode reclamar à CNPD (www.cnpd.pt).`,
    };
  }
  redirect(`${base || "/"}?m=apagada`);
}
