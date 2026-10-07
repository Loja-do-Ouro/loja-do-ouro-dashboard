import "server-only";
import { metricoolAccount, metricoolConfigured, metricoolRequest } from "@/lib/bi/metricool";
import { ingest, serverConfigured, type IngestConversation, type IngestMessage } from "./db";
import { sendOutcome } from "./rules";

// Metricool Inbox (API v2, https://app.metricool.com/api/swagger.json), mensagens privadas do
// Facebook Messenger e do Instagram da marca "Loja do Ouro Jericó" (blogId 2912472). Reutiliza o
// token e a marca da secção Redes sociais. A Inbox não tem webhooks: a sincronização é por consulta.
//   GET  /v2/inbox/conversations?provider=…               conversas com participantes e mensagens
//   POST /v2/inbox/conversations {provider, conversationId, recipient, text, attachment}
//   GET  /v2/inbox/conversations/authorizations?provider=… {missingScopes, allowAccessToMessages}
//   GET  /v2/inbox/conversations/fetch-image?provider=…&target=…
// Comentários de publicações e anúncios ficam fora desta fase.

type Participant = { id?: string; name?: string; email?: string; imageProfileUrl?: string };
type Message = { id?: string; from?: string; to?: string; text?: string; publicationDateTime?: string; attachments?: string[]; status?: string };
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

async function listConversations(provider: string, maxPages = 5) {
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
      r = await metricoolRequest("GET", u.pathname.replace(/^\/api/, ""), params);
    } else r = await metricoolRequest("GET", "/v2/inbox/conversations", { provider });
    if (r.status !== 200) throw failure(r.status, r.text, `Conversas ${provider}`, Number(r.headers?.get("retry-after")) || 0);
    const body = r.json as Listing;
    out.push(...(body?.data || []));
    const raw = body?.page?.next || null;
    paging = raw ? (/^https?:|^\//.test(raw) ? "url" : "token") : paging;
    next = raw && /^https?:|^\//.test(raw) ? raw : null;
    pages++;
  } while (next && pages < maxPages);
  return { conversations: out, pages, paging };
}

// A conta da marca é o participante comum a todas as conversas; com uma só conversa, o participante
// que não é autor da primeira mensagem recebida. Guardada na configuração da fonte depois de detetada.
export function brandParticipant(conversations: Conversation[], known?: string | null): string | null {
  if (known) return known;
  const count = new Map<string, number>();
  for (const c of conversations) for (const id of new Set((c.participants || []).map((p) => p.id).filter(Boolean) as string[])) count.set(id, (count.get(id) || 0) + 1);
  if (conversations.length >= 2) {
    const common = [...count].filter(([, n]) => n === conversations.length).map(([id]) => id);
    if (common.length === 1) return common[0];
  }
  return null;
}

function toConversation(c: Conversation, brand: string | null): IngestConversation | null {
  if (!c.id) return null;
  const others = (c.participants || []).filter((p) => p.id && p.id !== brand);
  const customer = others.length === 1 ? others[0] : others.find((p) => (c.messages || []).some((m) => m.from === p.id)) || others[0];
  const messages: IngestMessage[] = (c.messages || [])
    .filter((m) => m.id && m.publicationDateTime && m.status !== "DELETED")
    .map((m) => ({
      external_id: String(m.id),
      // Sem marca detetada, só é "do cliente" o que vem do participante cliente.
      kind: brand ? (m.from === brand ? "outbound" : "inbound") : m.from && m.from === customer?.id ? "inbound" : "outbound",
      author_name: m.from === customer?.id ? customer?.name || null : null,
      author_external_id: m.from || null,
      body: m.text || "",
      attachments: (m.attachments || []).filter((a) => /^https:\/\//.test(a)).map((a, i) => ({ name: `Anexo ${i + 1}`, type: null, size: null, ref: `metricool:${a}` })),
      created_at: new Date(m.publicationDateTime!).toISOString(),
    }));
  return {
    external_id: String(c.id),
    contact: { external_id: customer?.id || null, name: customer?.name || null, email: customer?.email || null, handle: customer?.name || null, avatar_url: customer?.imageProfileUrl || null },
    subject: null,
    platform_status: c.status || null,
    external_updated_at: c.lastUpdateTime || null,
    messages,
  };
}

export async function syncMetricool(source: { id: string; config: Record<string, unknown>; cursor: Record<string, unknown> }) {
  if (!metricoolInboxConfigured()) return { skipped: "Metricool por configurar (METRICOOL_USER_TOKEN)." };
  const provider = String(source.config.provider || "");
  const auth = await inboxAuthorizations(provider);
  if (!auth.allowAccessToMessages)
    throw new MetricoolError(`Metricool não tem acesso às mensagens ${provider}${auth.missingScopes.length ? ` (em falta: ${auth.missingScopes.join(", ")})` : ""}. Voltar a ligar a rede na marca Metricool.`, 403, 0, true);
  const { conversations } = await listConversations(provider);
  const brand = brandParticipant(conversations, typeof source.cursor.brand === "string" ? source.cursor.brand : null);
  const mapped = conversations.map((c) => toConversation(c, brand)).filter((c): c is IngestConversation => !!c);
  const totals = await ingest(source.id, mapped);
  return { cursor: { ...source.cursor, ...(brand ? { brand } : {}) }, totals, detail: brand ? null : "Conta da marca ainda não identificada: direção das mensagens deduzida pelo participante." };
}

// Envio numa conversa existente, ao participante cliente. Só texto nesta fase.
export async function metricoolSend(provider: string, conversationId: string, recipient: string | null, text: string) {
  if (!recipient) return { outcome: "failed" as const, externalId: null, detail: "Destinatário desconhecido nesta conversa." };
  const r = await metricoolRequest("POST", "/v2/inbox/conversations", {}, { provider, conversationId, recipient, text });
  const outcome = sendOutcome(r.status);
  const data = (r.json as { data?: unknown })?.data;
  return {
    outcome,
    // A resposta da API é um texto; só é usado como id se parecer um identificador.
    externalId: outcome === "accepted" && typeof data === "string" && /^[\w.:-]{6,200}$/.test(data) ? data : null,
    detail: outcome === "accepted" ? null : outcome === "uncertain" ? "Sem confirmação da Metricool; verificar antes de reenviar." : failure(r.status, r.text, "Envio").message,
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
export async function metricoolDiagnostics(provider: string) {
  const out: Record<string, unknown> = { provider };
  try {
    out.authorizations = await inboxAuthorizations(provider);
  } catch (e) {
    out.authorizations = { error: e instanceof Error ? e.message : "indisponível" };
  }
  try {
    const { conversations, pages, paging } = await listConversations(provider, 3);
    const msgs = conversations.map((c) => (c.messages || []).length);
    const brand = brandParticipant(conversations);
    out.read = {
      conversations: conversations.length, pages, paging,
      messagesPerConversation: msgs.length ? { min: Math.min(...msgs), max: Math.max(...msgs) } : null,
      participantsPerConversation: [...new Set(conversations.map((c) => (c.participants || []).length))],
      statuses: [...new Set(conversations.map((c) => c.status))],
      messageStatuses: [...new Set(conversations.flatMap((c) => (c.messages || []).map((m) => m.status)))],
      withAttachments: conversations.reduce((n, c) => n + (c.messages || []).filter((m) => (m.attachments || []).length).length, 0),
      brandDetected: Boolean(brand),
      oldestMessage: conversations.flatMap((c) => (c.messages || []).map((m) => m.publicationDateTime || "")).filter(Boolean).sort()[0] || null,
    };
  } catch (e) {
    out.read = { error: e instanceof Error ? e.message : "indisponível" };
  }
  return out;
}
