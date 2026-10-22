import { psFavorites } from "@/lib/private-selection/db";
import { bearerToken, checkOrigin, preflight, PsError, psHandle, psJson, readJson } from "@/lib/private-selection/http";
import { cleanHandle, isFavoritesAction } from "@/lib/private-selection-rules";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Peças guardadas no perfil ("Adicionar ao perfil" e "As minhas peças" na página reservada), com a sessão da loja em
// "Authorization: Bearer" e o corpo { action: "list" | "add" | "remove", handle? } (handle da Shopify, só em add e
// remove). Responde sempre com a lista toda, mais recentes primeiro. A sessão é confirmada na BD como em /session:
// sem ela, ou terminada, expirada, de um membro removido ou anterior à última mudança de senha → "expired". Ação ou
// handle inválidos, ou mais de 300 peças → "invalid_request". O handle não é confirmado na Shopify, só o formato.
export async function POST(request: Request) {
  return psHandle(request, async () => {
    checkOrigin(request);
    const token = bearerToken(request);
    if (!token) throw new PsError(401, "expired");
    const b = await readJson(request);
    if (!isFavoritesAction(b.action)) throw new PsError(400, "invalid_request");
    const handle = b.action === "list" ? null : cleanHandle(b.handle);
    if (b.action !== "list" && !handle) throw new PsError(400, "invalid_request");
    const r = await psFavorites(token, b.action, handle);
    if (!r.ok) throw new PsError(401, "expired");
    return psJson(request, { ok: true, handles: r.handles });
  });
}
