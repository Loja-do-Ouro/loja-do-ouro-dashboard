import { after } from "next/server";
import { psRequest } from "@/lib/private-selection/db";
import { checkOrigin, ipHash, ipPrefixHash, preflight, PsError, psHandle, psJson, readJson } from "@/lib/private-selection/http";
import { sweepPrivateSelection } from "@/lib/private-selection/send";
import { cleanEmail, cleanName, isBrand, normalizePhone, psLang } from "@/lib/private-selection-rules";
import { isUuid } from "@/lib/support/rules";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Pedido de acesso pelo formulário da página reservada: nome, email e telemóvel. Quem pede fica logo membro e
// recebe a senha por email cerca de 30 minutos depois (fila na BD). A resposta é sempre a mesma, "pedido
// recebido": membro novo, membro que já existe, membro removido (sem email; o pedido fica em ldo_ps_blocked para a equipa decidir) ou robô (campo escondido
// preenchido). Só os dados mal preenchidos têm resposta própria.
export async function POST(request: Request) {
  return psHandle(request, async () => {
    checkOrigin(request);
    const b = await readJson(request);
    // Campo escondido: só robôs o preenchem. Mesma resposta, sem gravar nada.
    if (typeof b.website === "string" && b.website.trim()) return psJson(request, { ok: true, code: "received" });
    if (!isBrand(b.brand) || !isUuid(b.client_key)) throw new PsError(400, "invalid_request");
    // Língua de duas letras, como o tema a envia ("pt-PT" também serve); outra língua → a da raiz da marca.
    const { brand, locale } = psLang(b.brand, b.locale);
    const name = cleanName(b.name);
    if (!name) throw new PsError(400, "invalid_name");
    const email = cleanEmail(b.email);
    if (!email) throw new PsError(400, "invalid_email");
    // O tema pede o indicativo; na Loja do Ouro (português e Portugal) um número sem ele é português.
    const phone = normalizePhone(b.phone, brand === "ldo" ? "+351" : undefined);
    if (!phone) throw new PsError(400, "invalid_phone");
    const { status } = await psRequest({
      name, email, phone, locale, brand, origin: request.headers.get("origin"), consent: b.consent_marketing === true,
      ipHash: ipHash(request), ipPrefixHash: ipPrefixHash(request), clientKey: b.client_key,
    });
    // Depois da resposta, só num pedido aceite (não num repetido nem num bloqueado): Klaviyo do membro novo e emails
    // que já estejam na hora (a verificação de 5 em 5 minutos faz o mesmo).
    if (status === "created" || status === "requeued") after(() => sweepPrivateSelection().catch(() => undefined));
    return psJson(request, { ok: true, code: "received" });
  });
}
