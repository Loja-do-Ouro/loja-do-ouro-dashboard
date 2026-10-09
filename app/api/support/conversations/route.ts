import { after } from "next/server";
import { sessionRpc } from "@/lib/support/db";
import { sweepSiteNotifications } from "@/lib/support/site-chat";
import { importTicket, zendeskConfigured } from "@/lib/support/zendesk";
import { handle, json, supportViewer } from "@/lib/support/http";

export const dynamic = "force-dynamic";

const FILTERS = new Set(["all", "mine", "unassigned", "unread", "auto"]);

// Lista de conversas com filtros e pesquisa; não lidas contadas para quem pede.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    // Chat do site: avisos por email de respostas que o cliente ainda não viu (no máximo uma vez por minuto).
    after(() => sweepSiteNotifications().catch(() => undefined));
    const q = new URL(request.url).searchParams;
    const filter = q.get("filtro") || "all";
    const search = (q.get("q") || "").trim().slice(0, 120);
    const list = () => sessionRpc<{ items: unknown[] }>(viewer.session, "ldo_support_list", {
      p_filter: FILTERS.has(filter) ? filter : "all",
      p_channel: q.get("canal") || null,
      p_status: q.get("estado") || null,
      p_q: search || null,
    });
    let result = await list();
    // "#1234": um ticket Zendesk ainda não sincronizado (mais antigo que a janela inicial) é lido a pedido.
    const ticket = /^#?(\d{1,12})$/.exec(search)?.[1];
    if (ticket && !result.items.length && zendeskConfigured() && (await importTicket(null, ticket).catch(() => false))) result = await list();
    return json(result);
  });
}
