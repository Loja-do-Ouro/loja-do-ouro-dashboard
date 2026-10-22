import { psSession } from "@/lib/private-selection/db";
import { bearerToken, checkOrigin, preflight, PsError, psHandle, psJson } from "@/lib/private-selection/http";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Confirmação da sessão da loja em cada visita da página reservada (token em "Authorization: Bearer"; o corpo é
// ignorado). Sessão terminada, expirada, de um membro removido ou anterior à última mudança de senha → "expired",
// e o tema volta a pedir a entrada. Como na entrada, o primeiro nome e o código de membro ("code", null se não
// houver), para um código novo chegar a quem já tem sessão.
export async function POST(request: Request) {
  return psHandle(request, async () => {
    checkOrigin(request);
    const token = bearerToken(request);
    if (!token) throw new PsError(401, "expired");
    const r = await psSession(token);
    if (!r.ok) throw new PsError(401, "expired");
    return psJson(request, { ok: true, name: r.name, expires_at: r.expires_at, code: r.code ?? null });
  });
}
