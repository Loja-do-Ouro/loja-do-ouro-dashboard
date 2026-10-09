import { after } from "next/server";
import { serverConfigured, serverRpc } from "@/lib/support/db";
import { runSync } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const METRICOOL = ["metricool-facebook", "metricool-instagram"];

// Verificação automática a cada 5 minutos (agendada no Supabase com pg_cron + pg_net), para as conversas do
// Facebook e do Instagram (sem avisos da Metricool) e as respostas automáticas saírem mesmo com o dashboard
// fechado. O token é gerado pela base de dados e guardado no Vault do Supabase: o pedido traz "Bearer <token>"
// e é a base de dados que o confirma (nunca passa pelo código nem pelas variáveis da Vercel).
// Responde já e sincroniza a seguir:
// - Facebook e Instagram em cada verificação, sem esperar pela frequência do dashboard aberto (a espera depois de
//   erros mantém-se);
// - as outras fontes com a frequência e as esperas habituais.
// Orçamento de 60 s contado desde o início do pedido: com a última leitura e os envios, fica abaixo dos 120 s.
export async function POST(request: Request) {
  const start = Date.now();
  if (!serverConfigured()) return new Response("Servidor por configurar.", { status: 503 });
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(request.headers.get("authorization") || "");
  const ok = m ? await serverRpc<boolean>("ldo_support_tick_check", { p_value: m[1] }).catch(() => false) : false;
  if (!ok) return new Response("Não autorizado.", { status: 401, headers: { "Cache-Control": "no-store" } });
  after(async () => {
    const budgetMs = Math.max(20_000, 60_000 - (Date.now() - start));
    await Promise.all([
      runSync({ only: METRICOOL, force: true, budgetMs }).catch(() => undefined),
      runSync({ only: ["zendesk", "gmail"], budgetMs }).catch(() => undefined),
    ]);
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
