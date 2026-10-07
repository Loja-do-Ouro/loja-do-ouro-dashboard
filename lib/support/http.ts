import "server-only";
import { canSupport } from "@/lib/permissions";
import { SupabaseError, userMessage } from "@/lib/supabase";
import { loadViewer, type Viewer } from "@/lib/viewer";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: NO_STORE });
}

// Pedidos que alteram dados só vêm do próprio dashboard: o cookie de sessão é SameSite=Lax e,
// além disso, exige-se a mesma origem e JSON.
function sameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

// Sessão válida com acesso ao Apoio ao Cliente; as funções na BD voltam a verificar tudo.
// json: false só nos carregamentos de ficheiros (corpo em bruto); a mesma origem é sempre exigida.
export async function supportViewer(request: Request, { write = false, json = true } = {}): Promise<Viewer> {
  if (write && (!sameOrigin(request) || (json && !(request.headers.get("content-type") || "").includes("application/json"))))
    throw new HttpError(403, "Pedido recusado.");
  const viewer = await loadViewer();
  if (!viewer) throw new HttpError(401, "Sessão terminada. Entre novamente.");
  if (viewer.mustChangePassword) throw new HttpError(403, "Mude primeiro a palavra-passe.");
  if (!canSupport(viewer)) throw new HttpError(403, "Sem acesso ao Apoio ao Cliente.");
  return viewer;
}

export async function body<T extends Record<string, unknown>>(request: Request): Promise<Partial<T>> {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Partial<T>) : {};
}

// Erros para o browser: mensagens próprias das funções ldo_* e dos adaptadores; nunca detalhes internos.
export function failure(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof SupabaseError) return json({ error: userMessage(e) }, e.code === "42501" ? 403 : e.code === "P0002" ? 404 : 400);
  if (e instanceof Error && e.message) return json({ error: e.message.slice(0, 400) }, 502);
  return json({ error: "Pedido indisponível. Tente novamente." }, 500);
}

export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return failure(e);
  }
}
