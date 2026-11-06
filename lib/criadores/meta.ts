import "server-only";
import { createHmac } from "node:crypto";
import {
  biographyFields, connectionTestFields, discoveryFields, graphErrorText, graphFailure, graphUrl, instagramHandle, parseBiography,
  parseBiographyTest, parseConnectionTest, parseDiscovery, usageFromHeaders, LOJA_IG_USERNAME, PUBLIC_BATCH, PUBLIC_GAP_MS,
  PUBLIC_MAX_PER_RUN, PUBLIC_USAGE_PAUSE, type GraphErrorClass, type GraphFailure, type ProofReason, type PublicReading,
} from "@/lib/criadores-meta-rules";
import { redact } from "@/lib/criadores-rules";
import {
  creatorsServerConfigured, crPublicClaim, crPublicConfirm, crPublicFail, crPublicHealth, crPublicProof, crPublicProofRefund,
  crPublicPut, type CrPublicClaimRow, type CrPublicHealthKind,
} from "./db";
import { sendMetaAlert } from "./emails";
import { ipHash } from "./site";

// Dados públicos do Instagram (fase 3A): pedidos à Business Discovery da Meta, sempre a partir da conta Instagram da
// Loja do Ouro (META_IG_ACCOUNT_ID) com o token do System User (META_SYSTEM_USER_TOKEN). As regras (campos, URL,
// leitura das respostas, erros) estão em lib/criadores-meta-rules.ts; aqui só o fetch, a BD e os avisos.
// - O token só vai no cabeçalho Authorization. Nunca vão para registos o token, o URL (leva o @ do criador), o corpo
//   da resposta (leva números e, na prova, a biografia) nem o @. Dos erros guardam-se só a classe e o código da Meta.
// - Os pedidos nunca lançam: uma falha de rede ou um timeout é um erro temporário.

export function metaPublicConfigured() {
  return Boolean(process.env.META_SYSTEM_USER_TOKEN && /^[0-9]{5,30}$/.test(process.env.META_IG_ACCOUNT_ID || ""));
}

type GraphResponse = { status: number | null; json: unknown; usage: number | null; regainMinutes: number | null };

async function graphGet(fields: string, timeoutMs: number): Promise<GraphResponse> {
  const token = process.env.META_SYSTEM_USER_TOKEN || "";
  const secret = process.env.META_APP_SECRET;
  try {
    // Só se a app tiver «Require App Secret» ligado (README); sem META_APP_SECRET não vai.
    const proof = secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
    const r = await fetch(graphUrl(process.env.META_IG_ACCOUNT_ID || "", fields, proof), {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const usage = usageFromHeaders(r.headers.get("x-app-usage"), r.headers.get("x-business-use-case-usage"));
    const json = await r.json().catch(() => null);
    return { status: r.status, json, usage: usage.pct, regainMinutes: usage.regainMinutes };
  } catch {
    return { status: null, json: null, usage: null, regainMinutes: null };
  }
}

const success = (g: GraphResponse) => g.status !== null && g.status >= 200 && g.status < 300;

// Números públicos de uma conta (um pedido: perfil e as 25 publicações mais recentes).
async function readNumbers(handle: string) {
  const g = await graphGet(discoveryFields(handle), 10_000);
  return { r: success(g) ? parseDiscovery(g.json, handle) : graphFailure(g.status, g.json), usage: g.usage, regainMinutes: g.regainMinutes };
}

// Prova da posse: lê a biografia (num pedido à parte) e devolve só se o código lá está.
async function proofLookup(handle: string, code: string) {
  const g = await graphGet(biographyFields(handle), 8_000);
  return { r: success(g) ? parseBiography(g.json, handle, code) : graphFailure(g.status, g.json), usage: g.usage, regainMinutes: g.regainMinutes };
}

// Estado da ligação na BD e, num erro de token ou de configuração, o aviso aos Super Admin (no máximo um por 24 h).
async function health(kind: CrPublicHealthKind, code: number | null, minutes: number | null, usage: number | null) {
  try {
    const h = await crPublicHealth(kind, code, minutes, usage);
    if (h?.alert && (kind === "token" || kind === "config")) await sendMetaAlert(kind);
  } catch (e) {
    console.error("criadores meta saude", redact(e));
  }
}

// Resposta certa de um pedido de teste (os seguidores só no da leitura).
function probeResult(what: "numbers" | "biography", json: unknown, id: string): { ok: true; followers: number | null } | GraphFailure {
  if (what === "biography") {
    const b = parseBiographyTest(json, id);
    return b.ok ? { ok: true, followers: null } : b;
  }
  const t = parseConnectionTest(json, id);
  return t.ok ? { ok: true, followers: t.reading.followers } : t;
}

// Pedido de teste sobre a própria @lojadoouro, que tem de devolver o id de META_IG_ACCOUNT_ID: «numbers», os campos
// da leitura; «biography», o pedido da prova da posse (à parte; da biografia da Loja do Ouro não se guarda nada). Uma
// conta não encontrada aqui é um problema de configuração (o id ou o tipo da conta da Loja do Ouro).
async function probeConnection(what: "numbers" | "biography" = "numbers"): Promise<{ ok: true; followers: number | null } | { ok: false; kind: GraphErrorClass; detail: string }> {
  const id = process.env.META_IG_ACCOUNT_ID || "";
  const g = await graphGet(what === "numbers" ? connectionTestFields() : biographyFields(LOJA_IG_USERNAME), 10_000);
  const r = success(g) ? probeResult(what, g.json, id) : graphFailure(g.status, g.json);
  if (r.ok) {
    await health("ok", null, null, g.usage);
    return { ok: true, followers: r.followers };
  }
  const kind: GraphErrorClass = r.error === "not_found" ? "config" : r.error;
  if (kind !== "temporary") await health(kind as CrPublicHealthKind, r.code, kind === "limit" ? g.regainMinutes ?? 60 : 60, g.usage);
  return { ok: false, kind, detail: graphErrorText(kind, r.code) };
}

// «Testar a ligação à Meta» (Influenciadores): funciona também com a leitura desligada. Testa os dois pedidos: o da
// leitura e o da biografia (se a Meta recusar só este, todas as confirmações falham com o resto verde).
export async function testMetaPublic(): Promise<{ ok: true; followers: number | null } | { ok: false; detail: string }> {
  if (!metaPublicConfigured()) return { ok: false, detail: "Faltam o token do System User e o id da conta Instagram da Loja do Ouro na Vercel." };
  const t = await probeConnection("numbers");
  if (!t.ok) return { ok: false, detail: t.detail };
  const b = await probeConnection("biography");
  return b.ok ? t : { ok: false, detail: `Pedido da biografia (confirmar a conta): ${b.detail}` };
}

// ---------------------------------------------------------------- site: confirmar a conta

export type PublicProofOutcome = { ok: true } | { ok: false; reason: ProofReason; handle?: string; left?: number };

// Devolve a tentativa reservada (a falha não foi da pessoa). Uma falha aqui só se regista: a tentativa fica gasta.
async function refundProof(session: string, attempt: number) {
  try {
    await crPublicProofRefund(session, attempt);
  } catch (e) {
    console.error("criadores meta tentativa", redact(e));
  }
}

// «Confirmar a conta» (server action de Redes): reserva a tentativa na BD (5 em 24 h), lê a biografia pela Meta,
// procura o código em memória e, se o encontrou, confirma. A biografia não sai de parseBiography. Contam o código em
// falta e a conta que não é profissional; uma falha do lado da Meta ou da Loja do Ouro (limite, token, configuração,
// erro temporário, sem resposta) devolve a tentativa.
export async function checkPublicProof(session: string, accountId: string): Promise<PublicProofOutcome> {
  if (!metaPublicConfigured()) return { ok: false, reason: "off" };
  const p = await crPublicProof(session, accountId, await ipHash());
  if (!p.ok) return { ok: false, reason: p.reason };
  const handle = instagramHandle(p.handle);
  if (!handle) {
    // A BD só autoriza um @ válido e mudá-lo para a leitura: não devia acontecer, e não houve pedido à Meta.
    await refundProof(session, p.attempt);
    return { ok: false, reason: "changed", handle: p.handle };
  }
  const { r, usage, regainMinutes } = await proofLookup(handle, p.code);
  if (!r.ok) {
    let reason: ProofReason = "error";
    if (r.error === "not_found") reason = "not_found";
    else if (r.error === "token" || r.error === "limit") {
      await health(r.error, r.code, r.error === "limit" ? regainMinutes ?? 60 : 60, usage);
      if (r.error === "limit") reason = "busy";
    } else if (r.error === "config") {
      // Como no tick, um teste à @lojadoouro (com o mesmo pedido da biografia) decide: se passa, o problema é desta
      // conta (como not_found); se falha, é da configuração (o teste já gravou o estado e avisou os Super Admin).
      if ((await probeConnection("biography")).ok) reason = "not_found";
    }
    if (reason !== "not_found") await refundProof(session, p.attempt);
    return { ok: false, reason, handle: p.handle, left: p.left };
  }
  if (!r.found) return { ok: false, reason: "missing", handle: p.handle, left: p.left };
  const c = await crPublicConfirm(session, accountId, p.handle, p.code, r.igUserId);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason, handle: p.handle };
}

// ---------------------------------------------------------------- tick: leitura

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function putReading(item: CrPublicClaimRow, reading: PublicReading): Promise<boolean> {
  try {
    return (await crPublicPut(item.account_id, item.lease, reading)).ok === true;
  } catch (e) {
    // Uma leitura que a BD recusa não pode voltar a cada 5 minutos: conta como falha temporária (1 a 6 h).
    console.error("criadores meta gravar", redact(e));
    await crPublicFail(item.account_id, item.lease, "temporary").catch(() => undefined);
    return false;
  }
}

// Tarefa do tick: até PUBLIC_MAX_PER_RUN contas por execução, em lotes de PUBLIC_BATCH, com PUBLIC_GAP_MS entre
// pedidos e um pedido por conta. Para com o uso da app em PUBLIC_USAGE_PAUSE % ou mais, num erro de limite, de token
// ou de configuração, ou à 3.ª falha temporária seguida (a pausa global fica em ldo_private.cr_public_state). As
// contas reservadas e não lidas voltam à fila em 3 minutos. Devolve quantas leu.
export async function readPublicAccounts({ budgetMs = 25_000 } = {}): Promise<number> {
  if (!creatorsServerConfigured() || !metaPublicConfigured()) return 0;
  const until = Date.now() + budgetMs;
  let requests = 0;
  let read = 0;
  let usage: number | null = null;
  let stopped = false;
  let temporary = 0;
  let probed: boolean | null = null;
  try {
    run: while (Date.now() < until && requests < PUBLIC_MAX_PER_RUN) {
      const items = (await crPublicClaim(Math.min(PUBLIC_BATCH, PUBLIC_MAX_PER_RUN - requests))) || [];
      for (const item of items) {
        if (Date.now() >= until || requests >= PUBLIC_MAX_PER_RUN) break run;
        const handle = instagramHandle(item.handle);
        if (!handle) {
          // A BD só aceita autorizar um @ válido e mudá-lo para a leitura: não devia acontecer.
          await crPublicFail(item.account_id, item.lease, "not_found");
          continue;
        }
        if (requests) await pause(PUBLIC_GAP_MS);
        requests++;
        const { r, usage: u, regainMinutes } = await readNumbers(handle);
        if (u !== null) usage = u;
        if (r.ok) {
          temporary = 0;
          if (await putReading(item, r.reading)) read++;
          if (usage !== null && usage >= PUBLIC_USAGE_PAUSE) {
            await health("limit", null, regainMinutes ?? 30, usage);
            stopped = true;
            break run;
          }
          continue;
        }
        if (r.error === "not_found") {
          temporary = 0;
          await crPublicFail(item.account_id, item.lease, "not_found");
        } else if (r.error === "limit" || r.error === "token") {
          // Não é da conta: pausa global, sem crPublicFail.
          await health(r.error, r.code, r.error === "limit" ? regainMinutes ?? 60 : 60, usage);
          stopped = true;
          break run;
        } else if (r.error === "config") {
          // Um teste à @lojadoouro decide: se passa, o problema é desta conta (como not_found); se falha, é da
          // configuração (o teste já gravou o estado e avisou).
          if (probed === null) probed = (await probeConnection()).ok;
          if (!probed) {
            stopped = true;
            break run;
          }
          await crPublicFail(item.account_id, item.lease, "not_found");
        } else {
          await crPublicFail(item.account_id, item.lease, "temporary");
          if (++temporary >= 3) {
            await health("temporary", r.code, 15, usage);
            stopped = true;
            break run;
          }
        }
      }
      if (items.length < PUBLIC_BATCH) break;
    }
    if (read > 0 && !stopped) await health("ok", null, null, usage);
  } catch (e) {
    console.error("criadores meta", redact(e));
  }
  return read;
}
