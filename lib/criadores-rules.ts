// Plataforma de criadores (criadores.lojadoouro.pt e área Influenciadores do dashboard): regras sem I/O.
// Listas fechadas, textos dos consentimentos, validações (NIF, IBAN, telefone, nome), máscaras, passos do
// onboarding, etiquetas, textos dos emails (fila e conta), redact(), prazos de conservação e o render seguro do
// Markdown dos documentos legais. Testado em tests/criadores.cjs.

import { brandEmail, emailParagraph, emailQuote, esc, BRAND } from "./email-layout";

// ---------------------------------------------------------------- datas (hora de Lisboa)

const LISBON = "Europe/Lisbon";
const PARTS = new Intl.DateTimeFormat("pt-PT", {
  timeZone: LISBON, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function lisbonParts(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(d)) p[x.type] = x.value;
  return p;
}

// «03-01-2027» (hora de Lisboa); «—» sem data.
export function lisbonDate(iso: string | null | undefined): string {
  const p = lisbonParts(iso);
  return p ? `${p.day}-${p.month}-${p.year}` : "—";
}

// «03-01-2027 às 10:42» (hora de Lisboa); «—» sem data.
export function lisbonDateTime(iso: string | null | undefined): string {
  const p = lisbonParts(iso);
  return p ? `${p.day}-${p.month}-${p.year} às ${p.hour}:${p.minute}` : "—";
}

// ---------------------------------------------------------------- listas fechadas

// A BD só limita o tamanho das listas (ldo_cr_profiles); os valores possíveis são estes.
export const CATEGORY_LABEL = {
  joias: "Joias e acessórios",
  relogios: "Relógios",
  moda: "Moda",
  beleza: "Beleza",
  estilo_de_vida: "Estilo de vida",
  casamentos: "Casamentos e noivas",
  familia: "Família e maternidade",
  viagens: "Viagens",
  luxo: "Luxo",
  casa: "Casa e decoração",
  desporto: "Desporto e bem-estar",
  cultura: "Cultura e arte",
  gastronomia: "Gastronomia",
  empreendedorismo: "Empreendedorismo",
} as const;
export type Category = keyof typeof CATEGORY_LABEL;
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
export const MAX_CATEGORIES = 12;

export const FORMAT_LABEL = {
  reels: "Reels e vídeos curtos",
  stories: "Stories",
  fotografia: "Publicações com fotografia",
  carrossel: "Carrosséis",
  video_longo: "Vídeo longo (YouTube)",
  diretos: "Diretos",
  unboxing: "Unboxing",
  ugc: "UGC (conteúdo para a marca usar)",
  eventos: "Presença em lojas e eventos",
  tutoriais: "Tutoriais e dicas de estilo",
} as const;
export type Format = keyof typeof FORMAT_LABEL;
export const FORMATS = Object.keys(FORMAT_LABEL) as Format[];
export const MAX_FORMATS = 10;

export const LANGUAGE_LABEL = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  it: "Italiano",
} as const;
export type Language = keyof typeof LANGUAGE_LABEL;
export const LANGUAGES = Object.keys(LANGUAGE_LABEL) as Language[];
export const MAX_LANGUAGES = 6;

// Iguais ao check de ldo_cr_social_accounts.platform.
export const PLATFORM_LABEL = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  pinterest: "Pinterest",
  outra: "Outra",
} as const;
export type Platform = keyof typeof PLATFORM_LABEL;
export const PLATFORMS = Object.keys(PLATFORM_LABEL) as Platform[];

// Iguais ao check de ldo_cr_contacts.preferred.
export const CONTACT_PREFERENCE_LABEL = { email: "Email", telefone: "Telefone", whatsapp: "WhatsApp" } as const;
export type ContactPreference = keyof typeof CONTACT_PREFERENCE_LABEL;
export const CONTACT_PREFERENCES = Object.keys(CONTACT_PREFERENCE_LABEL) as ContactPreference[];

// Distritos e regiões autónomas (sugestão do formulário; a BD aceita até 60 caracteres).
export const DISTRICTS = [
  "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria", "Lisboa",
  "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu", "Região Autónoma dos Açores",
  "Região Autónoma da Madeira",
] as const;

export const VAT_REGIME_LABEL = {
  art53: "Isento de IVA (artigo 53.º do CIVA)",
  normal: "Regime normal de IVA",
  outro: "Outro",
} as const;
export type VatRegime = keyof typeof VAT_REGIME_LABEL;

// Valores escolhidos de uma lista fechada: só os conhecidos, sem repetidos, no máximo `max`.
export function pickAllowed<T extends string>(values: unknown, allowed: readonly T[], max: number): T[] {
  const list = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  const out: T[] = [];
  for (const v of list) {
    const s = typeof v === "string" ? v.trim() : "";
    if ((allowed as readonly string[]).includes(s) && !out.includes(s as T)) out.push(s as T);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------- consentimentos e declarações (§7.1)

// Iguais ao check de ldo_cr_consents.purpose (tests/criadores.cjs compara com a migração).
export const CONSENT_PURPOSES = [
  "terms", "privacy_notice", "adult", "marketing", "campaign_news", "data_truth", "platform_instagram", "platform_public",
  "ai_analysis", "ad_disclosure", "product_disclosure", "address_use", "campaign_conditions", "paid_ads", "partnership_ads",
  "image_voice", "iban_owner", "vat_exempt", "withholding_waiver", "content_declaration",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

// Textos exatos das caixas (vão para text_shown; a server action monta p_texts a partir daqui, nunca do FormData,
// rev. R-B1). Marcadores: {versao} (versão do documento publicado) e {handle} (@ do Instagram, sem o @).
// [a confirmar: advogado] Todos os textos são validados pelo advogado antes do lançamento.
export const CONSENT_TEXT: Record<ConsentPurpose, string> = {
  adult: "Confirmo que tenho 18 ou mais anos.",
  terms: "Aceito os Termos de participação (v{versao}).",
  privacy_notice: "Li a Política de Privacidade (v{versao}).",
  // Fora da v1 (rev. R-B6): só volta com um envio de marketing real, com caixa própria.
  marketing: "Quero receber novidades, campanhas de marketing e ofertas da Loja do Ouro por email.",
  campaign_news:
    "Quero receber por email os avisos de campanhas novas da plataforma de criadores. Posso desligá-los em Definições ou na ligação de cada email.",
  data_truth: "Declaro que os dados e os números que indico são verdadeiros e que as contas de redes sociais indicadas me pertencem.",
  platform_instagram:
    "Autorizo a Loja do Ouro a obter e atualizar, através da Meta (Facebook Login), o perfil, as publicações, as estatísticas e os dados agregados de audiência da minha conta profissional do Instagram, para acompanhar colaborações e calcular indicadores estatísticos de autenticidade da audiência, explicados e sem nota, que a equipa vê. Posso desligar a qualquer momento em Redes; os dados obtidos são apagados nesse momento.",
  platform_public:
    "Autorizo a Loja do Ouro a ler, através da Meta, os números públicos da minha conta profissional do Instagram (@{handle}): seguidores, número de publicações e, por publicação, gostos, comentários e visualizações de reels. A leitura é diária, de hora a hora nas primeiras 48 horas das publicações de campanha, e semanal se a conta estiver sem atividade na plataforma há mais de 90 dias. A equipa vê estes números no meu perfil e eu vejo-os em Redes. Não servem para calcular indicadores de autenticidade nem são analisados por inteligência artificial. Posso parar a leitura em Redes, e os dados lidos são apagados nesse momento.",
  ai_analysis:
    "Aceito que os dados obtidos da minha conta ligada do Instagram sejam analisados com apoio de inteligência artificial (Claude, da Anthropic) para a equipa ter um resumo do perfil e dos melhores conteúdos. As decisões são sempre humanas. Posso retirar esta autorização em Definições, e as análises feitas são apagadas nesse momento.",
  ad_disclosure:
    "Comprometo-me a identificar o conteúdo como publicidade no início da publicação (#PUB ou #OFERTA) e a usar o rótulo de parceria da plataforma.",
  product_disclosure:
    "Compreendo que, se publicar sobre esta peça, tenho de a identificar com #OFERTA no início da publicação, mesmo sem pagamento.",
  address_use: "Autorizo o uso da morada indicada apenas para o envio deste pedido.",
  campaign_conditions:
    "Aceito as Condições Particulares desta campanha (v{versao}), incluindo a licença dos conteúdos nos meios, no território e no prazo nelas indicados.",
  paid_ads: "Autorizo o uso dos conteúdos em anúncios pagos da Loja do Ouro, durante o prazo indicado nas Condições Particulares desta campanha.",
  partnership_ads:
    "Autorizo anúncios de parceria a partir da minha conta (Partnership Ads), durante o prazo indicado nas Condições Particulares desta campanha.",
  image_voice: "Autorizo o uso da minha imagem e voz nos conteúdos licenciados, nos termos das Condições Particulares desta campanha.",
  iban_owner: "Declaro que sou titular da conta bancária com o IBAN indicado.",
  vat_exempt: "Declaro estar isento de IVA ao abrigo do artigo 53.º do Código do IVA.",
  withholding_waiver:
    "Opto pela dispensa de retenção na fonte (artigo 101.º-B do Código do IRS) e declaro prever rendimentos anuais da categoria B inferiores ao limite legal.",
  // rev. R-B3: sem menores, nem com autorização.
  content_declaration:
    "Declaro que sou autor do conteúdo, que tenho autorização de todas as pessoas identificáveis, que não aparecem menores de 18 anos e que a música e os elementos usados estão licenciados.",
};

// «Tomei conhecimento» de uma Política nova (privacy_notice, não bloqueia nada; rev. R-M6).
export const PRIVACY_NOTICE_UPDATE_TEXT = "Tomei conhecimento da Política de Privacidade (v{versao}).";

// Nome curto de cada finalidade (ficha do criador, histórico de consentimentos).
export const CONSENT_LABEL: Record<ConsentPurpose, string> = {
  adult: "Maioridade",
  terms: "Termos de participação",
  privacy_notice: "Política de Privacidade (conhecimento)",
  marketing: "Marketing",
  campaign_news: "Avisos de campanhas novas",
  data_truth: "Veracidade dos dados",
  platform_instagram: "Instagram ligado",
  platform_public: "Dados públicos do Instagram",
  ai_analysis: "Análise por IA",
  ad_disclosure: "Identificação publicitária",
  product_disclosure: "#OFERTA no unboxing",
  address_use: "Uso da morada",
  campaign_conditions: "Condições Particulares",
  paid_ads: "Anúncios pagos",
  partnership_ads: "Anúncios de parceria",
  image_voice: "Imagem e voz",
  iban_owner: "Titular do IBAN",
  vat_exempt: "Isenção de IVA (art. 53.º)",
  withholding_waiver: "Dispensa de retenção",
  content_declaration: "Declaração de conteúdo",
};

const VERSION_RE = /^[0-9]{1,3}\.[0-9]{1,3}$/;
const HANDLE_RE = /^[A-Za-z0-9._-]{1,60}$/;

// Texto de uma caixa com os marcadores preenchidos. Lança erro se faltar um valor (nunca grava «{versao}»).
export function consentText(purpose: ConsentPurpose, vars: { versao?: string | null; handle?: string | null } = {}): string {
  const base = CONSENT_TEXT[purpose];
  if (!base) throw new Error(`Finalidade sem texto: ${purpose}`);
  return fillConsent(base, vars);
}

export function privacyNoticeUpdateText(versao: string): string {
  return fillConsent(PRIVACY_NOTICE_UPDATE_TEXT, { versao });
}

function fillConsent(text: string, vars: { versao?: string | null; handle?: string | null }): string {
  let out = text;
  if (out.includes("{versao}")) {
    const v = String(vars.versao ?? "").trim();
    if (!VERSION_RE.test(v)) throw new Error("Falta a versão do documento no texto do consentimento.");
    out = out.split("{versao}").join(v);
  }
  if (out.includes("{handle}")) {
    const h = String(vars.handle ?? "").trim().replace(/^@/, "");
    if (!HANDLE_RE.test(h)) throw new Error("Falta o @ da conta no texto do consentimento.");
    out = out.split("{handle}").join(h);
  }
  return out;
}

// p_texts de ldo_cr_register: as 3 caixas do registo (sem marketing na v1, rev. R-B6).
export function registerTexts(termsVersion: string, privacyVersion: string): { terms: string; privacy_notice: string; adult: string } {
  return {
    terms: consentText("terms", { versao: termsVersion }),
    privacy_notice: consentText("privacy_notice", { versao: privacyVersion }),
    adult: consentText("adult"),
  };
}

// ---------------------------------------------------------------- validações

// NIF português: 9 algarismos, prefixo possível e dígito de controlo (módulo 11).
export function normalizeNif(value: unknown): string {
  return String(value ?? "").replace(/^PT/i, "").replace(/[\s.-]/g, "");
}

export function validNif(value: unknown): boolean {
  const n = normalizeNif(value);
  if (!/^[0-9]{9}$/.test(n)) return false;
  // 1, 2, 3 (pessoas), 45 (não residentes), 5, 6, 7x, 8, 9 (outros); 0 e 4x (exceto 45) não existem.
  if (n[0] === "0" || (n[0] === "4" && n[1] !== "5")) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(n[i]) * (9 - i);
  const r = sum % 11;
  const check = r < 2 ? 0 : 11 - r;
  return check === Number(n[8]);
}

// Comprimento do IBAN por país (registo ISO 13616 / SWIFT).
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28,
  NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

// Sem espaços e em maiúsculas (aceita «pt50 0002 …»).
export function normalizeIban(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch; // A=10 … Z=35
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

// Mensagem do problema, ou null se o IBAN for válido.
export function ibanProblem(value: unknown): string | null {
  const iban = normalizeIban(value);
  if (!iban) return "Indique o IBAN.";
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return "O IBAN começa pelas 2 letras do país e tem só letras e algarismos.";
  const len = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!len) return "Não reconhecemos o país deste IBAN. Confirme as 2 primeiras letras.";
  if (iban.length !== len) return `Um IBAN de ${iban.slice(0, 2)} tem ${len} caracteres; este tem ${iban.length}. Confirme se falta ou sobra algum.`;
  if (iban.startsWith("PT") && !/^PT[0-9]{23}$/.test(iban)) return "Um IBAN português tem só algarismos depois de PT.";
  if (mod97(iban) !== 1) return "O IBAN não está certo: confirme os algarismos (os de controlo não batem certo).";
  return null;
}

export const validIban = (value: unknown) => ibanProblem(value) === null;

// IBAN normalizado, país e 4 últimos (para iban_last4/iban_country), ou null se for inválido.
export function parseIban(value: unknown): { iban: string; country: string; last4: string } | null {
  if (!validIban(value)) return null;
  const iban = normalizeIban(value);
  return { iban, country: iban.slice(0, 2), last4: iban.slice(-4) };
}

export const ibanLast4 = (value: unknown) => normalizeIban(value).slice(-4);

// «PT50 •••• •••• •••• •••• 0154»: o país, os de controlo e os 4 últimos; nunca o resto.
export function maskIban(value: unknown): string {
  const iban = normalizeIban(value);
  if (iban.length < 12) return "••••";
  const groups = Math.max(1, Math.round((iban.length - 8) / 4));
  return [iban.slice(0, 4), ...Array(groups).fill("••••"), iban.slice(-4)].join(" ");
}

// Só os 4 últimos (é o que a BD guarda em claro e o que vai nos emails): «•••• 0154».
export function ibanTail(last4: unknown): string {
  const v = String(last4 ?? "").toUpperCase();
  return /^[0-9A-Z]{4}$/.test(v) ? `•••• ${v}` : "••••";
}

// Telefone em E.164 (+351912345678), igual ao check de ldo_cr_contacts.phone. Aceita espaços, pontos, hífenes,
// parênteses e o prefixo 00; um número português de 9 algarismos recebe +351. null se não for possível.
export function normalizePhone(value: unknown): string | null {
  let v = String(value ?? "").trim().replace(/[\s.()-]/g, "");
  if (!v) return null;
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (/^[29][0-9]{8}$/.test(v)) v = `+351${v}`;
  return validPhone(v) ? v : null;
}

export const validPhone = (value: unknown) => typeof value === "string" && /^\+[1-9][0-9]{6,14}$/.test(value);

// Nome civil (rev. S-B3): letras (qualquer alfabeto) separadas por espaço, hífen, apóstrofo ou «. »; um ponto final.
// «João», «Maria-José», «D'Ávila», «J. Silva» passam; «exemplo.pt», «https://x», «a@b.pt», «Ana2» não.
const NAME_RE = /^[\p{L}\p{M}]+(?:(?:\. |[ '’-])[\p{L}\p{M}]+)*\.?$/u;

export function cleanName(value: unknown): string {
  return String(value ?? "").normalize("NFC").replace(/[\s\p{Cc}]+/gu, " ").trim();
}

export function validName(value: unknown): boolean {
  const v = cleanName(value);
  return v.length >= 1 && v.length <= 120 && NAME_RE.test(v);
}

// Primeiro nome para «Olá Ana,» (só se o nome passar validName).
export function firstName(value: unknown): string {
  const v = cleanName(value);
  return validName(v) ? v.split(" ")[0] : "";
}

export function validEmail(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
}

// Igual a ldo_private.cr_check_password (a BD repete).
export function passwordProblem(value: unknown): string | null {
  const p = typeof value === "string" ? value : "";
  if (p.length < 10 || p.length > 128 || !/[A-Za-zÀ-ÿ]/.test(p) || !/[0-9]/.test(p))
    return "A palavra-passe tem de ter pelo menos 10 caracteres, com letras e números.";
  return null;
}

// Endereço https (portefólio, página da rede), igual aos check da BD; null se não servir.
export function httpsUrl(value: unknown, max = 300): string | null {
  const v = String(value ?? "").trim();
  if (!v || v.length > max || !/^https:\/\/[^\s]+$/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") ? v : null;
  } catch {
    return null;
  }
}

// @ de uma rede a partir do que a pessoa escreveu («@ana.silva», «instagram.com/ana.silva/», …). null se inválido.
export function normalizeHandle(value: unknown): string | null {
  let v = String(value ?? "").trim();
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|youtube\.com|facebook\.com|pinterest\.[a-z.]+)\/(.+)$/i.exec(v);
  if (m) v = m[1].split(/[/?#]/)[0];
  v = v.replace(/^@/, "");
  return HANDLE_RE.test(v) ? v : null;
}

// Nome para comparar o titular do IBAN com o nome fiscal (F3.3): minúsculas, sem acentos nem espaços repetidos.
export function normalizePersonName(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const holderMismatch = (holder: unknown, fiscalName: unknown) => normalizePersonName(holder) !== normalizePersonName(fiscalName);

export type FiscalData = {
  fiscal_name: string;
  nif: string;
  fiscal_address: string;
  tax_country: string;
  vat_regime: VatRegime;
  withholding_waiver: boolean;
  activity_code?: string | null;
};

// Dados fiscais completos e válidos (fiscal_complete), ou o problema e o campo a que diz respeito (para o formulário
// marcar o campo com aria-invalid).
export type FiscalField = "fiscal_name" | "tax_country" | "nif" | "fiscal_address" | "vat_regime" | "withholding_waiver" | "activity_code";
export function fiscalIssue(d: Partial<FiscalData> | null | undefined): { field: FiscalField | null; message: string } | null {
  if (!d) return { field: null, message: "Preencha os dados fiscais." };
  const name = cleanName(d.fiscal_name);
  if (name.length < 2 || name.length > 200 || /[<>]/.test(name)) return { field: "fiscal_name", message: "Indique o nome fiscal (como nas Finanças)." };
  const country = String(d.tax_country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { field: "tax_country", message: "Indique o país de residência fiscal." };
  if (country === "PT" ? !validNif(d.nif) : !/^[A-Z0-9]{4,20}$/i.test(normalizeNif(d.nif)))
    return { field: "nif", message: country === "PT" ? "O NIF não está certo: confirme os 9 algarismos." : "Indique o número de identificação fiscal." };
  const address = String(d.fiscal_address ?? "").trim();
  if (address.length < 5 || address.length > 400) return { field: "fiscal_address", message: "Indique a morada fiscal." };
  if (!d.vat_regime || !(d.vat_regime in VAT_REGIME_LABEL)) return { field: "vat_regime", message: "Escolha o regime de IVA." };
  if (typeof d.withholding_waiver !== "boolean") return { field: "withholding_waiver", message: "Indique se opta pela dispensa de retenção na fonte." };
  if (d.activity_code && !/^[0-9]{1,10}$/.test(String(d.activity_code).trim())) return { field: "activity_code", message: "O código de atividade tem só algarismos." };
  return null;
}
export function fiscalProblem(d: Partial<FiscalData> | null | undefined): string | null {
  return fiscalIssue(d)?.message ?? null;
}

// ---------------------------------------------------------------- onboarding (F2)

export const ONBOARDING_STEPS = [
  { key: "about", n: 1, label: "Sobre si" },
  { key: "contacts", n: 2, label: "Contactos" },
  { key: "content", n: 3, label: "Conteúdo e lojas" },
  { key: "networks", n: 4, label: "Redes" },
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export type OnboardingInput = {
  full_name?: string | null;
  city?: string | null;
  country?: string | null;
  languages?: string[] | null;
  phone?: string | null;
  categories?: string[] | null;
  formats?: string[] | null;
  social_accounts?: { platform: string; handle: string }[] | null;
};

export type OnboardingStep = { key: OnboardingStepKey; n: number; label: string; done: boolean; missing: string[] };

// Estado dos 4 passos. Regras (a BD repete-as em ldo_cr_me/ldo_cr_profile_submit):
//   about: nome civil válido, cidade, país e pelo menos 1 idioma; contacts: telemóvel em E.164;
//   content: pelo menos 1 categoria e 1 formato; networks: pelo menos 1 conta declarada.
export function onboardingSteps(p: OnboardingInput | null | undefined): OnboardingStep[] {
  const x = p || {};
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const any = (v: unknown) => Array.isArray(v) && v.length > 0;
  const missing: Record<OnboardingStepKey, string[]> = {
    about: [
      ...(validName(x.full_name) ? [] : ["o nome"]),
      ...(has(x.city) ? [] : ["a cidade"]),
      ...(has(x.country) ? [] : ["o país"]),
      ...(any(x.languages) ? [] : ["os idiomas"]),
    ],
    contacts: validPhone(x.phone) ? [] : ["o telemóvel"],
    content: [...(any(x.categories) ? [] : ["os temas"]), ...(any(x.formats) ? [] : ["os formatos"])],
    networks: any(x.social_accounts) ? [] : ["pelo menos uma rede"],
  };
  return ONBOARDING_STEPS.map((s) => ({ key: s.key, n: s.n, label: s.label, done: missing[s.key].length === 0, missing: missing[s.key] }));
}

// Primeiro passo por fazer (1..4), ou null com tudo feito.
export function nextOnboardingStep(p: OnboardingInput | null | undefined): number | null {
  const s = onboardingSteps(p).find((x) => !x.done);
  return s ? s.n : null;
}

// ---------------------------------------------------------------- etiquetas

export type CreatorStatus = "draft" | "pending_review" | "approved" | "rejected" | "suspended" | "restricted" | "deleted";

// Equipa (pílulas do backoffice).
export const CREATOR_STATUS_LABEL: Record<CreatorStatus, string> = {
  draft: "Por submeter",
  pending_review: "Por rever",
  approved: "Aprovado",
  rejected: "Recusado",
  suspended: "Suspenso",
  restricted: "Tratamento limitado",
  deleted: "Apagado",
};

// O próprio criador (painel do site).
export const CREATOR_STATUS_SITE: Record<CreatorStatus, string> = {
  draft: "Perfil por enviar",
  pending_review: "Perfil em revisão",
  approved: "Perfil aprovado",
  rejected: "Perfil não aprovado",
  suspended: "Conta suspensa",
  restricted: "Tratamento limitado a seu pedido",
  deleted: "Conta apagada",
};

export type Tone = "neutral" | "info" | "ok" | "warn" | "bad";
export const CREATOR_STATUS_TONE: Record<CreatorStatus, Tone> = {
  draft: "neutral", pending_review: "info", approved: "ok", rejected: "bad", suspended: "warn", restricted: "warn", deleted: "neutral",
};

// Selos das redes (§5.11).
export const VERIFICATION_LABEL = { declared: "Não verificado", public: "Dados públicos", verified: "Verificado", revoked: "Ligação revogada" } as const;

export const ACCESS_LEVEL_LABEL = { none: "Sem acesso", view: "Consultar", manage: "Gerir" } as const;
export const FINANCE_LABEL = "Finanças";

export const PRIVACY_KIND_LABEL = {
  access: "Acesso aos dados",
  portability: "Portabilidade",
  rectification: "Retificação",
  erasure: "Apagamento",
  objection: "Oposição",
  restriction: "Limitação do tratamento",
  human_review: "Revisão humana",
  withdrawal: "Retirada do consentimento",
  other: "Outro",
} as const;
export const PRIVACY_STATUS_LABEL = { open: "Aberto", done: "Respondido", refused: "Recusado" } as const;
export const PRIVACY_CHANNEL_LABEL = { self_service: "Na plataforma", email: "Por email", meta_callback: "Pela Meta", staff: "Pela equipa" } as const;

export const LEGAL_KIND_LABEL = {
  terms: "Termos de participação",
  privacy: "Política de Privacidade",
  cookies: "Política de Cookies",
  meta_data: "Dados obtidos da Meta",
  campaign_conditions: "Condições Particulares",
} as const;
export const LEGAL_STATUS_LABEL = { draft: "Rascunho", published: "Publicado", retired: "Retirado" } as const;

export const DELETE_REASON_LABEL = {
  self: "A pedido do próprio",
  inactivity: "Inatividade",
  staff: "Pela equipa (pedido RGPD)",
  unverified: "Email nunca confirmado",
  minor: "Menor de idade",
} as const;

// Ações da auditoria (ldo_cr_audit.action) com nome legível; as outras mostram-se como estão.
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "creator.register": "Registo",
  "creator.status": "Decisão sobre o perfil",
  "creator.view": "Ficha consultada",
  "creator.note": "Nota interna",
  "creator.minor": "Apagado por ser menor de idade",
  "creator.anonymized": "Conta anonimizada",
  "creator.password_reset": "Palavra-passe recuperada",
  "creator.password_change": "Palavra-passe mudada",
  "finance.fiscal_save": "Dados fiscais guardados",
  "finance.iban_pending": "IBAN novo por confirmar",
  "finance.iban_confirmed": "IBAN confirmado pelo titular",
  "finance.iban_rejected": "IBAN recusado pelo titular («Não fui eu»)",
  "finance.iban_confirm_refused": "Confirmação de IBAN recusada (conta suspensa)",
  "finance.reveal": "Dados de pagamento revelados",
  "metrics.validate": "Números validados",
  "legal.publish": "Documento publicado",
  "settings.save": "Definições guardadas",
  "privacy.export": "Dados exportados",
  "privacy.register": "Pedido RGPD registado",
  "privacy.extend": "Prazo do pedido prorrogado",
  "privacy.erasure": "Apagamento concluído",
  "privacy.erasure_blocked": "Apagamento à espera do fim de uma colaboração",
  "incident.lockdown": "Plataforma parada (incidente)",
  "retention.blocked": "Limpeza adiada por uma colaboração",
};

// ---------------------------------------------------------------- emails

export const CREATOR_EMAIL_FOOTER = "Loja do Ouro Criadores · criadores.lojadoouro.pt";

export type CreatorEmail = {
  subject: string;
  eyebrow: string;
  title: string; // também o título da notificação no painel (me.notifications)
  paragraphs: string[]; // texto simples; o HTML é escapado ao montar
  quote?: { label: string | null; text: string } | null; // texto de terceiros (motivo, resposta), sem ligações
  after?: string[]; // parágrafos depois da citação
  button: { label: string; url: string } | null;
  secondary?: { label: string; url: string } | null; // segunda ligação, em texto
};

// Linha de ldo_cr_outbox_claim (o claim junta o email e o primeiro nome; nunca IBAN, NIF nem morada).
export type CreatorOutboxItem = {
  id: number;
  kind: string;
  payload: Record<string, unknown> | null;
  lease?: string;
  email?: string;
  first_name?: string | null;
  deleted?: boolean;
};

// Kinds da fase 1 (PR1). Os do PR2 e do PR3 juntam-se aqui quando entrarem; um kind desconhecido devolve null.
export const PR1_OUTBOX_KINDS = [
  "profile_received", "profile_approved", "profile_rejected", "profile_suspended", "message", "finance_saved", "login_locked",
  "terms_updated", "inactivity_warning", "privacy_request_done", "privacy_request_extended", "privacy_updated", "erasure_blocked",
] as const;
export type Pr1OutboxKind = (typeof PR1_OUTBOX_KINDS)[number];

const trimUrl = (u: string) => String(u || "").replace(/\/+$/, "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+$/g, "").slice(0, max).trim() : "");
const version = (v: unknown) => (typeof v === "string" && VERSION_RE.test(v.trim()) ? v.trim() : "");
const isoOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const CNPD = "Se não concordar, pode apresentar reclamação à Comissão Nacional de Proteção de Dados (www.cnpd.pt).";

function privacyKind(v: unknown): string {
  return typeof v === "string" && v in PRIVACY_KIND_LABEL ? PRIVACY_KIND_LABEL[v as keyof typeof PRIVACY_KIND_LABEL].toLowerCase() : "";
}

// Texto de cada aviso da fila (ldo_cr_outbox). Só lê do payload os campos previstos para cada kind.
export function outboxEmail(item: CreatorOutboxItem, siteUrl: string): CreatorEmail | null {
  const site = trimUrl(siteUrl);
  const p = item.payload && typeof item.payload === "object" ? item.payload : {};
  const name = firstName(item.first_name);
  const hi = name ? `Olá ${name},` : "Olá,";
  const painel = { label: "Abrir o painel", url: `${site}/painel` };
  switch (item.kind as Pr1OutboxKind) {
    case "profile_received":
      return {
        subject: "Recebemos o seu perfil · Loja do Ouro Criadores", eyebrow: "CRIADORES · PERFIL", title: "Recebemos o seu perfil",
        paragraphs: [hi, "Obrigado por se juntar à plataforma de criadores da Loja do Ouro. A equipa vai rever o seu perfil e responde-lhe por email.",
          "Quem decide é sempre uma pessoa da equipa, sem pontuações automáticas. Entretanto pode completar ou corrigir os seus dados no painel."],
        button: painel,
      };
    case "profile_approved":
      return {
        subject: "O seu perfil foi aprovado · Loja do Ouro Criadores", eyebrow: "CRIADORES · PERFIL", title: "O seu perfil foi aprovado",
        paragraphs: [hi, "A equipa aprovou o seu perfil na plataforma de criadores da Loja do Ouro.",
          "Avisamo-lo quando houver campanhas abertas. Se mudar de redes ou de dados, atualize o perfil no painel."],
        button: painel,
      };
    case "profile_rejected": {
      const reason = text(p.reason, 1000);
      return {
        subject: "O seu perfil não foi aprovado · Loja do Ouro Criadores", eyebrow: "CRIADORES · PERFIL", title: "O seu perfil não foi aprovado",
        paragraphs: [hi, "A equipa reviu o seu perfil e, desta vez, não o aprovou."],
        quote: reason ? { label: "Motivo indicado pela equipa", text: reason } : null,
        after: ["Pode corrigir os dados e enviar o perfil de novo para revisão. Se tiver dúvidas, escreva-nos em Mensagens."],
        button: painel,
      };
    }
    case "profile_suspended": {
      const reason = text(p.reason, 1000);
      return {
        subject: "A sua conta foi suspensa · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA", title: "A sua conta foi suspensa",
        paragraphs: [hi, "A equipa suspendeu a sua conta na plataforma de criadores. Enquanto durar a suspensão, não pode candidatar-se nem fazer pedidos."],
        quote: reason ? { label: "Motivo indicado pela equipa", text: reason } : null,
        after: ["Pode continuar a entrar para ver os seus dados, descarregá-los ou apagar a conta. Para esclarecer, escreva-nos em Mensagens."],
        button: { label: "Abrir as mensagens", url: `${site}/mensagens` },
      };
    }
    case "message": {
      const n = typeof p.count === "number" && Number.isInteger(p.count) && p.count > 1 ? p.count : 1;
      return {
        subject: "Tem uma mensagem nova · Loja do Ouro Criadores", eyebrow: "CRIADORES · MENSAGENS",
        title: n > 1 ? `Tem ${n} mensagens novas` : "Tem uma mensagem nova",
        paragraphs: [hi, n > 1 ? `A equipa da Loja do Ouro enviou-lhe ${n} mensagens.` : "A equipa da Loja do Ouro enviou-lhe uma mensagem.",
          "Por segurança, o texto não vai no email: leia-o na plataforma."],
        button: { label: "Ler as mensagens", url: `${site}/mensagens` },
      };
    }
    case "finance_saved":
      return {
        subject: "Dados fiscais guardados · Loja do Ouro Criadores", eyebrow: "CRIADORES · PAGAMENTOS", title: "Os seus dados fiscais foram guardados",
        paragraphs: [hi, `Guardámos as alterações aos seus dados fiscais a ${lisbonDateTime(isoOrNull(p.at) || new Date().toISOString())} (hora de Lisboa).`,
          "Se não foi você, mude já a palavra-passe e escreva-nos em Mensagens."],
        button: { label: "Ver os dados de pagamento", url: `${site}/pagamentos` },
      };
    case "login_locked":
      return {
        subject: "Muitas tentativas de entrada na sua conta · Loja do Ouro Criadores", eyebrow: "CRIADORES · SEGURANÇA",
        title: "Bloqueámos as entradas na sua conta",
        paragraphs: ["Olá,", "Houve muitas tentativas de entrada na sua conta com a palavra-passe errada, por isso bloqueámos as entradas durante algum tempo.",
          "Se não reconhece estas tentativas, use «Recuperar a palavra-passe»: escolhe uma nova e a conta fica desbloqueada."],
        button: { label: "Recuperar a palavra-passe", url: `${site}/conta/recuperar` },
      };
    case "terms_updated": {
      const v = version(p.version);
      const summary = text(p.changes_summary, 2000);
      return {
        subject: "Atualizámos os Termos de participação · Loja do Ouro Criadores", eyebrow: "CRIADORES · TERMOS",
        title: "Atualizámos os Termos de participação",
        paragraphs: [hi, `Publicámos uma nova versão dos Termos de participação${v ? ` (v${v})` : ""}. Para continuar a candidatar-se e a fazer pedidos, leia-a e aceite-a na plataforma.`],
        quote: summary ? { label: "O que mudou", text: summary } : null,
        button: { label: "Ler os Termos", url: `${site}/conta/novos-termos` },
      };
    }
    case "inactivity_warning": {
      const on = isoOrNull(p.delete_on);
      return {
        subject: "A sua conta vai ser apagada por inatividade · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA",
        title: "Sentimos a sua falta",
        paragraphs: [hi, `Não entra na plataforma de criadores há muito tempo. Se não entrar ${on ? `até ${lisbonDate(on)}` : "nos próximos 2 meses"}, apagamos a sua conta e os dados do perfil.`,
          "Ficam só os dados que a lei nos obriga a guardar, como os pagamentos. Para manter a conta, basta entrar."],
        button: { label: "Entrar", url: `${site}/conta/entrar` },
      };
    }
    case "privacy_request_done": {
      const kind = privacyKind(p.kind);
      const response = text(p.response, 4000);
      // Recusa (art. 12.º, n.º 4, do RGPD): dizer que não se dá seguimento, porquê, e as vias de reclamação e recurso.
      if (p.status === "refused") {
        return {
          subject: "Não podemos dar seguimento ao seu pedido · Loja do Ouro Criadores", eyebrow: "CRIADORES · PRIVACIDADE",
          title: "Não podemos dar seguimento ao seu pedido",
          paragraphs: [hi, kind ? `Analisámos o seu pedido de ${kind} e não lhe podemos dar seguimento.` : "Analisámos o seu pedido sobre os seus dados pessoais e não lhe podemos dar seguimento."],
          quote: response ? { label: "Motivo", text: response } : null,
          after: ["Se não concordar, pode apresentar reclamação à Comissão Nacional de Proteção de Dados (www.cnpd.pt) ou recorrer aos tribunais."],
          button: null,
        };
      }
      return {
        subject: "Respondemos ao seu pedido · Loja do Ouro Criadores", eyebrow: "CRIADORES · PRIVACIDADE", title: "Respondemos ao seu pedido",
        paragraphs: [hi, kind ? `Concluímos o seu pedido de ${kind}.` : "Concluímos o seu pedido sobre os seus dados pessoais."],
        quote: response ? { label: "Resposta da equipa", text: response } : null,
        after: [CNPD],
        button: null,
      };
    }
    case "privacy_request_extended": {
      const kind = privacyKind(p.kind);
      const until = isoOrNull(p.extended_until);
      const reason = text(p.reason, 1000);
      return {
        subject: "Precisamos de mais tempo para responder · Loja do Ouro Criadores", eyebrow: "CRIADORES · PRIVACIDADE",
        title: "Precisamos de mais tempo para responder",
        paragraphs: [hi, `${kind ? `O seu pedido de ${kind}` : "O seu pedido sobre os seus dados pessoais"} precisa de mais tempo. Vamos responder${until ? ` até ${lisbonDate(until)}` : " dentro de dois meses"}, como permite o artigo 12.º, n.º 3, do RGPD.`],
        quote: reason ? { label: "Motivo", text: reason } : null,
        after: [CNPD],
        button: null,
      };
    }
    case "privacy_updated": {
      const v = version(p.version);
      const summary = text(p.changes_summary, 2000);
      return {
        subject: "Atualizámos a Política de Privacidade · Loja do Ouro Criadores", eyebrow: "CRIADORES · PRIVACIDADE",
        title: "Atualizámos a Política de Privacidade",
        paragraphs: [hi, `Publicámos uma nova versão da Política de Privacidade${v ? ` (v${v})` : ""}. Não precisa de aceitar nada: a Política explica como tratamos os seus dados.`],
        quote: summary ? { label: "O que mudou", text: summary } : null,
        button: { label: "Ler a Política", url: `${site}/privacidade` },
      };
    }
    case "erasure_blocked": {
      const detail = text(p.detail, 1000);
      return {
        subject: "Ainda não apagámos a sua conta · Loja do Ouro Criadores", eyebrow: "CRIADORES · PRIVACIDADE",
        title: "Ainda não apagámos a sua conta",
        paragraphs: [hi, "Recebemos o seu pedido para apagar a conta, mas tem uma colaboração a decorrer."],
        quote: detail ? { label: "Motivo", text: detail } : null,
        after: ["Já apagámos o que dependia da sua autorização, como os avisos de campanhas novas. Guardamos o resto enquanto a colaboração durar e apagamos quando terminar.",
          "Respondemos por email no prazo de um mês.", CNPD],
        button: { label: "Abrir as mensagens", url: `${site}/mensagens` },
      };
    }
    default:
      return null;
  }
}

// Título para a lista de notificações do painel (null num kind desconhecido).
export function outboxTitle(kind: string, payload: Record<string, unknown> | null = null): string | null {
  return outboxEmail({ id: 0, kind, payload }, "")?.title ?? null;
}

// Emails da conta (rev. S-B3: sem o nome, começam por «Olá,»; rev. S-B11: o token vai depois de #, nunca em ?t=).
const TOKEN_RE = /^[0-9a-f]{64}$/;
function tokenLink(site: string, path: string, token: string) {
  if (!TOKEN_RE.test(token)) throw new Error("Token inválido para a ligação.");
  return `${trimUrl(site)}${path}#t=${token}`;
}

export function verifyEmailText(siteUrl: string, token: string, opts: { pending?: boolean } = {}): CreatorEmail {
  return {
    subject: "Confirme o seu email · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA", title: "Confirme o seu email",
    paragraphs: opts.pending
      ? ["Olá,", "Já existe um registo por confirmar com este endereço na plataforma de criadores da Loja do Ouro. Para o confirmar, abra a ligação e escreva a palavra-passe escolhida nesse registo.",
        "Se não fez este registo, ignore este email: sem confirmação, o registo é apagado em 30 dias."]
      : ["Olá,", "Recebemos um registo na plataforma de criadores da Loja do Ouro com este endereço. Para o confirmar, abra a ligação e escreva a palavra-passe que escolheu.",
        "A ligação é válida durante 48 horas. Se não fez este registo, ignore este email: sem confirmação, o registo é apagado em 30 dias."],
    button: { label: "Confirmar o email", url: tokenLink(siteUrl, "/conta/confirmar", token) },
  };
}

export function accountExistsText(siteUrl: string): CreatorEmail {
  const site = trimUrl(siteUrl);
  return {
    subject: "Já tem conta · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA", title: "Já tem conta na plataforma",
    paragraphs: ["Olá,", "Alguém tentou registar este endereço na plataforma de criadores da Loja do Ouro, mas já existe uma conta com ele.",
      "Se foi você, entre com a sua palavra-passe ou recupere-a. Se não foi, ignore este email: nada muda na sua conta."],
    button: { label: "Entrar", url: `${site}/conta/entrar` },
    secondary: { label: "Recuperar a palavra-passe", url: `${site}/conta/recuperar` },
  };
}

export function resetEmailText(siteUrl: string, token: string): CreatorEmail {
  return {
    subject: "Nova palavra-passe · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA", title: "Escolha uma nova palavra-passe",
    paragraphs: ["Olá,", "Recebemos um pedido para mudar a palavra-passe da sua conta na plataforma de criadores da Loja do Ouro.",
      "A ligação é válida durante 2 horas e só pode ser usada uma vez. Se não foi você, ignore este email: nada muda."],
    button: { label: "Escolher a palavra-passe", url: tokenLink(siteUrl, "/conta/nova-palavra-passe", token) },
  };
}

// Confirmação de um IBAN novo (rev. S-A1): na hora, para o email da conta, com os 4 últimos e nunca mais.
export function ibanConfirmText(siteUrl: string, token: string, last4: string, requestedAt: string): CreatorEmail {
  const tail = String(last4 || "").toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(tail)) throw new Error("Últimos 4 caracteres do IBAN inválidos.");
  return {
    subject: "Confirme o seu IBAN · Loja do Ouro Criadores", eyebrow: "CRIADORES · PAGAMENTOS", title: "Confirme o IBAN novo",
    paragraphs: ["Olá,", `Pediu para receber os pagamentos no IBAN terminado em ${tail} (pedido a ${lisbonDateTime(requestedAt)}, hora de Lisboa). Até confirmar, continua a valer o anterior.`,
      "Se não fez este pedido, carregue em «Não fui eu»: terminamos todas as sessões e pedimos uma palavra-passe nova.",
      "A ligação é válida durante 48 horas e só pode ser usada uma vez. Depois de confirmar, os pagamentos para este IBAN esperam 72 horas."],
    button: { label: "Confirmar ou recusar o IBAN", url: tokenLink(siteUrl, "/conta/iban", token) },
  };
}

export function accountDeletedText(): CreatorEmail {
  return {
    subject: "A sua conta foi apagada · Loja do Ouro Criadores", eyebrow: "CRIADORES · CONTA", title: "A sua conta foi apagada",
    paragraphs: ["Olá,", "Apagámos a sua conta na plataforma de criadores da Loja do Ouro e os dados do seu perfil.",
      "Guardamos só o que a lei nos obriga: os pagamentos (10 anos) e o registo dos consentimentos (5 anos), já sem ligação a uma conta ativa.",
      "Se não pediu isto, responda a este email com urgência."],
    button: null,
  };
}

// Aviso de segurança para os Super Admin (rev. S-M8): sem dados de criadores.
export function revealAlertText(dashboardUrl: string, staffName: string, count: number): CreatorEmail {
  const who = cleanName(staffName).slice(0, 120) || "Um utilizador";
  return {
    subject: "Aviso: muitas revelações de IBAN · Influenciadores", eyebrow: "INFLUENCIADORES · SEGURANÇA", title: "Muitas revelações de IBAN",
    paragraphs: [`${who} revelou ${Math.max(0, Math.floor(count))} IBAN nas últimas 24 h.`,
      "Se não reconhece este uso, desative o utilizador em Administração → Utilizadores."],
    button: { label: "Abrir os utilizadores", url: `${trimUrl(dashboardUrl)}/admin/utilizadores` },
  };
}

// HTML do email (brandEmail; tudo escapado). logoBaseUrl: endereço que serve /logo-loja-do-ouro.png (o do dashboard:
// no domínio dos criadores esse caminho é reescrito para /c/… e não existe).
export function creatorEmailHtml(t: CreatorEmail, logoBaseUrl: string): string {
  const body = [
    ...t.paragraphs.map((x) => emailParagraph(esc(x))),
    ...(t.quote ? [emailQuote(t.quote.label, t.quote.text, { links: false })] : []),
    ...(t.after || []).map((x) => emailParagraph(esc(x))),
  ].join("");
  const after = t.secondary
    ? emailParagraph(`<a href="${esc(t.secondary.url)}" style="color:${BRAND.gold}">${esc(t.secondary.label)}</a>`)
    : undefined;
  return brandEmail({
    baseUrl: trimUrl(logoBaseUrl), eyebrow: t.eyebrow, title: t.title, preheader: t.paragraphs[1] || t.title, body,
    button: t.button ?? undefined, after, footer: CREATOR_EMAIL_FOOTER,
  });
}

// Versão em texto simples.
export function creatorEmailText(t: CreatorEmail): string {
  return [
    ...t.paragraphs,
    ...(t.quote ? [`${t.quote.label ? `${t.quote.label}:\n` : ""}«${t.quote.text}»`] : []),
    ...(t.after || []),
    ...(t.button ? [`${t.button.label}: ${t.button.url}`] : []),
    ...(t.secondary ? [`${t.secondary.label}: ${t.secondary.url}`] : []),
    CREATOR_EMAIL_FOOTER,
  ].join("\n\n");
}

// ---------------------------------------------------------------- redact (rev. S-B11, META-1)

// Parâmetros cujo valor nunca pode ir para registos, colunas de detalhe nem console.* (o «code» só como parâmetro
// próprio: error_code=100 fica).
const SECRET_PARAMS = ["access_token", "client_secret", "code", "signed_request", "refresh_token", "fb_exchange_token", "input_token", "appsecret_proof"];
const SECRET_JSON = ["access_token", "client_secret", "refresh_token", "input_token", "appsecret_proof", "signed_request", "fb_exchange_token"];
const NAMES = SECRET_PARAMS.join("|");
const JSON_NAMES = SECRET_JSON.join("|");
const BEFORE = `(^|[?&#\\s"'(;,/{]|%3[Ff]|%26)`;
const PARAM_RE = new RegExp(`${BEFORE}(${NAMES})=([^&#\\s"'<>)]*)`, "gi");
const PARAM_ENC_RE = new RegExp(`${BEFORE}(${NAMES})%3[Dd]((?:(?!%26)[^&#\\s"'<>)])*)`, "gi");
const T_RE = new RegExp(`${BEFORE}t=[0-9a-fA-F]{64}(?![0-9a-fA-F])`, "g");
const JSON_RE = new RegExp(`("(?:${JSON_NAMES})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi");
const JSON_ESC_RE = new RegExp(`(\\\\"(?:${JSON_NAMES})\\\\"\\s*:\\s*)\\\\"(?:[^"\\\\]|\\\\[^"])*\\\\"`, "gi");
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=|%-]+/gi;
const APP_TOKEN_RE = /\b[0-9]{8,20}\|[A-Za-z0-9_-]{16,}/g;
const META_TOKEN_RE = /\b(?:EAA[A-Za-z0-9]{20,}|IGQ[A-Za-z0-9_-]{20,})/g;

const R = "[removido]";

// Texto sem segredos, para registos e colunas de detalhe. Aceita texto, Error ou outro valor. max: corta no fim.
export function redact(value: unknown, max?: number): string {
  let s: string;
  if (typeof value === "string") s = value;
  else if (value instanceof Error) s = `${value.name}: ${value.message}`;
  else {
    try {
      s = JSON.stringify(value) ?? String(value);
    } catch {
      s = String(value);
    }
  }
  s = s
    .replace(PARAM_RE, (_m, pre: string, name: string) => `${pre}${name}=${R}`)
    .replace(PARAM_ENC_RE, (_m, pre: string, name: string) => `${pre}${name}%3D${R}`)
    .replace(T_RE, (_m, pre: string) => `${pre}t=${R}`)
    .replace(JSON_RE, (_m, key: string) => `${key}"${R}"`)
    .replace(JSON_ESC_RE, (_m, key: string) => `${key}\\"${R}\\"`)
    .replace(BEARER_RE, (_m, word: string) => `${word} ${R}`)
    .replace(APP_TOKEN_RE, R)
    .replace(META_TOKEN_RE, R);
  return max && s.length > max ? s.slice(0, max) : s;
}

// ---------------------------------------------------------------- prazos de conservação (§7.3, rev. S-B6)

// Valor por omissão de ldo_cr_settings.retention (migração A). As migrações B e C juntam chaves: acrescentá-las
// também aqui (RETENTION_DEFAULT e RETENTION_LABEL) no PR em que entram.
export const RETENTION_DEFAULT = {
  unverified_days: 30, attempts_days: 30, inactive_warn_months: 22, inactive_months: 24,
  captions_months: 12, platform_months: 24, hourly_snapshots_days: 30, ai_months: 12,
  address_months: 12, applications_months: 24, messages_months: 24, audit_months: 12,
  audit_decisions_years: 5, outbox_days: 90, payments_years: 10, consents_years_after_end: 5,
  sync_log_days: 30, privacy_requests_years: 5, pending_files_hours: 24,
  proof_years: 3, licence_files_years_after_end: 3, rejected_submissions_days: 90,
  declared_metrics_months: 24, evidence_months: 12, requests_months: 24, blob_deletions_days: 30,
  meta_requests_years: 5, meta_requests_id_days: 90,
} as const;
export type RetentionKey = keyof typeof RETENTION_DEFAULT;
export const RETENTION_KEYS = Object.keys(RETENTION_DEFAULT) as RetentionKey[];

export const RETENTION_LABEL: Record<RetentionKey, string> = {
  unverified_days: "Conta por confirmar",
  attempts_days: "Tentativas (entradas, registos e limites)",
  inactive_warn_months: "Aviso de inatividade",
  inactive_months: "Conta inativa (apagar)",
  captions_months: "Legendas das publicações",
  platform_months: "Dados obtidos da Meta",
  hourly_snapshots_days: "Leituras de hora a hora",
  ai_months: "Indicadores e análises IA",
  address_months: "Morada de envio (depois do fim do pedido)",
  applications_months: "Candidaturas não selecionadas",
  messages_months: "Mensagens",
  audit_months: "Auditoria corrente",
  audit_decisions_years: "Decisões e provas RGPD (auditoria)",
  outbox_days: "Emails enviados (fila)",
  payments_years: "Pagamentos",
  consents_years_after_end: "Consentimentos (depois do fim da conta)",
  sync_log_days: "Registo de sincronização",
  privacy_requests_years: "Pedidos RGPD",
  pending_files_hours: "Ficheiros reservados e não carregados",
  proof_years: "Prova de publicação",
  licence_files_years_after_end: "Ficheiros licenciados (depois do fim da licença)",
  rejected_submissions_days: "Entregas recusadas ou retiradas",
  declared_metrics_months: "Números declarados",
  evidence_months: "Capturas das estatísticas",
  requests_months: "Pedidos de produto concluídos",
  blob_deletions_days: "Fila de apagamento de ficheiros",
  meta_requests_years: "Pedidos da Meta",
  meta_requests_id_days: "Identificador da pessoa na Meta",
};

export type RetentionUnit = "days" | "months" | "years" | "hours";
export const RETENTION_UNIT_LABEL: Record<RetentionUnit, string> = { days: "dias", months: "meses", years: "anos", hours: "horas" };
const UNIT_ONE: Record<RetentionUnit, string> = { days: "dia", months: "mês", years: "ano", hours: "hora" };
const amount = (n: number, unit: RetentionUnit) => `${n} ${n === 1 ? UNIT_ONE[unit] : RETENTION_UNIT_LABEL[unit]}`;
const RETENTION_MAX: Record<RetentionUnit, number> = { days: 3650, months: 120, years: 30, hours: 720 };
// Pisos de ldo_private.cr_ret [a confirmar: advogado]; os restantes 1. Mudam só com migração.
const RETENTION_FLOORS: Record<string, number> = {
  payments_years: 10, consents_years_after_end: 5, audit_decisions_years: 5, inactive_months: 12, proof_years: 3,
};

export function retentionUnit(key: string): RetentionUnit | null {
  const m = /_(days|months|years|hours)(?:_|$)/.exec(key);
  return m ? (m[1] as RetentionUnit) : null;
}
export const retentionFloor = (key: string) => RETENTION_FLOORS[key] ?? 1;
export const retentionMax = (key: string) => {
  const u = retentionUnit(key);
  return u ? RETENTION_MAX[u] : 0;
};

// A mesma validação de ldo_cr_settings_save: todas as chaves conhecidas e só essas, inteiros entre o piso e o teto,
// e o aviso de inatividade antes da anonimização. Devolve a mensagem (com o nome da chave) ou null.
export function retentionProblem(retention: unknown, keys: readonly string[] = RETENTION_KEYS): string | null {
  if (!retention || typeof retention !== "object" || Array.isArray(retention)) return "Os prazos de conservação têm de ser um objeto.";
  const r = retention as Record<string, unknown>;
  const label = (k: string) => (k in RETENTION_LABEL ? `«${RETENTION_LABEL[k as RetentionKey]}» (${k})` : k);
  for (const k of Object.keys(r)) if (!keys.includes(k)) return `Prazo desconhecido: ${k}.`;
  for (const k of keys) {
    const unit = retentionUnit(k);
    if (!unit) return `Prazo sem unidade: ${k}.`;
    if (!(k in r)) return `Falta o prazo ${label(k)}.`;
    const v = r[k];
    if (typeof v !== "number" || !Number.isInteger(v)) return `O prazo ${label(k)} tem de ser um número inteiro de ${RETENTION_UNIT_LABEL[unit]}.`;
    const floor = retentionFloor(k);
    if (v < floor) return `O prazo ${label(k)} não pode ser menor do que ${amount(floor, unit)}.`;
    if (v > RETENTION_MAX[unit]) return `O prazo ${label(k)} não pode passar de ${amount(RETENTION_MAX[unit], unit)}.`;
  }
  if (keys.includes("inactive_warn_months") && keys.includes("inactive_months") && (r.inactive_warn_months as number) >= (r.inactive_months as number))
    return "O aviso de inatividade (inactive_warn_months) tem de ser antes do apagamento (inactive_months).";
  return null;
}

// ---------------------------------------------------------------- Markdown dos documentos legais

// Render próprio e seguro (§4.3 c/legal.tsx): só parágrafos, títulos, listas, negrito, itálico e ligações https
// (ou caminhos do próprio site, «/dados-meta»). Nada de HTML: o texto é sempre texto. legal.tsx desenha os blocos
// com React (sem dangerouslySetInnerHTML); legalMarkdownToHtml serve para emails e testes, com tudo escapado.

export type LegalInline =
  | { t: "text"; v: string }
  | { t: "strong"; c: LegalInline[] }
  | { t: "em"; c: LegalInline[] }
  | { t: "link"; href: string; internal: boolean; c: LegalInline[] };

export type LegalBlock =
  | { t: "h"; level: 2 | 3 | 4; c: LegalInline[] }
  | { t: "p"; c: LegalInline[] }
  | { t: "ul" | "ol"; items: LegalInline[][] }
  | { t: "hr" };

// Ligação permitida: https com host, ou caminho do site começado por «/» (nunca «//»). null = só o texto.
export function safeLegalHref(href: string): { href: string; internal: boolean } | null {
  const h = href.trim();
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(h) && !h.includes("\\")) return { href: h, internal: true };
  if (!/^https:\/\/[^\s<>"']+$/i.test(h)) return null;
  try {
    const u = new URL(h);
    return u.protocol === "https:" && u.hostname ? { href: u.toString(), internal: false } : null;
  } catch {
    return null;
  }
}

const INLINE_RE = /\[([^\]\n]{1,300})\]\(([^()\s]{1,500})\)|\*\*([^*\n]{1,1000}?)\*\*|\*([^*\n]{1,1000}?)\*|(^|[^\p{L}\p{N}_])_([^_\n]{1,1000}?)_(?![\p{L}\p{N}_])/u;

export function parseLegalInline(src: string, depth = 0): LegalInline[] {
  const out: LegalInline[] = [];
  const push = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  if (depth > 3) {
    push(src);
    return out;
  }
  let rest = src;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      push(rest);
      break;
    }
    let start = m.index;
    if (m[6] !== undefined) {
      push(rest.slice(0, start) + m[5]); // o carácter antes do «_» fica no texto
      start += m[5].length;
    } else push(rest.slice(0, start));
    if (m[1] !== undefined) {
      const ok = safeLegalHref(m[2]);
      const c = parseLegalInline(m[1], depth + 1);
      if (ok) out.push({ t: "link", href: ok.href, internal: ok.internal, c });
      else for (const x of c) x.t === "text" ? push(x.v) : out.push(x); // ligação recusada: fica só o texto
    } else if (m[3] !== undefined) out.push({ t: "strong", c: parseLegalInline(m[3], depth + 1) });
    else if (m[4] !== undefined) out.push({ t: "em", c: parseLegalInline(m[4], depth + 1) });
    else out.push({ t: "em", c: parseLegalInline(m[6], depth + 1) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseLegalMarkdown(md: string): LegalBlock[] {
  const lines = String(md || "").slice(0, 200000).replace(/\r\n?/g, "\n").split("\n");
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseLegalInline(para.join(" ")) });
    para = [];
    if (list) blocks.push({ t: list.t, items: list.items.map((x) => parseLegalInline(x)) });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*>\s?/, "").replace(/\s+$/, ""); // citações: o texto, sem o «>»
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*$/.exec(trimmed);
    if (h) {
      flush();
      blocks.push({ t: "h", level: Math.min(4, h[1].length + 1) as 2 | 3 | 4, c: parseLegalInline(h[2]) });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ t: "hr" });
      continue;
    }
    const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ol = /^[0-9]{1,3}[.)]\s+(.+)$/.exec(trimmed);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (para.length || (list && list.t !== kind)) flush();
      if (!list) list = { t: kind, items: [] };
      list.items.push((ul || ol)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${trimmed}`; // continuação do item
      continue;
    }
    if (list) flush();
    para.push(trimmed);
  }
  flush();
  return blocks;
}

function inlineHtml(nodes: LegalInline[]): string {
  return nodes
    .map((n) => {
      if (n.t === "text") return esc(n.v);
      if (n.t === "strong") return `<strong>${inlineHtml(n.c)}</strong>`;
      if (n.t === "em") return `<em>${inlineHtml(n.c)}</em>`;
      return `<a href="${esc(n.href)}"${n.internal ? "" : ' rel="noopener noreferrer nofollow"'}>${inlineHtml(n.c)}</a>`;
    })
    .join("");
}

export function legalMarkdownToHtml(md: string): string {
  return parseLegalMarkdown(md)
    .map((b) => {
      if (b.t === "h") return `<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`;
      if (b.t === "p") return `<p>${inlineHtml(b.c)}</p>`;
      if (b.t === "hr") return "<hr>";
      return `<${b.t}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${b.t}>`;
    })
    .join("\n");
}
