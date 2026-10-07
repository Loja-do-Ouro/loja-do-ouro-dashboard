import { after } from "next/server";
import { aiConfigured, beginAssistant, runAssistant, type AiEvent, type AiItem } from "@/lib/support/ai";
import { sessionRpc } from "@/lib/support/db";
import { body, handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";

export const dynamic = "force-dynamic";
// O assistente pára sozinho aos 125 s; o resto é margem para gravar o resultado.
export const maxDuration = 150;

type History = { enabled: boolean; daily_limit: number; used_today: number; items: AiItem[] };

// Histórico da pessoa com a IA nesta conversa (só o próprio). O custo estimado só o Super Admin vê.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const conversation = new URL(request.url).searchParams.get("conversa");
    if (!isUuid(conversation)) throw new HttpError(400, "Conversa inválida.");
    const h = await sessionRpc<History>(viewer.session, "ldo_support_ai_history", { p_conversation: conversation });
    return json({
      ...h,
      configured: aiConfigured(),
      items: h.items.map(({ cost_usd, ...i }) => (viewer.isSuper ? { ...i, cost_usd } : i)),
    });
  });
}

// Pedido à IA. A resposta chega em linhas JSON (progresso e resultado), para a colaboradora ver o
// que a IA está a consultar. O pedido fica registado antes de começar e o resultado é gravado mesmo
// que a página seja fechada a meio.
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request, { write: true });
    const b = await body<{ conversationId: string; kind: string; question: string }>(request);
    if (!isUuid(b.conversationId)) throw new HttpError(400, "Conversa inválida.");
    const kind = b.kind === "chat" || b.kind === "draft" ? b.kind : null;
    if (!kind) throw new HttpError(400, "Pedido à IA inválido.");
    if (!aiConfigured()) throw new HttpError(503, "Assistente de IA por configurar: falta a chave ANTHROPIC_API_KEY no servidor (Super Admin).");
    const question = typeof b.question === "string" ? b.question.trim().slice(0, 4000) : "";
    const conversationId = b.conversationId;
    const begin = await beginAssistant(viewer, conversationId, kind, question);

    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        controller = null;
      },
    });
    const emit = (e: AiEvent) => {
      try {
        controller?.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      } catch {
        controller = null;
      }
    };
    const work = runAssistant(viewer, conversationId, begin, kind, question, emit).finally(() => {
      try {
        controller?.close();
      } catch {
        // Já fechado (a página saiu).
      }
    });
    // Continua até ao fim mesmo que o browser se desligue: o resultado fica no histórico.
    after(() => work);
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  });
}
