import "server-only";
import { metricoolAccount, metricoolConfigured, metricoolRequest } from "@/lib/bi/metricool";
import { ingest, serverConfigured, serverRpc, type IngestConversation, type IngestMessage } from "./db";
import { metaSendRefusal, metricoolBrandFindings, metricoolCursor, metricoolFault, metricoolNetwork, safeMetricoolBrand, sendOutcome, type InboxProbe, type SafeBrand } from "./rules";
import { hiddenReaction, socialAutoReply, type SocialSettings } from "./social-rules";
import { commentAccess, commentBrand, commentCursorAfter, commentReadPlan, threadToConversation, walkPages, type CommentThread, type PostElement } from "./comment-rules";

// Metricool Inbox (API v2, https://app.metricool.com/api/swagger.json), mensagens privadas do
// Facebook Messenger e do Instagram da marca "Loja do Ouro" (blogId 7708381 desde 29-10-2026; antes "Loja do Ouro
// Jericó", 2912472). Reutiliza o token e a marca da secção Redes sociais. A Inbox não tem webhooks: a sincronização é por consulta.
//   GET  /v2/inbox/conversations?provider=…               conversas com participantes e mensagens
//   POST /v2/inbox/conversations {provider, conversationId, recipient, text, attachment}
//   GET  /v2/inbox/conversations/authorizations?provider=… {missingScopes, allowAccessToMessages}
//   GET  /v2/inbox/conversations/fetch-image?provider=…&target=…
// Comentários das publicações: fontes próprias (metricool-*-comments), mais abaixo.

type Participant = { id?: string; name?: string; email?: string; imageProfileUrl?: string };
type Message = {
  id?: string; from?: string; to?: string; text?: string; publicationDateTime?: string; attachments?: string[]; status?: string;
  // Não documentado na API: pode indicar reações e menções nas stories.
  properties?: Record<string, unknown>;
};
type Conversation = { id?: string; provider?: string; status?: string; creationDate?: string; lastUpdateTime?: string; participants?: Participant[]; messages?: Message[] };
type Listing = { data?: Conversation[]; page?: { next?: string | null } };

export class MetricoolError extends Error {
  constructor(message: string, public status: number | null, public retryAfter = 0, public blocked = false) {
    super(message);
  }
}

export const metricoolInboxConfigured = () => metricoolConfigured() && serverConfigured();

// provider: a rede, para explicar uma ligação em falta na marca (metricoolFault) em vez do texto técnico. Sem ligação
// ou com a sessão anulada pela Meta, a fonte fica Bloqueada (com a explicação) até a rede ser religada.
function failure(status: number | null, text: string | undefined, what: string, retryAfter = 0, provider?: string) {
  if (status === null) return new MetricoolError(`${what}: Metricool sem resposta.`, null);
  if (status === 401 || status === 403)
    return new MetricoolError(`${what}: a conta Metricool recusou o acesso à Inbox (HTTP ${status}). Confirmar que o plano e o token incluem a Inbox por API.`, status, 0, true);
  if (status === 429) return new MetricoolError(`${what}: limite de pedidos Metricool atingido.`, 429, retryAfter || 120);
  const fault = metricoolFault(text, metricoolNetwork(provider), "sincronizacao", status);
  if (fault) return new MetricoolError(`${what}: ${fault.text}`, status, retryAfter, fault.kind !== "internal");
  return new MetricoolError(`${what}: Metricool recusou o pedido (HTTP ${status}${text ? ` · ${text.replace(/\s+/g, " ").slice(0, 160)}` : ""}).`, status);
}

// Autorizações da Inbox para uma rede (permissões em falta na ligação da marca).
export async function inboxAuthorizations(provider: string) {
  const r = await metricoolRequest("GET", "/v2/inbox/conversations/authorizations", { provider });
  if (r.status !== 200) throw failure(r.status, r.text, `Autorizações ${provider}`, 0, provider);
  const data = (r.json as { data?: { missingScopes?: string[]; allowAccessToMessages?: boolean } })?.data || {};
  return { allowAccessToMessages: Boolean(data.allowAccessToMessages), missingScopes: data.missingScopes || [] };
}

// A Metricool vai buscar as conversas à Meta no momento: a listagem pode demorar mais do que as outras consultas.
const LIST_TIMEOUT_MS = 55_000;

// Páginas de conversas de uma rede; cada página é entregue logo (onPage) para ficar gravada mesmo
// que a passagem pare pelo limite de tempo.
async function listConversations(provider: string, { maxPages = 5, deadline = Infinity, onPage }: { maxPages?: number; deadline?: number; onPage?: (page: Conversation[]) => Promise<void> } = {}) {
  const out: Conversation[] = [];
  let next: string | null = null;
  let pages = 0;
  let paging: string | null = null;
  do {
    let r;
    if (next) {
      // Só se segue paginação dentro da própria API Metricool.
      const u = new URL(next, "https://app.metricool.com/api/");
      if (u.hostname !== "app.metricool.com") break;
      const params = Object.fromEntries(u.searchParams);
      delete params.userId;
      delete params.blogId;
      r = await metricoolRequest("GET", u.pathname.replace(/^\/api/, ""), params, undefined, LIST_TIMEOUT_MS);
    } else r = await metricoolRequest("GET", "/v2/inbox/conversations", { provider }, undefined, LIST_TIMEOUT_MS);
    if (r.status !== 200) throw failure(r.status, r.text, `Conversas ${provider}`, Number(r.headers?.get("retry-after")) || 0, provider);
    const body = r.json as Listing;
    const page = body?.data || [];
    out.push(...page);
    if (onPage) await onPage(page);
    const raw = body?.page?.next || null;
    paging = raw ? (/^https?:|^\//.test(raw) ? "url" : "token") : paging;
    next = raw && /^https?:|^\//.test(raw) ? raw : null;
    pages++;
    // Uma página pode demorar até 55 s: só se pede outra com tempo para ela dentro do orçamento da passagem.
  } while (next && pages < maxPages && Date.now() < deadline - 25_000);
  return { conversations: out, pages, paging, complete: !next };
}

const BRAND_NAME = /loja\s*do\s*ouro|lojadoouro/i;

// Conta da marca: a configurada (config.brand_id), a já detetada, ou a que participa em mais de metade
// das conversas (pelo menos duas); com poucas conversas, o participante com o nome da marca.
// Sem certeza, devolve null e as conversas ambíguas não são interpretadas (nunca se adivinha a direção).
export function brandParticipant(conversations: Conversation[], known?: string | null): string | null {
  if (known) return known;
  const count = new Map<string, number>();
  for (const c of conversations) for (const id of new Set((c.participants || []).map((p) => p.id).filter(Boolean) as string[])) count.set(id, (count.get(id) || 0) + 1);
  const ranked = [...count].sort((a, b) => b[1] - a[1]);
  if (conversations.length >= 2 && ranked[0] && ranked[0][1] >= 2 && ranked[0][1] > conversations.length / 2 && (!ranked[1] || ranked[1][1] < ranked[0][1]))
    return ranked[0][0];
  const named = new Set(conversations.flatMap((c) => (c.participants || []).filter((p) => p.id && BRAND_NAME.test(p.name || "")).map((p) => p.id!)));
  return named.size === 1 ? [...named][0] : null;
}

function toConversation(c: Conversation, brand: string | null): IngestConversation | null {
  if (!c.id) return null;
  const others = (c.participants || []).filter((p) => p.id && p.id !== brand);
  // Com a marca conhecida, ou um só participante listado, o cliente é inequívoco. Caso contrário a
  // conversa fica por interpretar: sem cliente identificado não há respostas nem mensagens atribuídas.
  const customer = others.length === 1 ? others[0] : null;
  if (!customer) return null;
  const messages: IngestMessage[] = (c.messages || [])
    .filter((m) => m.id && m.publicationDateTime)
    .map((m) => ({
      external_id: String(m.id),
      kind: m.from === customer.id ? "inbound" : "outbound",
      author_name: m.from === customer.id ? customer.name || null : null,
      author_external_id: m.from || null,
      body: m.status === "DELETED" ? "" : m.text || "",
      attachments: m.status === "DELETED" ? [] : (m.attachments || []).filter((a) => /^https:\/\//.test(a)).map((a, i) => ({ name: `Anexo ${i + 1}`, type: null, size: null, ref: `metricool:${a}` })),
      created_at: new Date(m.publicationDateTime!).toISOString(),
      // Mensagem que o cliente anulou: fica marcada e sem conteúdo.
      deleted: m.status === "DELETED",
    }));
  return {
    external_id: String(c.id),
    contact: { external_id: customer.id || null, name: customer.name || null, email: customer.email || null, handle: customer.name || null, avatar_url: customer.imageProfileUrl || null },
    subject: null,
    platform_status: c.status || null,
    external_updated_at: c.lastUpdateTime || null,
    messages,
  };
}

export async function syncMetricool(source: { id: string; account?: string; config: Record<string, unknown>; cursor: Record<string, unknown> }, deadline = Infinity) {
  if (!metricoolInboxConfigured()) return { skipped: "Metricool por configurar (METRICOOL_USER_TOKEN)." };
  const provider = String(source.config.provider || "");
  const auth = await inboxAuthorizations(provider);
  if (!auth.allowAccessToMessages)
    throw new MetricoolError(`Metricool não tem acesso às mensagens ${provider}${auth.missingScopes.length ? ` (em falta: ${auth.missingScopes.join(", ")})` : ""}. Voltar a ligar a rede na marca Metricool.`, 403, 0, true);
  const cursor = metricoolCursor(source.cursor, source.account, metricoolAccount().blogId);
  const configured = typeof source.config.brand_id === "string" ? source.config.brand_id : typeof cursor.brand === "string" ? cursor.brand : null;
  let totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0, autoreplies: 0 };
  let brand = configured;
  let skipped = 0;
  // Respostas automáticas (em vez da mensagem de ausência do Meta): lidas uma vez por passagem.
  const social = await serverRpc<SocialSettings | null>("ldo_support_social_settings").catch(() => null);
  // Partilhado por todas as páginas da passagem: depois de um envio sem ligação da rede, nenhuma página volta a tentar.
  const halt = { stop: false };
  const { complete } = await listConversations(provider, {
    deadline,
    onPage: async (page) => {
      brand = brandParticipant(page, brand);
      const pairs = page.map((raw) => ({ raw, conv: toConversation(raw, brand) })).filter((p): p is { raw: Conversation; conv: IngestConversation } => !!p.conv);
      const mapped = pairs.map((p) => p.conv);
      skipped += page.length - mapped.length;
      const r = await ingest(source.id, mapped);
      const autoreplies = social?.enabled ? await sendAutoReplies(provider, source.id, pairs, social, deadline, halt) : 0;
      totals = { conversations: totals.conversations + r.conversations, new_conversations: totals.new_conversations + r.new_conversations,
        new_messages: totals.new_messages + r.new_messages, reopened: totals.reopened + r.reopened, autoreplies: totals.autoreplies + autoreplies };
    },
  });
  const detail = skipped
    ? `${skipped} conversa(s) por interpretar: conta da marca ainda não identificada. Indicar o id da conta da marca na configuração da fonte (brand_id).`
    : complete ? null : "Nem todas as páginas foram lidas nesta passagem; continuam na seguinte.";
  return { cursor: { ...cursor, ...(brand ? { brand } : {}) }, totals, detail, more: !complete };
}

// Resposta automática ou agradecimento (regras em social-rules.ts), depois de a conversa estar gravada. A base
// de dados confirma antes de enviar (uma vez por mensagem, por conversa em 24 h e por pessoa em 7 dias); um envio
// recusado liberta o registo. Um resultado incerto fica registado: nunca se repete (podia ter chegado).
// Uma conversa só com reações claras (emoji, elogio curto, ou reação/menção numa story indicada pela Metricool) sai
// da lista principal para "Automáticas" até o cliente voltar a escrever ou alguém da equipa lhe mexer; a base de
// dados confirma (sem outras mensagens do cliente, sem responsável, Novo ou Resolvido).
// A classificação usa os anexos e as propriedades tal como a Metricool os entrega (também anexos que não são https),
// para uma mensagem com conteúdo nunca passar por reação. As decisões são rápidas: correm até 15 s depois do orçamento da passagem, e
// cada envio tem no máximo 10 s, dentro do limite da função.
// halt: sem ligação da rede na marca (ou com a sessão anulada pela Meta) os envios seguintes falhariam igual; param até ao
// fim da passagem (em todas as páginas), mas as conversas só com reações continuam a ser marcadas.
async function sendAutoReplies(provider: string, sourceId: string, pairs: { raw: Conversation; conv: IngestConversation }[], settings: SocialSettings, deadline: number,
  halt: { stop: boolean }) {
  let sent = 0;
  for (const { raw, conv } of pairs) {
    // Só com tempo dentro do orçamento da passagem (mais 5 s): os envios que ficarem passam à próxima verificação.
    if (Date.now() > deadline + 5_000) break;
    const recipient = conv.contact.external_id;
    if (!recipient) continue;
    const rawById = new Map((raw.messages || []).map((m) => [String(m.id), m]));
    const messages = conv.messages.map((m) => {
      const r = rawById.get(m.external_id);
      return { ...m, attachments: r?.attachments || m.attachments || [], properties: r?.properties };
    });
    const now = new Date();
    const name = conv.contact.name || conv.contact.handle || null;
    const hidden = hiddenReaction(messages, now, settings, name);
    if (hidden)
      await serverRpc("ldo_support_social_mark_auto", { p_source: sourceId, p_conversation: conv.external_id, p_from: hidden.from, p_through: hidden.through }).catch(() => undefined);
    if (halt.stop) continue;
    const decision = socialAutoReply(messages, settings, now, name);
    if (!decision) continue;
    const claim = { p_source: sourceId, p_conversation: conv.external_id, p_anchor: decision.anchor };
    if (!(await serverRpc<boolean>("ldo_support_social_autoreply_claim", { ...claim, p_contact: recipient, p_kind: decision.kind, p_since: decision.since }).catch(() => false))) continue;
    const r = await metricoolSend(provider, conv.external_id, recipient, decision.text, null, 10_000).catch(() => ({ outcome: "uncertain" as const, fault: null }));
    // Falhou: o registo sai e a mensagem pode voltar a ser respondida. Enviada ou sem confirmação: fica o
    // acontecimento na conversa (o incerto nunca se repete, porque pode ter chegado).
    const result = { ...claim, p_outcome: r.outcome };
    await serverRpc("ldo_support_social_autoreply_result", result).catch(() => serverRpc("ldo_support_social_autoreply_result", result)).catch(() => undefined);
    if (r.outcome !== "failed") sent++;
    if (r.fault === "connection" || r.fault === "token") halt.stop = true;
  }
  return sent;
}

// Imagem para a Meta: a Metricool envia anexos a partir de um URL que ela própria aloja (é o que a sua
// aplicação faz). /actions/normalize/image/url copia para lá uma imagem pública; se não estiver
// disponível com o token da API, usa-se o nosso URL público temporário diretamente.
async function hostedImage(publicUrl: string) {
  const r = await metricoolRequest("GET", "/actions/normalize/image/url", { url: publicUrl, folder: "temp" }, undefined, 20000);
  if (r.status !== 200) return { url: publicUrl, normalized: false };
  const raw = typeof r.json === "string" ? r.json : (r.json as { data?: unknown; url?: unknown } | null)?.data ?? (r.json as { url?: unknown } | null)?.url;
  return typeof raw === "string" && /^https:\/\//.test(raw) ? { url: raw, normalized: true } : { url: publicUrl, normalized: false };
}

// Envio numa conversa existente, ao participante cliente: texto e, no máximo, uma imagem (JPEG/PNG,
// limite da Metricool) no mesmo pedido. A resposta da API é um texto livre: não é usada como id; a
// sincronização seguinte reconhece a mensagem pelo texto.
export async function metricoolSend(provider: string, conversationId: string, recipient: string | null, text: string, imageUrl?: string | null, timeoutMs = 30_000) {
  if (!recipient || recipient.startsWith("conversa:"))
    return { outcome: "failed" as const, externalId: null, fault: null, detail: "Destinatário por identificar nesta conversa: nada foi enviado." };
  let attachment: string | undefined;
  // Fotos da Shopify já são públicas e estáveis; só o URL temporário do dashboard é copiado para a Metricool.
  if (imageUrl) attachment = new URL(imageUrl).hostname === "cdn.shopify.com" ? imageUrl : (await hostedImage(imageUrl)).url;
  const r = await metricoolRequest("POST", "/v2/inbox/conversations", {}, { provider, conversationId, recipient, text, ...(attachment ? { attachment } : {}) }, timeoutMs);
  const outcome = sendOutcome(r.status);
  // A Meta recusa imagens que não consegue ir buscar (endereço protegido, expirado) ou em formato não suportado.
  const imageRefused = outcome === "failed" && attachment && /attachment format|attachment.*not supported|#100/i.test(r.text || "");
  // Pessoa que já não recebe mensagens da página (Meta #551): explicação em vez do erro técnico da Metricool.
  const network = metricoolNetwork(provider);
  const unreachable = outcome === "failed" ? metaSendRefusal(r.text, network === "Instagram" ? "Instagram" : "Messenger") : null;
  // Ligação da rede em falta na marca Metricool (UserConnection nula), sessão anulada pela Meta ou erro interno: idem.
  const fault = outcome === "failed" && !imageRefused && !unreachable ? metricoolFault(r.text, network, "envio", r.status) : null;
  return {
    outcome,
    externalId: null,
    fault: fault?.kind ?? null,
    detail: outcome === "accepted" ? null : outcome === "uncertain" ? "Sem confirmação da Metricool; verificar antes de reenviar."
      : imageRefused ? "A Meta recusou a imagem (não a conseguiu obter ou o formato não é suportado). Nada foi enviado ao cliente; pode enviar só o texto ou outra imagem JPEG/PNG."
      : unreachable ?? fault?.text ?? failure(r.status, r.text, "Envio").message,
  };
}

// Imagem de uma mensagem através da Metricool (os URLs das redes expiram ou exigem sessão).
export async function metricoolImage(provider: string, target: string) {
  const token = process.env.METRICOOL_USER_TOKEN;
  if (!token) throw new MetricoolError("Metricool por configurar.", null);
  const url = new URL("https://app.metricool.com/api/v2/inbox/conversations/fetch-image");
  url.search = new URLSearchParams({ provider, target, ...metricoolAccount() }).toString();
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25000), headers: { "X-Mc-Auth": token } });
  if (!r.ok) throw new MetricoolError(`Imagem indisponível (HTTP ${r.status}).`, r.status);
  return r;
}

// Diagnóstico para a configuração (Super Admin): só contagens e estrutura, nunca conteúdo de mensagens.
// Estrutura de um objeto "properties" da Metricool: nomes de campos e tipos; valor só em campos que descrevem um
// tipo (type, kind, reaction…) ou em verdadeiro/falso, nunca nomes nem conteúdo.
function propertiesShape(value: unknown) {
  const parts: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 20)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    } else {
      const typed = /(^|\.)(type|kind|subtype|category|event|reaction|source)$/i.test(path) && typeof v === "string" && /^[A-Za-z_]{1,30}$/.test(v);
      parts.push(typed || typeof v === "boolean" ? `${path}=${v}` : `${path}:${Array.isArray(v) ? "array" : v === null ? "null" : typeof v}`);
    }
  };
  walk(value ?? null, "", 0);
  return parts.sort().join(", ") || "(sem properties)";
}

function topShapes(values: unknown[]) {
  const shapes = new Map<string, number>();
  for (const v of values) {
    const key = propertiesShape(v);
    shapes.set(key, (shapes.get(key) || 0) + 1);
  }
  return [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([shape, n]) => ({ shape, n }));
}

function emptyMessageShapes(conversations: Conversation[]) {
  const empty = conversations.flatMap((c) => (c.messages || []).filter((m) => !String(m.text || "").trim() && !(m.attachments || []).length));
  return { count: empty.length, properties: topShapes(empty.map((m) => m.properties)) };
}

export async function metricoolDiagnostics(provider: string) {
  const out: Record<string, unknown> = { provider };
  try {
    out.authorizations = await inboxAuthorizations(provider);
  } catch (e) {
    out.authorizations = { error: e instanceof Error ? e.message : "indisponível" };
  }
  try {
    const started = Date.now();
    const { conversations, pages, paging, complete } = await listConversations(provider, { maxPages: 3 });
    out.listSeconds = Math.round((Date.now() - started) / 100) / 10;
    out.allPagesRead = complete;
    const msgs = conversations.map((c) => (c.messages || []).length);
    const brand = brandParticipant(conversations);
    out.read = {
      conversations: conversations.length, pages, paging,
      messagesPerConversation: msgs.length ? { min: Math.min(...msgs), max: Math.max(...msgs) } : null,
      participantsPerConversation: [...new Set(conversations.map((c) => (c.participants || []).length))],
      statuses: [...new Set(conversations.map((c) => c.status))],
      messageStatuses: [...new Set(conversations.flatMap((c) => (c.messages || []).map((m) => m.status)))],
      withAttachments: conversations.reduce((n, c) => n + (c.messages || []).filter((m) => (m.attachments || []).length).length, 0),
      // Mensagens sem texto nem anexos (reações e menções nas stories, partilhas, áudios?): que campos traz o
      // "properties" da Metricool. Só nomes de campos e valores curtos sem espaços (tipos), nunca o conteúdo.
      emptyMessages: emptyMessageShapes(conversations),
      brandDetected: Boolean(brand),
      brandId: brand,
      oldestMessage: conversations.flatMap((c) => (c.messages || []).map((m) => m.publicationDateTime || "")).filter(Boolean).sort()[0] || null,
    };
  } catch (e) {
    out.read = { error: e instanceof Error ? e.message : "indisponível" };
  }
  return out;
}

// Ligação da marca na Metricool ("Validar ligações", Super Admin): só leituras, para ver de que lado está uma falha.
// - a marca na lista de marcas do token (GET /admin/simpleProfiles): a resposta traz também logins, hashes, imagens e
//   ligações de white label, que nunca saem daqui (só os campos de safeMetricoolBrand);
// - as autorizações da Inbox nas três redes possíveis (o Instagram ligado pelo login do Instagram é INSTAGRAMBUSINESS),
//   só com o HTTP, o acesso e o tipo de falha (nunca o texto da Metricool).
// - listed: conversas lidas na lista de cada rede (da leitura de metricoolDiagnostics, sem pedidos a mais):
//   0 com as autorizações OK é o sinal de que a Metricool não está a ler a rede (Facebook desde 28-10-2026).
// Nunca /admin/userstatus (devolve tokens) nem pedidos que alteram a marca ou as ligações.
const INBOX_PROVIDERS = ["FACEBOOK", "INSTAGRAM", "INSTAGRAMBUSINESS"] as const;

async function inboxProbe(provider: string): Promise<InboxProbe> {
  const r = await metricoolRequest("GET", "/v2/inbox/conversations/authorizations", { provider }, undefined, 20_000);
  if (r.status !== 200) return { status: r.status, fault: metricoolFault(r.text, metricoolNetwork(provider), "sincronizacao", r.status)?.kind ?? null };
  const data = (r.json as { data?: { missingScopes?: unknown; allowAccessToMessages?: unknown } } | null)?.data || {};
  const scopes = Array.isArray(data.missingScopes) ? data.missingScopes.filter((s): s is string => typeof s === "string" && /^[\w.:-]{1,60}$/.test(s)).slice(0, 10) : [];
  return { status: 200, allowAccessToMessages: data.allowAccessToMessages === true, missingScopes: scopes };
}

type PerNetwork = { Facebook: string | null; Instagram: string | null };
export async function metricoolBrandDiagnostics(expected: { facebookPageId: string | null; instagramId: string | null },
  lastInbound: PerNetwork, lastSuccess: PerNetwork, listedPromise: Promise<{ FACEBOOK: number | null; INSTAGRAM: number | null }>) {
  const account = metricoolAccount();
  // Tratado já aqui: uma falha da leitura das listas nunca fica sem resposta enquanto os outros pedidos correm.
  const listedSafe = listedPromise.catch(() => ({ FACEBOOK: null, INSTAGRAM: null }));
  try {
    const [list, ...probes] = await Promise.all([
      metricoolRequest("GET", "/admin/simpleProfiles", {}, undefined, 20_000),
      ...INBOX_PROVIDERS.map((p) => inboxProbe(p)),
    ]);
    const listed = await listedSafe;
    const body = list.json as unknown;
    const raw = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown } | null)?.data) ? (body as { data: unknown[] }).data : null;
    const brands = list.status === 200 && raw ? raw.map(safeMetricoolBrand).filter((b): b is SafeBrand => !!b) : null;
    const inbox = Object.fromEntries(INBOX_PROVIDERS.map((p, i) => [p, probes[i]])) as Record<(typeof INBOX_PROVIDERS)[number], InboxProbe>;
    const brand = brands?.find((b) => String(b.id) === account.blogId) || null;
    const page = brand?.facebookPageId || expected.facebookPageId;
    return {
      findings: metricoolBrandFindings({ account, brands, brandsStatus: list.status, expected, inbox, listed, lastInbound, lastSuccess, now: new Date() }),
      detail: {
        // userId e blogId em uso (não são segredos); esperado = contas da marca nas conversas guardadas (cursor.brand).
        account, expected, listed, lastInbound, lastSuccess,
        // Todas as marcas da conta, para ver em qual ficaram a página e o Instagram (a marca em uso tem inUse).
        brands: brands
          ? brands.map((b) => ({ id: b.id, label: b.label, inUse: String(b.id) === account.blogId, facebookPageId: b.facebookPageId, instagram: b.instagram, instagramConnectionType: b.instagramConnectionType }))
          : `indisponível (${list.status === null ? "sem resposta" : `HTTP ${list.status}`})`,
        brand,
        otherBrandsWithSamePage: (brands || []).filter((b) => b.id !== brand?.id && page && b.facebookPageId === page).map((b) => ({ id: b.id, label: b.label })),
        inbox,
      },
    };
  } catch (e) {
    return { findings: [{ level: "erro" as const, text: e instanceof Error ? e.message : "Metricool indisponível." }], detail: { account } };
  }
}

// ---------------------------------------------------------------- comentários das publicações
// Inbox "post-comments" da Metricool: um tópico por comentário principal, com a publicação (element) e as
// respostas. O diagnóstico (Super Admin) devolve contagens e estrutura, nunca textos, nomes nem ligações.

// Tipo de publicação pelo endereço (sem guardar o endereço).
function linkKind(link?: string) {
  if (!link) return "sem ligação";
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^(www|m|business)\./, "");
    const p = `${u.pathname}${u.search}`;
    const kind = /\/reels?\//.test(p) ? "reel" : /\/p\//.test(p) ? "publicação" : /\/videos?\/|\/watch/.test(p) ? "vídeo"
      : /\/photos?\/|photo\.php/.test(p) ? "foto" : /\/posts?\/|permalink|story_fbid/.test(p) ? "publicação" : /\/stories\//.test(p) ? "story" : "outro";
    return `${host} · ${kind}`;
  } catch {
    return "ligação inválida";
  }
}

const range = (values: number[]) => (values.length ? { min: Math.min(...values), max: Math.max(...values) } : null);
const countBy = (values: (string | undefined)[]) => Object.fromEntries([...values.reduce((m, v) => m.set(v || "(vazio)", (m.get(v || "(vazio)") || 0) + 1), new Map<string, number>())]);

// Páginas de tópicos (regras em walkPages, comment-rules.ts): a 1.ª e, com tempo, as seguintes a partir de onde a
// passagem anterior parou. Devolve o ponto de continuação (next) e se a lista chegou ao fim (end).
async function readCommentThreads(provider: string, maxPages: number, deadline: number, onPage?: (page: CommentThread[]) => Promise<void>, resume?: string | null) {
  const threads: CommentThread[] = [];
  const last = { text: "", retryAfter: 0 };
  const walk = await walkPages<CommentThread>({
    maxPages, deadline, now: () => Date.now(), resume,
    onPage: async (page) => {
      threads.push(...page);
      if (onPage) await onPage(page);
    },
    fetchPage: async (next, timeout) => {
      let r;
      if (next) {
        const u = new URL(next, "https://app.metricool.com/api/");
        const params = Object.fromEntries(u.searchParams);
        delete params.userId;
        delete params.blogId;
        r = await metricoolRequest("GET", u.pathname.replace(/^\/api/, ""), params, undefined, timeout);
      } else r = await metricoolRequest("GET", "/v2/inbox/post-comments", { provider }, undefined, timeout);
      if (r.status !== 200) {
        last.text = r.text || "";
        last.retryAfter = Number(r.headers?.get("retry-after")) || 0;
      }
      const body = r.json as { data?: CommentThread[]; page?: { next?: string | null } } | null;
      return { status: r.status, data: body?.data || [], next: body?.page?.next || null };
    },
  });
  if (walk.error) throw failure(walk.error.status, last.text, `Comentários ${provider}`, last.retryAfter, provider);
  return { threads, pages: walk.pages, complete: walk.end, next: walk.next, end: walk.end };
}

export async function metricoolCommentsDiagnostics(provider: string) {
  const out: Record<string, unknown> = { provider };
  const started = Date.now();
  const deadline = started + 95_000;
  const auth = await metricoolRequest("GET", "/v2/inbox/post-comments/authorizations", { provider });
  out.authorizations = auth.status === 200
    ? (auth.json as { data?: { missingScopes?: string[]; allowAccessToMessages?: boolean } })?.data || {}
    : { error: failure(auth.status, auth.text, `Autorizações de comentários ${provider}`, 0, provider).message };
  try {
    const { threads, pages, complete } = await readCommentThreads(provider, 3, deadline);
    out.listSeconds = Math.round((Date.now() - started) / 100) / 10;
    out.allPagesRead = complete;
    const roots = threads.map((t) => t.root).filter(Boolean) as NonNullable<CommentThread["root"]>[];
    const replies = roots.flatMap((r) => r.comments || []);
    const elements = roots.map((r) => r.element).filter(Boolean) as PostElement[];
    const posts = new Map(elements.filter((e) => e.id).map((e) => [e.id!, e]));
    const brandOwner = new Set(elements.map((e) => e.owner?.id).filter(Boolean) as string[]);
    const dates = roots.map((r) => r.creationDate || "").filter(Boolean).sort();
    out.read = {
      threads: threads.length, pages,
      providers: countBy(threads.map((t) => t.provider)),
      statuses: countBy(threads.map((t) => t.status)),
      posts: posts.size,
      postKinds: countBy([...posts.values()].map((e) => linkKind(e.link))),
      postOwnerIsBrand: [...posts.values()].filter((e) => BRAND_NAME.test(e.owner?.name || "")).length,
      commentCountOnPosts: range([...posts.values()].map((e) => Number(e.commentCount) || 0)),
      repliesPerThread: range(roots.map((r) => (r.comments || []).length)),
      threadsWithReplies: roots.filter((r) => (r.comments || []).length).length,
      repliesFromPostOwner: replies.filter((c) => c.owner && brandOwner.has(c.owner)).length,
      replyOwnerFormat: countBy(replies.map((c) => (!c.owner ? "vazio" : /^\d+$/.test(c.owner) ? "id numérico" : "texto"))),
      rootOwnerFormat: countBy(roots.map((r) => (!r.owner ? "vazio" : /^\d+$/.test(r.owner) ? "id numérico" : "texto"))),
      participantsPerThread: [...new Set(threads.map((t) => (t.participants || []).length))],
      rootsWithMedia: roots.filter((r) => r.mediaUrl).length,
      rootsWithoutText: roots.filter((r) => !String(r.text || "").trim()).length,
      oldestComment: dates[0] || null,
      newestComment: dates.at(-1) || null,
      // Campos extra da publicação e do comentário (para ver, por exemplo, se há marcação de anúncios).
      postProperties: topShapes([...posts.values()].map((e) => e.properties)),
      commentProperties: topShapes(roots.map((r) => r.properties)),
    };
  } catch (e) {
    out.read = { error: e instanceof Error ? e.message : "indisponível" };
  }
  return out;
}

async function commentAuthorizations(provider: string) {
  const r = await metricoolRequest("GET", "/v2/inbox/post-comments/authorizations", { provider });
  if (r.status !== 200) throw failure(r.status, r.text, `Autorizações de comentários ${provider}`, Number(r.headers?.get("retry-after")) || 0, provider);
  return commentAccess((r.json as { data?: unknown } | null)?.data);
}

// Grava os tópicos de uma página. Se a BD recusar um lote (por exemplo, um texto que não aceita), grava-os um a um:
// um tópico com problema não trava os outros nem põe a fonte em espera. Só falha se nenhum ficar gravado.
async function ingestThreads(sourceId: string, conversations: IngestConversation[]) {
  const zero = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  try {
    return { ...(await ingest(sourceId, conversations)), failed: 0 };
  } catch (e) {
    const totals = { ...zero };
    let failed = 0;
    for (const c of conversations) {
      try {
        const r = await ingest(sourceId, [c]);
        for (const k of Object.keys(zero) as (keyof typeof zero)[]) totals[k] += r[k] || 0;
      } catch {
        failed++;
      }
    }
    if (failed && failed === conversations.length) throw e;
    return { ...totals, failed };
  }
}

// Comentários das publicações (fontes metricool-*-comments): uma conversa por comentário principal. Nunca há
// respostas automáticas nem reações tratadas aqui (as respostas são públicas). As autorizações são confirmadas no
// máximo de hora a hora (cursor.auth_at). firstPageOnly (Verificar, Não foi enviada): só a 1.ª página, sem mexer na
// leitura completa em curso.
export async function syncPostComments(source: { id: string; account?: string; config: Record<string, unknown>; cursor: Record<string, unknown> }, deadline = Infinity,
  { firstPageOnly = false }: { firstPageOnly?: boolean } = {}) {
  if (!metricoolInboxConfigured()) return { skipped: "Metricool por configurar (METRICOOL_USER_TOKEN)." };
  const provider = String(source.config.provider || "");
  if (provider !== "FACEBOOK" && provider !== "INSTAGRAM")
    throw new MetricoolError(`Rede por configurar nesta fonte (${provider || "vazia"}).`, null, 0, true);
  // Noutra marca, a paginação, a leitura completa e as autorizações da marca anterior não valem: começa do zero.
  const cursor = metricoolCursor(source.cursor, source.account, metricoolAccount().blogId);
  const authAt = typeof cursor.auth_at === "string" ? Date.parse(cursor.auth_at) : NaN;
  if (!Number.isFinite(authAt) || Date.now() - authAt > 3_600_000) {
    const auth = await commentAuthorizations(provider);
    if (!auth.allowed)
      throw new MetricoolError(`Metricool não tem acesso aos comentários ${provider}${auth.missingScopes.length ? ` (em falta: ${auth.missingScopes.join(", ")})` : ""}. Voltar a ligar a rede na marca Metricool.`, 403, 0, true);
    cursor.auth_at = new Date().toISOString();
  }
  const handles = Array.isArray(source.config.brand_handles) ? source.config.brand_handles.filter((h): h is string => typeof h === "string") : [];
  let brand = typeof source.config.brand_id === "string" ? source.config.brand_id : typeof cursor.brand === "string" ? cursor.brand : null;
  let totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  let skipped = 0, failed = 0;
  const plan = commentReadPlan(cursor, Date.now(), firstPageOnly);
  const walk = await readCommentThreads(provider, plan.maxPages, deadline, async (page) => {
    brand = commentBrand(page, brand);
    if (!brand) {
      skipped += page.length;
      return;
    }
    const now = new Date();
    const mapped = page
      .map((t) => threadToConversation(t, { network: provider, now, brandHandles: handles, brandId: brand }))
      .filter((c): c is NonNullable<typeof c> => !!c);
    skipped += page.length - mapped.length;
    const r = await ingestThreads(source.id, mapped);
    failed += r.failed;
    totals = { conversations: totals.conversations + r.conversations, new_conversations: totals.new_conversations + r.new_conversations,
      new_messages: totals.new_messages + r.new_messages, reopened: totals.reopened + r.reopened };
  }, plan.resume);
  const after = commentCursorAfter(cursor, plan.walking, walk, Date.now());
  const importing = after.importing;
  const detail = [
    !brand && "Conta da marca por identificar nos comentários: indicar o id da conta da marca na configuração da fonte (brand_id).",
    failed && `${failed} tópico(s) recusado(s) pela base de dados nesta passagem.`,
    skipped && brand && `${skipped} tópico(s) por importar: sem o comentário principal, numa publicação de outra conta ou só com respostas da marca.`,
    importing && "Leitura de todos os tópicos em curso: continua na próxima passagem.",
  ].filter(Boolean).join(" ") || null;
  return { cursor: { ...after.cursor, ...(brand ? { brand } : {}) }, totals, detail, more: importing };
}

// Resposta PÚBLICA a um comentário, no mesmo tópico: objectId é o id do comentário principal, lido da base de dados
// (nunca do pedido do browser). Só texto. A resposta da API é um texto livre: não é usada como id; a
// sincronização seguinte reconhece a resposta pelo texto.
export async function metricoolComment(provider: string | undefined, objectId: string | null | undefined, text: string, timeoutMs = 30_000) {
  if (!provider || !objectId || !/^[\w.:-]{1,200}$/.test(objectId))
    return { outcome: "failed" as const, externalId: null, detail: "Comentário de destino por identificar nesta conversa: nada foi publicado." };
  if (!text.trim()) return { outcome: "failed" as const, externalId: null, detail: "Escreva o texto da resposta (os comentários não levam anexos)." };
  const r = await metricoolRequest("POST", "/v2/inbox/post-comments", {}, { provider, objectId, text }, timeoutMs);
  const outcome = sendOutcome(r.status);
  const fault = outcome === "failed" ? metricoolFault(r.text, metricoolNetwork(provider), "comentario", r.status) : null;
  return {
    outcome,
    externalId: null,
    detail: outcome === "accepted" ? null : outcome === "uncertain" ? "Sem confirmação da Metricool; confirmar na publicação antes de voltar a publicar."
      : fault?.text ?? failure(r.status, r.text, "Resposta pública").message,
  };
}
