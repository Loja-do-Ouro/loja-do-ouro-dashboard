import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { SupabaseError, userMessage } from "@/lib/supabase";
import type { Viewer } from "@/lib/viewer";
import { aiConfigured } from "./ai";
import { anthropicWorkspace, costUsd, type UsagePart } from "./ai-rules";
import { serverRpc, sessionRpc } from "./db";
import { HttpError } from "./http";
import { visitorSite } from "./rules";
import {
  REVIEW_DEFAULT_MODEL, REVIEW_MAX_CHARS, REVIEW_MIN_CHARS, REVIEW_MODEL_TIMEOUT_MS, REVIEW_SCHEMA, discardReason, factsIn, isReviewModel,
  normalizeForHash, parseReview, portugueseText, reviewInstructions, reviewKnowledgeText, reviewThinking, reviewUserText,
  type DiscardReason, type ReviewBegin, type ReviewProblem, type ReviewTag,
} from "./review-rules";

// Revisão da IA antes de enviar (Claude, só no servidor). Uma chamada curta, sem ferramentas, com tempo limite e sem novas
// tentativas: se a IA falhar, o browser envia a resposta na mesma. Do texto só ficam os hashes.

export type ReviewResponse =
  | { id: string; veredicto: "aprovada" | "melhorar"; problemas: ReviewProblem[]; sugestao: string | null; descartada: DiscardReason | null }
  // A IA não respondeu (a tempo ou de todo): a resposta segue sem revisão.
  | { id: string; falhou: "timeout" | "erro"; motivo: string };

export const reviewHash = (text: string) => createHash("sha256").update(normalizeForHash(text), "utf8").digest("hex");

// Motivo curto para a colaboradora (nunca a chave nem detalhes internos).
function failure(e: unknown): { falhou: "timeout" | "erro"; motivo: string } {
  if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError || (e instanceof Error && e.name === "TimeoutError"))
    return { falhou: "timeout", motivo: "a IA não respondeu a tempo" };
  if (e instanceof Anthropic.AuthenticationError) return { falhou: "erro", motivo: "a Anthropic recusou a chave da IA" };
  if (e instanceof Anthropic.RateLimitError) return { falhou: "erro", motivo: "limite de pedidos da Anthropic atingido" };
  if (e instanceof Anthropic.InternalServerError) return { falhou: "erro", motivo: "IA sobrecarregada" };
  if (e instanceof Anthropic.APIError) return { falhou: "erro", motivo: `IA indisponível (HTTP ${e.status ?? "?"})` };
  if (e instanceof Error && e.message) return { falhou: "erro", motivo: e.message.slice(0, 200) };
  return { falhou: "erro", motivo: "IA indisponível" };
}

export async function reviewReply(viewer: Viewer, conversationId: string, reviewId: string, body: string): Promise<ReviewResponse> {
  const started = Date.now();
  const text = normalizeForHash(body);
  if (text.length < REVIEW_MIN_CHARS || text.length > REVIEW_MAX_CHARS) throw new HttpError(400, "Resposta fora dos limites da revisão.");
  if (!aiConfigured()) throw new HttpError(503, "IA por configurar no servidor");
  // Modo, preferência, limite diário e orçamento: uma recusa volta com o motivo (o browser envia sem revisão).
  let begin: ReviewBegin;
  try {
    begin = await sessionRpc<ReviewBegin>(viewer.session, "ldo_support_ai_review_begin", { p_conversation_id: conversationId, p_id: reviewId });
  } catch (e) {
    if (e instanceof SupabaseError && e.code === "42501") return { id: reviewId, falhou: "erro", motivo: userMessage(e) };
    throw e;
  }
  const model = isReviewModel(begin.model) ? begin.model : REVIEW_DEFAULT_MODEL;
  const site = begin.conversation.channel === "site" ? visitorSite(begin.visitor, begin.conversation.account) : null;
  const knowledge = reviewKnowledgeText(begin.knowledge, begin.stores);
  const finish = (r: { status: "done" | "error"; cost: number; error?: string; veredicto?: string; criterios?: string[]; sugestao?: string | null; descartada?: string | null; model?: string }) =>
    serverRpc("ldo_support_ai_review_finish", {
      p_id: begin.id, p_status: r.status, p_veredicto: r.veredicto ?? null, p_criterios: r.criterios ?? [],
      p_original_hash: reviewHash(text), p_sugestao_hash: r.sugestao ? reviewHash(r.sugestao) : null, p_descartada: r.descartada ?? null,
      p_model: r.model ?? model, p_cost: r.cost, p_latency_ms: Date.now() - started, p_error: r.error ?? null,
    }).catch(() => undefined);

  let res: Anthropic.Message;
  try {
    const workspace = anthropicWorkspace(process.env.ANTHROPIC_WORKSPACE_ID);
    const client = new Anthropic({ maxRetries: 0, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
    // 9 s para a IA, contados desde o pedido do browser (que desiste aos 10 s).
    const timeout = Math.max(1000, Math.min(REVIEW_MODEL_TIMEOUT_MS, REVIEW_MODEL_TIMEOUT_MS + 500 - (Date.now() - started)));
    res = await client.messages.create(
      {
        model,
        max_tokens: 3000,
        // Sem fallbacks (o Haiku 5.5 não os tem; uma recusa é uma falha) e com a menor latência possível.
        thinking: reviewThinking(model),
        output_config: { effort: "low", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
        system: [
          { type: "text", text: reviewInstructions(begin.criteria) },
          { type: "text", text: knowledge, cache_control: { type: "ephemeral", ttl: "1h" } },
        ],
        messages: [{ role: "user", content: reviewUserText(begin, text, site) }],
      },
      { timeout, maxRetries: 0, signal: AbortSignal.timeout(timeout) },
    );
  } catch (e) {
    const f = failure(e);
    await finish({ status: "error", cost: 0, error: f.motivo });
    return { id: begin.id, ...f };
  }

  // Custo gravado logo a seguir à chamada, também quando a resposta não serve (preço do modelo pedido, que está na tabela).
  const usage: UsagePart[] = [{ ...(res.usage as UsagePart), model }];
  const cost = costUsd(usage, model);
  try {
    if (res.stop_reason === "refusal") throw new Error("a IA recusou rever esta resposta");
    if (res.stop_reason === "max_tokens") throw new Error("a revisão da IA ficou demasiado longa");
    const out = parseReview(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    let sugestao = out.sugestao && normalizeForHash(out.sugestao) !== text ? out.sugestao : null;
    let descartada: DiscardReason | null = null;
    if (sugestao) {
      descartada = discardReason({
        draft: text, suggestion: sugestao, knowledge, knowledgeFacts: factsIn(knowledge), site: site?.site || "ldo",
        portuguese: portugueseText(text, site?.locale ?? null),
      });
      if (descartada) sugestao = null;
    }
    // Sem problemas nem sugestão que se possa mostrar, a resposta segue.
    const veredicto = out.veredicto === "melhorar" && (out.problemas.length || sugestao) ? "melhorar" : "aprovada";
    const problemas = veredicto === "melhorar" ? out.problemas : [];
    await finish({ status: "done", cost, veredicto, criterios: problemas.map((p) => p.criterio), sugestao, descartada, model: res.model || model });
    return { id: begin.id, veredicto, problemas, sugestao, descartada: veredicto === "melhorar" ? descartada : null };
  } catch (e) {
    const f = failure(e);
    await finish({ status: "error", cost, error: f.motivo, model: res.model || model });
    return { id: begin.id, ...f };
  }
}

// Depois de ldo_support_begin_send: a escolha feita com a revisão (deduzida pelo hash do texto enviado) e a proposta da
// IA usada. Nunca atrasa nem impede o envio (erros ignorados).
export function recordReplyLinks(userId: string, message: { id: string; body: string }, o: { review?: ReviewTag | null; aiDraftId?: string | null }) {
  const jobs: Promise<unknown>[] = [];
  if (o.review)
    jobs.push(serverRpc("ldo_support_ai_review_choice", {
      p_id: o.review.id, p_user: userId, p_message_id: message.id, p_body_hash: reviewHash(message.body), p_client_choice: o.review.choice ?? null,
    }));
  if (o.aiDraftId) jobs.push(serverRpc("ldo_support_ai_draft_used", { p_id: o.aiDraftId, p_user: userId, p_message_id: message.id }));
  return Promise.allSettled(jobs);
}
