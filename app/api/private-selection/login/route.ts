import { psLogin } from "@/lib/private-selection/db";
import { checkOrigin, ipPrefixHash, preflight, PsError, psHandle, psJson, readJson } from "@/lib/private-selection/http";
import { cleanEmail } from "@/lib/private-selection-rules";
import { clearFailures, clientKey, isLocked, recordFailure } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const FAILURE_DELAY_MS = 800;

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Entrada na página reservada com o email e a senha partilhada. Devolve o token da sessão da loja (30 dias), que o
// tema guarda e envia nas visitas seguintes, só o primeiro nome e o código de membro ("code": o código de desconto
// que a página aplica sem o mostrar; null enquanto a equipa não o definir). Email desconhecido, senha errada, membro
// removido ou senha ainda por definir dão a mesma resposta. Bloqueios na BD: 5 falhas do mesmo email a partir da
// mesma rede durante 15 minutos e, com 20 falhas numa hora, a rede só entra com a senha certa; cada endereço também
// é travado aqui, com uma contagem própria (não bloqueia a entrada no dashboard).
export async function POST(request: Request) {
  return psHandle(request, async () => {
    checkOrigin(request);
    const client = `private-selection:${clientKey(request)}`;
    if (isLocked(client)) throw new PsError(429, "locked");
    const b = await readJson(request);
    const email = cleanEmail(b.email);
    const password = typeof b.password === "string" && b.password.length <= 200 ? b.password : "";
    const result = email && password ? await psLogin(email, password, ipPrefixHash(request)) : null;
    if (!result?.ok) {
      recordFailure(client);
      await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
      throw result?.reason === "locked" || isLocked(client) ? new PsError(429, "locked") : new PsError(401, "invalid");
    }
    clearFailures(client);
    return psJson(request, { ok: true, token: result.token, expires_at: result.expires_at, name: result.name, code: result.code ?? null });
  });
}
