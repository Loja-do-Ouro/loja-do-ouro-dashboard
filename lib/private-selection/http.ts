import "server-only";
import { psOrigins } from "@/lib/private-selection-rules";
import { SupabaseError } from "@/lib/supabase";
import { ChatError } from "@/lib/support/site-chat";
import { allowedOrigin } from "@/lib/support/site-rules";

// Private Selection: rotas públicas (sem sessão do dashboard) chamadas pela página reservada do tema Shopify.
// Como no chat do site: o browser só fala com o servidor, as funções da BD levam o token do servidor e o IP só
// chega à BD em hash (ipHash/ipPrefixHash e readJson são os do chat).
export { ipHash, ipPrefixHash, readJson } from "@/lib/support/site-chat";

// Respostas com "ok" e, quando falham, um código estável que o tema traduz (nunca texto para o cliente).
export type PsCode =
  | "received" | "invalid_name" | "invalid_email" | "invalid_phone" | "invalid_request"
  | "invalid" | "locked" | "expired" | "origin" | "rate_limited" | "unavailable";

export class PsError extends Error {
  constructor(public status: number, public code: PsCode) {
    super(code);
  }
}

// CORS: só as lojas (PRIVATE_SELECTION_ORIGINS ou PS_DEFAULT_ORIGINS) e o próprio dashboard. Sem cookies entre sites:
// a sessão da loja segue no cabeçalho Authorization.
export function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request.headers.get("origin"), psOrigins(), new URL(request.url).origin);
  return {
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...(origin
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Max-Age": "600",
        }
      : {}),
  };
}

export function preflight(request: Request) {
  const headers = corsHeaders(request);
  return new Response(null, { status: headers["Access-Control-Allow-Origin"] ? 204 : 403, headers });
}

// Pedidos de browser vindos de outro site são recusados; sem Origin (fora de um browser) seguem, e os limites na
// BD travam o resto.
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(origin, psOrigins(), new URL(request.url).origin)) throw new PsError(403, "origin");
}

export function psJson(request: Request, data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

// Mensagens das funções ldo_ps_* (22023) que têm código próprio; as outras são "invalid_request".
const DB_CODES = new Map<string, PsCode>([
  ["Indique o seu nome.", "invalid_name"],
  ["Indique um email válido.", "invalid_email"],
  ["Indique o telemóvel com o indicativo do país.", "invalid_phone"],
]);

// Limite geral dos pedidos de acesso (300 por hora, ldo_ps_request): fecha o formulário a todos durante até uma
// hora, por isso fica no registo do servidor.
const GLOBAL_LIMIT = "Limite geral de pedidos de acesso atingido.";

// Erros para a loja: só o código, nunca detalhes internos. O token do servidor recusado (42501) ou a BD em baixo
// contam como indisponível.
export function psFailure(request: Request, e: unknown) {
  if (e instanceof PsError) return psJson(request, { ok: false, code: e.code }, e.status);
  // readJson do chat: corpo demasiado grande ou que não é JSON.
  if (e instanceof ChatError) return psJson(request, { ok: false, code: "invalid_request" }, e.status === 413 ? 413 : 400);
  if (e instanceof SupabaseError) {
    if (e.code === "P0429") {
      if (e.message.trim() === GLOBAL_LIMIT) console.error("private-selection", GLOBAL_LIMIT);
      return psJson(request, { ok: false, code: "rate_limited" }, 429);
    }
    if (e.code === "22023") return psJson(request, { ok: false, code: DB_CODES.get(e.message.trim()) || "invalid_request" }, 400);
  }
  console.error("private-selection", e instanceof Error ? e.message : e);
  return psJson(request, { ok: false, code: "unavailable" }, 503);
}

export async function psHandle(request: Request, fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return psFailure(request, e);
  }
}

// Sessão da loja: o token que a BD deu na entrada (64 caracteres hexadecimais), no cabeçalho Authorization. A BD só
// guarda o hash. Sem token ou com outro formato → null.
export function bearerToken(request: Request) {
  return /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1] || null;
}
