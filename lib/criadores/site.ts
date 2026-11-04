import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardUrl } from "@/lib/email";
import { ipHashWith } from "@/lib/criadores-crypto-core";
import { redact } from "@/lib/criadores-rules";
import {
  creatorCookieName, creatorCookieOptions, creatorsReady as creatorsReadyWith, creatorsSiteBaseFor, creatorsSiteUrl,
  isCreatorSessionToken, sameOriginPost as sameOriginPostWith,
} from "@/lib/criadores-site-rules";
import { crMe, type CrMe } from "./db";

// Site dos criadores (§4.3): sessão do criador no cookie, endereços, "pronto para abrir", hash dos IP, verificação de
// origem dos POST do browser e palavras-passe expostas. As regras puras estão em lib/criadores-site-rules.ts; aqui só
// se junta o ambiente (process.env, cookies, headers).

const production = () => process.env.NODE_ENV === "production";

// ---------------------------------------------------------------- sessão do criador [rev. S-B1]

// Nome do cookie: "__Host-ldo_criador" em produção (o servidor nunca lê o nome sem prefixo), "ldo_criador" em
// desenvolvimento sem HTTPS.
export const creatorCookie = () => creatorCookieName(production());

// Token da sessão (64 hex) ou "".
export async function creatorSession(): Promise<string> {
  const v = (await cookies()).get(creatorCookie())?.value;
  return isCreatorSessionToken(v) ? v : "";
}

// Grava o cookie (httpOnly, secure em produção, sameSite lax, path=/, nunca Domain) até ao fim da sessão da BD.
// Só em Server Actions e Route Handlers. Usar depois de ldo_cr_login e de ldo_cr_password_change (sessão nova).
export async function setCreatorSession(token: string, expiresAt: string) {
  if (!isCreatorSessionToken(token)) throw new Error("Sessão inválida.");
  const ms = Date.parse(expiresAt) - Date.now();
  const maxAge = Number.isFinite(ms) && ms > 0 ? Math.max(60, Math.floor(ms / 1000)) : undefined;
  (await cookies()).set(creatorCookie(), token, creatorCookieOptions(production(), maxAge));
}

// Apaga o cookie com os mesmos atributos (um cookie __Host- só se apaga com secure e path=/).
export async function clearCreatorSession() {
  (await cookies()).set(creatorCookie(), "", { ...creatorCookieOptions(production(), 0), maxAge: 0 });
}

export type CreatorContext = { session: string; me: CrMe };

// Criador da sessão, uma vez por pedido (null sem sessão válida). Uma falha da BD lança (página de erro), como
// loadViewer: nunca tira a pessoa da conta por uma falha passageira.
export const loadCreator = cache(async (): Promise<CreatorContext | null> => {
  const session = await creatorSession();
  if (!session) return null;
  const me = await crMe(session);
  return me ? { session, me } : null;
});

// Páginas com sessão: sem ela, vai para Entrar (com next, se indicado); com Termos por voltar a aceitar, vai para
// /conta/novos-termos (salvo nessa própria página: allowReaccept).
export async function requireCreator(opts: { next?: string; allowReaccept?: boolean } = {}): Promise<CreatorContext> {
  const base = await siteBase();
  const c = await loadCreator();
  if (!c) {
    const next = opts.next && opts.next.startsWith("/") && !opts.next.startsWith("//") ? `?next=${encodeURIComponent(opts.next)}` : "";
    redirect(`${base}/conta/entrar${next}`);
  }
  if (!opts.allowReaccept && c.me.reaccept.length) redirect(`${base}/conta/novos-termos`);
  return c;
}

// ---------------------------------------------------------------- endereços e estado [rev. S-M4]

// "" no domínio criadores.*, "/c" no endereço do dashboard (testes internos antes do DNS). Torna a página dinâmica.
export async function siteBase() {
  return creatorsSiteBaseFor((await headers()).get("host"));
}

// Endereço absoluto do site (ligações dos emails): CREATORS_URL, ou `${dashboardUrl()}/c` antes do DNS.
export function siteUrl() {
  return creatorsSiteUrl(process.env.CREATORS_URL, dashboardUrl());
}

// Inscrições abertas e emails a sair só com o site no domínio próprio e as chaves configuradas (em produção exige
// CREATORS_URL https, CREATORS_SERVER_TOKEN e CREATORS_ENCRYPTION_KEY). Dos segredos só se vê se existem.
export function creatorsReady() {
  return creatorsReadyWith({
    production: production(),
    creatorsUrl: process.env.CREATORS_URL,
    hasServerToken: Boolean(process.env.CREATORS_SERVER_TOKEN),
    hasEncryptionKey: Boolean(process.env.CREATORS_ENCRYPTION_KEY),
  });
}

// ---------------------------------------------------------------- ligação do cliente

// IP do pedido (o primeiro de x-forwarded-for, que a Vercel define). Nunca vai para a BD em claro.
async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

// HMAC-SHA256 de "cr:<ip>" com uma chave própria, derivada do CREATORS_SERVER_TOKEN por HKDF (info "ldo-cr-ip-v1")
// [rev. S-M3]; nunca o BI_INGEST_TOKEN. null sem o token (a BD aceita null; as funções recusam de qualquer forma).
export async function ipHash(): Promise<string | null> {
  const token = process.env.CREATORS_SERVER_TOKEN;
  if (!token) return null;
  try {
    return ipHashWith(token, await clientIp());
  } catch (e) {
    console.error("criadores ipHash", redact(e));
    return null;
  }
}

// ---------------------------------------------------------------- POST do browser às rotas /api/c/* [rev. S-B1]

// 403 (Response a devolver) se o Origin não for a origem de CREATORS_URL (antes do DNS, a do próprio pedido), ou se o
// browser disser que o pedido veio de outro sítio (Sec-Fetch-Site diferente de same-origin). null = pode seguir.
// Usar em POST /api/c/export, meta/connect e no pedido de token do upload; nunca no tick, nos callbacks da Meta nem
// no callback do Blob (chamadas de servidor com assinatura própria). As Server Actions já são verificadas pelo Next.
export function sameOriginPost(request: Request): Response | null {
  const denied = sameOriginPostWith(request, process.env.CREATORS_URL);
  if (denied) return denied;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    return new Response("Pedido recusado.", { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  return null;
}

// ---------------------------------------------------------------- palavras-passe expostas [rev. S-M2]

export const PWNED_MESSAGE = "Esta palavra-passe aparece em fugas de dados conhecidas. Escolha outra, que não use noutros sítios.";

// true se a palavra-passe aparece no Have I Been Pwned (pesquisa por intervalo: só saem os 5 primeiros caracteres do
// SHA-1, com resposta preenchida). 2 s no máximo; qualquer falha deixa passar (a BD continua a exigir as regras).
export async function pwnedPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const sha = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  try {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, {
      cache: "no-store", signal: AbortSignal.timeout(2000), headers: { "Add-Padding": "true", "User-Agent": "loja-do-ouro-criadores" },
    });
    if (!r.ok) return false;
    const suffix = sha.slice(5);
    for (const line of (await r.text()).split("\n")) {
      const [s, count] = line.trim().split(":");
      if (s === suffix) return Number(count) > 0;
    }
    return false;
  } catch {
    return false;
  }
}
