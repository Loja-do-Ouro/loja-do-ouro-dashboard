import "server-only";
import { encryptionConfigured, open, seal } from "./crypto";
import { ingest, serverConfigured, serverRpc, type Attachment, type IngestConversation, type IngestMessage } from "./db";
import { fromZendeskStatus, plainText, sendOutcome, toZendeskStatus, type Status } from "./rules";

// Zendesk Support (goldstorepremium.zendesk.com), OAuth por colaborador: cada pessoa liga a sua
// própria conta de agente e as respostas saem com essa autoria. Scopes do cliente OAuth
// "lojadoouro_apoio_cliente": tickets:read (tickets, comentários, anexos), tickets:write
// (respostas, notas internas, estado, responsável) e users:read (perfil do agente e nomes dos autores).
export const ZENDESK_SCOPES = "tickets:read tickets:write users:read";
export const OAUTH_COOKIE = "ldo_zd_oauth";
// Tokens de acesso duram 30 minutos (omissão Zendesk); o de renovação pede-se com 90 dias (máximo).
const REFRESH_TOKEN_SECONDS = 90 * 24 * 3600;
const RENEW_MARGIN_MS = 2 * 60 * 1000;
const FIRST_SYNC_DAYS = 30;
const MAX_TICKETS_PER_RUN = 60;

export class ZendeskError extends Error {
  constructor(message: string, public status: number | null = null, public retryAfter = 0, public reconnect = false) {
    super(message);
  }
}

export function zendeskSubdomain() {
  const s = (process.env.ZENDESK_SUBDOMAIN || "goldstorepremium").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(s)) throw new ZendeskError("ZENDESK_SUBDOMAIN inválido.");
  return s;
}
const base = () => `https://${zendeskSubdomain()}.zendesk.com`;

export function zendeskReadiness() {
  return {
    client: Boolean(process.env.ZENDESK_CLIENT_ID && process.env.ZENDESK_CLIENT_SECRET),
    encryption: encryptionConfigured(),
    server: serverConfigured(),
  };
}
export const zendeskConfigured = () => Object.values(zendeskReadiness()).every(Boolean);

// Endereço de retorno estável: domínio de produção em produção, endereço do ramo nas previews.
export function publicOrigin(requestUrl: string) {
  const env = process.env;
  if (env.SUPPORT_PUBLIC_URL) return env.SUPPORT_PUBLIC_URL.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  return new URL(requestUrl).origin;
}
export const redirectUri = (requestUrl: string) => `${publicOrigin(requestUrl)}/api/support/zendesk/callback`;

export function authorizeUrl(requestUrl: string, state: string, challenge: string) {
  const u = new URL(`${base()}/oauth/authorizations/new`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ZENDESK_CLIENT_ID || "",
    redirect_uri: redirectUri(requestUrl),
    scope: ZENDESK_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number | null; refresh_token_expires_in?: number | null; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, unknown>): Promise<{ status: number; json: TokenResponse }> {
  let r: Response;
  try {
    r = await fetch(`${base()}/oauth/tokens`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: process.env.ZENDESK_CLIENT_ID, client_secret: process.env.ZENDESK_CLIENT_SECRET, ...body }),
    });
  } catch {
    throw new ZendeskError("Pedido de token ao Zendesk interrompido.");
  }
  return { status: r.status, json: (await r.json().catch(() => ({}))) as TokenResponse };
}

const expiry = (seconds: number | null | undefined) => (seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null);

function sealedTokens(t: TokenResponse, owner: string) {
  return {
    access_ct: seal(t.access_token!, owner),
    refresh_ct: t.refresh_token ? seal(t.refresh_token, owner) : null,
    access_expires_at: expiry(t.expires_in),
    refresh_expires_at: expiry(t.refresh_token_expires_in),
    scope: t.scope || null,
  };
}

// Callback: troca o código pelo par de tokens, confirma o agente e guarda tudo cifrado.
export async function completeConnection(userId: string, code: string, verifier: string, requestUrl: string) {
  const { status, json } = await tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: redirectUri(requestUrl), scope: ZENDESK_SCOPES,
    code_verifier: verifier, refresh_token_expires_in: REFRESH_TOKEN_SECONDS,
  });
  if (status !== 200 || !json.access_token)
    throw new ZendeskError(`O Zendesk recusou a ligação (${json.error_description || json.error || `HTTP ${status}`}).`, status);
  const me = await call<{ user: ZUser }>(json.access_token, "GET", "/api/v2/users/me.json");
  if (!me.user || !["agent", "admin"].includes(me.user.role))
    throw new ZendeskError("Esta conta Zendesk não é de agente. Entre com a sua conta de agente.");
  await serverRpc("ldo_support_zendesk_save", {
    p_user_id: userId,
    p_data: {
      subdomain: zendeskSubdomain(), zendesk_user_id: String(me.user.id), zendesk_name: me.user.name, zendesk_email: me.user.email,
      zendesk_role: me.user.role, ...sealedTokens(json, userId),
    },
  });
  return me.user;
}

type Connection = {
  user_id: string; zendesk_user_id: string; zendesk_name: string | null; status: string; version: number;
  access_ct: string | null; refresh_ct: string | null; access_expires_at: string | null; refresh_lease_until: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Token de acesso válido de um colaborador. Só um pedido de cada vez renova (lease na BD);
// os outros esperam pela versão nova, porque cada renovação invalida o par anterior.
export async function accessToken(userId: string, forceRenew = false): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const c = await serverRpc<Connection | null>("ldo_support_zendesk_get", { p_user_id: userId });
    if (!c || c.status !== "active" || !c.access_ct)
      throw new ZendeskError("A sua conta Zendesk não está ligada. Use “Ligar Zendesk”.", null, 0, true);
    const fresh = !c.access_expires_at || Date.parse(c.access_expires_at) - Date.now() > RENEW_MARGIN_MS;
    if (fresh && !forceRenew) {
      try {
        return open(c.access_ct, userId);
      } catch {
        throw new ZendeskError("Não foi possível ler o token guardado (chave de cifra alterada?). Volte a ligar o Zendesk.", null, 0, true);
      }
    }
    if (!c.refresh_ct) throw new ZendeskError("Ligação Zendesk sem renovação. Volte a ligar o Zendesk.", null, 0, true);
    if (await serverRpc<boolean>("ldo_support_zendesk_claim", { p_user_id: userId, p_version: c.version })) {
      const { status, json } = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(c.refresh_ct, userId), refresh_token_expires_in: REFRESH_TOKEN_SECONDS });
      if (status === 200 && json.access_token) {
        const data = sealedTokens(json, userId);
        // O par antigo já não vale: a gravação é repetida antes de desistir.
        for (let i = 0; i < 3; i++) {
          try {
            await serverRpc("ldo_support_zendesk_rotate", { p_user_id: userId, p_version: c.version, p_data: data });
            break;
          } catch (e) {
            if (i === 2) throw e;
            await sleep(500);
          }
        }
        return json.access_token;
      }
      if (status === 400 || status === 401) {
        await serverRpc("ldo_support_zendesk_fail", { p_user_id: userId, p_version: c.version, p_detail: `Renovação recusada pelo Zendesk (${json.error || status}).` });
        throw new ZendeskError("A ligação ao Zendesk expirou. Volte a ligar o Zendesk.", status, 0, true);
      }
      throw new ZendeskError(`Renovação do token Zendesk indisponível (HTTP ${status}).`, status);
    }
    forceRenew = false;
    await sleep(500);
  }
  throw new ZendeskError("Renovação do token Zendesk demorou demasiado.");
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${base()}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ZendeskError("Pedido ao Zendesk interrompido ou sem resposta.", null);
  }
  if (r.ok) return (await r.json()) as T;
  const retry = Number(r.headers.get("retry-after")) || 0;
  const detail = (await r.json().catch(() => ({}))) as { error?: string | { title?: string; message?: string }; description?: string; details?: Record<string, { description?: string }[]> };
  const msg = typeof detail.error === "object" ? detail.error.message || detail.error.title : detail.description || detail.error;
  const fields = detail.details ? Object.values(detail.details).flat().map((d) => d.description).filter(Boolean).join(" ") : "";
  if (r.status === 403) throw new ZendeskError(`Sem permissão no Zendesk para esta operação${msg ? ` (${msg})` : ""}.`, 403);
  if (r.status === 429) throw new ZendeskError("Limite de pedidos do Zendesk atingido; nova tentativa mais tarde.", 429, retry || 60);
  throw new ZendeskError(`Zendesk recusou o pedido (HTTP ${r.status}${msg ? `: ${msg}` : ""}${fields ? ` — ${fields}` : ""}).`, r.status, retry);
}

// Pedido com o token do colaborador; um 401 força uma renovação e repete uma vez.
async function asUser<T>(userId: string, method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await call<T>(await accessToken(userId), method, path, body);
  } catch (e) {
    if (!(e instanceof ZendeskError) || e.status !== 401) throw e;
    return call<T>(await accessToken(userId, true), method, path, body);
  }
}

type ZUser = { id: number; name: string; email: string | null; phone: string | null; role: string; photo?: { content_url?: string } | null };
type ZAttachment = { id: number; file_name: string; content_url: string; content_type: string | null; size: number | null; malware_scan_result?: string };
type ZComment = { id: number; public: boolean; author_id: number; body: string; html_body?: string; plain_body?: string; attachments: ZAttachment[]; created_at: string };
type ZTicket = { id: number; subject: string | null; status: string; requester_id: number; assignee_id: number | null; via?: { channel?: string }; updated_at: string; created_at: string };

const attachmentsOf = (c: ZComment): Attachment[] =>
  (c.attachments || [])
    // Ficheiros que o Zendesk marcou como maliciosos nunca são disponibilizados.
    .filter((a) => a.malware_scan_result !== "malware_found")
    .map((a) => ({ name: a.file_name, type: a.content_type, size: a.size, ref: `zendesk:${a.id}` }));

function toConversation(t: ZTicket, users: Map<number, ZUser>, comments: ZComment[] | null): IngestConversation {
  const requester = users.get(t.requester_id);
  const messages: IngestMessage[] = (comments || []).map((c) => {
    const author = users.get(c.author_id);
    const agent = author ? author.role !== "end-user" : c.author_id !== t.requester_id;
    return {
      external_id: String(c.id),
      kind: !c.public ? "note" : agent ? "outbound" : "inbound",
      author_name: author?.name || null,
      author_external_id: String(c.author_id),
      body: c.plain_body ?? (c.html_body ? plainText(c.html_body) : c.body || ""),
      attachments: attachmentsOf(c),
      created_at: c.created_at,
    };
  });
  return {
    external_id: String(t.id),
    contact: {
      external_id: String(t.requester_id), name: requester?.name || null, email: requester?.email || null, phone: requester?.phone || null,
      avatar_url: requester?.photo?.content_url || null,
    },
    subject: t.subject ? `#${t.id} · ${t.subject}` : `#${t.id}`,
    status: fromZendeskStatus(t.status),
    platform_status: t.status,
    external_assignee_id: t.assignee_id ? String(t.assignee_id) : null,
    external_assignee_name: t.assignee_id ? users.get(t.assignee_id)?.name || null : null,
    via: t.via?.channel || null,
    external_updated_at: t.updated_at,
    messages,
  };
}

async function ticketComments(userId: string, id: string) {
  const comments: ZComment[] = [];
  const users = new Map<number, ZUser>();
  let path: string | null = `/api/v2/tickets/${encodeURIComponent(id)}/comments.json?include=users&sort_order=asc&per_page=100`;
  for (let page = 0; path && page < 20; page++) {
    const r: { comments: ZComment[]; users?: ZUser[]; next_page: string | null } = await asUser(userId, "GET", path);
    comments.push(...r.comments);
    for (const u of r.users || []) users.set(u.id, u);
    path = r.next_page ? new URL(r.next_page).pathname + new URL(r.next_page).search : null;
  }
  return { comments, users };
}

// Um ticket completo (estado, autores e todos os comentários), no formato comum.
export async function readTicket(userId: string, id: string): Promise<IngestConversation> {
  const [{ ticket, users: ticketUsers }, { comments, users }] = await Promise.all([
    asUser<{ ticket: ZTicket; users?: ZUser[] }>(userId, "GET", `/api/v2/tickets/${encodeURIComponent(id)}.json?include=users`),
    ticketComments(userId, id),
  ]);
  for (const u of ticketUsers || []) users.set(u.id, u);
  return toConversation(ticket, users, comments);
}

// Sincronização: tickets alterados desde a última passagem (mais recentes primeiro), com os comentários.
// O Zendesk é a fonte de verdade; nada é escrito no Zendesk aqui.
export async function syncZendesk(cursor: Record<string, unknown>) {
  if (!zendeskConfigured()) return { skipped: "Zendesk por configurar (credenciais OAuth ou SUPPORT_ENCRYPTION_KEY em falta)." };
  const userId = await serverRpc<string | null>("ldo_support_zendesk_sync_user");
  if (!userId) return { skipped: "Nenhum colaborador ligou ainda a sua conta Zendesk." };
  const since = typeof cursor.since === "string" ? cursor.since : new Date(Date.now() - FIRST_SYNC_DAYS * 86400000).toISOString();
  const all: ZTicket[] = [];
  const users = new Map<number, ZUser>();
  let done = false;
  for (let page = 1; !done && page <= 10; page++) {
    const r = await asUser<{ tickets: ZTicket[]; users?: ZUser[]; next_page: string | null }>(userId, "GET",
      `/api/v2/tickets.json?sort_by=updated_at&sort_order=desc&per_page=100&page=${page}&include=users`);
    for (const u of r.users || []) users.set(u.id, u);
    for (const t of r.tickets) {
      // O ticket no limite do cursor volta a ser lido: gravar é idempotente, saltá-lo não seria.
      if (t.updated_at < since) {
        done = true;
        break;
      }
      all.push(t);
    }
    if (!r.next_page) done = true;
  }
  // Do mais antigo para o mais recente, no máximo MAX_TICKETS_PER_RUN por passagem: o cursor só
  // avança até ao último ticket gravado, por isso nenhum fica para trás.
  const changed = all.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, MAX_TICKETS_PER_RUN);
  let next = since;
  let totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  for (let i = 0; i < changed.length; i += 10) {
    const batch = changed.slice(i, i + 10);
    const convs: IngestConversation[] = [];
    for (const t of batch) {
      const { comments, users: commentUsers } = await ticketComments(userId, String(t.id));
      for (const [k, v] of commentUsers) users.set(k, v);
      convs.push(toConversation(t, users, comments));
    }
    const r = await ingest("zendesk", convs);
    totals = { conversations: totals.conversations + r.conversations, new_conversations: totals.new_conversations + r.new_conversations,
      new_messages: totals.new_messages + r.new_messages, reopened: totals.reopened + r.reopened };
    next = batch.at(-1)!.updated_at;
  }
  return { cursor: { since: next }, totals, more: all.length > changed.length };
}

type UpdateResult = { ticket: ZTicket; audit?: { events?: { id: number; type: string; public?: boolean }[] } };

// Resposta pública ou nota interna, com o token de quem escreve. Uma nota é sempre public:false.
export async function zendeskComment(userId: string, ticketId: string, body: string, isPublic: boolean) {
  const path = `/api/v2/tickets/${encodeURIComponent(ticketId)}.json`;
  const payload = { ticket: { comment: { body, public: isPublic } } };
  // Sem token válido o pedido nem chega a sair: é uma falha, não um resultado incerto.
  let token: string;
  try {
    token = await accessToken(userId);
  } catch (e) {
    return { outcome: "failed" as const, externalId: null, detail: e instanceof Error ? e.message : "Ligação Zendesk indisponível." };
  }
  try {
    let r: UpdateResult;
    try {
      r = await call<UpdateResult>(token, "PUT", path, payload);
    } catch (e) {
      // 401: o Zendesk recusou o token, nada foi criado; repete uma vez com um token renovado.
      if (!(e instanceof ZendeskError) || e.status !== 401) throw e;
      r = await call<UpdateResult>(await accessToken(userId, true), "PUT", path, payload);
    }
    const event = r.audit?.events?.find((e) => e.type === "Comment");
    return { outcome: "accepted" as const, externalId: event ? String(event.id) : null, detail: null as string | null };
  } catch (e) {
    if (!(e instanceof ZendeskError)) throw e;
    return { outcome: e.reconnect ? ("failed" as const) : sendOutcome(e.status), externalId: null, detail: e.message };
  }
}

// Estado e responsável: escritos primeiro no Zendesk; o dashboard guarda o que o Zendesk devolver.
export async function zendeskUpdate(userId: string, ticketId: string, change: { status?: Status; assigneeZendeskId?: string | null }) {
  const ticket: Record<string, unknown> = {};
  if (change.status) ticket.status = toZendeskStatus(change.status);
  if (change.assigneeZendeskId !== undefined) ticket.assignee_id = change.assigneeZendeskId ? Number(change.assigneeZendeskId) : null;
  await asUser<UpdateResult>(userId, "PUT", `/api/v2/tickets/${encodeURIComponent(ticketId)}.json`, { ticket });
  return readTicket(userId, ticketId);
}

// Anexo de um comentário: o servidor procura-o no próprio ticket (nunca segue um URL vindo do browser).
export async function zendeskAttachment(userId: string, ticketId: string, attachmentId: string) {
  const { comments } = await ticketComments(userId, ticketId);
  const a = comments.flatMap((c) => c.attachments || []).find((x) => String(x.id) === attachmentId);
  if (!a || a.malware_scan_result === "malware_found") throw new ZendeskError("Anexo indisponível.", 404);
  const host = new URL(a.content_url).hostname;
  if (!/(^|\.)zendesk\.com$|(^|\.)zdusercontent\.com$/.test(host)) throw new ZendeskError("Anexo fora do Zendesk recusado.", 400);
  const r = await fetch(a.content_url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${await accessToken(userId)}` } });
  if (!r.ok) throw new ZendeskError(`Anexo indisponível (HTTP ${r.status}).`, r.status);
  return { response: r, name: a.file_name, type: a.content_type, size: a.size };
}

// Revoga no Zendesk o token atual (melhor esforço) antes de o apagar no dashboard.
export async function revokeConnection(userId: string) {
  try {
    await call(await accessToken(userId), "DELETE", "/api/v2/oauth/tokens/current.json");
  } catch {
    // A ligação é apagada na mesma; o token expira sozinho.
  }
}

// Diagnóstico para a configuração (Super Admin): confirma o subdomínio e a ligação, sem dados de clientes.
export async function zendeskDiagnostics() {
  const out: Record<string, unknown> = { subdomain: zendeskSubdomain(), readiness: zendeskReadiness() };
  try {
    const r = await fetch(`${base()}/api/v2/locales/public.json`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    out.account = r.ok ? "Conta Zendesk encontrada neste subdomínio." : `Subdomínio sem conta Zendesk (HTTP ${r.status}).`;
  } catch {
    out.account = "Zendesk sem resposta.";
  }
  const userId = serverConfigured() ? await serverRpc<string | null>("ldo_support_zendesk_sync_user").catch(() => null) : null;
  if (!userId) {
    out.connection = "Nenhum colaborador ligou ainda a conta Zendesk.";
    return out;
  }
  try {
    const me = await asUser<{ user: ZUser }>(userId, "GET", "/api/v2/users/me.json");
    out.connection = `Ligado como ${me.user.name} (${me.user.role}).`;
    const r = await asUser<{ count?: { value?: number } }>(userId, "GET", "/api/v2/tickets/count.json");
    out.tickets = r.count?.value ?? null;
  } catch (e) {
    out.connection = e instanceof Error ? e.message : "Ligação indisponível.";
  }
  return out;
}
