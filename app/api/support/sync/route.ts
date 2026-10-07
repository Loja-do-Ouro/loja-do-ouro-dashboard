import { runSync } from "@/lib/support/sync";
import { body, handle, json, supportViewer } from "@/lib/support/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chamado pelo dashboard aberto (frequência da configuração) e pelo botão Atualizar.
// Cada fonte só corre se estiver na hora e ninguém a estiver a sincronizar (lease na BD).
export async function POST(request: Request) {
  return handle(async () => {
    await supportViewer(request, { write: true });
    const b = await body<{ force: boolean }>(request);
    return json({ results: await runSync({ force: b.force === true }) });
  });
}
