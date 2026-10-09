import { after } from "next/server";
import { serverConfigured, serverRpc } from "@/lib/support/db";
import { runSync } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verificação automática a cada 5 minutos (agendada no Supabase com pg_cron + pg_net), para as conversas do
// Facebook e do Instagram (sem avisos da Metricool) e as respostas automáticas saírem mesmo com o dashboard
// fechado. O token é gerado pela base de dados e guardado no Vault do Supabase: o pedido traz "Bearer <token>"
// e é a base de dados que o confirma (nunca passa pelo código nem pelas variáveis da Vercel).
// Responde já e sincroniza a seguir, com a frequência e a espera depois de erros habituais (sem forçar).
export async function POST(request: Request) {
  if (!serverConfigured()) return new Response("Servidor por configurar.", { status: 503 });
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(request.headers.get("authorization") || "");
  const ok = m ? await serverRpc<boolean>("ldo_support_tick_check", { p_value: m[1] }).catch(() => false) : false;
  if (!ok) return new Response("Não autorizado.", { status: 401, headers: { "Cache-Control": "no-store" } });
  after(async () => {
    await runSync({ budgetMs: 40_000 }).catch(() => undefined);
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
