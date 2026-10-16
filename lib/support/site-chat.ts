import "server-only";
import { dashboardUrl as baseUrl, emailConfigured, sendEmail } from "@/lib/email";
import { clientKey } from "@/lib/rate-limit";
import { SupabaseError } from "@/lib/supabase";
import { sha256Hex } from "./crypto";
import { serverRpc } from "./db";
import { supportEmailFrom, supportReplyTo } from "./notify";
import { replyEmail, transcriptEmail, visitorLang, type TranscriptMessage } from "./site-i18n";
import { allowedOrigin, CHAT_UNAVAILABLE, decodeIdentity, errorCode, ipPrefix, parseOrigins, verifyIdentity } from "./site-rules";

// Chat do site: rotas públicas (sem sessão do dashboard) usadas pelo botão do tema Shopify.
// O browser só fala com o servidor; as funções da BD são chamadas com o token do servidor.

export const SITE_SOURCE = "site-chat";
export const siteOrigins = () => parseOrigins(process.env.SITE_CHAT_ORIGINS);

// Erro para o visitante: texto em português e código estável (code) que o widget traduz.
export class ChatError extends Error {
  constructor(public status: number, message: string, public code = errorCode(message)) {
    super(message);
  }
}

// CORS: só as lojas autorizadas (e o próprio dashboard, para a página de teste). Sem cookies entre sites.
export function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request.headers.get("origin"), siteOrigins(), new URL(request.url).origin);
  return {
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...(origin
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LDO-Identity",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Max-Age": "600",
        }
      : {}),
  };
}

export function preflight(request: Request) {
  const headers = corsHeaders(request);
  return new Response(null, { status: headers["Access-Control-Allow-Origin"] ? 204 : 403, headers });
}

// Pedidos de browser vindos de outro site são recusados (a lista de origens é o que o browser respeita;
// os limites na BD travam o resto).
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(origin, siteOrigins(), new URL(request.url).origin)) throw new ChatError(403, "Origem não autorizada.");
}

export function chatJson(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

// Erros para o visitante: só as mensagens próprias das funções do chat; nunca detalhes internos. "error" fica em
// português (widgets antigos); "code" é o que o widget traduz.
export function chatFailure(request: Request, e: unknown) {
  if (e instanceof ChatError) return chatJson(request, { error: e.message, code: e.code, ...(e.status === 401 ? { restart: true } : {}) }, e.status);
  if (e instanceof SupabaseError) {
    const status = e.code === "P0429" ? 429 : e.code === "P0401" ? 401 : e.code === "22023" ? 400 : e.code === "42501" ? 403 : 0;
    if (status) return chatJson(request, { error: e.message, code: errorCode(e.message), ...(status === 401 ? { restart: true } : {}) }, status);
  }
  console.error("site-chat", e instanceof Error ? e.message : e);
  return chatJson(request, { error: CHAT_UNAVAILABLE, code: errorCode(CHAT_UNAVAILABLE) }, 503);
}

export async function chatHandle(request: Request, fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return chatFailure(request, e);
  }
}

// Sessão do visitante: token aleatório no cabeçalho Authorization; na BD só existe o hash.
export function visitorTokenHash(request: Request) {
  const m = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(request.headers.get("authorization") || "");
  if (!m) throw new ChatError(401, "Sessão do chat inválida. Inicie uma nova conversa.");
  return sha256Hex(m[1]);
}

// Email do cliente com sessão iniciada na loja, confirmado pela assinatura do tema (ou null). Uma conversa
// confirmada só continua com o mesmo email confirmado (a BD recusa as outras).
export function identityEmail(request: Request, fromBody?: unknown) {
  const identity = fromBody ?? decodeIdentity(request.headers.get("x-ldo-identity"));
  return verifyIdentity(identity, process.env.SITE_CHAT_SECRET);
}

// IP só para os limites de abuso, guardado como hash com um segredo do servidor (o endereço e a rede).
const salt = () => process.env.SUPPORT_ENCRYPTION_KEY || process.env.BI_INGEST_TOKEN || "";
export function ipHash(request: Request) {
  return sha256Hex(`${clientKey(request)}|${salt()}`);
}
export function ipPrefixHash(request: Request) {
  return sha256Hex(`${ipPrefix(clientKey(request))}|${salt()}`);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 32_000) throw new ChatError(413, "Pedido demasiado grande.");
  const text = await request.text();
  if (text.length > 32_000) throw new ChatError(413, "Pedido demasiado grande.");
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // Corpo inválido: tratado abaixo.
  }
  throw new ChatError(400, "Pedido inválido.");
}


type Pending = {
  visitor: string; conversation: string; email: string; name: string; until: string; replies: string[];
  items?: { body: string; author: string | null }[];
  locale?: string | null; site?: string | null; country?: string | null; // língua, loja e país do visitante
};

// Respostas que o cliente ainda não viu, por email: só quando está fora do site há algum tempo e reunindo
// todas as respostas desde o último aviso. Uma falha volta a ser tentada mais tarde (30 minutos).
// Devolve o detalhe para mostrar na mensagem (só com uma conversa indicada).
export async function notifySiteVisitors(opts: { conversation: string | null; idleSeconds: number; minAgeSeconds: number; limit: number }) {
  const pending = await serverRpc<Pending[]>("ldo_support_site_notify_claim", {
    p_conversation: opts.conversation, p_idle_seconds: opts.idleSeconds, p_min_age_seconds: opts.minAgeSeconds, p_limit: opts.limit,
  }).catch(() => [] as Pending[]);
  let detail: string | null = null;
  for (const p of pending || []) {
    const r = await sendReplies(p);
    await serverRpc("ldo_support_site_notify_done", { p_visitor: p.visitor, p_until: p.until, p_ok: r.ok }).catch(() => undefined);
    detail = r.ok
      ? `Cliente fora do site: resposta enviada também por email para ${p.email}.`
      : `Cliente fora do site; aviso por email não enviado (${r.detail}). Nova tentativa automática.`;
  }
  return detail;
}

// Endereço da loja nas ligações dos emails: SITE_CHAT_URL substitui o da Loja do Ouro (nunca o da Gold Store Premium).
const chatOrigin = () => process.env.SITE_CHAT_URL || null;

// Na língua e com a marca do site do visitante (quem respondeu aparece só com o primeiro nome, como no chat).
async function sendReplies(p: Pending): Promise<{ ok: boolean; detail: string }> {
  if (!emailConfigured()) return { ok: false, detail: "RESEND_API_KEY por configurar" };
  const items = p.items?.length ? p.items : (p.replies || []).map((body) => ({ body, author: null as string | null }));
  const mail = replyEmail({ site: p.site, locale: p.locale, country: p.country, name: p.name, items }, baseUrl(), chatOrigin());
  return sendEmail([p.email], mail.subject, mail.html, {
    from: supportEmailFrom(visitorLang(p.site, p.locale).site), replyTo: supportReplyTo(), text: mail.text, timeoutMs: 8000,
  });
}

export type Transcript = {
  email: string | null; name: string; transcript: boolean;
  messages: TranscriptMessage[];
  locale?: string | null; site?: string | null; country?: string | null;
};

// Cópia da conversa para o cliente que a terminou e a pediu (só para o email que ele próprio indicou), na língua
// e com a marca do site dele.
export async function sendTranscript(t: Transcript): Promise<{ ok: boolean; detail: string }> {
  if (!t.email || !emailConfigured()) return { ok: false, detail: "Email indisponível." };
  const mail = transcriptEmail({ site: t.site, locale: t.locale, country: t.country, name: t.name, messages: t.messages }, baseUrl(), chatOrigin());
  return sendEmail([t.email], mail.subject, mail.html, {
    from: supportEmailFrom(visitorLang(t.site, t.locale).site), replyTo: supportReplyTo(), text: mail.text, timeoutMs: 8000,
  });
}

// Passagem pelos avisos pendentes (no máximo uma vez por minuto, decidido na BD). Corre quando a equipa tem
// o Apoio ao Cliente aberto, para não depender de tarefas agendadas.
export async function sweepSiteNotifications() {
  const due = await serverRpc<boolean>("ldo_support_site_notify_sweep").catch(() => false);
  if (due) await notifySiteVisitors({ conversation: null, idleSeconds: 120, minAgeSeconds: 120, limit: 10 });
}
