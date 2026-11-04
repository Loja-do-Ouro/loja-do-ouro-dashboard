import "server-only";
import { after } from "next/server";
import {
  creatorsKeyProblem, open, parseKeyRing, reseal, resealProblem, seal, type CryptoPurpose, type KeyRing,
} from "@/lib/criadores-crypto-core";
import {
  consentText, fiscalProblem, holderMismatch, ibanProblem, normalizeNif, parseIban, redact, type FiscalData,
} from "@/lib/criadores-rules";
import { SupabaseError } from "@/lib/supabase";
import {
  creatorsServerConfigured, crExport, crFinanceGet, crFinanceReveal, crFinanceSave, crResealBatch, crResealPut,
  type CrExportData, type CrFinanceGet, type CrFinanceSaveData,
} from "./db";
import { sendIbanConfirm, sendRevealAlert } from "./emails";
import { ipHash } from "./site";

// Cifra da plataforma de criadores (§0.3, rev. S-B12) com o anel de CREATORS_ENCRYPTION_KEY ("c1:<base64>"; numa
// rotação "c2:<nova>,c1:<antiga>"), pelo núcleo puro lib/criadores-crypto-core.ts. A BD só vê "cN.…" (*_ct).
// AAD "<finalidade>:<id>": iban:<criador>, fiscal:<criador> (PR2: addr:<pedido>, payee:<pagamento>; PR3B: ig, igsel).
// Também os fluxos que juntam a cifra e a BD: guardar os dados de pagamento (com o email do IBAN na hora), ler os
// dados fiscais do próprio, revelar (equipa com finanças), exportar os dados do próprio e regravar numa rotação.

// ---------------------------------------------------------------- anel de chaves

// Problema com a variável (formato, chaves repetidas, igual à SUPPORT_ENCRYPTION_KEY) ou null. Nunca o valor.
export function encryptionProblem(): string | null {
  return creatorsKeyProblem(process.env.CREATORS_ENCRYPTION_KEY, process.env.SUPPORT_ENCRYPTION_KEY);
}
export const encryptionConfigured = () => encryptionProblem() === null;

let cached: { raw: string; support: string; ring: KeyRing } | null = null;
function ring(): KeyRing {
  const raw = process.env.CREATORS_ENCRYPTION_KEY || "";
  const support = process.env.SUPPORT_ENCRYPTION_KEY || "";
  if (!cached || cached.raw !== raw || cached.support !== support) cached = { raw, support, ring: parseKeyRing(raw, support) };
  return cached.ring;
}

const aad = (purpose: CryptoPurpose, id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("Identificador inválido para a cifra.");
  return `${purpose}:${id}`;
};

export const sealFor = (purpose: CryptoPurpose, id: string, plain: string) => seal(ring(), plain, aad(purpose, id));
export const openFor = (purpose: CryptoPurpose, id: string, sealed: string) => open(ring(), sealed, aad(purpose, id));

// IBAN: {iban, holder} em JSON, AAD iban:<criador>.
export type IbanPlain = { iban: string; holder: string };
export const sealIban = (creatorId: string, v: IbanPlain) => sealFor("iban", creatorId, JSON.stringify({ iban: v.iban, holder: v.holder }));
export function openIban(creatorId: string, sealed: string): IbanPlain {
  const v = JSON.parse(openFor("iban", creatorId, sealed)) as Partial<IbanPlain>;
  return { iban: String(v.iban || ""), holder: String(v.holder || "") };
}

// Dados fiscais (FiscalData em JSON), AAD fiscal:<criador>.
export const sealFiscal = (creatorId: string, d: FiscalData) => sealFor("fiscal", creatorId, JSON.stringify(normalizeFiscal(d)));
export function openFiscal(creatorId: string, sealed: string): FiscalData {
  return normalizeFiscal(JSON.parse(openFor("fiscal", creatorId, sealed)) as FiscalData);
}

function normalizeFiscal(d: Partial<FiscalData>): FiscalData {
  return {
    fiscal_name: String(d.fiscal_name ?? "").trim().slice(0, 200),
    nif: normalizeNif(d.nif).slice(0, 20),
    fiscal_address: String(d.fiscal_address ?? "").trim().slice(0, 400),
    tax_country: String(d.tax_country ?? "").trim().toUpperCase().slice(0, 2),
    vat_regime: d.vat_regime as FiscalData["vat_regime"],
    withholding_waiver: Boolean(d.withholding_waiver),
    activity_code: d.activity_code ? String(d.activity_code).trim().slice(0, 10) : null,
  };
}

const userError = (message: string) => new SupabaseError(message, 400, "22023");

// ---------------------------------------------------------------- site: dados de pagamento (F3)

// O formulário de /pagamentos: os dados fiscais decifrados (para preencher) e o resto como vem da BD (nunca o IBAN).
export type MyFinance = Omit<NonNullable<CrFinanceGet>, "fiscal_ct"> & { fiscal: FiscalData | null; fiscal_error: string | null };
export async function getMyFinance(session: string, creatorId: string): Promise<MyFinance | null> {
  const f = await crFinanceGet(session);
  if (!f) return null;
  const { fiscal_ct, ...rest } = f;
  let fiscal: FiscalData | null = null;
  let fiscalError: string | null = null;
  if (fiscal_ct) {
    try {
      fiscal = openFiscal(creatorId, fiscal_ct);
    } catch (e) {
      console.error("criadores fiscal", redact(e));
      fiscalError = "Não foi possível ler os dados fiscais guardados. Volte a escrevê-los.";
    }
  }
  return { ...rest, fiscal, fiscal_error: fiscalError };
}

export type SaveFinanceInput = {
  creatorId: string; // me.id da sessão (a AAD liga o valor ao criador)
  password: string;
  fiscal?: FiscalData | null; // ausente = manter os guardados
  iban?: { iban: string; holder: string } | null; // ausente = manter (um IBAN novo fica pendente)
  // Por omissão saem dos dados fiscais (vat_regime = art53, withholding_waiver).
  declarations?: { vat_exempt?: boolean; withholding_waiver?: boolean };
};
export type SaveFinanceResult =
  | { ok: false; reason: "password" | "rate" }
  | { ok: true; fiscalComplete: boolean | null; ibanPending: boolean; pendingLast4: string | null; emailSent: boolean };

// [rev. S-A1] Valida (IBAN mod 97, dados fiscais), compara o titular com o nome fiscal, cifra e grava com a
// palavra-passe. Um IBAN novo (também o primeiro) fica pendente e o email de confirmação sai NA HORA (sem fila).
// Os textos das declarações saem de CONSENT_TEXT (rev. R-B1). Dados fiscais incompletos gravam-se com
// fiscal_complete = false (validar antes com fiscalProblem se a página exigir tudo). Erros → SupabaseError 22023.
export async function saveFinance(session: string, input: SaveFinanceInput): Promise<SaveFinanceResult> {
  const data: CrFinanceSaveData = {
    texts: { iban_owner: consentText("iban_owner"), vat_exempt: consentText("vat_exempt"), withholding_waiver: consentText("withholding_waiver") },
  };
  // Estado atual: o nome fiscal guardado (para comparar com o titular) e as declarações já feitas (só se grava um
  // consentimento novo quando a resposta muda).
  const current = await getMyFinance(session, input.creatorId).catch(() => null);
  let fiscalName: string | null = current?.fiscal?.fiscal_name ?? null;
  let fiscalComplete: boolean | null = null;
  let declarations: { vat_exempt?: boolean; withholding_waiver?: boolean } = {};
  if (input.fiscal) {
    const fiscal = normalizeFiscal(input.fiscal);
    fiscalComplete = fiscalProblem(fiscal) === null;
    fiscalName = fiscal.fiscal_name;
    data.fiscal_ct = sealFiscal(input.creatorId, fiscal);
    data.fiscal_complete = fiscalComplete;
    declarations = { vat_exempt: fiscal.vat_regime === "art53", withholding_waiver: fiscal.withholding_waiver };
  }
  if (input.declarations) declarations = { ...declarations, ...input.declarations };
  for (const k of ["vat_exempt", "withholding_waiver"] as const) {
    if (typeof declarations[k] === "boolean" && current?.declarations?.[k]?.granted !== declarations[k]) {
      data.declarations = { ...data.declarations, [k]: declarations[k] };
    }
  }
  if (input.iban) {
    const parsed = parseIban(input.iban.iban);
    if (!parsed) throw userError(ibanProblem(input.iban.iban) || "O IBAN não está certo.");
    const holder = String(input.iban.holder || "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (holder.length < 2) throw userError("Indique o titular da conta.");
    data.iban_ct = sealIban(input.creatorId, { iban: parsed.iban, holder });
    data.iban_last4 = parsed.last4;
    data.iban_country = parsed.country;
    data.holder_mismatch = fiscalName ? holderMismatch(holder, fiscalName) : false;
  }
  const r = await crFinanceSave(session, input.password, data, await ipHash());
  if (!r.ok) return r;
  let emailSent = false;
  if (r.confirm_token && r.pending_last4) emailSent = (await sendIbanConfirm(r.email, r.confirm_token, r.pending_last4)).ok;
  return { ok: true, fiscalComplete, ibanPending: r.iban_pending, pendingLast4: r.pending_last4, emailSent };
}

// ---------------------------------------------------------------- equipa: revelar (F8, rev. S-M8, S-A1)

export type RevealResult =
  | { ok: false; reason: "password" | "locked" }
  | {
      ok: true; iban: IbanPlain | null; fiscal: FiscalData | null; error: string | null; iban_last4: string | null;
      iban_changed_at: string | null; iban_hold_until: string | null; iban_holder_mismatch: boolean; iban_pending_last4: string | null;
    };

// Só com finanças (a BD confirma; 42501 sem permissão, na espera sem oob e à 21.ª em 24 h). Decifra no servidor;
// a página mostra 60 s, sem cache (no-store). À 10.ª revelação em 24 h avisa os Super Admin em after().
// staffName: viewer.fullName || viewer.username (só para o aviso).
export async function revealFinance(staffSession: string, staffName: string, creatorId: string, reason: string, oobConfirmed: boolean, password: string): Promise<RevealResult> {
  const r = await crFinanceReveal(staffSession, creatorId, reason, oobConfirmed, password);
  if (!r.ok) return r;
  if (r.alert) after(() => sendRevealAlert(staffName, 10).catch((e) => console.error("criadores alerta", redact(e))));
  let iban: IbanPlain | null = null;
  let fiscal: FiscalData | null = null;
  let error: string | null = null;
  try {
    if (r.iban_ct) iban = openIban(creatorId, r.iban_ct);
    if (r.fiscal_ct) fiscal = openFiscal(creatorId, r.fiscal_ct);
  } catch (e) {
    console.error("criadores revelar", redact(e));
    error = "Não foi possível decifrar os dados. Confirme a CREATORS_ENCRYPTION_KEY (Definições → estado da cifra).";
  }
  return {
    ok: true, iban, fiscal, error, iban_last4: r.iban_last4, iban_changed_at: r.iban_changed_at, iban_hold_until: r.iban_hold_until,
    iban_holder_mismatch: r.iban_holder_mismatch, iban_pending_last4: r.iban_pending_last4,
  };
}

// ---------------------------------------------------------------- site: «Descarregar os meus dados» (F11)

// ldo_cr_export com a palavra-passe; os dados fiscais e o IBAN do próprio vão decifrados (é dele e houve
// reautenticação). A BD já grava o pedido access done. A rota POST /api/c/export devolve isto como anexo no-store.
export type MyExport = Omit<CrExportData, "finance"> & {
  finance: (Record<string, unknown> & { fiscal: FiscalData | null; iban: IbanPlain | null; note?: string }) | null;
};
export async function exportMyData(session: string, password: string): Promise<{ ok: false; reason: "password" | "rate" } | { ok: true; data: MyExport }> {
  const r = await crExport(session, password, await ipHash());
  if (!r.ok) return r;
  const { finance, ...rest } = r.data;
  if (!finance) return { ok: true, data: { ...rest, finance: null } };
  const { fiscal_ct, iban_ct, ...plain } = finance;
  const id = r.data.account.id;
  const out: NonNullable<MyExport["finance"]> = { ...plain, fiscal: null, iban: null };
  try {
    if (fiscal_ct) out.fiscal = openFiscal(id, fiscal_ct);
    if (iban_ct) out.iban = openIban(id, iban_ct);
  } catch (e) {
    console.error("criadores export", redact(e));
    out.note = "Não foi possível incluir os dados de pagamento cifrados. Peça-os em Mensagens.";
  }
  return { ok: true, data: { ...rest, finance: out } };
}

// ---------------------------------------------------------------- rotação (tick, com CREATORS_RESEAL_FROM)

// Volta a cifrar com a chave atual os valores da versão CREATORS_RESEAL_FROM, em lotes de 50, com a mesma AAD e só se
// o valor não mudou entretanto (ldo_cr_reseal_put compara). Não mexe em iban_changed_at. Devolve quantos regravou.
// Sem CREATORS_RESEAL_FROM não faz nada.
export async function resealCreators({ budgetMs = 20_000 } = {}): Promise<number> {
  const from = (process.env.CREATORS_RESEAL_FROM || "").trim();
  if (!from || !creatorsServerConfigured()) return 0;
  const until = Date.now() + budgetMs;
  let done = 0;
  try {
    const keys = ring();
    const problem = resealProblem(keys, from);
    if (problem) {
      console.error("criadores regravar", redact(problem));
      return 0;
    }
    const seen = new Set<string>();
    while (Date.now() < until) {
      const rows = (await crResealBatch(from, 50)) || [];
      const fresh = rows.filter((x) => !seen.has(`${x.t}:${x.id}:${x.col}`));
      if (!fresh.length) break;
      for (const x of fresh) {
        seen.add(`${x.t}:${x.id}:${x.col}`);
        // A AAD tem de ser "<finalidade>:<id>" da própria linha (nunca a de outra).
        if (!x.aad.endsWith(`:${x.id}`)) {
          console.error("criadores regravar", redact(`AAD inesperada em ${x.t}.${x.col}`));
          continue;
        }
        try {
          const novo = reseal(keys, x.ct, x.aad, from);
          if (novo && (await crResealPut(x.t, x.id, x.col, x.ct, novo))) done++;
        } catch (e) {
          console.error("criadores regravar", redact(`${x.t}.${x.col}: ${e instanceof Error ? e.message : String(e)}`));
        }
        if (Date.now() >= until) break;
      }
    }
  } catch (e) {
    console.error("criadores regravar", redact(e));
  }
  return done;
}
