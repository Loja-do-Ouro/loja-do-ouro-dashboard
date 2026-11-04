import { redact } from "@/lib/criadores-rules";
import { exportMyData } from "@/lib/criadores/crypto";
import { creatorSession, loadCreator, sameOriginPost, siteBase } from "@/lib/criadores/site";

export const dynamic = "force-dynamic";

// «Descarregar os meus dados» (arts. 15.º e 20.º do RGPD; §4.4 e F11 da especificação). Formulário de /definicoes do
// site (method="post", action="/api/c/export", campo "password"): cookie do criador + palavra-passe + o pedido tem de
// vir do próprio site [rev. S-B1]: Origin igual a CREATORS_URL (antes do DNS, a do próprio pedido) e Sec-Fetch-Site
// "same-origin" obrigatório. ldo_cr_export confirma a palavra-passe (5 falhas em 15 min bloqueiam), limita a 5
// exportações por hora e grava o pedido RGPD access como done; os dados fiscais e o IBAN do próprio vão decifrados.
// Resposta: anexo JSON, no-store. Os erros voltam a /definicoes com ?dados=<código>#dados (sem texto no endereço;
// a página mostra a mensagem do código): senha | limite | bloqueado | erro. Sem sessão: /conta/entrar.
// No host do dashboard com CREATORS_URL, o proxy responde 404 a esta rota (só existe em criadores.*).

const MAX_BODY = 16 * 1024;
const noStore = { "Cache-Control": "no-store" };

const refused = () =>
  new Response("Pedido recusado.", { status: 403, headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });

// 303: o browser volta à página com GET. Location relativo (o mesmo host do pedido: criadores.* ou, antes do DNS, o
// endereço do dashboard com /c).
const back = (path: string) => new Response(null, { status: 303, headers: { ...noStore, Location: path } });

export async function POST(request: Request) {
  const denied = sameOriginPost(request);
  if (denied) return denied;
  if (request.headers.get("sec-fetch-site") !== "same-origin") return refused();

  const base = await siteBase();
  const settings = `${base}/definicoes`;
  const fail = (code: "senha" | "limite" | "bloqueado" | "erro") => back(`${settings}?dados=${code}#dados`);

  const session = await creatorSession();
  if (!session) return back(`${base}/conta/entrar?next=${encodeURIComponent("/definicoes")}`);

  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) {
    return new Response("Formato não suportado.", { status: 415, headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) {
    return new Response("Pedido demasiado grande.", { status: 413, headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
  }

  let password = "";
  try {
    const value = (await request.formData()).get("password");
    password = typeof value === "string" ? value.slice(0, 200) : "";
  } catch {
    return fail("erro");
  }
  if (!password) return fail("senha");

  try {
    // Sessão terminada (ou conta apagada) → Entrar. Uma falha da BD aqui segue para o catch (erro).
    if (!(await loadCreator())) return back(`${base}/conta/entrar?next=${encodeURIComponent("/definicoes")}`);
    const r = await exportMyData(session, password);
    if (!r.ok) return fail(r.reason === "rate" ? "limite" : "senha");
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(r.data, null, 2), {
      headers: {
        ...noStore,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="criadores-loja-do-ouro-dados-${day}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    // 42501 depois de a sessão estar confirmada = 5 palavras-passe erradas em 15 min (ldo_cr_reauth).
    if ((e as { code?: string })?.code === "42501") return fail("bloqueado");
    console.error("criadores export", redact(e));
    return fail("erro");
  }
}
