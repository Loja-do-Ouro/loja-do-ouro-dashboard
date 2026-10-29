import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Viewer } from "@/lib/viewer";
import { aiConfigured } from "./ai";
import { anthropicWorkspace, costUsd, otherBrandIn, type UsagePart } from "./ai-rules";
import { serverRpc, sessionRpc } from "./db";
import { HttpError } from "./http";
import {
  CARD_LIMITS, DISTILL_INSTRUCTIONS, DISTILL_SCHEMA, KNOWLEDGE_BUTTON_CALL_MS, KNOWLEDGE_CRON_CALL_MS, KNOWLEDGE_CRON_END_MS, KNOWLEDGE_CRON_LIMIT,
  KNOWLEDGE_CRON_STOP_MS, KNOWLEDGE_DISCARD_TEXT, KNOWLEDGE_EFFORT, KNOWLEDGE_MAX_TOKENS, KNOWLEDGE_MODEL, KnowledgeFormatError, cardPii, companyAllowlist,
  conversationBrand, copiesCustomer, distillUserText, parseDistill, poisonReason, sourceWarnings, type KnowledgeBegin, type KnowledgeDiscard,
} from "./knowledge-rules";

// Base de conhecimento aprendida (Claude Sonnet 5.5, só no servidor): uma chamada por conversa, sem ferramentas, sem
// fallbacks e sem novas tentativas, com tempo limite. O resultado é sempre uma proposta para o Super Admin aprovar;
// nada é enviado a clientes nem usado pela IA antes de aprovado e publicado. O custo grava-se logo a seguir à chamada.

type Outcome = { resultado: "novo" | "existente" | "nao_aproveitavel" | "descartado" | "erro"; motivo: string; descartado?: KnowledgeDiscard };
type Propose = { resultado: Outcome["resultado"] | null; card_id: string | null; descartado: KnowledgeDiscard | null; estado: string | null };

function failure(e: unknown) {
  if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError || (e instanceof Error && e.name === "TimeoutError"))
    return { timeout: true, motivo: "a IA não respondeu a tempo" };
  if (e instanceof Anthropic.AuthenticationError) return { timeout: false, motivo: "a Anthropic recusou a chave da IA" };
  if (e instanceof Anthropic.RateLimitError) return { timeout: false, motivo: "limite de pedidos da Anthropic atingido" };
  if (e instanceof Anthropic.InternalServerError) return { timeout: false, motivo: "IA sobrecarregada" };
  if (e instanceof Anthropic.APIError) return { timeout: false, motivo: `IA indisponível, HTTP ${e.status ?? "?"}` };
  if (e instanceof Error && e.message) return { timeout: false, motivo: e.message.slice(0, 200) };
  return { timeout: false, motivo: "IA indisponível" };
}

// Pedido interrompido: a Anthropic pode cobrá-lo na mesma, até ao teto de saída. Estimativa por excesso (3 caracteres por
// token de entrada e o teto inteiro de saída).
const interruptedCost = (chars: number) =>
  costUsd([{ model: KNOWLEDGE_MODEL, input_tokens: Math.ceil(chars / 3), output_tokens: KNOWLEDGE_MAX_TOKENS }], KNOWLEDGE_MODEL);

async function distill(begin: KnowledgeBegin, timeoutMs: number, effort: "low" | "medium"): Promise<Outcome> {
  const started = Date.now();
  // Chave aleatória deste pedido nas marcas das mensagens (quem escreveu uma mensagem não a conhece).
  const userText = distillUserText(begin, randomBytes(6).toString("hex"));
  const record = (values: Record<string, unknown>) =>
    serverRpc<Propose>("ldo_support_knowledge_propose", { p_run: begin.id, p_values: { model: KNOWLEDGE_MODEL, latency_ms: Date.now() - started, ...values } })
      .catch(() => null);

  let res: Anthropic.Message;
  try {
    const workspace = anthropicWorkspace(process.env.ANTHROPIC_WORKSPACE_ID);
    const client = new Anthropic({ maxRetries: 0, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
    res = await client.messages.create(
      {
        model: KNOWLEDGE_MODEL,
        max_tokens: KNOWLEDGE_MAX_TOKENS,
        // Sem fallbacks (uma recusa é uma falha) e com raciocínio adaptativo; o esforço depende do caminho (KNOWLEDGE_EFFORT).
        thinking: { type: "adaptive" },
        output_config: { effort, format: { type: "json_schema", schema: DISTILL_SCHEMA } },
        // Instruções iguais em todos os pedidos: em cache durante a passagem diária.
        system: [{ type: "text", text: DISTILL_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userText }],
      },
      { timeout: timeoutMs, maxRetries: 0, signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (e) {
    const f = failure(e);
    await record({ status: "error", cost: f.timeout ? interruptedCost(DISTILL_INSTRUCTIONS.length + userText.length) : 0, error: f.motivo });
    return { resultado: "erro", motivo: f.motivo };
  }

  const cost = costUsd([{ ...(res.usage as UsagePart), model: KNOWLEDGE_MODEL }], KNOWLEDGE_MODEL);
  const model = res.model || KNOWLEDGE_MODEL;
  const discard = async (code: KnowledgeDiscard, motivo: string) => {
    const r = await record({ status: "done", cost, model, resultado: "descartado", descartado: code });
    const final = r?.descartado ?? code;
    return { resultado: "descartado" as const, motivo, descartado: final };
  };
  try {
    if (res.stop_reason === "refusal") throw new Error("a IA recusou ler esta conversa");
    if (res.stop_reason === "max_tokens") throw new Error("a proposta da IA ficou demasiado longa");
    const out = parseDistill(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""), {
      similar: begin.similar.map((c) => c.id), stores: begin.stores.map((s) => s.code), today: begin.today,
    });
    if (!out.aproveitavel) {
      await record({ status: "done", cost, model, resultado: "nao_aproveitavel" });
      return { resultado: "nao_aproveitavel", motivo: out.motivo };
    }
    if (out.card_existente) {
      const r = await record({ status: "done", cost, model, resultado: "existente", card_id: out.card_existente });
      return r?.resultado === "existente" ? { resultado: "existente", motivo: out.motivo } : { resultado: "descartado", motivo: out.motivo, descartado: r?.descartado ?? "formato" };
    }
    // Verificações antes de gravar, na pergunta, nas variantes e na resposta. Retiram a proposta só os dados pessoais
    // sem ambiguidade (emails, telefones, IBAN, NIF, números de cartão, de encomenda ou de cliente, ligações de perfis, o
    // nome do cliente ou de alguém da equipa), os números, ligações, contactos e compromissos que a equipa não escreveu,
    // o texto copiado do cliente e a outra marca. A pergunta e as variantes também são publicadas para a IA: um número,
    // uma ligação ou a outra marca numa pergunta também retiram a proposta. O resto (possíveis nomes, moradas,
    // contradições e condições em falta) fica na proposta como aviso, que o Super Admin confirma antes de aprovar.
    const knowledge = begin.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n");
    const allow = companyAllowlist({ knowledge, stores: begin.stores, extra: begin.company });
    const names = [begin.conversation.contact_name, begin.conversation.contact_handle, ...begin.staff_names];
    if (cardPii(out, allow, names).length) return discard("dados_pessoais", out.motivo);
    // Só as respostas da equipa enviadas pelo dashboard confirmam factos; a escolhida no botão, se houver, conta como as outras.
    const staff = begin.messages.filter((m) => m.kind === "outbound" && m.dashboard).map((m) => m.body).join("\n\n");
    const questions = [out.pergunta, ...out.variantes].join("\n");
    const poison = poisonReason({ text: out.resposta, staff, knowledge }) ?? poisonReason({ text: questions, staff, knowledge, question: true });
    if (poison) return discard(poison, out.motivo);
    const inbound = begin.messages.filter((m) => m.kind === "inbound").map((m) => m.body);
    if (copiesCustomer([out.pergunta, ...out.variantes, out.resposta], inbound)) return discard("copia_cliente", out.motivo);
    const brand = conversationBrand(begin.conversation.channel, begin.conversation.site);
    if (otherBrandIn(out.resposta, brand) || otherBrandIn(questions, brand)) return discard("marca", out.motivo);
    // Avisos em relação à resposta da equipa (só aqui há a resposta da equipa): ficam no cartão para o Super Admin.
    const avisos = sourceWarnings({ text: out.resposta, staff, knowledge });
    const loja = out.loja ? begin.stores.find((s) => s.code === out.loja)?.id ?? null : null;
    const r = await record({
      status: "done", cost, model, resultado: "novo",
      card: {
        intent: out.intent, brand, loja_id: loja, pergunta: out.pergunta.slice(0, CARD_LIMITS.pergunta), variantes: out.variantes,
        resposta: out.resposta, valido_ate: out.valido_ate, avisos,
      },
    });
    if (!r) return { resultado: "erro", motivo: "não foi possível gravar a proposta" };
    if (r.resultado === "descartado") return { resultado: "descartado", motivo: out.motivo, descartado: r.descartado ?? "formato" };
    return { resultado: "novo", motivo: out.motivo };
  } catch (e) {
    if (e instanceof KnowledgeFormatError) return discard("formato", "");
    const f = failure(e);
    await record({ status: "error", cost, model, error: f.motivo });
    return { resultado: "erro", motivo: f.motivo };
  }
}

// Texto para quem carregou no botão (nunca dados de outras conversas).
function buttonNote(o: Outcome) {
  switch (o.resultado) {
    case "novo":
      return "Guardada como proposta na base de conhecimento aprendida: as regras do servidor não encontraram emails, telefones, números de encomenda nem os nomes do cliente ou da equipa (possíveis nomes, moradas e contradições ficam assinalados). O Super Admin revê-a e aprova-a em Configuração → IA do apoio.";
    case "existente":
      return "Já existe uma resposta (proposta ou aprovada) para esta pergunta: ficou contada como mais uma confirmação.";
    case "nao_aproveitavel":
      return `A IA não encontrou nesta resposta uma pergunta geral para reutilizar${o.motivo ? `: ${o.motivo.slice(0, 200)}` : "."}`;
    case "descartado":
      return `A proposta da IA foi retirada pelas regras de segurança: ${KNOWLEDGE_DISCARD_TEXT[o.descartado ?? "formato"]}.`;
    default:
      return `Não foi possível preparar a proposta (${o.motivo}). Tente outra vez mais tarde.`;
  }
}

// Botão "Guardar como resposta aprovada" numa resposta enviada pelo dashboard (a própria pessoa ou o Super Admin; a BD
// confirma). Uma chamada síncrona; o resultado é sempre uma proposta para o Super Admin.
export async function proposeFromMessage(viewer: Viewer, conversationId: string, messageId: string) {
  if (!aiConfigured()) throw new HttpError(503, "IA por configurar no servidor");
  const begin = await sessionRpc<KnowledgeBegin>(viewer.session, "ldo_support_knowledge_from_message", { p_message_id: messageId });
  if (begin.conversation.id !== conversationId) {
    await serverRpc("ldo_support_knowledge_propose", { p_run: begin.id, p_values: { status: "error", cost: 0, error: "conversa diferente" } }).catch(() => null);
    throw new HttpError(404, "Mensagem não encontrada nesta conversa.");
  }
  const outcome = await distill(begin, KNOWLEDGE_BUTTON_CALL_MS, KNOWLEDGE_EFFORT.botao);
  return { note: buttonNote(outcome), resultado: outcome.resultado };
}

export type DistillSummary = { lidas: number; novas: number; existentes: number; nao_aproveitaveis: number; descartadas: number; erros: number; parou?: string };

// Ordem aleatória (Fisher–Yates): a ordem dos pedidos no registo não diz qual conversa foi lida em cada um.
function shuffled<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Passagem diária (support-sync), só com "Propostas automáticas a partir das conversas" ligada: até 12 conversas, uma de
// cada vez e por ordem aleatória, 15 s por chamada, sem começar chamadas novas depois dos 90 s desde o início da função
// (started).
export async function distillPending(started: number): Promise<DistillSummary> {
  const s: DistillSummary = { lidas: 0, novas: 0, existentes: 0, nao_aproveitaveis: 0, descartadas: 0, erros: 0 };
  if (!aiConfigured()) return { ...s, parou: "sem chave da IA" };
  const ids = await serverRpc<string[]>("ldo_support_knowledge_candidates", { p_limit: KNOWLEDGE_CRON_LIMIT });
  for (const id of shuffled(ids)) {
    const now = Date.now();
    if (now - started >= KNOWLEDGE_CRON_STOP_MS) return { ...s, parou: "tempo" };
    const begin = await serverRpc<KnowledgeBegin | null>("ldo_support_knowledge_begin", { p_conversation_id: id });
    // Desligada a meio, orçamento esgotado ou conversa apagada: a passagem pára.
    if (!begin) return { ...s, parou: "definição ou orçamento" };
    const o = await distill(begin, Math.max(1000, Math.min(KNOWLEDGE_CRON_CALL_MS, started + KNOWLEDGE_CRON_END_MS - Date.now())), KNOWLEDGE_EFFORT.diaria);
    s.lidas++;
    if (o.resultado === "novo") s.novas++;
    else if (o.resultado === "existente") s.existentes++;
    else if (o.resultado === "nao_aproveitavel") s.nao_aproveitaveis++;
    else if (o.resultado === "descartado") s.descartadas++;
    else s.erros++;
  }
  return s;
}
