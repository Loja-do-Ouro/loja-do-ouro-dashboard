import "server-only";
import { SupabaseError } from "@/lib/supabase";
import { ingest, serverRpc, type IngestConversation, type IngestMessage } from "./db";
import { open, randomToken, seal } from "./crypto";
import { gmailThreadLink } from "./rules";
import {
  autoReplyAllowed, buildMime, cleanSubject, cleanText, dashboardMessageId, formatAddress, header, isAutoSubmitted, labelExcluded,
  messageAttachments, messageText, replySubject, senderOf, signatureBlock, textToHtml, validEmail, withinHours,
  type GmailMessage, type GmailPart,
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
type HistoryChange = { message: { id: string; threadId: string; labelIds?: string[] }; labelIds?: string[] };
type HistoryPage = {
  history?: { messagesAdded?: HistoryChange[]; labelsAdded?: HistoryChange[]; labelsRemoved?: HistoryChange[] }[];
  historyId?: string;
  nextPageToken?: string;
};
const MAX_THREADS_PER_RUN = 40;
// Conversas por ler entre passagens (no cursor da fonte). Muito acima do normal: se alguma vez passar, as mais
// antigas saem e o estado da fonte diz quantas.
const MAX_PENDING = 5000;
// Uma conversa volta a contar quando entra na caixa de entrada ou sai do spam, do lixo, das promoções ou das redes sociais.
const RETURNING = ["SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"];
const SENT_CHECK_DAYS = 7;

// Nosso é só o que saiu desta caixa (o Gmail marca-o como SENT): um From forjado com o endereço da loja não conta.
const isOwn = (m: GmailMessage) => (m.labelIds || []).includes("SENT");
// Mensagens que contam: sem rascunhos, spam, lixo, promoções e redes sociais.
const visible = (t: Thread) => (t.messages || []).filter((m) => !labelExcluded(m.labelIds));
const at = (m: GmailMessage) => Number(m.internalDate) || 0;

export type MappedThread = {
  conversation: IngestConversation;
  // Email do formulário de contacto (Reply-To), guardado como não confirmado.
  claimed: string | null;
  // Envios feitos pelo dashboard que o Gmail tem nos Enviados: confirmam envios incertos.
  sent: { id: string; externalId: string; at: number }[];
};

// Uma conversa do Gmail no formato comum.
// - O cliente é quem escreveu a primeira mensagem recebida: o From (autenticado pelo Gmail) ou, nos formulários de
//   contacto, o Reply-To, que fica como email não confirmado (não mostra encomendas até a equipa o associar).
// - As nossas respostas automáticas não entram como mensagens (aparecem como acontecimento na conversa).
// - Os envios do dashboard já estão no dashboard: só confirmam o envio.
// - Todo o texto é limpo para o Postgres (um NUL num email não pode travar a sincronização).
export function mapThread(t: Thread, mailbox: string): MappedThread | null {
  const msgs = visible(t);
  const inbound = msgs.filter((m) => !isOwn(m));
  const customer = inbound.map((m) => senderOf(m)).find((a) => a.email && a.email !== mailbox);
  if (!customer?.email) return null;
  const sent: MappedThread["sent"] = [];
  const messages: IngestMessage[] = [];
  for (const m of msgs) {
    const own = isOwn(m);
    if (own) {
      const id = dashboardMessageId(m);
      if (id) {
        sent.push({ id, externalId: m.id, at: at(m) });
        continue;
      }
      if (isAutoSubmitted(m)) continue;
    }
    const from = own ? null : senderOf(m);
    // Um email recebido com o endereço da própria caixa no From não foi enviado por nós.
    const author = from ? `${from.name || from.email || "Remetente desconhecido"}${from.email === mailbox ? " (não enviado por esta caixa)" : ""}` : null;
    messages.push({
      external_id: m.id,
      kind: own ? "outbound" : "inbound",
      author_name: author ? cleanText(author).slice(0, 200) : null,
      body: cleanText(messageText(m.payload) || (m.snippet || "").slice(0, 500)),
      attachments: messageAttachments(m.id, m.payload).map((a) => ({ ...a, name: cleanText(a.name) })),
      created_at: new Date(at(m) || Date.now()).toISOString(),
      ...(own ? { delivery: "accepted" as const } : {}),
    });
  }
  const subject = Array.from(cleanText(cleanSubject(header(msgs[0].payload, "Subject")))).slice(0, 300).join("");
  return {
    conversation: {
      external_id: t.id,
      contact: { external_id: customer.email, name: customer.name ? cleanText(customer.name) : null, email: customer.verified ? customer.email : null },
      subject: subject || "(sem assunto)",
      via: customer.verified ? "email" : "formulario",
      external_updated_at: new Date(Math.max(...msgs.map(at)) || Date.now()).toISOString(),
      messages,
    },
    claimed: customer.verified ? null : customer.email,
    sent,
  };
}

// Erro dos dados (classe 22 do Postgres, ex.: texto que o jsonb recusa) e não da ligação.
const dataError = (e: unknown) => e instanceof SupabaseError && e.code.startsWith("22");

type Totals = { conversations: number; new_conversations: number; new_messages: number; reopened: number };

// Grava as conversas; uma que a base de dados recuse é saltada (e contada) em vez de travar todas as outras.
async function ingestEach(conversations: IngestConversation[]) {
  const totals: Totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  const add = (r: Totals) => (Object.keys(totals) as (keyof Totals)[]).forEach((k) => (totals[k] += r[k] || 0));
  let skipped = 0;
  if (!conversations.length) return { totals, skipped };
  try {
    add(await ingest("gmail", conversations));
  } catch (first) {
    let ok = 0;
    for (const c of conversations) {
      try {
        add(await ingest("gmail", [c]));
        ok++;
      } catch (e) {
        if (!dataError(e)) throw e;
        skipped++;
      }
    }
    if (!ok && !skipped) throw first;
  }
  return { totals, skipped };
}

export async function syncGmail(cursor: Record<string, unknown>, deadline: number) {
  const state = await gmailState();
  if (!state.account) return { skipped: "Gmail por ligar." };
  if (state.account.status !== "active") throw new GmailError("É preciso voltar a ligar a caixa Gmail.", null, true);
  const mailbox = gmailMailbox();
  const watchUntil = state.account.watch_expires_at ? Date.parse(state.account.watch_expires_at) : 0;
  if (gmailPushReady() && watchUntil - Date.now() < 2 * 24 * 3600 * 1000) await gmailWatch().catch(() => undefined);

  const now = () => Math.floor(Date.now() / 1000);
  let historyId = typeof cursor.historyId === "string" ? cursor.historyId : undefined;
  let syncedAt = typeof cursor.syncedAt === "number" ? cursor.syncedAt : null;
  const previous = Array.isArray(cursor.pending) ? (cursor.pending as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const notes: string[] = [];

  if (!historyId) {
    // Primeira passagem: só entra o que chegar a partir de agora. Os emails anteriores ficam no Gmail (e no Zendesk,
    // durante a transição); importá-los como "Novo" levaria a responder outra vez a clientes já atendidos.
    const profile = await call<{ historyId: string }>("/profile");
    return {
      cursor: { historyId: profile.historyId, syncedAt: now(), pending: [] },
      totals: { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0, autoreplies: 0, skipped: 0 },
      detail: `Gmail (${mailbox}): os emails novos entram a partir de agora.`,
      more: false,
    };
  }

  // Conversas alteradas, as mais recentes primeiro.
  const found: string[] = [];
  try {
    let page: string | undefined;
    let latest = historyId;
    const ids: string[] = [];
    do {
      const q = new URLSearchParams({ startHistoryId: historyId, maxResults: "500" });
      for (const type of ["messageAdded", "labelAdded", "labelRemoved"]) q.append("historyTypes", type);
      if (page) q.set("pageToken", page);
      const h = await call<HistoryPage>(`/history?${q}`);
      for (const e of h.history || []) {
        for (const a of e.messagesAdded || []) if (!(a.message.labelIds || []).includes("DRAFT")) ids.push(a.message.threadId);
        for (const a of e.labelsAdded || []) if ((a.labelIds || []).includes("INBOX")) ids.push(a.message.threadId);
        for (const a of e.labelsRemoved || []) if ((a.labelIds || []).some((l) => RETURNING.includes(l))) ids.push(a.message.threadId);
      }
      latest = h.historyId || latest;
      page = h.nextPageToken;
    } while (page && Date.now() < deadline - 15000);
    found.push(...ids.reverse());
    // Sem ler o histórico todo, o ponto de partida fica onde estava (a passagem seguinte relê-o).
    if (!page) {
      historyId = latest;
      syncedAt = now();
    }
  } catch (e) {
    if (!(e instanceof GmailError && e.status === 404)) throw e;
    // Histórico expirado (a Google pode guardá-lo só algumas horas): todas as conversas alteradas desde a última
    // leitura completa (com 1 hora de margem), página a página.
    const profile = await call<{ historyId: string }>("/profile");
    const since = syncedAt ? `after:${syncedAt - 3600}` : "newer_than:7d";
    let page: string | undefined;
    let pages = 0;
    do {
      const q = new URLSearchParams({ q: `${since} -in:spam -in:trash -in:drafts`, maxResults: "100" });
      if (page) q.set("pageToken", page);
      const list = await call<{ threads?: { id: string }[]; nextPageToken?: string }>(`/threads?${q}`);
      for (const t of list.threads || []) found.push(t.id);
      page = list.nextPageToken;
      pages++;
    } while (page && pages < 30 && Date.now() < deadline - 15000);
    if (page) notes.push("histórico do Gmail expirado: conversas mais antigas não foram relidas");
    historyId = profile.historyId;
    syncedAt = now();
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const id of [...found, ...previous]) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(id);
  }
  if (queue.length > MAX_PENDING) {
    notes.push(`${queue.length - MAX_PENDING} conversas antigas por ler ficaram de fora`);
    queue.length = MAX_PENDING;
  }

  const mapped: MappedThread[] = [];
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
    fresh.push(t);
    const m = mapThread(t, mailbox);
    if (m) mapped.push(m);
  }
  const { totals, skipped } = await ingestEach(mapped.map((m) => m.conversation));
  if (skipped) notes.push(`${skipped} conversa(s) com conteúdo que a base de dados recusou`);

  // Formulário de contacto: o email indicado fica como não confirmado.
  const claimed = [...new Set(mapped.map((m) => m.claimed).filter((x): x is string => Boolean(x)))];
  if (claimed.length) await serverRpc("ldo_support_gmail_claimed", { p_addresses: claimed }).catch(() => undefined);
  // Envios do dashboard encontrados nos Enviados: um envio incerto passa a Aceite (os outros não mudam).
  for (const s of mapped.flatMap((m) => m.sent)) {
    if (Date.now() - s.at > SENT_CHECK_DAYS * 86400_000 || Date.now() > deadline - 5000) continue;
    await serverRpc("ldo_support_finish_send", {
      p_message: s.id, p_delivery: "accepted", p_detail: "Confirmado nos Enviados do Gmail.", p_external_id: s.externalId,
    }).catch(() => undefined);
  }

  let autoreplies = 0;
  if (state.settings.autoreply_enabled) {
    for (const t of fresh) {
      if (Date.now() > deadline - 5000) break;
      if (await autoReply(t, state.settings, mailbox).catch(() => false)) autoreplies++;
    }
  }
  return {
    cursor: { historyId, syncedAt, pending: queue },
    totals: { ...totals, autoreplies, skipped },
    detail: `Gmail (${mailbox})${notes.length ? ` · ${notes.join("; ")}` : ""}`,
    more: queue.length > 0,
  };
}

// ---------------------------------------------------------------- envio

const HEADERS_FOR_REPLY = ["From", "Reply-To", "Subject", "Message-ID", "References"];

function personalise(signature: string, firstName: string | null) {
  return signature.split("\n").map((l) => l.replace(/\{nome\}/gi, firstName || "").trimEnd()).filter((l, i, all) => l || (i > 0 && all[i - 1])).join("\n").trim();
}

// Resposta na mesma conversa do Gmail (threadId + In-Reply-To/References + assunto), com a assinatura.
// O destinatário é sempre o cliente da conversa (o que o dashboard mostra), nunca outro participante do thread.
export async function gmailSendReply(o: {
  threadId: string; to: string; body: string; signature: string; senderFirstName: string | null;
  files?: { name: string; type: string; data: Buffer }[]; dashboardId?: string; autoSubmitted?: boolean;
}) {
  const mailbox = gmailMailbox();
  const to = (o.to || "").trim().toLowerCase();
  if (!validEmail(to) || to === mailbox) throw new GmailError("Esta conversa não tem um email de cliente válido.", 400);
  const q = new URLSearchParams([["format", "metadata"], ...HEADERS_FOR_REPLY.map((h) => ["metadataHeaders", h])]);
  const t = await call<Thread>(`/threads/${encodeURIComponent(o.threadId)}?${q}`);
  const msgs = visible(t);
  const inbound = msgs.filter((m) => !isOwn(m));
  // Responde à última mensagem deste cliente (para o Gmail manter a conversa); sem nenhuma, à última recebida.
  const ref = [...inbound].reverse().find((m) => senderOf(m).email === to) || inbound[inbound.length - 1];
  if (!ref) throw new GmailError("Esta conversa não tem mensagens do cliente para responder.", 400);
  const messageId = header(ref.payload, "Message-ID");
  const references = [header(ref.payload, "References"), messageId].filter(Boolean).join(" ");
  const sig = signatureBlock(personalise(o.signature, o.senderFirstName));
  const mime = buildMime({
    from: formatAddress("Loja do Ouro", mailbox), to, subject: replySubject(header(msgs[0].payload, "Subject")),
    inReplyTo: messageId, references: references || null,
    text: o.body + sig.text, html: textToHtml(o.body) + sig.html, attachments: o.files,
    dashboardId: o.dashboardId, autoSubmitted: o.autoSubmitted,
  });
  // Envio com a mensagem completa (anexos incluídos) e o threadId, num só pedido.
  const boundary = `ldo-${randomToken(12)}`;
  const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ threadId: o.threadId })}\r\n`
    + `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${mime}\r\n--${boundary}--\r\n`;
  return call<{ id: string; threadId: string }>("/messages/send?uploadType=multipart", {
    base: UPLOAD, method: "POST", raw: payload, contentType: `multipart/related; boundary=${boundary}`,
  });
}

// "Recebemos o seu email": só em conversas novas (ainda sem nada enviado por nós), com a última mensagem do
// cliente com menos de 1 hora, nunca a remetentes automáticos, listas ou ao próprio domínio, uma vez por conversa
// e uma vez por dia por remetente (a BD confirma). Sai marcada como automática (Auto-Submitted).
async function autoReply(t: Thread, s: EmailSettings, mailbox: string) {
  const msgs = visible(t);
  if (!msgs.length || msgs.some(isOwn)) return false;
  const last = msgs[msgs.length - 1];
  if (Date.now() - at(last) > 60 * 60 * 1000) return false;
  if (!autoReplyAllowed(last, { mailbox, ownDomains: [mailbox.split("@")[1] || ""] }).ok) return false;
  const to = senderOf(last).email;
  if (!to || to === mailbox) return false;
  if (!(await serverRpc<boolean>("ldo_support_gmail_autoreply_claim", { p_thread: t.id, p_email: to }))) return false;
  const text = withinHours(s.hours, new Date()) ? s.autoreply_text : s.autoreply_offhours_text;
  try {
    await gmailSendReply({ threadId: t.id, to, body: text, signature: s.signature, senderFirstName: null, autoSubmitted: true });
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
