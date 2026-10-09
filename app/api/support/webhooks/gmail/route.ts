import { after } from "next/server";
import { gmailMailbox, gmailPushAudience } from "@/lib/support/gmail";
import { verifyPubSubPush } from "@/lib/support/google-jwt";
import { runSync, type SyncOutcome } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Aviso da Google (Pub/Sub, entrega push) de que a caixa do apoio mudou. Só aceita o token OIDC
// assinado pela Google para esta subscrição (audience = este endereço, conta de serviço configurada).
// O aviso não traz conteúdo: responde logo (o Pub/Sub espera 10 s) e sincroniza a seguir.
export async function POST(request: Request) {
  const start = Date.now();
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

  // O aviso só diz "mudou alguma coisa": responde já (o Pub/Sub espera 10 s) e sincroniza a seguir, até ler tudo.
  // - Outra passagem a correr (ou acabada há menos de 15 s): espera e volta a tentar; essa passagem não leu este email.
  // - Mais conversas por ler: continua.
  // - A espera depois de erros não trava um aviso (override): um email novo é sinal para tentar já.
  // Uma leitura do Gmail pode começar até 10 s antes do fim da passagem e demorar até 25 s, e depois ainda há a
  // gravação: o orçamento conta desde o início do pedido e fica em 30 s menos o tempo já passado (folga para os
  // 60 s da função); nunca começa uma passagem com menos de 12 s. O que ficar por fazer passa à seguinte.
  after(async () => {
    for (;;) {
      const budgetMs = Math.min(25_000, 30_000 - (Date.now() - start));
      if (budgetMs < 12_000) return;
      const [r] = await runSync({ only: ["gmail"], force: true, override: true, budgetMs }).catch(() => [] as SyncOutcome[]);
      if (!r) return;
      if (r.ran) {
        if (!r.more || r.ok === false) return;
        continue;
      }
      if (!["running", "recent"].includes(r.reason || "")) return;
      await sleep(5000);
    }
  });
  return new Response(null, { status: 204 });
}
