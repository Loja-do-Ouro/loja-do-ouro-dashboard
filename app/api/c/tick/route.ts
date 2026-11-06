import { after } from "next/server";
import { resealCreators } from "@/lib/criadores/crypto";
import { creatorsServerConfigured, crTickCheck } from "@/lib/criadores/db";
import { sendCreatorsOutbox } from "@/lib/criadores/emails";
import { readPublicAccounts } from "@/lib/criadores/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Verificação automática da plataforma de criadores (§4.4), a cada 5 minutos: pg_cron + pg_net no Supabase
// (supabase/migrations/20261105100100_ldo_creators_tick_schedule.sql, aplicado só depois do deploy). O pedido traz
// "Bearer <token>"; o token é gerado pela BD, fica no Vault (ldo_creators_tick) e é a BD que o confirma
// (ldo_cr_tick_check, com o CREATORS_SERVER_TOKEN). Falha fechada: sem configuração 503, token errado 401.
// O proxy deixa passar /api/c/tick nos dois hosts (no do dashboard é o URL do pg_cron), sem sessão.
// Responde já (204) e trabalha a seguir, em after(), com um orçamento de 60 s contado desde o início do pedido;
// cada tarefa tem o seu .catch, para uma falha não parar as outras. PR1:
// - fila de emails (ldo_cr_outbox): lotes de 20, 600 ms entre envios, para no 429 do Resend;
// - regravação da cifra numa rotação da chave [rev. S-B12]: só com CREATORS_RESEAL_FROM (ex.: "c1") e o anel de
//   CREATORS_ENCRYPTION_KEY com a versão nova à frente; sem a variável não faz nada.
// PR 3A: leitura dos dados públicos do Instagram (Business Discovery). Até 20 contas por execução, em lotes de 10,
// com 1 s entre pedidos; um pedido por conta. Para com X-App-Usage ≥ 75 % ou num erro de limite, token ou
// configuração (pausa global em ldo_private.cr_public_state). Nunca regista o token, o URL nem a resposta. Sem
// META_SYSTEM_USER_TOKEN e META_IG_ACCOUNT_ID, ou com a leitura desligada em Definições, não faz nada.
// A limpeza por prazos (ldo-creators-retention, 03:41) corre só na BD e não passa por aqui.
// PR2: + apagamentos no Blob + catálogo. PR 3B: + tokens, sincronização e indicadores.
export async function POST(request: Request) {
  const start = Date.now();
  if (!creatorsServerConfigured()) {
    return new Response("Servidor por configurar.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(request.headers.get("authorization") || "");
  if (!m || !(await crTickCheck(m[1]))) {
    return new Response("Não autorizado.", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  after(async () => {
    const budgetMs = Math.max(20_000, 60_000 - (Date.now() - start));
    await Promise.all([
      sendCreatorsOutbox({ budgetMs }).catch(() => undefined),
      resealCreators({ budgetMs }).catch(() => undefined),
      readPublicAccounts({ budgetMs }).catch(() => undefined),
    ]);
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
