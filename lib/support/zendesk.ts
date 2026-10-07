import "server-only";
import { encryptionConfigured, open, seal } from "./crypto";
import { ingest, serverConfigured, serverRpc, type Attachment, type IngestConversation, type IngestMessage } from "./db";
import { fromZendeskStatus, plainText, sendOutcome, toZendeskStatus, type Status } from "./rules";

// Zendesk Support (goldstorepremium.zendesk.com), OAuth por colaborador: cada pessoa liga a sua
// própria conta de agente e as respostas saem com essa autoria. Scopes do cliente OAuth
// "lojadoouro_apoio_cliente": tickets:read (tickets e comentários), tickets:write (respostas, notas
// internas, estado, responsável), users:read (perfil do agente e nomes dos autores) e, desde os scopes
// granulares de agosto de 2026, ticket_attachments:read/write (ver e anexar ficheiros).
export const ZENDESK_SCOPES = "tickets:read tickets:write users:read ticket_attachments:read ticket_attachments:write";
export const OAUTH_COOKIE = "ldo_zd_oauth";
// Tokens de acesso duram 30 minutos (omissão Zendesk); o de renovação pede-se com 90 dias (máximo).
const REFRESH_TOKEN_SECONDS = 90 * 24 * 3600;
const RENEW_MARGIN_MS = 2 * 60 * 1000;
const FIRST_SYNC_DAYS = 30;
const MAX_TICKETS_PER_RUN = 60;
const LIST_PAGES = 10;

// code: motivo curto para a página (o callback nunca põe texto livre no URL).
export class ZendeskError extends Error {
  constructor(message: string, public status: number | null = null, public retryAfter = 0, public reconnect = false, public code = "erro") {
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
// Uma conta de agente só pode estar ligada a um colaborador (verificado também na BD).
export async function completeConnection(userId: string, code: string, verifier: string, requestUrl: string) {
  const { status, json } = await tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: redirectUri(requestUrl), scope: ZENDESK_SCOPES,
    code_verifier: verifier, refresh_token_expires_in: REFRESH_TOKEN_SECONDS,
  });
  if (status !== 200 || !json.access_token)
    throw new ZendeskError(`O Zendesk recusou a ligação (${json.error || `HTTP ${status}`}).`, status, 0, false, "token");
  const me = await call<{ user: ZUser }>(json.access_token, "GET", "/api/v2/users/me.json");
  if (!me.user || !["agent", "admin"].includes(me.user.role))
    throw new ZendeskError("Esta conta Zendesk não é de agente.", null, 0, false, "agente");
  // Light agents só escrevem notas privadas: as respostas ao cliente nunca chegariam.
  if (me.user.role_type === 1) throw new ZendeskError("Conta Zendesk light agent: não pode responder a clientes.", null, 0, false, "light");
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

// Reaproveita o token durante a mesma passagem (só memória da instância, nunca persistido aqui).
const tokenCache = new Map<string, { token: string; until: number }>();

// Token de acesso válido de um colaborador. Só um pedido de cada vez renova (lease na BD);
// os outros esperam pela versão nova, porque cada renovação invalida o par anterior.
// failedToken: o token que acabou de receber 401; só se renova se for ainda o guardado.
export async function accessToken(userId: string, failedToken?: string): Promise<string> {
  const cached = tokenCache.get(userId);
  if (!failedToken && cached && cached.until > Date.now()) return cached.token;
  tokenCache.delete(userId);
  for (let attempt = 0; attempt < 30; attempt++) {
    const c = await serverRpc<Connection | null>("ldo_support_zendesk_get", { p_user_id: userId });
    if (!c || c.status !== "active" || !c.access_ct)
      throw new ZendeskError("A sua conta Zendesk não está ligada. Use “Ligar Zendesk”.", null, 0, true);
    let stored: string;
    try {
      stored = open(c.access_ct, userId);
    } catch {
      throw new ZendeskError("Não foi possível ler o token guardado (chave de cifra alterada?). Volte a ligar o Zendesk.", null, 0, true);
    }
    const expiresAt = c.access_expires_at ? Date.parse(c.access_expires_at) : Infinity;
    const fresh = expiresAt - Date.now() > RENEW_MARGIN_MS;
    // Outro pedido já renovou depois do 401: usa o token novo sem voltar a renovar.
    if (fresh && (!failedToken || stored !== failedToken)) {
      tokenCache.set(userId, { token: stored, until: Math.min(expiresAt - RENEW_MARGIN_MS, Date.now() + 5 * 60 * 1000) });
      return stored;
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
      // Só um token de renovação inválido obriga a voltar a ligar; credenciais da app erradas
      // (invalid_client) são configuração e não apagam os tokens de ninguém.
      if (json.error === "invalid_grant" || json.error === "invalid_token") {
        await serverRpc("ldo_support_zendesk_fail", { p_user_id: userId, p_version: c.version, p_detail: `Renovação recusada pelo Zendesk (${json.error}).` });
        throw new ZendeskError("A ligação ao Zendesk expirou. Volte a ligar o Zendesk.", status, 0, true);
      }
      if (json.error === "invalid_client" || json.error === "unauthorized_client")
        throw new ZendeskError(`O Zendesk recusou as credenciais da app (${json.error}). Verificar ZENDESK_CLIENT_ID/ZENDESK_CLIENT_SECRET.`, status);
      throw new ZendeskError(`Renovação do token Zendesk indisponível (${json.error || `HTTP ${status}`}).`, status >= 500 ? status : null);
    }
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
  if (r.ok) return (r.status === 204 ? null : await r.json()) as T;
  const retry = Number(r.headers.get("retry-after")) || 0;
  const detail = (await r.json().catch(() => ({}))) as { error?: string | { title?: string; message?: string }; description?: string; details?: Record<string, { description?: string }[]> };
  const msg = typeof detail.error === "object" ? detail.error.message || detail.error.title : detail.description || detail.error;
  const fields = detail.details ? Object.values(detail.details).flat().map((d) => d.description).filter(Boolean).join(" ") : "";
  if (r.status === 403) throw new ZendeskError(`Sem permissão no Zendesk para esta operação${msg ? ` (${msg})` : ""}.`, 403);
  if (r.status === 429) throw new ZendeskError("Limite de pedidos do Zendesk atingido; nova tentativa mais tarde.", 429, retry || 60);
  throw new ZendeskError(`Zendesk recusou o pedido (HTTP ${r.status}${msg ? `: ${msg}` : ""}${fields ? ` — ${fields}` : ""}).`, r.status, retry);
}

// Pedido com o token do colaborador; um 401 renova (se ainda for preciso) e repete uma vez.
async function asUser<T>(userId: string, method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(userId);
  try {
    return await call<T>(token, method, path, body);
  } catch (e) {
    if (!(e instanceof ZendeskError) || e.status !== 401) throw e;
    return call<T>(await accessToken(userId, token), method, path, body);
  }
}

type ZUser = { id: number; name: string; email: string | null; phone: string | null; role: string; role_type?: number | null; photo?: { content_url?: string } | null };
type ZAttachment = { id: number; file_name: string; content_url: string; content_type: string | null; size: number | null; inline?: boolean; malware_scan_result?: string };
type ZComment = { id: number; public: boolean; author_id: number; body: string; html_body?: string; plain_body?: string; attachments: ZAttachment[]; created_at: string };
type ZTicket = { id: number; subject: string | null; status: string; requester_id: number; assignee_id: number | null; via?: { channel?: string }; updated_at: string; created_at: string };

const attachmentsOf = (c: ZComment): Attachment[] =>
  (c.attachments || [])
    // Ficheiros que o Zendesk marcou como maliciosos nunca são disponibilizados.
    .filter((a) => a.malware_scan_result !== "malware_found")
    // inline: imagem embutida no corpo do email (muitas vezes logótipos de assinatura).
    .map((a) => ({ name: a.file_name, type: a.content_type, size: a.size, ref: `zendesk:${a.id}`, ...(a.inline ? { inline: true } : {}) }));

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
  let path: string | null = `/api/v2/tickets/${encodeURIComponent(id)}/comments.json?include=users&include_inline_images=true&sort_order=asc&per_page=100`;
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

// Ticket pedido pelo número na pesquisa (fora da janela já sincronizada): lido e guardado a pedido.
export async function importTicket(userId: string | null, id: string) {
  const reader = userId || (await serverRpc<string | null>("ldo_support_zendesk_sync_user"));
  if (!reader) return false;
  try {
    await ingest("zendesk", [await readTicket(reader, id)]);
    return true;
  } catch (e) {
    if (e instanceof ZendeskError && e.status === 404) return false;
    throw e;
  }
}

type Cursor = { since: string; seen: number[] };

// Sincronização: tickets alterados desde a última passagem, do mais antigo para o mais recente, com
// os comentários. O Zendesk é a fonte de verdade; nada é escrito no Zendesk aqui.
// Cursor (updated_at, ids já lidos nesse mesmo segundo): nenhum ticket fica para trás nem se repete
// para sempre. O progresso é gravado a cada lote e a passagem para antes do limite de tempo.
export async function syncZendesk(raw: Record<string, unknown>, deadline: number, progress: (cursor: Cursor) => Promise<unknown>) {
  if (!zendeskConfigured()) return { skipped: "Zendesk por configurar (credenciais OAuth ou SUPPORT_ENCRYPTION_KEY em falta)." };
  const userId = await serverRpc<string | null>("ldo_support_zendesk_sync_user");
  if (!userId) return { skipped: "Nenhum colaborador ligou ainda a sua conta Zendesk." };
  const cursor: Cursor = {
    since: typeof raw.since === "string" ? raw.since : new Date(Date.now() - FIRST_SYNC_DAYS * 86400000).toISOString(),
    seen: Array.isArray(raw.seen) ? raw.seen.map(Number) : [],
  };
  const pending = (t: ZTicket) => t.updated_at > cursor.since || (t.updated_at === cursor.since && !cursor.seen.includes(t.id));
  const all: ZTicket[] = [];
  const users = new Map<number, ZUser>();
  let reachedCursor = false;
  for (let page = 1; !reachedCursor && page <= LIST_PAGES && Date.now() < deadline; page++) {
    const r = await asUser<{ tickets: ZTicket[]; users?: ZUser[]; next_page: string | null }>(userId, "GET",
      `/api/v2/tickets.json?sort_by=updated_at&sort_order=desc&per_page=100&page=${page}&include=users`);
    for (const u of r.users || []) users.set(u.id, u);
    for (const t of r.tickets) {
      if (t.updated_at < cursor.since) {
        reachedCursor = true;
        break;
      }
      if (pending(t)) all.push(t);
    }
    if (!r.next_page) reachedCursor = true;
  }
  // Mais de LIST_PAGES×100 tickets alterados (primeira importação grande): ficam os mais recentes e o
  // aviso fica visível; os anteriores abrem-se pelo número (#N) na pesquisa.
  const detail = reachedCursor ? null : `Mais de ${LIST_PAGES * 100} tickets alterados desde a última passagem: só os mais recentes foram considerados. Os anteriores abrem-se pesquisando o número (#N).`;
  const changed = all.sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id - b.id).slice(0, MAX_TICKETS_PER_RUN);
  let totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  let processed = 0;
  for (let i = 0; i < changed.length && Date.now() < deadline; i += 10) {
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
    for (const t of batch) {
      if (t.updated_at > cursor.since) {
        cursor.since = t.updated_at;
        cursor.seen = [t.id];
      } else cursor.seen.push(t.id);
    }
    processed += batch.length;
    await progress(cursor);
  }
  return { cursor, totals, detail, more: all.length > processed };
}

type UpdateResult = { ticket: ZTicket; audit?: { events?: { id: number; type: string; public?: boolean }[] } };

export type OutgoingFile = { name: string; type: string; data: Buffer };

const ATTACHMENT_SCOPE_HINT = "A ligação Zendesk não tem permissão para anexos (ticket_attachments). Confirme os scopes do cliente OAuth e volte a ligar o Zendesk.";

// Carrega um ficheiro no Zendesk (bytes em bruto, não multipart) e devolve o token de uso único.
// Vários ficheiros juntam-se no mesmo carregamento passando o token anterior.
async function uploadFile(token: string, file: OutgoingFile, previous?: string) {
  const q = new URLSearchParams({ filename: file.name, ...(previous ? { token: previous } : {}) });
  let r: Response;
  try {
    r = await fetch(`${base()}/api/v2/uploads.json?${q}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type, Accept: "application/json" },
      body: new Uint8Array(file.data),
    });
  } catch {
    throw new ZendeskError("Carregamento do anexo no Zendesk interrompido.", null);
  }
  if (r.status === 401) throw new ZendeskError("Token Zendesk recusado.", 401);
  if (r.status === 403) throw new ZendeskError(ATTACHMENT_SCOPE_HINT, 403);
  if (!r.ok) throw new ZendeskError(`O Zendesk recusou o anexo “${file.name}” (HTTP ${r.status}).`, r.status);
  const j = (await r.json().catch(() => ({}))) as { upload?: { token?: string } };
  if (!j.upload?.token) throw new ZendeskError("O Zendesk não devolveu o anexo carregado.", r.status);
  return j.upload.token;
}

// Resposta pública ou nota interna, com o token de quem escreve. Uma nota é sempre public:false.
// Os anexos são carregados primeiro: se algum falhar, nada é publicado no ticket ("Falhou").
export async function zendeskComment(userId: string, ticketId: string, body: string, isPublic: boolean, files: OutgoingFile[] = []) {
  const path = `/api/v2/tickets/${encodeURIComponent(ticketId)}.json`;
  const failed = (e: unknown) => ({ outcome: "failed" as const, externalId: null, detail: e instanceof Error ? e.message : "Ligação Zendesk indisponível." });
  // Sem token válido o pedido nem chega a sair: é uma falha, não um resultado incerto.
  let token: string;
  try {
    token = await accessToken(userId);
  } catch (e) {
    return failed(e);
  }
  let uploadToken: string | undefined;
  try {
    for (const f of files) {
      try {
        uploadToken = await uploadFile(token, f, uploadToken);
      } catch (e) {
        if (!(e instanceof ZendeskError) || e.status !== 401) throw e;
        token = await accessToken(userId, token);
        uploadToken = await uploadFile(token, f, uploadToken);
      }
    }
  } catch (e) {
    return failed(e);
  }
  const payload = { ticket: { comment: { body: body || (files.length ? "Segue em anexo." : ""), public: isPublic, ...(uploadToken ? { uploads: [uploadToken] } : {}) } } };
  let r: UpdateResult;
  try {
    r = await call<UpdateResult>(token, "PUT", path, payload);
  } catch (e) {
    if (!(e instanceof ZendeskError)) return { outcome: "uncertain" as const, externalId: null, detail: "Resposta do Zendesk ilegível; verificar antes de reenviar." };
    if (e.status !== 401) return { outcome: sendOutcome(e.status), externalId: null, detail: e.message };
    // 401: o Zendesk recusou o token e nada foi criado. Renovar (se falhar, continua a não ter saído).
    let renewed: string;
    try {
      renewed = await accessToken(userId, token);
    } catch (err) {
      return failed(err);
    }
    try {
      r = await call<UpdateResult>(renewed, "PUT", path, payload);
    } catch (err) {
      if (!(err instanceof ZendeskError)) return { outcome: "uncertain" as const, externalId: null, detail: "Resposta do Zendesk ilegível; verificar antes de reenviar." };
      return { outcome: err.reconnect ? ("failed" as const) : sendOutcome(err.status), externalId: null, detail: err.message };
    }
  }
  const event = r.audit?.events?.find((e) => e.type === "Comment");
  // O Zendesk pode gravar como privada uma resposta pública (permissões da conta): o cliente não a recebe.
  if (isPublic && event && event.public === false)
    return { outcome: "failed" as const, externalId: String(event.id), detail: "O Zendesk gravou esta resposta como nota interna (a sua conta não pode responder publicamente): o cliente não a recebeu." };
  return { outcome: "accepted" as const, externalId: event ? String(event.id) : null, detail: null as string | null };
}

// Estado e responsável: escritos primeiro no Zendesk; o dashboard guarda o que o Zendesk devolver.
export async function zendeskUpdate(userId: string, ticketId: string, change: { status?: Status; assigneeZendeskId?: string | null }) {
  const ticket: Record<string, unknown> = {};
  if (change.status) ticket.status = toZendeskStatus(change.status);
  if (change.assigneeZendeskId !== undefined) ticket.assignee_id = change.assigneeZendeskId ? Number(change.assigneeZendeskId) : null;
  await asUser<UpdateResult>(userId, "PUT", `/api/v2/tickets/${encodeURIComponent(ticketId)}.json`, { ticket });
  return readTicket(userId, ticketId);
}

const ZENDESK_FILE_HOST = /(^|\.)zendesk\.com$|(^|\.)zdusercontent\.com$/;

// Anexo de um comentário: o servidor procura-o no próprio ticket (nunca segue um URL vindo do browser).
// O Zendesk responde com um redirecionamento para um endereço temporário; ficheiros pequenos são
// lidos pelo servidor (cabeçalhos seguros), os grandes abrem diretamente desse endereço temporário.
// Vários anexos do mesmo ticket abertos ao mesmo tempo (miniaturas) reutilizam a mesma lista de comentários.
const commentsCache = new Map<string, { at: number; list: ReturnType<typeof ticketComments> }>();
function cachedComments(userId: string, ticketId: string) {
  const key = `${userId}:${ticketId}`;
  const hit = commentsCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  const list = ticketComments(userId, ticketId);
  list.catch(() => commentsCache.delete(key));
  commentsCache.set(key, { at: Date.now(), list });
  if (commentsCache.size > 200) commentsCache.delete(commentsCache.keys().next().value!);
  return list;
}

export async function zendeskAttachment(userId: string, ticketId: string, attachmentId: string, maxBytes: number) {
  const { comments } = await cachedComments(userId, ticketId);
  const a = comments.flatMap((c) => c.attachments || []).find((x) => String(x.id) === attachmentId);
  if (!a || a.malware_scan_result === "malware_found") throw new ZendeskError("Anexo indisponível.", 404);
  if (!ZENDESK_FILE_HOST.test(new URL(a.content_url).hostname)) throw new ZendeskError("Anexo fora do Zendesk recusado.", 400);
  const meta = { name: a.file_name, type: a.content_type, size: a.size };
  const first = await fetch(a.content_url, {
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${await accessToken(userId)}` },
  });
  if (first.status === 403 || first.status === 401) {
    await first.body?.cancel();
    throw new ZendeskError(`Sem permissão para abrir anexos do Zendesk. ${ATTACHMENT_SCOPE_HINT}`, 403);
  }
  let location: string | null = null;
  if (first.status >= 300 && first.status < 400) {
    location = new URL(first.headers.get("location") || "", a.content_url).toString();
    await first.body?.cancel();
    if (!ZENDESK_FILE_HOST.test(new URL(location).hostname)) throw new ZendeskError("Anexo fora do Zendesk recusado.", 400);
  } else if (!first.ok) {
    await first.body?.cancel();
    throw new ZendeskError(`Anexo indisponível (HTTP ${first.status}).`, first.status);
  }
  // Grande: o browser vai buscá-lo diretamente ao Zendesk (o nosso servidor não o transporta).
  if ((a.size || 0) > maxBytes) {
    if (!location) await first.body?.cancel();
    return { ...meta, redirect: location || a.content_url };
  }
  if (!location) return { ...meta, response: first };
  // O endereço temporário já traz a autorização: nunca se envia o token do agente para lá.
  const r = await fetch(location, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new ZendeskError(`Anexo indisponível (HTTP ${r.status}).`, r.status);
  return { ...meta, response: r };
}

// Revoga no Zendesk o token atual (melhor esforço) antes de o apagar no dashboard.
export async function revokeConnection(userId: string) {
  try {
    await call(await accessToken(userId), "DELETE", "/api/v2/oauth/tokens/current.json");
  } catch {
    // A ligação é apagada na mesma; o token expira sozinho.
  }
  tokenCache.delete(userId);
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
