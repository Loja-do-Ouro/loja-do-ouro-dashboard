import { sessionRpc } from "@/lib/support/db";
import { handle, json, supportViewer } from "@/lib/support/http";

export const dynamic = "force-dynamic";

const FILTERS = new Set(["all", "mine", "unassigned", "unread"]);

// Lista de conversas com filtros e pesquisa; não lidas contadas para quem pede.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const q = new URL(request.url).searchParams;
    const filter = q.get("filtro") || "all";
    return json(
      await sessionRpc(viewer.session, "ldo_support_list", {
        p_filter: FILTERS.has(filter) ? filter : "all",
        p_channel: q.get("canal") || null,
        p_status: q.get("estado") || null,
        p_q: (q.get("q") || "").slice(0, 120) || null,
      }),
    );
  });
}
