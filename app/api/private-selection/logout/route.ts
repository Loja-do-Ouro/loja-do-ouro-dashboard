import { psLogout } from "@/lib/private-selection/db";
import { bearerToken, checkOrigin, preflight, psHandle, psJson } from "@/lib/private-selection/http";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Saída da página reservada: termina a sessão da loja na BD. Repetir (ou um token que já não existe) responde na
// mesma "ok".
export async function POST(request: Request) {
  return psHandle(request, async () => {
    checkOrigin(request);
    const token = bearerToken(request);
    if (token) await psLogout(token);
    return psJson(request, { ok: true });
  });
}
