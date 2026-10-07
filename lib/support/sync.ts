import "server-only";
import { serverConfigured, serverRpc, type SourceRow } from "./db";
import { MetricoolError, syncMetricool } from "./metricool";
import { ZendeskError, syncZendesk } from "./zendesk";

const SOURCES = ["zendesk", "metricool-facebook", "metricool-instagram"] as const;

type Outcome = { source: string; ran: boolean; ok?: boolean; detail?: string; totals?: unknown; more?: boolean };

// Uma passagem por fonte, se estiver na hora (ou se for pedida) e ninguém a estiver a fazer.
// Cada fonte é independente: uma falha numa plataforma não impede as outras.
// Chamada pelo dashboard aberto (com a frequência definida na configuração), pelo botão
// Atualizar e pela tarefa diária da Vercel. Nunca fica a correr em segundo plano.
export async function runSync({ force = false, only }: { force?: boolean; only?: string[] } = {}): Promise<Outcome[]> {
  if (!serverConfigured()) return [{ source: "all", ran: false, detail: "Servidor sem ligação ao Supabase." }];
  const ids = SOURCES.filter((s) => !only || only.includes(s));
  return Promise.all(ids.map((id) => syncOne(id, force)));
}

async function syncOne(id: string, force: boolean): Promise<Outcome> {
  let source: SourceRow | null;
  try {
    source = await serverRpc<SourceRow | null>("ldo_support_sync_claim", { p_source: id, p_force: force });
  } catch (e) {
    return { source: id, ran: false, detail: e instanceof Error ? e.message : "Indisponível" };
  }
  if (!source) return { source: id, ran: false };
  try {
    const r = source.platform === "zendesk" ? await syncZendesk(source.cursor) : await syncMetricool(source);
    if ("skipped" in r) {
      await finish(id, true, "pending", r.skipped ?? null, null, null, 0);
      return { source: id, ran: true, ok: true, detail: r.skipped };
    }
    const detail = "detail" in r ? (r.detail as string | null) : null;
    await finish(id, true, "active", detail, null, r.cursor, 0);
    return { source: id, ran: true, ok: true, totals: r.totals, more: "more" in r ? Boolean(r.more) : false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    const blocked = (e instanceof MetricoolError && e.blocked) || (e instanceof ZendeskError && (e.status === 403 || e.reconnect));
    const retry = e instanceof MetricoolError || e instanceof ZendeskError ? e.retryAfter : 0;
    await finish(id, false, blocked ? "blocked" : "error", null, message, null, retry).catch(() => undefined);
    return { source: id, ran: true, ok: false, detail: message };
  }
}

function finish(id: string, ok: boolean, status: string, detail: string | null, error: string | null, cursor: unknown, retryAfter: number) {
  return serverRpc("ldo_support_sync_finish", {
    p_source: id, p_ok: ok, p_status: status, p_detail: detail, p_error: error, p_cursor: cursor ?? null, p_retry_after: retryAfter,
  });
}
