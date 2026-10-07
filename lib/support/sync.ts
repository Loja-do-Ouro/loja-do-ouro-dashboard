import "server-only";
import { serverConfigured, serverRpc, type SourceRow } from "./db";
import { MetricoolError, syncMetricool } from "./metricool";
import { ZendeskError, syncZendesk } from "./zendesk";

const SOURCES = ["zendesk", "metricool-facebook", "metricool-instagram"] as const;

export type SyncOutcome = { source: string; ran: boolean; ok?: boolean; detail?: string; reason?: string; nextAt?: string | null; totals?: unknown; more?: boolean };
type Claim = { claimed: true; source: SourceRow } | { claimed: false; reason: string; next_attempt_at: string | null };

export const REFUSAL: Record<string, string> = {
  running: "já está a sincronizar",
  recent: "sincronizou há menos de 15 s",
  backoff: "em espera depois de erros",
  not_due: "ainda não é a hora",
};

// Uma passagem por fonte, se estiver na hora (ou se for pedida) e ninguém a estiver a fazer.
// Cada fonte é independente: uma falha numa plataforma não impede as outras. Cada passagem tem um
// limite de tempo abaixo do da função Vercel; o progresso fica gravado e a seguinte continua.
// Chamada pelo dashboard aberto, pelo botão Atualizar, pela configuração e pela tarefa diária.
export async function runSync({ force = false, override = false, only, budgetMs = 40_000 }: { force?: boolean; override?: boolean; only?: string[]; budgetMs?: number } = {}): Promise<SyncOutcome[]> {
  if (!serverConfigured()) return [{ source: "all", ran: false, detail: "Servidor sem ligação ao Supabase." }];
  const deadline = Date.now() + budgetMs;
  const ids = SOURCES.filter((s) => !only || only.includes(s));
  return Promise.all(ids.map((id) => syncOne(id, force, override, deadline)));
}

async function syncOne(id: string, force: boolean, override: boolean, deadline: number): Promise<SyncOutcome> {
  let claim: Claim;
  try {
    claim = await serverRpc<Claim>("ldo_support_sync_claim", { p_source: id, p_force: force, p_override: override });
  } catch (e) {
    return { source: id, ran: false, detail: e instanceof Error ? e.message : "Indisponível" };
  }
  if (!claim.claimed) return { source: id, ran: false, reason: claim.reason, nextAt: claim.next_attempt_at };
  const source = claim.source;
  const progress = (cursor: unknown) => serverRpc("ldo_support_sync_progress", { p_source: id, p_cursor: cursor }).catch(() => undefined);
  try {
    const r = source.platform === "zendesk" ? await syncZendesk(source.cursor, deadline, progress) : await syncMetricool(source, deadline);
    if ("skipped" in r) {
      await finish(id, "skipped", "pending", r.skipped ?? null, null, null, 0);
      return { source: id, ran: true, ok: true, detail: r.skipped };
    }
    const detail = "detail" in r ? (r.detail as string | null) : null;
    const more = "more" in r && Boolean(r.more);
    await finish(id, more ? "more" : "ok", "active", detail, null, r.cursor, 0);
    return { source: id, ran: true, ok: true, totals: r.totals, more, detail: detail || undefined };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    const blocked = (e instanceof MetricoolError && e.blocked) || (e instanceof ZendeskError && (e.status === 403 || e.reconnect));
    const retry = e instanceof MetricoolError || e instanceof ZendeskError ? e.retryAfter : 0;
    await finish(id, "error", blocked ? "blocked" : "error", null, message, null, retry).catch(() => undefined);
    return { source: id, ran: true, ok: false, detail: message };
  }
}

function finish(id: string, outcome: "ok" | "more" | "skipped" | "error", status: string, detail: string | null, error: string | null, cursor: unknown, retryAfter: number) {
  return serverRpc("ldo_support_sync_finish", {
    p_source: id, p_outcome: outcome, p_status: status, p_detail: detail, p_error: error, p_cursor: cursor ?? null, p_retry_after: retryAfter,
  });
}
