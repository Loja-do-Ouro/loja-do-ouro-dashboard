// Regras da Private Selection (área reservada da loja, com senha) que não dependem do servidor: formulário do tema,
// marca e língua, endereço de entrada na loja, peças guardadas, código de membro e pedidos à Klaviyo. Sem I/O
// (testado em tests/private-selection.cjs);
// as rotas estão em app/api/private-selection/ e o envio em lib/private-selection/.
import { isEmail, parseOrigins, SITES } from "./support/site-rules";

// Duas marcas, como no tema: Loja do Ouro só em português com o país Portugal; em tudo o resto, Gold Store Premium.
// "Private Selection" fica em inglês em todas as línguas (é nome de marca).
export const PS_LOCALES = ["pt", "en", "es", "fr", "de", "it"] as const;
export type PsLocale = (typeof PS_LOCALES)[number];
export type PsBrand = "ldo" | "gsp";

export const PS_INTL: Record<PsLocale, string> = { pt: "pt-PT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" };

type BrandInfo = {
  name: string; store: string; origin: string; domain: string; logo: string; // logótipo dos emails (ficheiro em public/)
  prefixes: Record<PsLocale, string>; // prefixo de cada língua nos endereços da loja
};
// Prefixos = línguas de cada domínio no Shopify Markets (out. 2026): lojadoouro.pt tem pt, en, es, fr e de (fr e de
// ainda por publicar); goldstorepremium.com tem en, es e pt-PT. Uma língua que o domínio não tem abre na língua
// principal do domínio (""), em vez de uma página que não existe. Ao juntar uma língua a um domínio, acrescentar aqui.
export const PS_BRANDS: Record<PsBrand, BrandInfo> = {
  ldo: {
    name: `${SITES.ldo.brand} Private Selection`, store: SITES.ldo.brand, origin: SITES.ldo.origin, domain: SITES.ldo.domain, logo: SITES.ldo.logo,
    prefixes: { pt: "", en: "/en", es: "/es", fr: "/fr", de: "/de", it: "" },
  },
  gsp: {
    name: `${SITES.gsp.brand} Private Selection`, store: SITES.gsp.brand, origin: SITES.gsp.origin, domain: SITES.gsp.domain, logo: SITES.gsp.logo,
    prefixes: { en: "", es: "/es", pt: "/pt-pt", fr: "", de: "", it: "" },
  },
};

export const isLocale = (v: unknown): v is PsLocale => typeof v === "string" && (PS_LOCALES as readonly string[]).includes(v);
export const isBrand = (v: unknown): v is PsBrand => v === "ldo" || v === "gsp";

// Porque é que um pedido ficou à espera da equipa (ldo_ps_blocked.reason), com o membro removido que o bloqueia.
export function blockedReasonText(reason: string, removedEmail: string | null): string {
  const who = removedEmail ? ` (${removedEmail})` : "";
  if (reason === "removed_email") return "Este email foi removido da Private Selection.";
  if (reason === "removed_mailbox") return `Outra forma deste email foi removida${who}.`;
  if (reason === "removed_phone") return `O telemóvel é o de um membro removido${who}.`;
  return "Pedido de uma pessoa removida.";
}

// "pt-PT", "IT", "es_ES" → pt, it, es. Outra língua ou valor inválido → fallback.
export function pickLocale(v: unknown, fallback: PsLocale = "en"): PsLocale {
  if (typeof v !== "string") return fallback;
  const k = v.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(k) ? k : fallback;
}

// Regra do tema: Loja do Ouro só em português e com o país PT (sem país, no dashboard, conta como PT).
export function brandFor(locale: unknown, country: unknown = "PT"): PsBrand {
  return pickLocale(locale) === "pt" && typeof country === "string" && country.trim().toUpperCase() === "PT" ? "ldo" : "gsp";
}

// Marca e língua guardadas na BD (valores inválidos: Gold Store Premium, na língua da raiz do domínio).
export function psLang(brand: unknown, locale: unknown): { brand: PsBrand; locale: PsLocale } {
  const b = isBrand(brand) ? brand : "gsp";
  return { brand: b, locale: pickLocale(locale, b === "ldo" ? "pt" : "en") };
}

export const brandName = (brand: string) => PS_BRANDS[psLang(brand, null).brand].name;

// Lojas que podem chamar a API pública. PRIVATE_SELECTION_ORIGINS substitui a lista (separada por vírgulas).
export const PS_DEFAULT_ORIGINS = [
  "https://www.lojadoouro.pt", "https://lojadoouro.pt",
  "https://lojadoouro-online.myshopify.com",
  "https://www.goldstorepremium.com", "https://goldstorepremium.com",
];
export const psOrigins = () => parseOrigins(process.env.PRIVATE_SELECTION_ORIGINS, PS_DEFAULT_ORIGINS);

// Página da Private Selection na loja (definições: entry_path). Sem prefixo de língua: o do cliente junta-se aqui.
export const PS_DEFAULT_ENTRY_PATH = "/products/pulseira-marquesa-em-ouro-19kl-20-1cm?view=private-selection";

// Endereço do botão do email: domínio da marca, prefixo da língua do cliente e o caminho das definições. Um prefixo
// de língua que já venha no caminho é trocado pelo do cliente; um caminho inválido dá o de origem.
export function entryUrl(brand: string, locale: string, path?: string | null) {
  const l = psLang(brand, locale);
  const info = PS_BRANDS[l.brand];
  let p = typeof path === "string" ? path.trim() : "";
  if (!/^\/(?![/\\])[^\s\\]*$/.test(p)) p = PS_DEFAULT_ENTRY_PATH;
  p = p.replace(/^\/(?:pt|en|es|fr|de|it)(?:-[a-z]{2})?(?=[/?#]|$)/i, "") || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return `${info.origin}${info.prefixes[l.locale]}${p}`;
}

// Nome do formulário: espaços normalizados, 2 a 80 caracteres, só letras (de qualquer alfabeto), espaços,
// apóstrofos, hífenes e pontos. Sem algarismos, "@", "/" nem domínios ("loja.com"): o nome vai no email, e o
// formulário aceita o endereço de outra pessoa.
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (s.length < 2 || s.length > 80) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u.test(s) || /\.\p{L}{2}/u.test(s)) return null;
  return s;
}

export const firstName = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "";

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return isEmail(e) ? e : null;
}

// Telemóvel em formato internacional (E.164, ex.: +351912345678). Aceita espaços, pontos, hífenes, parênteses,
// "(0)" e "00" em vez de "+". Sem indicativo, usa defaultPrefix (ex.: "+351"); sem ele → null. Em Portugal o
// número tem sempre 9 algarismos.
export function normalizePhone(v: unknown, defaultPrefix?: string): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  let s = v.trim().replace(/\(0\)/g, "").replace(/[\s.()/-]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (!s.startsWith("+")) {
    if (!defaultPrefix || !/^\+[1-9]\d{0,3}$/.test(defaultPrefix)) return null;
    s = defaultPrefix + s;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  if (s.startsWith("+351") && !/^\+351[2-9]\d{8}$/.test(s)) return null;
  return s;
}

// Senha partilhada (definida no dashboard; a BD volta a exigir de 8 a 100 caracteres). Sem espaços nas pontas, que
// se perdem ao copiar do email, nem caracteres de controlo.
export const PS_PASSWORD_MIN = 8;
export const PS_PASSWORD_MAX = 100;
export function validPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= PS_PASSWORD_MIN && v.length <= PS_PASSWORD_MAX && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
}

// Alerta do formulário da senha no dashboard, antes de guardar (a mesma regra de validPassword, mais a confirmação).
// "" = pode guardar. Também diz qual dos dois campos corrigir.
export function passwordAlert(password: string, confirm: string): { message: string; field: "password" | "confirm" | null } {
  const fail = (message: string, field: "password" | "confirm" = "password") => ({ message: `${message} Não foi guardada.`, field });
  if (password.length < PS_PASSWORD_MIN) {
    const missing = PS_PASSWORD_MIN - password.length;
    return fail(`A senha tem de ter pelo menos ${PS_PASSWORD_MIN} caracteres${password ? ` (faltam ${missing})` : ""}.`);
  }
  if (password.length > PS_PASSWORD_MAX) return fail(`A senha pode ter no máximo ${PS_PASSWORD_MAX} caracteres.`);
  if (password !== password.trim()) return fail("A senha não pode começar nem acabar com um espaço.");
  if (/[\u0000-\u001f\u007f]/.test(password)) return fail("A senha tem caracteres que não se podem usar.");
  if (password !== confirm) return fail("As duas senhas não coincidem.", "confirm");
  return { message: "", field: null };
}

// ---------------------------------------------------------------- fase 2: catálogo exclusivo

// Peças guardadas no perfil ("Adicionar ao perfil"), pelo handle do produto na Shopify. A mesma regra da BD
// (ldo_ps_favorites): minúsculas sem acentos, algarismos e hífenes, a começar por letra ou algarismo, até 255
// caracteres. O handle não é confirmado na Shopify, só o formato.
export const PS_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,254}$/;
export const isHandle = (v: unknown): v is string => typeof v === "string" && PS_HANDLE_RE.test(v);

// Handle enviado pelo tema: sem espaços nas pontas e em minúsculas (a Shopify guarda-os sempre assim). Fora da
// regra → null.
export function cleanHandle(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  const h = v.trim().toLowerCase();
  return isHandle(h) ? h : null;
}

// Até 300 peças por membro (verificado na BD, ldo_ps_favorites).
export const PS_FAVORITES_MAX = 300;
export const PS_FAVORITES_ACTIONS = ["list", "add", "remove"] as const;
export type PsFavoritesAction = (typeof PS_FAVORITES_ACTIONS)[number];
export const isFavoritesAction = (v: unknown): v is PsFavoritesAction =>
  typeof v === "string" && (PS_FAVORITES_ACTIONS as readonly string[]).includes(v);

// Página da peça na Loja do Ouro (lista da equipa). Handle fora da regra → null (sem link).
export const pieceUrl = (handle: unknown) => (isHandle(handle) ? `${PS_BRANDS.ldo.origin}/products/${handle}` : null);

// Código de membro: o código de desconto da Shopify (7,5 % nas peças da Private Selection, não acumulável) que a
// página reservada aplica sem o mostrar. A mesma regra da BD (ldo_ps_settings.member_code): 4 a 40 letras sem
// acentos, algarismos, "-" ou "_". Sem espaços nas pontas; vazio → null (retira o código).
export const PS_MEMBER_CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
export const PS_MEMBER_CODE_ERROR = 'O código tem de ter entre 4 e 40 caracteres: letras sem acentos, números, "-" ou "_".';
export function parseMemberCode(v: unknown): { ok: true; code: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, code: null };
  if (typeof v !== "string") return { ok: false, error: PS_MEMBER_CODE_ERROR };
  const code = v.trim();
  if (!code) return { ok: true, code: null };
  return PS_MEMBER_CODE_RE.test(code) ? { ok: true, code } : { ok: false, error: PS_MEMBER_CODE_ERROR };
}

// Klaviyo (lib/klaviyo-write.ts). Todos os membros ficam na lista "Clientes Private Selection"; só quem marcou a
// caixa do marketing é também inscrito nos emails de marketing (a lista tem de ter double opt-in, e as campanhas vão
// para um segmento com consentimento, nunca para a lista inteira). O telemóvel vai como propriedade e não como
// phone_number: a Klaviyo recusa o perfil inteiro quando não aceita o número ou quando ele já é de outro perfil.
export type PsKlaviyoMember = {
  email: string; name: string; phone?: string | null; locale: string; brand: string; source: string;
  consent_marketing: boolean; consent_at?: string | null; created_at: string;
};

// Cria ou atualiza o perfil (POST /api/profile-import/; o que não vai fica como estava). names: false deixa o nome
// de fora, para o nome escrito no formulário (não confirmado) não mudar o de um perfil que a Klaviyo já tem.
export function klaviyoProfilePayload(m: PsKlaviyoMember, { names = true }: { names?: boolean } = {}) {
  const { brand, locale } = psLang(m.brand, m.locale);
  const [first, ...rest] = names ? (m.name || "").trim().split(/\s+/).filter(Boolean) : [];
  return {
    data: {
      type: "profile",
      attributes: {
        email: m.email.trim().toLowerCase(),
        ...(first ? { first_name: first } : {}),
        ...(rest.length ? { last_name: rest.join(" ") } : {}),
        properties: {
          ps_brand: brand,
          ps_locale: locale,
          ps_source: m.source,
          ps_requested_at: m.created_at,
          ps_marketing_consent: m.consent_marketing === true,
          ...(m.phone ? { ps_phone: m.phone } : {}),
          ...(m.consent_marketing === true && m.consent_at ? { ps_consent_at: m.consent_at } : {}),
        },
      },
    },
  };
}

// Junta ou tira perfis da lista (POST ou DELETE /api/lists/{id}/relationships/profiles/). O perfil nunca é apagado.
export function klaviyoListPayload(profileIds: string[]) {
  return { data: profileIds.map((id) => ({ type: "profile", id })) };
}

// Inscrição nos emails de marketing, na mesma lista (POST /api/profile-subscription-bulk-create-jobs/). Só com a
// caixa marcada; sem ela → null. Com double opt-in na lista, a Klaviyo pede a confirmação à própria pessoa antes de
// a inscrever. Sem consented_at: a Klaviyo só o aceita em importações históricas e regista ela a hora da inscrição
// (a hora do consentimento fica no perfil, em ps_consent_at).
export function klaviyoSubscriptionPayload(m: PsKlaviyoMember, listId: string) {
  if (m.consent_marketing !== true) return null;
  return {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        custom_source: brandName(m.brand),
        profiles: {
          data: [{ type: "profile", attributes: { email: m.email.trim().toLowerCase(), subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } } }],
        },
      },
      relationships: { list: { data: { type: "list", id: listId } } },
    },
  };
}
