import "server-only";
import { SupabaseError } from "@/lib/supabase";
import { ingest, serverRpc, type IngestConversation, type IngestMessage } from "./db";
import { open, randomToken, seal } from "./crypto";
import { gmailThreadLink } from "./rules";
import {
  autoReplyAllowed, buildMime, cleanSubject, cleanText, contactExternalId, dashboardMessageId, formatAddress, header, isAutoSubmitted,
  labelExcluded, messageAttachments, messageText, recipientAllowed, replySubject, senderOf, signatureBlock, textToHtml, validEmail, withinHours,
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
  // Resposta cortada ou ilegível (ex.: corpo grande que não chegou a tempo): erro, nunca um valor vazio.
  if (body === null) throw new GmailError("Gmail: resposta ilegível.");
  return body as T;
}

// Confirma a caixa e cifra as chaves; quem guarda é a rota de retorno (com a sessão do Super Admin).
export async function exchangeGmailCode(code: string, verifier: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: gmailRedirectUri(), code_verifier: verifier });
  if (!t.refresh_token) throw new GmailError("A Google não devolveu a autorização permanente. Volte a carregar em Ligar Gmail.");
  if (t.scope && !t.scope.split(" ").includes(GMAIL_SCOPE)) throw new GmailError("Falta autorizar o acesso ao Gmail. Volte a ligar e aceite o pedido.");
  const profile = await gmailFetch<{ emailAddress: string; historyId?: string }>(t.access_token, "/profile");
  const email = (profile.emailAddress || "").toLowerCase();
  if (email !== gmailMailbox()) throw new GmailError(`Entrou com ${email || "outra conta"}: ligue a caixa ${gmailMailbox()}.`, 403);
  return {
    // Ponto de partida da sincronização: os emails que chegarem a partir daqui entram todos.
    history_id: profile.historyId || null,
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
  history?: { id?: string; messagesAdded?: HistoryChange[]; labelsAdded?: HistoryChange[]; labelsRemoved?: HistoryChange[] }[];
  historyId?: string;
  nextPageToken?: string;
};
// Releitura depois de o histórico expirar, retomada de passagem em passagem.
type Recover = { q: string; page: string | null; historyId: string };
const MAX_THREADS_PER_RUN = 40;
// Páginas (de 100 conversas) lidas por passagem na releitura depois de o histórico expirar.
const RECOVER_PAGES = 30;
// Conversas por ler entre passagens (no cursor). Com a fila cheia o ponto de partida não avança: o que falta é
// relido mais tarde, nunca deitado fora.
const MAX_PENDING = 5000;
// Uma conversa que o Gmail não deixa ler passa para o fim da fila e nunca trava as outras. Só sai da fila (fica
// contada no estado da fonte e volta a ser lida se chegar outra mensagem) depois de falhar pelo menos 5 vezes
// durante 6 horas: uma falha passageira do Gmail nunca tira um email da fila.
const MAX_THREAD_FAILURES = 5;
const THREAD_FAILURE_WINDOW_S = 6 * 3600;
// Até 3 conversas a falhar numa passagem; a partir daí pára de ler (o Gmail deve estar com problemas).
const MAX_FAILED_PER_RUN = 3;
// Tempo reservado no fim da passagem para enviar as respostas automáticas das conversas lidas.
const AUTOREPLY_RESERVE_MS = 20000;
// Uma conversa volta a contar quando entra na caixa de entrada ou sai do spam ou do lixo.
const RETURNING = ["SPAM", "TRASH"];

// Nosso é só o que saiu desta caixa (o Gmail marca-o como SENT): um From forjado com o endereço da loja não conta.
const isOwn = (m: GmailMessage) => (m.labelIds || []).includes("SENT");
// Mensagens que contam: sem rascunhos, spam e lixo.
const visible = (t: Thread) => (t.messages || []).filter((m) => !labelExcluded(m.labelIds));
const at = (m: GmailMessage) => Number(m.internalDate) || 0;

// O cliente da conversa: quem escreveu a primeira mensagem recebida. O From (autenticado pelo Gmail) ou, nos
// formulários de contacto, o Reply-To, que fica como email não confirmado.
function customerOf(msgs: GmailMessage[], mailbox: string) {
  return msgs.filter((m) => !isOwn(m)).map((m) => senderOf(m)).find((a) => a.email && a.email !== mailbox) || null;
}

export type MappedThread = {
  conversation: IngestConversation;
  // Email do formulário de contacto, guardado como não confirmado.
  claimed: string | null;
};
type SentCopy = { id: string; thread: string; external_id: string; attachments: IngestMessage["attachments"] };

// Envios do dashboard que o Gmail tem nos Enviados (cabeçalho X-LDO-Message): confirmam o envio e passam os
// anexos para o Gmail. Lidos mesmo quando a conversa não tem (já) mensagens do cliente visíveis.
function sentCopies(t: Thread): SentCopy[] {
  return (t.messages || []).filter((m) => isOwn(m) && !labelExcluded(m.labelIds)).flatMap((m) => {
    const id = dashboardMessageId(m);
    return id ? [{ id, thread: t.id, external_id: m.id, attachments: messageAttachments(m.id, m.payload).map((a) => ({ ...a, name: cleanText(a.name) })) }] : [];
  });
}

// Uma conversa do Gmail no formato comum.
// - O contacto de um formulário tem id próprio ("formulario:<email>", sem email): nunca herda a identidade, o nome
//   nem as encomendas de quem escreveu diretamente desse endereço.
// - As nossas respostas automáticas e os envios do dashboard não entram como mensagens (os primeiros aparecem como
//   acontecimento; os segundos já estão no dashboard).
// - Todo o texto é limpo para o Postgres (um NUL num email não pode travar a sincronização).
export function mapThread(t: Thread, mailbox: string): MappedThread | null {
  const msgs = visible(t);
  const customer = customerOf(msgs, mailbox);
  const externalId = customer ? contactExternalId(customer) : null;
  if (!customer?.email || !externalId) return null;
  const messages: IngestMessage[] = [];
  for (const m of msgs) {
    const own = isOwn(m);
    if (own && (dashboardMessageId(m) || isAutoSubmitted(m))) continue;
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
      contact: { external_id: externalId, name: customer.name ? cleanText(customer.name) : null, email: customer.verified ? customer.email : null },
      subject: subject || "(sem assunto)",
      via: customer.verified ? "email" : "formulario",
      external_updated_at: new Date(Math.max(...msgs.map(at)) || Date.now()).toISOString(),
      messages,
    },
    claimed: customer.verified ? null : customer.email,
  };
}

// Erro dos dados (classe 22 do Postgres, ex.: texto que o jsonb recusa) e não da ligação.
const dataError = (e: unknown) => e instanceof SupabaseError && e.code.startsWith("22");

type Totals = { conversations: number; new_conversations: number; new_messages: number; reopened: number };

// Grava as conversas lidas, marca os emails de formulário como não confirmados e confirma os envios do
// dashboard. Uma conversa que a base de dados recuse é saltada (e contada) em vez de travar as outras.
// Devolve as conversas cuja confirmação de envio não ficou feita, para voltarem à fila.
async function store(threads: Thread[], mailbox: string) {
  const totals: Totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  const add = (r: Totals) => (Object.keys(totals) as (keyof Totals)[]).forEach((k) => (totals[k] += r[k] || 0));
  const mapped = threads.map((t) => mapThread(t, mailbox)).filter((m): m is MappedThread => m !== null);
  const conversations = mapped.map((m) => m.conversation);
  let skipped = 0;
  if (conversations.length) {
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
  }
  const claimed = [...new Set(mapped.map((m) => m.claimed).filter((x): x is string => Boolean(x)))];
  if (claimed.length) await serverRpc("ldo_support_gmail_claimed", { p_addresses: claimed });
  const copies = threads.flatMap(sentCopies);
  let retry: string[] = [];
  if (copies.length) {
    try {
      await serverRpc("ldo_support_gmail_confirm_sent", { p_items: copies });
    } catch {
      retry = [...new Set(copies.map((c) => c.thread))];
    }
  }
  return { totals, skipped, retry };
}

// "Verificar" de uma resposta por email: relê já a conversa no Gmail (sem esperar pelo histórico).
export async function gmailRecheck(threadId: string) {
  const t = await call<Thread>(`/threads/${encodeURIComponent(threadId)}?format=full`);
  const r = await store([t], gmailMailbox());
  if (r.retry.length) throw new GmailError("Não foi possível confirmar o envio agora. Tente de novo.");
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function syncGmail(cursor: Record<string, unknown>, deadline: number) {
  const state = await gmailState();
  if (!state.account) return { skipped: "Gmail por ligar." };
  if (state.account.status !== "active") throw new GmailError("É preciso voltar a ligar a caixa Gmail.", null, true);
  const mailbox = gmailMailbox();
  const watchUntil = state.account.watch_expires_at ? Date.parse(state.account.watch_expires_at) : 0;
  if (gmailPushReady() && watchUntil - Date.now() < 2 * 24 * 3600 * 1000) await gmailWatch().catch(() => undefined);

  const now = () => Math.floor(Date.now() / 1000);
  const notes: string[] = [];
  let historyId = typeof cursor.historyId === "string" ? cursor.historyId : undefined;
  let syncedAt = typeof cursor.syncedAt === "number" ? cursor.syncedAt : null;
  const previous = strings(cursor.pending);
  // Falhas por conversa: quantas e desde quando (segundos Unix).
  const failures: Record<string, { n: number; since: number }> = {};
  if (cursor.failures && typeof cursor.failures === "object")
    for (const [k, v] of Object.entries(cursor.failures as Record<string, unknown>)) {
      const x = v as { n?: unknown; since?: unknown } | null;
      if (x && typeof x.n === "number" && typeof x.since === "number") failures[k] = { n: x.n, since: x.since };
    }
  let broken = strings(cursor.broken).slice(-50);
  const r = cursor.recover as Partial<Recover> | undefined;
  let recover: Recover | null = r && typeof r.q === "string" && typeof r.historyId === "string" ? { q: r.q, page: typeof r.page === "string" ? r.page : null, historyId: r.historyId } : null;

  if (!historyId) {
    // Sem ponto de partida (não devia acontecer: a ligação grava-o). Começa agora.
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
  // Fila quase cheia: esta passagem só lê o que está em atraso; o histórico e a releitura esperam (sem mexer no
  // ponto de partida), para a fila nunca crescer sem fim nem voltar a ler as mesmas conversas.
  const listing = previous.length < MAX_PENDING - RECOVER_PAGES * 100;
  if (!listing) notes.push("a ler conversas em atraso");
  if (listing && !recover) {
    try {
      let page: string | undefined;
      let latest = historyId;
      let lastRecord: string | null = null;
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
          if (e.id) lastRecord = e.id;
        }
        latest = h.historyId || latest;
        page = h.nextPageToken;
      } while (page && Date.now() < deadline - 15000 && previous.length + ids.length < MAX_PENDING - 1000);
      found.push(...ids.reverse());
      // Histórico lido até ao fim: o ponto de partida passa ao atual. A meio (falta de tempo ou fila a encher): a
      // passagem seguinte continua depois do último registo lido (as conversas encontradas já estão na fila).
      if (!page) {
        historyId = latest;
        syncedAt = now();
      } else {
        if (lastRecord) historyId = lastRecord;
        notes.push("histórico longo: a continuar na próxima passagem");
      }
    } catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
      // Histórico expirado (a Google pode guardá-lo só algumas horas): relê, página a página e ao longo das
      // passagens que forem precisas, as conversas alteradas desde a última leitura completa (1 hora de margem).
      // O ponto de partida novo é o de agora, mas só passa a valer quando a releitura acabar.
      const profile = await call<{ historyId: string }>("/profile");
      recover = { q: `${syncedAt ? `after:${syncedAt - 3600}` : "newer_than:7d"} -in:spam -in:trash -in:drafts -in:sent`, page: null, historyId: profile.historyId };
    }
  }
  if (listing && recover) {
    let page = recover.page;
    let pages = 0;
    do {
      const q = new URLSearchParams({ q: recover.q, maxResults: "100" });
      if (page) q.set("pageToken", page);
      const list = await call<{ threads?: { id: string }[]; nextPageToken?: string }>(`/threads?${q}`);
      for (const t of list.threads || []) found.push(t.id);
      page = list.nextPageToken || null;
      pages++;
    } while (page && pages < RECOVER_PAGES && Date.now() < deadline - 15000);
    if (page) {
      recover = { ...recover, page };
      notes.push("a reler as conversas depois de o histórico do Gmail expirar");
    } else {
      historyId = recover.historyId;
      syncedAt = now();
      recover = null;
    }
  }

  // Fila: as encontradas agora (mais recentes primeiro) e depois as que já esperavam.
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const id of [...found, ...previous]) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(id);
  }

  const threads: Thread[] = [];
  const failed = new Set<string>();
  let read = 0;
  // Com respostas automáticas por enviar, pára de ler mais cedo para haver tempo de as enviar nesta passagem.
  let replyPending = false;
  const stopAt = () => deadline - (replyPending ? AUTOREPLY_RESERVE_MS : 10000);
  while (queue.length && read < MAX_THREADS_PER_RUN && Date.now() < stopAt()) {
    const id = queue.shift()!;
    read++;
    let t: Thread | null = null;
    let error: unknown = null;
    try {
      t = await call<Thread>(`/threads/${encodeURIComponent(id)}?format=full`);
      if (!t || !Array.isArray(t.messages)) throw new GmailError("Gmail: resposta incompleta.");
    } catch (e) {
      error = e;
    }
    if (!error && t) {
      delete failures[id];
      broken = broken.filter((b) => b !== id);
      threads.push(t);
      if (state.settings.autoreply_enabled && autoReplyTarget(t, mailbox)) replyPending = true;
      continue;
    }
    if (error instanceof GmailError && error.status === 404) continue; // apagada entretanto
    // Problema geral (ligação, limite de pedidos): pára e tenta tudo mais tarde, com a espera habitual.
    if (!(error instanceof GmailError) || error.reconnect || error.status === 401 || error.status === 429) throw error;
    // Erro nesta conversa: vai para o fim da fila (nunca relida nesta passagem) e as outras continuam.
    failed.add(id);
    if (failed.size >= MAX_FAILED_PER_RUN) break;
  }
  for (const id of failed) {
    const f = failures[id] || { n: 0, since: now() };
    failures[id] = { n: f.n + 1, since: f.since };
    if (failures[id].n >= MAX_THREAD_FAILURES && now() - f.since >= THREAD_FAILURE_WINDOW_S) {
      delete failures[id];
      broken = [...broken.filter((b) => b !== id), id].slice(-50);
    } else queue.push(id);
  }
  const { totals, skipped, retry } = await store(threads, mailbox);
  const requeue = (ids: string[]) => queue.unshift(...ids.filter((id) => !queue.includes(id)));
  requeue(retry);
  if (skipped) notes.push(`${skipped} conversa(s) com conteúdo que a base de dados recusou`);
  if (broken.length) notes.push(`${broken.length} conversa(s) que o Gmail não deixou ler (abrir no Gmail)`);

  // Resposta automática só com tempo para a enviar; as conversas que ficarem por tratar voltam à fila (a resposta
  // automática só sai a mensagens com menos de 1 hora e uma vez por conversa, por isso relê-las não duplica nada).
  let autoreplies = 0;
  if (state.settings.autoreply_enabled) {
    const later: string[] = [];
    for (const t of threads) {
      const to = autoReplyTarget(t, mailbox);
      if (!to) continue;
      // O orçamento da passagem deixa folga até ao limite da função (60 s): as respostas automáticas podem sair até
      // 5 s depois dele (um aviso tratado tarde, com pouco orçamento, também responde).
      if (Date.now() > deadline + 5000) {
        later.push(t.id);
        continue;
      }
      if (await autoReply(t, to, state.settings).catch(() => false)) autoreplies++;
    }
    requeue(later);
  }
  for (const k of Object.keys(failures)) if (!queue.includes(k)) delete failures[k];
  return {
    cursor: { historyId, syncedAt, pending: queue, ...(recover ? { recover } : {}), ...(Object.keys(failures).length ? { failures } : {}), ...(broken.length ? { broken } : {}) },
    totals: { ...totals, autoreplies, skipped },
    detail: `Gmail (${mailbox})${notes.length ? ` · ${notes.join("; ")}` : ""}`,
    // Só as conversas que falharam agora não pedem outra passagem já (esperam pela sincronização seguinte).
    more: queue.some((id) => !failed.has(id)) || Boolean(recover),
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
function autoReplyTarget(t: Thread, mailbox: string): string | null {
  const msgs = visible(t);
  if (!msgs.length || msgs.some(isOwn)) return null;
  const last = msgs[msgs.length - 1];
  if (Date.now() - at(last) > 60 * 60 * 1000) return null;
  // Só ao cliente da conversa (quem escreveu primeiro) e só se a última mensagem for dele. O endereço também é
  // verificado (no formulário de contacto é o que a pessoa escreveu): nunca ao próprio domínio nem a sistemas.
  const to = customerOf(msgs, mailbox)?.email;
  const ownDomains = [mailbox.split("@")[1] || ""];
  if (!to || senderOf(last).email !== to || !recipientAllowed(to, ownDomains)) return null;
  return autoReplyAllowed(last, { mailbox, ownDomains }).ok ? to : null;
}

async function autoReply(t: Thread, to: string, s: EmailSettings) {
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
