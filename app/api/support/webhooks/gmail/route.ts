import { after } from "next/server";
import { gmailMailbox, gmailPushAudience } from "@/lib/support/gmail";
import { verifyPubSubPush } from "@/lib/support/google-jwt";
import { runSync } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Aviso da Google (Pub/Sub, entrega push) de que a caixa do apoio mudou. Só aceita o token OIDC
// assinado pela Google para esta subscrição (audience = este endereço, conta de serviço configurada).
// O aviso não traz conteúdo: responde logo (o Pub/Sub espera 10 s) e sincroniza a seguir.
export async function POST(request: Request) {
  const account = process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!account) return new Response("Gmail por configurar.", { status: 503 });
  const auth = await verifyPubSubPush(request.headers.get("authorization"), { audience: gmailPushAudience(), email: account });
  if (!auth.ok) return new Response("Não autorizado.", { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: { data?: string } } | null;
  let mailbox = "";
  try {
    mailbox = String(JSON.parse(Buffer.from(body?.message?.data || "", "base64").toString("utf8")).emailAddress || "").toLowerCase();
  } catch {
    // Aviso sem conteúdo legível: aceite e ignorado.
  }
  if (mailbox !== gmailMailbox()) return new Response(null, { status: 204 });

  // Se outra passagem estiver a correr (ou tiver acabado há menos de 15 s), espera e tenta outra vez:
  // assim um email que chega durante uma sincronização não fica à espera da próxima.
  // Espera no máximo ~20 s por outra passagem; com a sincronização (35 s) fica abaixo dos 60 s da função.
  after(async () => {
    const start = Date.now();
    for (;;) {
      const [r] = await runSync({ only: ["gmail"], force: true, budgetMs: 35_000 }).catch(() => [{ ran: false, reason: "erro" }] as { ran: boolean; reason?: string }[]);
      if (r?.ran || !["running", "recent"].includes(r?.reason || "") || Date.now() - start > 12_000) return;
      await sleep(8000);
    }
  });
  return new Response(null, { status: 204 });
}
