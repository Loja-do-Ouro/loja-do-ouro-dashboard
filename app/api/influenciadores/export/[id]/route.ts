import { crAdminExport } from "@/lib/criadores/db";
import { dashboardUrl } from "@/lib/email";
import { canManageCreators } from "@/lib/permissions";
import { SupabaseError, userMessage } from "@/lib/supabase";
import { loadViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Exportação dos dados de um criador pela equipa (RGPD, arts. 15.º e 20.º) [rev. S-M8, R-M9]:
// - só POST, a partir do próprio dashboard (Origin igual ao endereço do dashboard; Sec-Fetch-Site, quando vem, tem
//   de ser same-origin). Um GET dá 405;
// - só quem gere (a BD confirma com cr_require 'manage') e só com um pedido RGPD access/portability desse criador,
//   aberto e com a identidade confirmada (ldo_cr_admin_export dá 22023 sem ele e grava privacy.export com o pedido);
// - não decifra nada: o JSON da BD não tem *_ct (nem IBAN, nem dados fiscais, nem moradas). Por precaução, qualquer
//   campo *_ct que apareça é retirado antes de sair;
// - anexo JSON com Cache-Control no-store. A equipa envia-o só para o email da conta (send_to).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
const deny = (status: number, text: string, extra: Record<string, string> = {}) =>
  new Response(text, { status, headers: { ...NO_STORE, ...extra } });

function origins(request: Request): Set<string> {
  const out = new Set<string>();
  for (const v of [dashboardUrl(), request.url]) {
    try {
      out.add(new URL(v).origin);
    } catch {
      // endereço inválido: ignora
    }
  }
  return out;
}

function sameOrigin(request: Request) {
  const origin = (request.headers.get("origin") || "").trim();
  if (!origin || origin === "null") return false;
  let given: string;
  try {
    given = new URL(origin).origin;
  } catch {
    return false;
  }
  if (/^https?:\/\/criadores\./i.test(given)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return origins(request).has(given);
}

// Retira qualquer campo terminado em _ct (valores cifrados), a qualquer profundidade.
function withoutSealed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutSealed);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!/_ct$/i.test(k)) out[k] = withoutSealed(x);
    return out;
  }
  return v;
}

export async function GET() {
  return deny(405, "Use o botão «Descarregar JSON» na ficha do criador.", { Allow: "POST" });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return deny(403, "Pedido recusado.");
  const viewer = await loadViewer().catch(() => null);
  if (!viewer) return deny(401, "A sua sessão terminou. Entre de novo no dashboard.");
  if (viewer.mustChangePassword || !canManageCreators(viewer)) return deny(403, "Sem permissão para exportar dados de criadores.");
  const { id } = await params;
  if (!UUID.test(id)) return deny(404, "Criador não encontrado.");
  const form = await request.formData().catch(() => null);
  const requestId = typeof form?.get("request_id") === "string" ? String(form!.get("request_id")) : "";
  if (!UUID.test(requestId)) return deny(400, "Escolha o pedido RGPD de acesso ou portabilidade desta pessoa.");
  try {
    const data = withoutSealed(await crAdminExport(viewer.session, id, requestId));
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="criador-${id.slice(0, 8)}-dados-${day}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    // Recusas da BD (sem pedido, identidade por confirmar, sem permissão): volta à ficha com a mensagem (sem dados
    // pessoais no endereço). Outros erros: texto simples.
    if (e instanceof SupabaseError && ["22023", "42501", "P0002"].includes(e.code)) {
      const back = new URL(`/influenciadores/criadores/${id}`, request.url);
      back.search = new URLSearchParams({ tab: "notas", erro: userMessage(e) }).toString();
      return new Response(null, { status: 303, headers: { Location: back.pathname + back.search, "Cache-Control": "no-store" } });
    }
    return deny(502, userMessage(e));
  }
}
