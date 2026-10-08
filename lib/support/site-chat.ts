import "server-only";
import { emailConfigured, emailFrom, sendEmail } from "@/lib/email";
import { clientKey } from "@/lib/rate-limit";
import { SupabaseError } from "@/lib/supabase";
import { sha256Hex } from "./crypto";
import { serverRpc } from "./db";
import { allowedOrigin, decodeIdentity, ipPrefix, parseOrigins, verifyIdentity } from "./site-rules";

// Chat do site: rotas públicas (sem sessão do dashboard) usadas pelo botão do tema Shopify.
// O browser só fala com o servidor; as funções da BD são chamadas com o token do servidor.

export const SITE_SOURCE = "site-chat";
export const siteOrigins = () => parseOrigins(process.env.SITE_CHAT_ORIGINS);

export class ChatError extends Error {
  constructor(public status: number, message: string) {
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

// Erros para o visitante: só as mensagens próprias das funções do chat; nunca detalhes internos.
export function chatFailure(request: Request, e: unknown) {
  if (e instanceof ChatError) return chatJson(request, { error: e.message, ...(e.status === 401 ? { restart: true } : {}) }, e.status);
  if (e instanceof SupabaseError) {
    const status = e.code === "P0429" ? 429 : e.code === "P0401" ? 401 : e.code === "22023" ? 400 : e.code === "42501" ? 403 : 0;
    if (status) return chatJson(request, { error: e.message, ...(status === 401 ? { restart: true } : {}) }, status);
  }
  console.error("site-chat", e instanceof Error ? e.message : e);
  return chatJson(request, { error: "O chat está indisponível de momento. Tente novamente dentro de instantes." }, 503);
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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Pending = { visitor: string; conversation: string; email: string; name: string; until: string; replies: string[] };

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

async function sendReplies(p: Pending): Promise<{ ok: boolean; detail: string }> {
  if (!emailConfigured()) return { ok: false, detail: "RESEND_API_KEY por configurar" };
  const from = process.env.SITE_CHAT_FROM || process.env.REPORTS_FROM || emailFrom();
  const site = (process.env.SITE_CHAT_URL || "https://www.lojadoouro.pt").replace(/\/+$/, "");
  const first = p.name.split(/\s+/)[0] || "";
  const blocks = (p.replies || []).map((body) =>
    `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #a47a37;background:#f7f8f5;white-space:pre-wrap">${escapeHtml(body)}</blockquote>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#253531;max-width:560px">
<p>Olá${first ? ` ${escapeHtml(first)}` : ""},</p>
<p>${p.replies.length > 1 ? "Deixámos-lhe estas respostas" : "Respondemos à sua mensagem"} no chat da Loja do Ouro:</p>
${blocks}
<p><a href="${site}/?chat=abrir" style="color:#a47a37">Continuar a conversa no site</a></p>
<p style="color:#78807c;font-size:13px">Recebeu este email porque falou connosco no chat de lojadoouro.pt.</p>
</div>`;
  return sendEmail([p.email], "Resposta da Loja do Ouro à sua mensagem", html, {
    from, replyTo: process.env.SITE_CHAT_REPLY_TO || "apoiocliente@lojadoouro.pt", timeoutMs: 8000,
  });
}

// Passagem pelos avisos pendentes (no máximo uma vez por minuto, decidido na BD). Corre quando a equipa tem
// o Apoio ao Cliente aberto, para não depender de tarefas agendadas.
export async function sweepSiteNotifications() {
  const due = await serverRpc<boolean>("ldo_support_site_notify_sweep").catch(() => false);
  if (due) await notifySiteVisitors({ conversation: null, idleSeconds: 120, minAgeSeconds: 120, limit: 10 });
}
