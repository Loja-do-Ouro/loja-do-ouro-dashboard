import { constantTimeTextEqual } from "@/lib/session";
import { serverRpc } from "@/lib/support/db";
import { distillPending } from "@/lib/support/knowledge";
import { runSync } from "@/lib/support/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Passagem diária de segurança (Vercel Cron, com CRON_SECRET), para o caso de ninguém ter o
// dashboard aberto. Durante o dia a sincronização é feita pelo dashboard aberto, com a frequência
// definida na configuração, sem processos permanentes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeTextEqual(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const started = Date.now();
  // 60 s de orçamento: com uma última página da Metricool (até 55 s) fica dentro dos 120 s da função. As limpezas seguem
  // logo a seguir à sincronização, em paralelo, sem esperar pela base de conhecimento aprendida, que corre ao mesmo tempo
  // (só com as propostas automáticas ligadas): até 12 conversas, 15 s cada, sem começar chamadas novas depois dos 90 s.
  const sync = runSync({ force: true, budgetMs: 60_000 }).then(async (results) => {
    const [purged, aiPurged, reviewsPurged, knowledgePurged, sitePurged] = await Promise.all([
      // Anexos enviados: os bytes apagam-se ao fim de 30 dias (e os nunca enviados ao fim de 1 dia).
      serverRpc<number>("ldo_support_uploads_purge").catch(() => null),
      // Pedidos à IA: o registo apaga-se ao fim de 180 dias.
      serverRpc<number>("ldo_support_ai_purge").catch(() => null),
      // Revisões da IA antes de enviar (só hashes e totais): apagam-se ao fim de 365 dias.
      serverRpc<number>("ldo_support_ai_review_purge").catch(() => null),
      // Base de conhecimento aprendida: registo de pedidos (365 dias; ligação às conversas 30), conversas vistas (180),
      // propostas paradas, arquivadas e marcas de resposta automática expiradas.
      serverRpc<number>("ldo_support_knowledge_purge").catch(() => null),
      // Chat do site: tokens de visitantes sem atividade há 180 dias deixam de funcionar.
      serverRpc<number>("ldo_support_site_purge").catch(() => null),
    ]);
    return { results, purged, aiPurged, reviewsPurged, knowledgePurged, sitePurged };
  });
  const [s, knowledge] = await Promise.all([
    sync,
    distillPending(started).catch((e) => ({ erro: e instanceof Error ? e.message.slice(0, 200) : "erro" })),
  ]);
  return Response.json({ ok: s.results.every((r) => r.ok !== false), ...s, knowledge }, { headers: { "Cache-Control": "no-store" } });
}
