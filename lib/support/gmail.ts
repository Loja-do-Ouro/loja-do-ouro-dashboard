import "server-only";
import { ingest, serverRpc, type IngestConversation } from "./db";
import { open, randomToken, seal } from "./crypto";
import { gmailThreadLink } from "./rules";
import {
  autoReplyAllowed, buildMime, cleanSubject, formatAddress, header, labelExcluded, messageAttachments, messageText, parseAddress,
  parseAddressList, replySubject, signatureBlock, textToHtml, withinHours, type GmailMessage, type GmailPart,
} from "./gmail-rules";

// Email do Apoio ao Cliente diretamente pela caixa Gmail (Google Workspace), em vez do Zendesk.
// Uma só caixa partilhada, ligada pelo Super Admin com OAuth (âmbito gmail.modify). As chaves ficam
// cifradas no Supabase (AES-256-GCM, SUPPORT_ENCRYPTION_KEY) e só o servidor as usa. Os emails novos
// chegam por aviso da Google (Pub/Sub → /api/support/webhooks/gmail) e pela sincronização habitual; o
// histórico da caixa (historyId) diz o que mudou desde a última passagem.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_OAUTH_COOKIE = "ldo_gm_oauth";
const OWNER = "gmail:apoio"; // dados autenticados da cifra: as chaves só abrem para esta ligação
const RENEW_MARGIN_MS = 2 * 60 * 1000;

export class GmailError extends Error {
  constructor(message: string, public status: number | null = null, public reconnect = false, public retryAfter = 0) {
    super(message);
  }
}

export function gmailMailbox() {
  return (process.env.GMAIL_MAILBOX || "apoiocliente@lojadoouro.pt").trim().toLowerCase();
}
export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
export function gmailPushReady() {
  return Boolean(process.env.GMAIL_PUBSUB_TOPIC && process.env.GMAIL_PUSH_SERVICE_ACCOUNT);
}
// O endereço de retorno registado na Google é o da produção: a ligação faz-se sempre lá.
function productionOrigin() {
  if (process.env.SUPPORT_PUBLIC_URL) return process.env.SUPPORT_PUBLIC_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://loja-do-ouro-dashboard.vercel.app";
}
export function gmailRedirectUri() {
  return process.env.GMAIL_REDIRECT_URI || `${productionOrigin()}/api/support/gmail/callback`;
}
export function gmailPushAudience() {
  return process.env.GMAIL_PUSH_AUDIENCE || `${productionOrigin()}/api/support/webhooks/gmail`;
}
export function gmailThreadUrl(threadId: string) {
  return gmailThreadLink(gmailMailbox(), threadId);
}

export type EmailSettings = {
  signature: string; autoreply_enabled: boolean; autoreply_text: string; autoreply_offhours_text: string;
  hours: { weekdays?: string; saturday?: string; sunday?: string };
};
type Account = {
  email: string; scope: string | null; refresh_ct: string | null; access_ct: string | null; access_expires_at: string | null;
  version: number; status: "active" | "reconnect"; watch_expires_at: string | null;
};
type State = { account: Account | null; settings: EmailSettings };

async function gmailState() {
  return serverRpc<State>("ldo_support_gmail_get");
}
export async function emailSettings() {
  return (await gmailState()).settings;
}

// ---------------------------------------------------------------- OAuth

export function gmailAuthorizeUrl(state: string, challenge: string) {
  const mailbox = gmailMailbox();
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: gmailRedirectUri(), response_type: "code", scope: GMAIL_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge,
    code_challenge_method: "S256", login_hint: mailbox, hd: mailbox.split("@")[1] || "",
  });
  return `${AUTH_URL}?${q}`;
}

type TokenResponse = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  let r: Response;
  try {
    r = await fetch(TOKEN_URL, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", ...params }),
    });
  } catch {
    throw new GmailError("A Google não respondeu ao pedido de acesso. Tente de novo.");
  }
  const body = (await r.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!r.ok || !body.access_token) {
    const code = body.error || "";
    // invalid_grant: autorização revogada ou expirada → voltar a ligar. invalid_client: configuração da app.
    throw new GmailError(
      code === "invalid_grant" ? "A Google recusou a ligação (autorização revogada ou expirada). Volte a ligar a caixa."
        : code === "invalid_client" || code === "unauthorized_client" ? "A Google recusou as credenciais OAuth (GOOGLE_CLIENT_ID/SECRET)."
          : `A Google recusou o pedido de acesso (${body.error_description || code || `HTTP ${r.status}`}).`,
      r.status, code === "invalid_grant");
  }
  return body as TokenResponse;
}

async function gmailFetch<T>(token: string, path: string, init: { method?: string; json?: unknown; raw?: string; contentType?: string; base?: string } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${init.base || API}${path}`, {
      method: init.method || "GET", cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(init.json !== undefined ? { "Content-Type": "application/json" } : init.raw !== undefined ? { "Content-Type": init.contentType || "application/octet-stream" } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.raw,
    });
  } catch {
    throw new GmailError("O Gmail não respondeu a tempo.");
  }
  if (r.status === 204) return undefined as T;
  const body = (await r.json().catch(() => null)) as (T & { error?: { message?: string; status?: string; errors?: { reason?: string }[] } }) | null;
  if (!r.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
    const retry = Number(r.headers.get("retry-after")) || (r.status === 429 ? 60 : 0);
    const reconnect = r.status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(reason);
    throw new GmailError(`Gmail: ${body?.error?.message || `HTTP ${r.status}`}`, r.status, reconnect, retry);
  }
  return body as T;
}

// Confirma a caixa e cifra as chaves; quem guarda é a rota de retorno (com a sessão do Super Admin).
export async function exchangeGmailCode(code: string, verifier: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: gmailRedirectUri(), code_verifier: verifier });
  if (!t.refresh_token) throw new GmailError("A Google não devolveu a autorização permanente. Volte a carregar em Ligar Gmail.");
  if (t.scope && !t.scope.split(" ").includes(GMAIL_SCOPE)) throw new GmailError("Falta autorizar o acesso ao Gmail. Volte a ligar e aceite o pedido.");
  const profile = await gmailFetch<{ emailAddress: string }>(t.access_token, "/profile");
  const email = (profile.emailAddress || "").toLowerCase();
  if (email !== gmailMailbox()) throw new GmailError(`Entrou com ${email || "outra conta"}: ligue a caixa ${gmailMailbox()}.`, 403);
  return {
    email, scope: t.scope || GMAIL_SCOPE, refresh_ct: seal(t.refresh_token, OWNER), access_ct: seal(t.access_token, OWNER),
    access_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
  };
}

let tokenCache: { token: string; until: number } | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chave de acesso válida. Renovação por uma só função de cada vez (lease de 30 s na BD, pela versão).
async function accessToken(failed?: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (tokenCache && tokenCache.until > Date.now() && tokenCache.token !== failed) return tokenCache.token;
    const { account: a } = await gmailState();
    if (!a) throw new GmailError("Gmail por ligar.", null, true);
    if (a.status !== "active" || !a.refresh_ct) throw new GmailError("É preciso voltar a ligar a caixa Gmail.", null, true);
    let access: string | null = null;
    try {
      access = a.access_ct ? open(a.access_ct, OWNER) : null;
    } catch {
      throw new GmailError("Não foi possível abrir a ligação Gmail (a chave de cifra mudou?). Volte a ligar a caixa.", null, true);
    }
    const expires = a.access_expires_at ? Date.parse(a.access_expires_at) : 0;
    if (access && access !== failed && expires - Date.now() > RENEW_MARGIN_MS) {
      tokenCache = { token: access, until: Math.min(expires - RENEW_MARGIN_MS, Date.now() + 5 * 60 * 1000) };
      return access;
    }
    if (await serverRpc<boolean>("ldo_support_gmail_claim", { p_version: a.version })) {
      let t: TokenResponse;
      try {
        t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(a.refresh_ct, OWNER) });
      } catch (e) {
        if (e instanceof GmailError && e.reconnect) await serverRpc("ldo_support_gmail_fail", { p_version: a.version, p_detail: e.message }).catch(() => undefined);
        throw e;
      }
      const until = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
      await serverRpc<boolean>("ldo_support_gmail_rotate", {
        p_version: a.version, p_access_ct: seal(t.access_token, OWNER), p_access_expires_at: until,
        p_refresh_ct: t.refresh_token ? seal(t.refresh_token, OWNER) : null,
      }).catch(() => false);
      tokenCache = { token: t.access_token, until: Math.min(Date.parse(until) - RENEW_MARGIN_MS, Date.now() + 5 * 60 * 1000) };
      return t.access_token;
    }
    await sleep(800);
  }
  throw new GmailError("A renovação da ligação Gmail demorou demasiado. Tente de novo.");
}

async function call<T>(path: string, init: Parameters<typeof gmailFetch>[2] = {}): Promise<T> {
  const token = await accessToken();
  try {
    return await gmailFetch<T>(token, path, init);
  } catch (e) {
    if (e instanceof GmailError && e.status === 401) return gmailFetch<T>(await accessToken(token), path, init);
    throw e;
  }
}

// Avisos da Google (Pub/Sub) para a caixa de entrada e os enviados. Expiram ao fim de 7 dias: renovados
// pela sincronização quando faltam menos de 2 dias.
export async function gmailWatch() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) return null;
  const r = await call<{ historyId: string; expiration: string }>("/watch", {
    method: "POST", json: { topicName: topic, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" },
  });
  await serverRpc("ldo_support_gmail_watch", { p_expires_at: new Date(Number(r.expiration)).toISOString() });
  return r.historyId;
}

// Desligar: parar os avisos e revogar a autorização na Google (melhor esforço).
export async function gmailDisconnectRemote() {
  await call("/stop", { method: "POST", json: {} }).catch(() => undefined);
  const { account } = await gmailState().catch(() => ({ account: null }));
  if (account?.refresh_ct) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(account.refresh_ct, OWNER))}`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // A ligação é apagada na BD na mesma.
    }
  }
  tokenCache = null;
}

// ---------------------------------------------------------------- sincronização

type Thread = { id: string; historyId?: string; messages?: GmailMessage[] };
type Cursor = { historyId?: string; pending?: string[] };
const MAX_THREADS_PER_RUN = 40;

const isOwn = (m: GmailMessage, mailbox: string) =>
  (m.labelIds || []).includes("SENT") || parseAddress(header(m.payload, "From")).email === mailbox;

// Endereço de quem escreveu: o Reply-To quando existe (formulário de contacto da loja, que chega de um
// remetente da Shopify com o email do cliente em Reply-To), senão o From.
function senderOf(m: GmailMessage, mailbox: string) {
  const reply = parseAddress(header(m.payload, "Reply-To"));
  if (reply.email && reply.email !== mailbox) return reply;
  return parseAddress(header(m.payload, "From"));
}

// Uma conversa do Gmail no formato comum. O cliente é o primeiro remetente que não é a caixa (ou o
// primeiro destinatário, se fomos nós a começar). Rascunhos, spam, lixo e promoções ficam de fora.
export function mapThread(t: Thread, mailbox: string): IngestConversation | null {
  const msgs = (t.messages || []).filter((m) => isOwn(m, mailbox) ? !(m.labelIds || []).some((l) => l === "DRAFT" || l === "TRASH") : !labelExcluded(m.labelIds));
  if (!msgs.length || !msgs.some((m) => !isOwn(m, mailbox))) return null;
  let customer = msgs.filter((m) => !isOwn(m, mailbox)).map((m) => senderOf(m, mailbox)).find((a) => a.email && a.email !== mailbox) || null;
  if (!customer)
    customer = msgs.flatMap((m) => parseAddressList(header(m.payload, "To"))).find((a) => a.email && a.email !== mailbox) || null;
  if (!customer?.email) return null;
  const times = msgs.map((m) => Number(m.internalDate) || 0);
  return {
    external_id: t.id,
    contact: { external_id: customer.email, name: customer.name, email: customer.email },
    subject: (cleanSubject(header(msgs[0].payload, "Subject")) || "(sem assunto)").slice(0, 300),
    via: "email",
    external_updated_at: new Date(Math.max(...times) || Date.now()).toISOString(),
    messages: msgs.map((m) => {
      const own = isOwn(m, mailbox);
      const from = senderOf(m, mailbox);
      return {
        external_id: m.id,
        kind: own ? ("outbound" as const) : ("inbound" as const),
        author_name: own ? null : from.name || from.email,
        body: messageText(m.payload) || (m.snippet || "").slice(0, 500),
        attachments: messageAttachments(m.id, m.payload),
        created_at: new Date(Number(m.internalDate) || Date.now()).toISOString(),
        ...(own ? { delivery: "accepted" as const } : {}),
      };
    }),
  };
}

export async function syncGmail(cursor: Record<string, unknown>, deadline: number) {
  const state = await gmailState();
  if (!state.account) return { skipped: "Gmail por ligar." };
  if (state.account.status !== "active") throw new GmailError("É preciso voltar a ligar a caixa Gmail.", null, true);
  const mailbox = gmailMailbox();
  const watchUntil = state.account.watch_expires_at ? Date.parse(state.account.watch_expires_at) : 0;
  if (gmailPushReady() && watchUntil - Date.now() < 2 * 24 * 3600 * 1000) await gmailWatch().catch(() => undefined);

  const pending = new Set(Array.isArray(cursor.pending) ? (cursor.pending as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  let historyId = typeof cursor.historyId === "string" ? cursor.historyId : undefined;
  let initial = false;
  const recent = async (days: number) => {
    const profile = await call<{ historyId: string }>("/profile");
    const list = await call<{ threads?: { id: string }[] }>(`/threads?${new URLSearchParams({ q: `in:inbox newer_than:${days}d`, maxResults: "50" })}`);
    for (const t of list.threads || []) pending.add(t.id);
    return profile.historyId;
  };
  if (!historyId) {
    // Primeira passagem: os emails dos últimos 14 dias (sem respostas automáticas a mensagens antigas).
    historyId = await recent(14);
    initial = true;
  } else {
    try {
      let page: string | undefined;
      let latest = historyId;
      do {
        const h = await call<{ history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string }>(
          `/history?${new URLSearchParams({ startHistoryId: historyId, historyTypes: "messageAdded", maxResults: "500", ...(page ? { pageToken: page } : {}) })}`);
        for (const e of h.history || []) for (const a of e.messagesAdded || []) if (!(a.message.labelIds || []).includes("DRAFT")) pending.add(a.message.threadId);
        latest = h.historyId || latest;
        page = h.nextPageToken;
      } while (page && Date.now() < deadline - 15000);
      // Sem ler o histórico todo, o ponto de partida fica onde estava (as conversas lidas ficam pendentes).
      if (!page) historyId = latest;
    } catch (e) {
      // Histórico demasiado antigo (a Google guarda cerca de uma semana): recomeça pelos últimos 7 dias.
      if (!(e instanceof GmailError && e.status === 404)) throw e;
      historyId = await recent(7);
    }
  }

  const queue = [...pending];
  const conversations: IngestConversation[] = [];
  const fresh: Thread[] = [];
  let read = 0;
  while (queue.length && read < MAX_THREADS_PER_RUN && Date.now() < deadline - 10000) {
    const id = queue.shift()!;
    read++;
    const t = await call<Thread>(`/threads/${encodeURIComponent(id)}?format=full`).catch((e) => {
      if (e instanceof GmailError && e.status === 404) return null; // apagada entretanto
      throw e;
    });
    if (!t) continue;
    const conv = mapThread(t, mailbox);
    if (!conv) continue;
    conversations.push(conv);
    if (!initial) fresh.push(t);
  }
  const totals = conversations.length ? await ingest("gmail", conversations) : { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  let autoreplies = 0;
  if (state.settings.autoreply_enabled) {
    for (const t of fresh) {
      if (Date.now() > deadline - 5000) break;
      if (await autoReply(t, state.settings, mailbox).catch(() => false)) autoreplies++;
    }
  }
  return {
    cursor: { historyId, pending: queue },
    totals: { ...totals, autoreplies },
    detail: `Gmail (${mailbox})`,
    more: queue.length > 0,
  };
}

// ---------------------------------------------------------------- envio

const HEADERS_FOR_REPLY = ["From", "Reply-To", "To", "Subject", "Message-ID", "Message-Id", "References"];

function personalise(signature: string, firstName: string | null) {
  return signature.split("\n").map((l) => l.replace(/\{nome\}/gi, firstName || "").trimEnd()).filter((l, i, all) => l || (i > 0 && all[i - 1])).join("\n").trim();
}

// Resposta na mesma conversa do Gmail (threadId + In-Reply-To/References + assunto), com a assinatura.
export async function gmailSendReply(o: {
  threadId: string; body: string; signature: string; senderFirstName: string | null; files?: { name: string; type: string; data: Buffer }[];
}) {
  const mailbox = gmailMailbox();
  const q = new URLSearchParams([["format", "metadata"], ...HEADERS_FOR_REPLY.map((h) => ["metadataHeaders", h])]);
  const t = await call<Thread>(`/threads/${encodeURIComponent(o.threadId)}?${q}`);
  const msgs = (t.messages || []).filter((m) => !(m.labelIds || []).includes("DRAFT"));
  const lastIn = [...msgs].reverse().find((m) => !isOwn(m, mailbox));
  if (!lastIn) throw new GmailError("Esta conversa não tem mensagens do cliente para responder.", 400);
  const to = parseAddress(header(lastIn.payload, "Reply-To")).email || parseAddress(header(lastIn.payload, "From")).email;
  if (!to || to === mailbox) throw new GmailError("Não foi possível saber o email do cliente nesta conversa.", 400);
  const messageId = header(lastIn.payload, "Message-ID") || header(lastIn.payload, "Message-Id");
  const references = [header(lastIn.payload, "References"), messageId].filter(Boolean).join(" ").split(/\s+/).slice(-20).join(" ");
  const sig = signatureBlock(personalise(o.signature, o.senderFirstName));
  const mime = buildMime({
    from: formatAddress("Loja do Ouro", mailbox), to, subject: replySubject(header(msgs[0].payload, "Subject")),
    inReplyTo: messageId, references: references || null,
    text: o.body + sig.text, html: textToHtml(o.body) + sig.html, attachments: o.files,
  });
  // Envio com a mensagem completa (anexos incluídos) e o threadId, num só pedido.
  const boundary = `ldo-${randomToken(12)}`;
  const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ threadId: o.threadId })}\r\n`
    + `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${mime}\r\n--${boundary}--\r\n`;
  return call<{ id: string; threadId: string }>("/messages/send?uploadType=multipart", {
    base: UPLOAD, method: "POST", raw: payload, contentType: `multipart/related; boundary=${boundary}`,
  });
}

// "Recebemos o seu email": só em conversas novas (a primeira mensagem é do cliente e ainda não respondemos),
// com a última mensagem do cliente com menos de 1 hora, nunca a remetentes automáticos, listas ou ao próprio
// domínio, uma vez por conversa e uma vez por dia por remetente (a BD confirma).
async function autoReply(t: Thread, s: EmailSettings, mailbox: string) {
  const msgs = (t.messages || []).filter((m) => !labelExcluded(m.labelIds) || isOwn(m, mailbox));
  if (!msgs.length || isOwn(msgs[0], mailbox) || msgs.some((m) => isOwn(m, mailbox))) return false;
  const last = msgs[msgs.length - 1];
  if (Date.now() - (Number(last.internalDate) || 0) > 60 * 60 * 1000) return false;
  const check = autoReplyAllowed(last, { mailbox, ownDomains: [mailbox.split("@")[1] || ""] });
  if (!check.ok) return false;
  const email = parseAddress(header(last.payload, "Reply-To")).email || parseAddress(header(last.payload, "From")).email;
  if (!email) return false;
  if (!(await serverRpc<boolean>("ldo_support_gmail_autoreply_claim", { p_thread: t.id, p_email: email }))) return false;
  const text = withinHours(s.hours, new Date()) ? s.autoreply_text : s.autoreply_offhours_text;
  try {
    await gmailSendReply({ threadId: t.id, body: text, signature: s.signature, senderFirstName: null });
    return true;
  } catch {
    await serverRpc("ldo_support_gmail_autoreply_release", { p_thread: t.id }).catch(() => undefined);
    return false;
  }
}

// ---------------------------------------------------------------- anexos

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function findPart(part: GmailPart | undefined, partId: string): GmailPart | null {
  if (!part) return null;
  if (part.partId === partId) return part;
  for (const p of part.parts || []) {
    const hit = findPart(p, partId);
    if (hit) return hit;
  }
  return null;
}

// Anexo de uma mensagem (ref "gmail:<mensagem>:<parte>"), lido com a ligação da caixa.
export async function gmailAttachment(messageId: string, partId: string) {
  const m = await call<GmailMessage>(`/messages/${encodeURIComponent(messageId)}?format=full`);
  const part = findPart(m.payload, partId);
  if (!part) throw new GmailError("Anexo não encontrado.", 404);
  if ((part.body?.size || 0) > MAX_ATTACHMENT_BYTES) throw new GmailError("Anexo com mais de 4 MB: abra-o no Gmail.", 413);
  const data = part.body?.attachmentId
    ? (await call<{ data: string }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`)).data
    : part.body?.data || "";
  const bytes = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new GmailError("Anexo com mais de 4 MB: abra-o no Gmail.", 413);
  return { data: bytes, type: part.mimeType || "application/octet-stream", name: part.filename || "anexo", threadId: m.threadId };
}
