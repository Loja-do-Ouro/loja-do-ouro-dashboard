import "server-only";
import { metricoolAccount, metricoolConfigured, metricoolRequest } from "@/lib/bi/metricool";
import { ingest, serverConfigured, serverRpc, type IngestConversation, type IngestMessage } from "./db";
import { sendOutcome } from "./rules";
import { hiddenReaction, socialAutoReply, type SocialSettings } from "./social-rules";

// Metricool Inbox (API v2, https://app.metricool.com/api/swagger.json), mensagens privadas do
// Facebook Messenger e do Instagram da marca "Loja do Ouro Jericó" (blogId 2912472). Reutiliza o
// token e a marca da secção Redes sociais. A Inbox não tem webhooks: a sincronização é por consulta.
//   GET  /v2/inbox/conversations?provider=…               conversas com participantes e mensagens
//   POST /v2/inbox/conversations {provider, conversationId, recipient, text, attachment}
//   GET  /v2/inbox/conversations/authorizations?provider=… {missingScopes, allowAccessToMessages}
//   GET  /v2/inbox/conversations/fetch-image?provider=…&target=…
// Comentários de publicações e anúncios ficam fora desta fase.

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

function failure(status: number | null, text: string | undefined, what: string, retryAfter = 0) {
  if (status === null) return new MetricoolError(`${what}: Metricool sem resposta.`, null);
  if (status === 401 || status === 403)
    return new MetricoolError(`${what}: a conta Metricool recusou o acesso à Inbox (HTTP ${status}). Confirmar que o plano e o token incluem a Inbox por API.`, status, 0, true);
  if (status === 429) return new MetricoolError(`${what}: limite de pedidos Metricool atingido.`, 429, retryAfter || 120);
  return new MetricoolError(`${what}: Metricool recusou o pedido (HTTP ${status}${text ? ` · ${text.replace(/\s+/g, " ").slice(0, 160)}` : ""}).`, status);
}

// Autorizações da Inbox para uma rede (permissões em falta na ligação da marca).
export async function inboxAuthorizations(provider: string) {
  const r = await metricoolRequest("GET", "/v2/inbox/conversations/authorizations", { provider });
  if (r.status !== 200) throw failure(r.status, r.text, `Autorizações ${provider}`);
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
    if (r.status !== 200) throw failure(r.status, r.text, `Conversas ${provider}`, Number(r.headers?.get("retry-after")) || 0);
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

export async function syncMetricool(source: { id: string; config: Record<string, unknown>; cursor: Record<string, unknown> }, deadline = Infinity) {
  if (!metricoolInboxConfigured()) return { skipped: "Metricool por configurar (METRICOOL_USER_TOKEN)." };
  const provider = String(source.config.provider || "");
  const auth = await inboxAuthorizations(provider);
  if (!auth.allowAccessToMessages)
    throw new MetricoolError(`Metricool não tem acesso às mensagens ${provider}${auth.missingScopes.length ? ` (em falta: ${auth.missingScopes.join(", ")})` : ""}. Voltar a ligar a rede na marca Metricool.`, 403, 0, true);
  const configured = typeof source.config.brand_id === "string" ? source.config.brand_id : typeof source.cursor.brand === "string" ? source.cursor.brand : null;
  let totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0, autoreplies: 0 };
  let brand = configured;
  let skipped = 0;
  // Respostas automáticas (em vez da mensagem de ausência do Meta): lidas uma vez por passagem.
  const social = await serverRpc<SocialSettings | null>("ldo_support_social_settings").catch(() => null);
  const { complete } = await listConversations(provider, {
    deadline,
    onPage: async (page) => {
      brand = brandParticipant(page, brand);
      const pairs = page.map((raw) => ({ raw, conv: toConversation(raw, brand) })).filter((p): p is { raw: Conversation; conv: IngestConversation } => !!p.conv);
      const mapped = pairs.map((p) => p.conv);
      skipped += page.length - mapped.length;
      const r = await ingest(source.id, mapped);
      const autoreplies = social?.enabled ? await sendAutoReplies(provider, source.id, pairs, social, deadline) : 0;
      totals = { conversations: totals.conversations + r.conversations, new_conversations: totals.new_conversations + r.new_conversations,
        new_messages: totals.new_messages + r.new_messages, reopened: totals.reopened + r.reopened, autoreplies: totals.autoreplies + autoreplies };
    },
  });
  const detail = skipped
    ? `${skipped} conversa(s) por interpretar: conta da marca ainda não identificada. Indicar o id da conta da marca na configuração da fonte (brand_id).`
    : complete ? null : "Nem todas as páginas foram lidas nesta passagem; continuam na seguinte.";
  return { cursor: { ...source.cursor, ...(brand ? { brand } : {}) }, totals, detail, more: !complete };
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
async function sendAutoReplies(provider: string, sourceId: string, pairs: { raw: Conversation; conv: IngestConversation }[], settings: SocialSettings, deadline: number) {
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
    const decision = socialAutoReply(messages, settings, now, name);
    if (!decision) continue;
    const claim = { p_source: sourceId, p_conversation: conv.external_id, p_anchor: decision.anchor };
    if (!(await serverRpc<boolean>("ldo_support_social_autoreply_claim", { ...claim, p_contact: recipient, p_kind: decision.kind, p_since: decision.since }).catch(() => false))) continue;
    const r = await metricoolSend(provider, conv.external_id, recipient, decision.text, null, 10_000).catch(() => ({ outcome: "uncertain" as const }));
    // Falhou: o registo sai e a mensagem pode voltar a ser respondida. Enviada ou sem confirmação: fica o
    // acontecimento na conversa (o incerto nunca se repete, porque pode ter chegado).
    const result = { ...claim, p_outcome: r.outcome };
    await serverRpc("ldo_support_social_autoreply_result", result).catch(() => serverRpc("ldo_support_social_autoreply_result", result)).catch(() => undefined);
    if (r.outcome !== "failed") sent++;
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
    return { outcome: "failed" as const, externalId: null, detail: "Destinatário por identificar nesta conversa: nada foi enviado." };
  let attachment: string | undefined;
  // Fotos da Shopify já são públicas e estáveis; só o URL temporário do dashboard é copiado para a Metricool.
  if (imageUrl) attachment = new URL(imageUrl).hostname === "cdn.shopify.com" ? imageUrl : (await hostedImage(imageUrl)).url;
  const r = await metricoolRequest("POST", "/v2/inbox/conversations", {}, { provider, conversationId, recipient, text, ...(attachment ? { attachment } : {}) }, timeoutMs);
  const outcome = sendOutcome(r.status);
  // A Meta recusa imagens que não consegue ir buscar (endereço protegido, expirado) ou em formato não suportado.
  const imageRefused = outcome === "failed" && attachment && /attachment format|attachment.*not supported|#100/i.test(r.text || "");
  return {
    outcome,
    externalId: null,
    detail: outcome === "accepted" ? null : outcome === "uncertain" ? "Sem confirmação da Metricool; verificar antes de reenviar."
      : imageRefused ? "A Meta recusou a imagem (não a conseguiu obter ou o formato não é suportado). Nada foi enviado ao cliente; pode enviar só o texto ou outra imagem JPEG/PNG."
      : failure(r.status, r.text, "Envio").message,
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
function emptyMessageShapes(conversations: Conversation[]) {
  const empty = conversations.flatMap((c) => (c.messages || []).filter((m) => !String(m.text || "").trim() && !(m.attachments || []).length));
  const shapes = new Map<string, number>();
  for (const m of empty) {
    const parts: string[] = [];
    const walk = (v: unknown, path: string, depth: number) => {
      if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) {
        for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 20)) walk(x, path ? `${path}.${k}` : k, depth + 1);
      } else {
        // Valor só em campos que descrevem um tipo (type, kind, reaction…), nunca nomes nem conteúdo.
        const typed = /(^|\.)(type|kind|subtype|category|event|reaction|source)$/i.test(path) && typeof v === "string" && /^[A-Za-z_]{1,30}$/.test(v);
        parts.push(typed ? `${path}=${v}` : `${path}:${Array.isArray(v) ? "array" : typeof v}`);
      }
    };
    walk(m.properties ?? null, "", 0);
    const key = parts.sort().join(", ") || "(sem properties)";
    shapes.set(key, (shapes.get(key) || 0) + 1);
  }
  return { count: empty.length, properties: [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([shape, n]) => ({ shape, n })) };
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
