// Plataforma de criadores, fase 3A: leitura dos dados públicos do Instagram pela Business Discovery da Meta, a partir
// da conta Instagram da Loja do Ouro. Regras sem I/O: campos pedidos à Meta, URL, leitura das respostas (só a lista
// branca de campos), classificação dos erros, cabeçalhos de uso, código na biografia, médias simples e textos.
// Testado em tests/criadores-meta.cjs. Quem faz os pedidos é lib/criadores/meta.ts.
// Nunca sai daqui a biografia, legendas, imagens, URLs da Meta nem o username devolvido pela Meta.

// ---------------------------------------------------------------- constantes

// Uma versão só se muda depois de «Testar a ligação à Meta» com ela (README).
export const META_GRAPH_VERSION = "v27.0";
export const GRAPH_HOST = "https://graph.facebook.com";
// A conta Instagram da Loja do Ouro (META_IG_ACCOUNT_ID), usada no teste da ligação.
export const LOJA_IG_USERNAME = "lojadoouro";

export const PUBLIC_MEDIA_LIMIT = 25; // um pedido por conta e por leitura, sem paginação
export const PUBLIC_BATCH = 10; // contas por ldo_cr_public_claim
export const PUBLIC_MAX_PER_RUN = 20; // pedidos por execução do tick
export const PUBLIC_GAP_MS = 1000; // entre pedidos
export const PUBLIC_USAGE_PAUSE = 75; // % de uso da app a partir da qual o tick para (x-app-usage, x-business-use-case-usage)
// Espelho do SQL (ldo_cr_public_proof, cr_public_code_quota, ldo_cr_public_start e ldo_cr_public_renew;
// tests/criadores-meta-estatico.cjs compara).
export const PUBLIC_PROOF_PER_DAY = 5;
export const PUBLIC_CODES_PER_DAY = 5; // autorizações e códigos novos, por pessoa em 24 h
export const PUBLIC_CODE_DAYS = 7;
// O texto do botão, à letra da Política de Privacidade e da página /dados-meta.
export const PUBLIC_STOP_LABEL = "Parar a leitura e apagar os dados públicos";
// Médias simples das últimas publicações (sem rácios): à espera da validação do advogado, porque a Política diz que
// estes números «não servem para indicadores». Enquanto for false, o site e a ficha mostram só a lista.
export const PUBLIC_SHOW_AVERAGES = false;

// Campos pedidos à Meta (lista branca). O username só serve para confirmar a conta e não se guarda. view_count não se
// pode pedir só para os reels: vem de todas as publicações e parseDiscovery deita fora o que não é de um reel.
export const PUBLIC_PROFILE_FIELDS = ["id", "username", "followers_count", "media_count"] as const;
export const PUBLIC_MEDIA_FIELDS = ["id", "timestamp", "media_type", "media_product_type", "like_count", "comments_count", "view_count"] as const;
// Nunca pedidos (testes). A biografia só se pede em biographyFields, num pedido à parte, para a prova da posse.
export const FORBIDDEN_FIELDS = [
  "media_url", "thumbnail_url", "caption", "children", "permalink", "shortcode", "profile_picture_url", "name", "follows_count",
  "website", "alt_text", "owner", "biography",
] as const;

export const MEDIA_TYPES = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const;
export const PRODUCT_TYPES = ["FEED", "REELS", "STORY", "AD"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export type ProductType = (typeof PRODUCT_TYPES)[number];

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const IG_ID_RE = /^[0-9]{5,30}$/;
const CODE_RE = /^LDO-[2-9A-HJ-NP-Z]{6}$/;

// ---------------------------------------------------------------- @ e campos

// @ do Instagram a partir do que a pessoa escreveu («@Ana.Silva», «instagram.com/ana_silva/»): em minúsculas, só
// letras, números, ponto e _, até 30 caracteres; senão null (o hífen, que outras redes aceitam, aqui não).
export function instagramHandle(value: unknown): string | null {
  let v = String(value ?? "").trim();
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#]+)/i.exec(v);
  if (m) v = m[1];
  v = v.replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(v) ? v : null;
}

// O @ entra no parâmetro fields: nunca pode levar «(», «)», «{», «,» nem espaços.
function safeHandle(handle: string): string {
  if (typeof handle !== "string" || !HANDLE_RE.test(handle)) throw new Error("Nome de utilizador do Instagram inválido.");
  return handle;
}

export function discoveryFields(handle: string): string {
  return `business_discovery.username(${safeHandle(handle)}){${PUBLIC_PROFILE_FIELDS.join(",")},media.limit(${PUBLIC_MEDIA_LIMIT}){${PUBLIC_MEDIA_FIELDS.join(",")}}}`;
}

// Prova da posse: um pedido à parte, para a biografia nunca vir com os números.
export function biographyFields(handle: string): string {
  return `business_discovery.username(${safeHandle(handle)}){id,username,biography}`;
}

// O teste da ligação usa os mesmos campos da leitura, sobre a própria @lojadoouro.
export function connectionTestFields(): string {
  return `id,username,${discoveryFields(LOJA_IG_USERNAME)}`;
}

// URL do pedido. O token nunca vai aqui (só no cabeçalho Authorization); appsecret_proof só se a app o exigir.
export function graphUrl(igAccountId: string, fields: string, appsecretProof?: string | null): string {
  if (!IG_ID_RE.test(String(igAccountId ?? ""))) throw new Error("Id da conta Instagram da Loja do Ouro inválido.");
  const params = new URLSearchParams({ fields });
  if (appsecretProof) {
    if (!/^[0-9a-f]{64}$/.test(appsecretProof)) throw new Error("appsecret_proof inválido.");
    params.set("appsecret_proof", appsecretProof);
  }
  return `${GRAPH_HOST}/${META_GRAPH_VERSION}/${igAccountId}?${params.toString()}`;
}

// ---------------------------------------------------------------- erros e uso

export type GraphErrorClass = "not_found" | "limit" | "token" | "config" | "temporary";
export type GraphFailure = { ok: false; error: GraphErrorClass; code: number | null; subcode: number | null };

const LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613, 80002]);

// Classe de um erro da Graph API. Decide só pelo code e pelo error_subcode, nunca pelo error_user_msg (vem
// traduzido). 110/2207013: o @ não existe ou não é uma conta profissional.
export function classifyGraphError(status: number | null, json: unknown): { kind: GraphErrorClass; code: number | null; subcode: number | null } {
  const err = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  const e = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const code = typeof e.code === "number" && Number.isSafeInteger(e.code) ? e.code : null;
  const subcode = typeof e.error_subcode === "number" && Number.isSafeInteger(e.error_subcode) ? e.error_subcode : null;
  let kind: GraphErrorClass = "temporary";
  if (code === 110 && subcode === 2207013) kind = "not_found";
  else if (code === 190 || code === 102) kind = "token";
  else if ((code !== null && LIMIT_CODES.has(code)) || status === 429) kind = "limit";
  else if (code === 10 || code === 100 || (code !== null && code >= 200 && code <= 299)) kind = "config";
  return { kind, code, subcode };
}

export function graphFailure(status: number | null, json: unknown): GraphFailure {
  const c = classifyGraphError(status, json);
  return { ok: false, error: c.kind, code: c.code, subcode: c.subcode };
}

// Uso da app em % (o maior de call_count, total_cputime e total_time nos dois cabeçalhos) e os minutos até a Meta
// voltar a aceitar pedidos (estimated_time_to_regain_access). JSON inválido ou ausente: null.
export function usageFromHeaders(appUsage: string | null, bucUsage: string | null): { pct: number | null; regainMinutes: number | null } {
  const acc: { pct: number | null; regainMinutes: number | null } = { pct: null, regainMinutes: null };
  const parse = (s: string | null): unknown => {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const take = (o: unknown) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    const r = o as Record<string, unknown>;
    for (const k of ["call_count", "total_cputime", "total_time"]) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) acc.pct = Math.max(acc.pct ?? 0, Math.round(v));
    }
    const t = r.estimated_time_to_regain_access;
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) acc.regainMinutes = Math.max(acc.regainMinutes ?? 0, Math.ceil(t));
  };
  take(parse(appUsage));
  const buc = parse(bucUsage);
  if (buc && typeof buc === "object" && !Array.isArray(buc)) {
    for (const list of Object.values(buc as Record<string, unknown>)) if (Array.isArray(list)) for (const x of list) take(x);
  }
  return acc;
}

// ---------------------------------------------------------------- respostas

export type PublicMediaRow = {
  media_id: string; posted_at: string; media_type: MediaType; product_type: ProductType | null;
  like_count: number | null; comments_count: number | null; view_count: number | null;
};
export type PublicReading = { ig_user_id: string; followers: number | null; media_count: number | null; media: PublicMediaRow[] };

const MAX_COUNT = 2_000_000_000; // inteiros da BD (seguidores e publicações)

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// Inteiro seguro e não negativo, ou null (ausente não é 0; texto, decimais e negativos também dão null).
function count(v: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null;
}

// «2026-11-01T10:00:00+0000» (o formato da Graph API) → «2026-11-01T10:00:00.000Z»; null se não for uma data.
export function isoTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}:?\d{2})$/.exec(v.trim());
  if (!m) return null;
  const zone = m[2] === "Z" ? "Z" : `${m[2].slice(0, 3)}:${m[2].slice(-2)}`;
  const t = Date.parse(`${m[1]}${zone}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// O nó business_discovery, se for da conta pedida (o id da Meta e o @, sem diferença de maiúsculas); senão null.
function discoveryNode(json: unknown, handle: string): { node: Record<string, unknown>; id: string } | null {
  const bd = asObject(asObject(json)?.business_discovery);
  const id = typeof bd?.id === "string" ? bd.id : null;
  const username = typeof bd?.username === "string" ? bd.username.toLowerCase() : null;
  if (!bd || !id || !IG_ID_RE.test(id) || !username || username !== String(handle ?? "").toLowerCase()) return null;
  return { node: bd, id };
}

const UNEXPECTED: GraphFailure = { ok: false, error: "temporary", code: null, subcode: null };

// Leitura dos números públicos: só os campos da lista branca, no máximo 25 publicações; uma publicação com um tipo
// desconhecido, sem data ou sem id cai. As visualizações só ficam nos reels (a autorização fala em «visualizações de
// reels»; a BD volta a confirmar). Uma resposta que não é da conta pedida conta como erro temporário.
export function parseDiscovery(json: unknown, handle: string): { ok: true; reading: PublicReading } | GraphFailure {
  if (asObject(json)?.error) return graphFailure(200, json);
  const found = discoveryNode(json, handle);
  if (!found) return UNEXPECTED;
  const { node, id } = found;
  const data = asObject(node.media)?.data;
  const media: PublicMediaRow[] = [];
  for (const raw of Array.isArray(data) ? data.slice(0, PUBLIC_MEDIA_LIMIT) : []) {
    const m = asObject(raw);
    if (!m) continue;
    const mediaId = typeof m.id === "string" && IG_ID_RE.test(m.id) ? m.id : null;
    const postedAt = isoTimestamp(m.timestamp);
    const type = (MEDIA_TYPES as readonly unknown[]).includes(m.media_type) ? (m.media_type as MediaType) : null;
    const product = m.media_product_type === undefined || m.media_product_type === null ? null
      : (PRODUCT_TYPES as readonly unknown[]).includes(m.media_product_type) ? (m.media_product_type as ProductType) : undefined;
    if (!mediaId || !postedAt || !type || product === undefined) continue;
    media.push({
      media_id: mediaId, posted_at: postedAt, media_type: type, product_type: product,
      like_count: count(m.like_count), comments_count: count(m.comments_count), view_count: product === "REELS" ? count(m.view_count) : null,
    });
  }
  return { ok: true, reading: { ig_user_id: id, followers: count(node.followers_count, MAX_COUNT), media_count: count(node.media_count, MAX_COUNT), media } };
}

// Teste da ligação: a leitura da própria @lojadoouro tem de devolver o id configurado em META_IG_ACCOUNT_ID.
export function parseConnectionTest(json: unknown, igAccountId: string): { ok: true; reading: PublicReading } | GraphFailure {
  const r = parseDiscovery(json, LOJA_IG_USERNAME);
  if (!r.ok) return r;
  if (r.reading.ig_user_id !== igAccountId) return { ok: false, error: "config", code: null, subcode: null };
  return r;
}

// Prova da posse: procura o código na biografia e devolve só se o encontrou (e o id da conta). A biografia nunca sai
// desta função.
export function parseBiography(json: unknown, handle: string, code: string): { ok: true; igUserId: string; found: boolean } | GraphFailure {
  if (asObject(json)?.error) return graphFailure(200, json);
  const found = discoveryNode(json, handle);
  if (!found) return UNEXPECTED;
  return { ok: true, igUserId: found.id, found: bioHasCode(found.node.biography, code) };
}

// Teste do pedido da prova da posse (o da biografia, à parte do da leitura) sobre a própria @lojadoouro: tem de
// devolver o id configurado. Se a Meta recusar só este pedido, todas as confirmações falham com o resto verde. O
// código procurado não interessa e da biografia da Loja do Ouro também não sai nada.
export function parseBiographyTest(json: unknown, igAccountId: string): { ok: true } | GraphFailure {
  const r = parseBiography(json, LOJA_IG_USERNAME, "LDO-222222");
  if (!r.ok) return r;
  return r.igUserId === igAccountId ? { ok: true } : { ok: false, error: "config", code: null, subcode: null };
}

// O código na biografia, em qualquer sítio do texto: compara em NFKC, em maiúsculas e só com letras e algarismos
// («ldo 7k3q 9p» encontra «LDO-7K3Q9P»).
const squash = (s: string) => s.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
export function bioHasCode(bio: unknown, code: string): boolean {
  if (typeof bio !== "string" || typeof code !== "string" || !CODE_RE.test(code)) return false;
  return squash(bio).includes(squash(code));
}

// ---------------------------------------------------------------- ecrã

export type PublicMediaView = {
  posted_at: string; media_type: string; product_type: string | null;
  like_count: number | null; comments_count: number | null; view_count: number | null;
};
export type PublicSummary = { posts: number; likes: number | null; comments: number | null; reels: number; reelViews: number | null };

// Médias simples das n publicações mais recentes com mais de 48 h (os números ainda estão a subir antes disso), só
// com os valores que a Meta devolveu; as visualizações só nos reels. Nunca rácios com os seguidores. null sem dados.
// (Só se mostram com PUBLIC_SHOW_AVERAGES.)
export function publicSummary(media: PublicMediaView[], now: Date | number = Date.now(), opts: { n?: number; minAgeHours?: number } = {}): PublicSummary | null {
  const n = opts.n ?? 12;
  const minAge = (opts.minAgeHours ?? 48) * 3_600_000;
  const t = typeof now === "number" ? now : now.getTime();
  const eligible = media
    .map((m) => ({ m, at: Date.parse(m.posted_at) }))
    .filter((x) => Number.isFinite(x.at) && t - x.at >= minAge)
    .sort((a, b) => b.at - a.at)
    .slice(0, n)
    .map((x) => x.m);
  if (!eligible.length) return null;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const reels = eligible.filter((m) => m.product_type === "REELS");
  return {
    posts: eligible.length,
    likes: avg(eligible.map((m) => m.like_count)),
    comments: avg(eligible.map((m) => m.comments_count)),
    reels: reels.length,
    reelViews: avg(reels.map((m) => m.view_count)),
  };
}

export function mediaKindLabel(m: { media_type: string; product_type: string | null }): string {
  if (m.product_type === "REELS") return "Reel";
  return m.media_type === "VIDEO" ? "Vídeo" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : "Fotografia";
}

export const PUBLIC_STATE_LABEL = { proof: "À espera do código", active: "Em leitura", error: "Leitura com erro" } as const;

export type ProofReason = "missing" | "not_found" | "rate" | "busy" | "expired" | "taken" | "changed" | "off" | "state" | "error";

// Leitura em pausa (ldo_private.cr_public_state): um limite pedido pela Meta, um erro de token ou de configuração da
// Loja do Ouro ou erros temporários seguidos. Neutro, porque o motivo varia; nesse tempo as tentativas não contam
// (ldo_cr_public_proof recusa antes de as gravar e checkPublicProof devolve a de uma falha da Meta).
export const PUBLIC_PAUSED_TEXT = "A leitura está em pausa de momento. Tente confirmar mais tarde: enquanto durar a pausa, as tentativas não contam.";

// Texto para o criador de cada recusa da confirmação da conta.
export function proofMessage(reason: ProofReason, handle: string, left?: number | null): string {
  const h = String(handle ?? "").replace(/^@/, "");
  switch (reason) {
    case "missing": {
      const more = typeof left === "number" && Number.isInteger(left) && left >= 0
        ? left === 0 ? " Já usou as 5 tentativas das últimas 24 horas: pode tentar de novo amanhã." : ` Pode tentar mais ${left} ${left === 1 ? "vez" : "vezes"} nas próximas 24 horas.`
        : "";
      return `Não encontrámos o código na biografia de @${h}. Confirme que guardou a biografia com o código igual ao de cima e tente de novo dentro de um minuto.${more}`;
    }
    case "not_found":
      return `A Meta não encontrou @${h} como conta profissional do Instagram. A leitura só funciona com contas profissionais (Criador de conteúdos ou Empresa): mude o tipo de conta na app do Instagram e tente de novo.`;
    case "rate":
      return `Já tentou ${PUBLIC_PROOF_PER_DAY} vezes nas últimas 24 horas. Tente de novo amanhã.`;
    case "busy":
      // A pausa tanto vem de um limite da Meta como de um problema do lado da Loja do Ouro (token, configuração).
      return PUBLIC_PAUSED_TEXT;
    case "expired":
      return "O código expirou. Gere um código novo.";
    case "taken":
      return "Este @ já foi confirmado por outra conta da plataforma. Se é seu, fale connosco em Mensagens.";
    case "changed":
      return "O @ ou o código mudaram entretanto. Recarregue a página e tente de novo.";
    case "off":
      return "A leitura dos dados públicos está desligada de momento.";
    case "state":
      return "Esta conta já não está à espera de confirmação. Recarregue a página.";
    default:
      return "Não conseguimos falar com a Meta agora. Tente dentro de alguns minutos.";
  }
}

// Texto do backoffice para um erro da ligação (sem dados de criadores).
export function graphErrorText(kind: GraphErrorClass, code: number | null): string {
  const c = typeof code === "number" ? ` (código ${code})` : "";
  switch (kind) {
    case "token":
      return `A Meta recusou o token do System User: expirou, foi revogado ou perdeu permissões${c}.`;
    case "config":
      return `A Meta recusou o pedido por falta de permissões, por um campo que deixou de existir ou porque a conta configurada não é a @${LOJA_IG_USERNAME}${c}.`;
    case "limit":
      return `A Meta pediu uma pausa nos pedidos (limite de uso)${c}.`;
    case "not_found":
      return `A Meta não encontrou a conta pedida como conta profissional do Instagram${c}.`;
    default:
      return `A Meta não respondeu ou deu um erro temporário${c}.`;
  }
}

// Motivo de public.stop na auditoria da ficha.
export const PUBLIC_STOP_WHY_LABEL: Record<string, string> = {
  creator: "pelo criador",
  staff: "pela equipa, a pedido",
  handle: "@ ou rede mudados",
  delete: "conta apagada em Redes",
  other_account: "o @ passou a ser de outra conta",
  proof_expired: "código nunca confirmado",
  not_found: "conta não encontrada durante 90 dias",
  erase: "apagamento pedido",
};
