import "server-only";
import { rpc } from "@/lib/supabase";
import { supabaseConfig } from "@/lib/session";

// Ações das pessoas: funções ldo_support_* com o token de sessão (permissões verificadas na BD).
export function sessionRpc<T>(session: string, fn: string, args: Record<string, unknown> = {}) {
  return rpc<T>(fn, { p_session: session, ...args });
}

// Dados sincronizados, estados de envio e tokens: só o servidor, identificado pelo mesmo token de
// servidor da recolha noturna (BI_INGEST_TOKEN, hash em ldo_private.bi_token). Nunca chega ao browser.
export function serverConfigured() {
  const c = supabaseConfig();
  return Boolean(c.url && c.key && process.env.BI_INGEST_TOKEN);
}

export function serverRpc<T>(fn: string, args: Record<string, unknown> = {}) {
  const token = process.env.BI_INGEST_TOKEN;
  if (!token) throw new Error("Ligação do servidor ao Supabase por configurar (BI_INGEST_TOKEN).");
  return rpc<T>(fn, { p_token: token, ...args });
}

export type SourceRow = {
  id: string;
  platform: "zendesk" | "metricool" | "whatsapp" | "site" | "gmail";
  channel: "zendesk" | "facebook" | "instagram" | "whatsapp" | "site" | "email";
  account: string;
  label: string;
  status: string;
  config: Record<string, unknown>;
  cursor: Record<string, unknown>;
  failures: number;
};

// Conversa no formato comum que todos os adaptadores entregam a ldo_support_ingest.
export type IngestMessage = {
  external_id: string;
  kind: "inbound" | "outbound" | "note";
  author_name?: string | null;
  author_external_id?: string | null;
  body: string;
  attachments?: Attachment[];
  created_at: string;
  delivery?: "accepted" | "delivered" | "read" | null;
  deleted?: boolean;
};
export type Attachment = { name: string; type: string | null; size: number | null; ref: string; inline?: boolean };
export type IngestConversation = {
  external_id: string;
  contact: { external_id: string | null; name?: string | null; email?: string | null; phone?: string | null; handle?: string | null; avatar_url?: string | null };
  subject?: string | null;
  status?: string | null;
  platform_status?: string | null;
  external_assignee_id?: string | null;
  external_assignee_name?: string | null;
  via?: string | null;
  external_updated_at?: string | null;
  messages: IngestMessage[];
};

export async function ingest(source: string, conversations: IngestConversation[]) {
  const totals = { conversations: 0, new_conversations: 0, new_messages: 0, reopened: 0 };
  // Lotes pequenos: cada chamada é uma transação curta.
  for (let i = 0; i < conversations.length; i += 25) {
    const r = await serverRpc<typeof totals>("ldo_support_ingest", { p_source: source, p_conversations: conversations.slice(i, i + 25) });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k] || 0;
  }
  return totals;
}
